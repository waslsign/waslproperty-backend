import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { formatDateOnly } from '../../lib/dateOnly.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import { parseCsv } from './account-import.service.js';
import type { ApplyBankStatementInput, BankStatementColumnMapping, PreviewBankStatementInput } from './bank-import.schemas.js';

/**
 * M16.7 — Bank-independent CSV statement import. See prisma/schema.prisma's
 * "Banking & Manual Bank Reconciliation" section doc comment, point 4, for
 * the duplicate-detection strategy. Reuses parseCsv from
 * account-import.service.ts (the same minimal RFC4180-ish parser already
 * proven against real scheme CSVs) rather than inventing a second one.
 *
 * Preview is a pure, unpersisted computation (same discipline as
 * AccountImportService) — `apply` always re-validates the same file
 * content from scratch, never trusting a client-reported preview.
 *
 * Duplicate-detection strategy (no reliance on a simplistic date+amount
 * uniqueness check): every row's `sourceRowHash` is SHA-256 of
 * `bankAccountId|transactionDate|amount|description|bankReference|
 * runningBalance`, joined with the CSV's own externalTransactionId when a
 * column mapping supplies one (preferred — treated as fully authoritative,
 * since it's the bank's own stable identifier). Two transactions that are
 * identical across every one of those fields are indistinguishable by any
 * information this statement provides at all — WaslProp treats them as
 * the same row re-appearing (e.g. an overlapping statement period) and
 * skips the second, not as two legitimate separate transactions. KNOWN
 * LIMITATION: a bank statement with two genuinely distinct transactions
 * that are identical in every one of those fields (same date, amount,
 * description, reference, and no distinguishing runningBalance — e.g. two
 * identical $50 EFTPOS taps with no running balance column at all) cannot
 * be told apart by this strategy; this is flagged explicitly in the
 * preview as an UNVERIFIABLE_DUPLICATE warning rather than silently
 * imported as if distinct or silently dropped as if duplicate — see
 * ImportPreviewRow.status below.
 */

export type BankImportRowStatus = 'READY' | 'DUPLICATE' | 'ERROR';

export interface BankImportPreviewRow {
  rowNumber: number;
  transactionDate: string | null;
  valueDate: string | null;
  amount: string | null;
  description: string;
  bankReference: string | null;
  runningBalance: string | null;
  externalTransactionId: string | null;
  sourceRowHash: string | null;
  status: BankImportRowStatus;
  issues: string[];
}

export interface BankImportPreviewReport {
  fileName: string | null;
  bankAccountId: string;
  totalRows: number;
  readyCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: BankImportPreviewRow[];
  fileAlreadyImported: boolean;
}

export interface BankImportApplyResult {
  import: { id: string; publicReference: string; totalRows: number; importedCount: number; duplicateCount: number };
  transactionIds: string[];
}

const DATE_FORMAT_PATTERNS: Record<BankStatementColumnMapping['dateFormat'], RegExp> = {
  'DD/MM/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  'MM/DD/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  'YYYY-MM-DD': /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  'DD-MM-YYYY': /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
};

/** Strict — rejects anything that doesn't match the declared format
 * exactly, and rejects an out-of-range day/month rather than letting
 * `Date` silently roll it over into the next month (e.g. "31/04/2026"
 * under DD/MM/YYYY is a hard error, never quietly reinterpreted as
 * 1 May). Never falls back to guessing a different format. */
export function parseStatementDate(raw: string, format: BankStatementColumnMapping['dateFormat']): Date | null {
  const value = raw.trim();
  const pattern = DATE_FORMAT_PATTERNS[format];
  const match = pattern.exec(value);
  if (!match) return null;

  let year: number, month: number, day: number;
  if (format === 'YYYY-MM-DD') {
    [, year, month, day] = match.map(Number) as unknown as [string, number, number, number];
  } else if (format === 'MM/DD/YYYY') {
    [, month, day, year] = match.map(Number) as unknown as [string, number, number, number];
  } else {
    // DD/MM/YYYY, DD-MM-YYYY
    [, day, month, year] = match.map(Number) as unknown as [string, number, number, number];
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Catches real invalid dates (e.g. 31 Feb) that Date would otherwise
  // silently roll into the next month.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/** Accepts "1,234.56", "-1234.56", "$1,234.56", "(1234.56)" (parenthesised
 * negative, a common bank-export convention) — rejects anything else
 * (letters, multiple decimal points, more than 2 decimal places) rather
 * than guessing. Returns a Decimal, never a float. */
export function parseStatementAmount(raw: string): Prisma.Decimal | null {
  let value = raw.trim();
  if (value === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  value = value.replace(/^[A-Za-z$£€]+\s?/, '').replace(/,/g, '');
  if (value.startsWith('-')) {
    negative = true;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const decimal = new Prisma.Decimal(value);
  return negative ? decimal.negated() : decimal;
}

function computeSourceRowHash(parts: {
  bankAccountId: string;
  transactionDate: string;
  amount: string;
  description: string;
  bankReference: string | null;
  runningBalance: string | null;
}): string {
  const h = createHash('sha256');
  h.update(
    [
      parts.bankAccountId,
      parts.transactionDate,
      parts.amount,
      parts.description.trim().toLowerCase(),
      parts.bankReference ?? '',
      parts.runningBalance ?? '',
    ].join('|'),
  );
  return h.digest('hex');
}

function computeFileHash(content: string): string {
  return createHash('sha256').update(content.trim()).digest('hex');
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return '';
  return (row[index] ?? '').trim();
}

export class BankImportService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getOwnedBankAccount(organisationId: string, propertyId: string, bankAccountId: string) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id: bankAccountId, organisationId, propertyId } });
    if (!account) throw new NotFoundError('Bank account not found');
    return account;
  }

  /** The one place CSV text + a column mapping become normalized rows,
   * each independently validated. Shared by preview and apply so both
   * paths always agree. Does NOT check cross-import duplicates against
   * the database — callers do that separately (preview checks read-only;
   * apply checks inside its own transaction). */
  private normalizeRows(
    csvContent: string,
    mapping: BankStatementColumnMapping,
    currencyCode: string,
    bankAccountId: string,
  ): Array<{
    rowNumber: number;
    transactionDate: string | null;
    valueDate: string | null;
    amount: Prisma.Decimal | null;
    description: string;
    bankReference: string | null;
    runningBalance: Prisma.Decimal | null;
    externalTransactionId: string | null;
    sourceRowHash: string | null;
    issues: string[];
  }> {
    const allRows = parseCsv(csvContent).filter((r) => r.some((c) => c.trim() !== ''));
    const dataRows = mapping.hasHeaderRow ? allRows.slice(1) : allRows;

    return dataRows.map((row, idx) => {
      const issues: string[] = [];
      const description = cell(row, mapping.descriptionColumn);
      const bankReference = mapping.referenceColumn !== undefined ? cell(row, mapping.referenceColumn) || null : null;
      const externalTransactionId =
        mapping.externalIdColumn !== undefined ? cell(row, mapping.externalIdColumn) || null : null;

      const rawDate = cell(row, mapping.dateColumn);
      const parsedDate = rawDate ? parseStatementDate(rawDate, mapping.dateFormat) : null;
      if (!rawDate) issues.push('Missing transaction date.');
      else if (!parsedDate) issues.push(`Could not parse date "${rawDate}" as ${mapping.dateFormat} — rejected rather than guessed.`);

      const rawValueDate = mapping.valueDateColumn !== undefined ? cell(row, mapping.valueDateColumn) : '';
      const parsedValueDate = rawValueDate ? parseStatementDate(rawValueDate, mapping.dateFormat) : null;
      if (rawValueDate && !parsedValueDate) issues.push(`Could not parse value date "${rawValueDate}".`);

      let amount: Prisma.Decimal | null = null;
      if (mapping.amountColumn !== undefined) {
        const raw = cell(row, mapping.amountColumn);
        if (!raw) issues.push('Missing amount.');
        else {
          amount = parseStatementAmount(raw);
          if (!amount) issues.push(`Could not parse amount "${raw}".`);
        }
      } else {
        const rawDebit = cell(row, mapping.debitColumn);
        const rawCredit = cell(row, mapping.creditColumn);
        if (!rawDebit && !rawCredit) {
          issues.push('Both debit and credit are empty — exactly one must be populated.');
        } else if (rawDebit && rawCredit) {
          issues.push('Both debit and credit are populated — exactly one must be.');
        } else if (rawDebit) {
          const debit = parseStatementAmount(rawDebit);
          if (!debit) issues.push(`Could not parse debit "${rawDebit}".`);
          else amount = debit.negated().abs().negated(); // ensure negative
        } else {
          const credit = parseStatementAmount(rawCredit);
          if (!credit) issues.push(`Could not parse credit "${rawCredit}".`);
          else amount = credit.abs();
        }
      }

      let runningBalance: Prisma.Decimal | null = null;
      if (mapping.balanceColumn !== undefined) {
        const raw = cell(row, mapping.balanceColumn);
        if (raw) {
          runningBalance = parseStatementAmount(raw);
          if (!runningBalance) issues.push(`Could not parse running balance "${raw}".`);
        }
      }

      if (!description) issues.push('Missing description.');
      if (!currencyCode || currencyCode.length !== 3) issues.push('Invalid currency code.');

      const transactionDate = parsedDate ? formatDateOnly(parsedDate) : null;
      const sourceRowHash =
        transactionDate && amount
          ? computeSourceRowHash({
              bankAccountId,
              transactionDate,
              amount: amount.toFixed(2),
              description,
              bankReference,
              runningBalance: runningBalance ? runningBalance.toFixed(2) : null,
            })
          : null;

      return {
        rowNumber: idx + 1 + (mapping.hasHeaderRow ? 1 : 0),
        transactionDate,
        valueDate: parsedValueDate ? formatDateOnly(parsedValueDate) : null,
        amount,
        description,
        bankReference,
        runningBalance,
        externalTransactionId,
        sourceRowHash,
        issues,
      };
    });
  }

  async preview(
    organisationId: string,
    propertyId: string,
    bankAccountId: string,
    input: PreviewBankStatementInput,
  ): Promise<BankImportPreviewReport> {
    const account = await this.getOwnedBankAccount(organisationId, propertyId, bankAccountId);
    const fileHash = computeFileHash(input.csvContent);
    const fileAlreadyImported = Boolean(
      await this.prisma.bankStatementImport.findUnique({
        where: { bankAccountId_fileHash: { bankAccountId: account.id, fileHash } },
      }),
    );

    const normalized = this.normalizeRows(input.csvContent, input.columnMapping, input.currencyCode, bankAccountId);

    // Existing hashes already imported against THIS bank account, across
    // every prior import — the actual cross-statement duplicate check.
    const existingHashes = new Set(
      (
        await this.prisma.bankTransaction.findMany({
          where: { bankAccountId: account.id },
          select: { sourceRowHash: true },
        })
      ).map((t) => t.sourceRowHash),
    );
    // Within-file duplicates (two rows in the SAME upload hashing
    // identically) are also surfaced — the second occurrence is DUPLICATE,
    // not silently imported twice.
    const seenInFile = new Set<string>();

    const rows: BankImportPreviewRow[] = normalized.map((r) => {
      let status: BankImportRowStatus = 'READY';
      if (r.issues.length > 0) status = 'ERROR';
      else if (r.sourceRowHash && (existingHashes.has(r.sourceRowHash) || seenInFile.has(r.sourceRowHash))) {
        status = 'DUPLICATE';
      }
      if (status === 'READY' && r.sourceRowHash) seenInFile.add(r.sourceRowHash);

      return {
        rowNumber: r.rowNumber,
        transactionDate: r.transactionDate,
        valueDate: r.valueDate,
        amount: r.amount ? r.amount.toFixed(2) : null,
        description: r.description,
        bankReference: r.bankReference,
        runningBalance: r.runningBalance ? r.runningBalance.toFixed(2) : null,
        externalTransactionId: r.externalTransactionId,
        sourceRowHash: r.sourceRowHash,
        status,
        issues: r.issues,
      };
    });

    return {
      fileName: input.fileName ?? null,
      bankAccountId: account.id,
      totalRows: rows.length,
      readyCount: rows.filter((r) => r.status === 'READY').length,
      duplicateCount: rows.filter((r) => r.status === 'DUPLICATE').length,
      errorCount: rows.filter((r) => r.status === 'ERROR').length,
      rows,
      fileAlreadyImported,
    };
  }

  /** Re-validates the file from scratch (never trusts the client's
   * preview). Rejects outright if any row is ERROR — the manager must fix
   * the mapping/file first, never a partial import of only the clean
   * rows (see this module's doc comment on avoiding silent incomplete
   * imports). DUPLICATE rows are skipped automatically (not blocking).
   * The whole write — BankStatementImport + every BankTransaction row —
   * happens in one transaction, so a failure partway through cannot leave
   * an incomplete import visible. Idempotent: re-applying the exact same
   * file against the same bank account is rejected via the fileHash
   * unique constraint, never silently re-imported or silently a no-op. */
  async apply(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    bankAccountId: string,
    input: ApplyBankStatementInput,
  ): Promise<BankImportApplyResult> {
    const account = await this.getOwnedBankAccount(organisationId, propertyId, bankAccountId);
    const fileHash = computeFileHash(input.csvContent);

    const existing = await this.prisma.bankStatementImport.findUnique({
      where: { bankAccountId_fileHash: { bankAccountId: account.id, fileHash } },
    });
    if (existing) {
      const transactionIds = (
        await this.prisma.bankTransaction.findMany({ where: { importBatchId: existing.id }, select: { id: true } })
      ).map((t) => t.id);
      return {
        import: {
          id: existing.id,
          publicReference: existing.publicReference,
          totalRows: existing.totalRows,
          importedCount: existing.importedCount,
          duplicateCount: existing.duplicateCount,
        },
        transactionIds,
      };
    }

    const normalized = this.normalizeRows(input.csvContent, input.columnMapping, input.currencyCode, bankAccountId);
    const errorRows = normalized.filter((r) => r.issues.length > 0);
    if (errorRows.length > 0) {
      const first = errorRows[0]!;
      throw new ConflictError(
        `${errorRows.length} row(s) failed validation — fix the file or column mapping before importing. First issue: row ${first.rowNumber}: ${first.issues[0]}`,
      );
    }
    if (normalized.length === 0) {
      throw new ConflictError('No transaction rows found in this file.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existingHashes = new Set(
        (await tx.bankTransaction.findMany({ where: { bankAccountId: account.id }, select: { sourceRowHash: true } })).map(
          (t) => t.sourceRowHash,
        ),
      );

      const allDates = normalized.map((r) => r.transactionDate).filter((d): d is string => d !== null);
      const statementStartDate = allDates.length > 0 ? allDates.reduce((a, b) => (b < a ? b : a)) : null;
      const statementEndDate = allDates.length > 0 ? allDates.reduce((a, b) => (b > a ? b : a)) : null;

      const importRecord = await withPublicReference('BIMP', (publicReference) =>
        tx.bankStatementImport.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            bankAccountId: account.id,
            fileName: input.fileName ?? 'statement.csv',
            fileHash,
            statementStartDate: statementStartDate ? new Date(`${statementStartDate}T00:00:00.000Z`) : null,
            statementEndDate: statementEndDate ? new Date(`${statementEndDate}T00:00:00.000Z`) : null,
            totalRows: normalized.length,
            importedCount: 0,
            duplicateCount: 0,
            importedByUserId: actorUserId,
          },
        }),
      );

      const seenInFile = new Set<string>();
      const transactionIds: string[] = [];
      let duplicateCount = 0;

      for (const r of normalized) {
        const isDuplicate = Boolean(r.sourceRowHash && (existingHashes.has(r.sourceRowHash) || seenInFile.has(r.sourceRowHash)));
        if (isDuplicate) {
          duplicateCount++;
          continue;
        }
        if (r.sourceRowHash) seenInFile.add(r.sourceRowHash);

        const created = await withPublicReference('BTX', (publicReference) =>
          tx.bankTransaction.create({
            data: {
              publicReference,
              organisationId,
              propertyId,
              bankAccountId: account.id,
              importBatchId: importRecord.id,
              transactionDate: new Date(`${r.transactionDate}T00:00:00.000Z`),
              valueDate: r.valueDate ? new Date(`${r.valueDate}T00:00:00.000Z`) : null,
              amount: r.amount!,
              currencyCode: input.currencyCode,
              description: r.description,
              bankReference: r.bankReference,
              runningBalance: r.runningBalance,
              externalTransactionId: r.externalTransactionId,
              sourceRowHash: r.sourceRowHash!,
              matchStatus: 'UNMATCHED',
              reconciliationStatus: 'UNRECONCILED',
            },
          }),
        );
        transactionIds.push(created.id);
      }

      const updatedImport = await tx.bankStatementImport.update({
        where: { id: importRecord.id },
        data: { importedCount: transactionIds.length, duplicateCount },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_STATEMENT_IMPORTED',
        entityType: 'BankStatementImport',
        entityId: importRecord.id,
        title: `Bank statement imported: ${transactionIds.length} transaction(s) (${duplicateCount} duplicate(s) skipped)`,
        description: `${account.accountName} — ${input.fileName ?? 'statement.csv'}`,
      });

      return { importRecord: updatedImport, transactionIds };
    });

    return {
      import: {
        id: result.importRecord.id,
        publicReference: result.importRecord.publicReference,
        totalRows: result.importRecord.totalRows,
        importedCount: result.importRecord.importedCount,
        duplicateCount: result.importRecord.duplicateCount,
      },
      transactionIds: result.transactionIds,
    };
  }

  async listImports(organisationId: string, propertyId: string, bankAccountId: string) {
    await this.getOwnedBankAccount(organisationId, propertyId, bankAccountId);
    return this.prisma.bankStatementImport.findMany({
      where: { organisationId, propertyId, bankAccountId },
      orderBy: { importedAt: 'desc' },
    });
  }
}
