import type { AccountClassification, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/AppError.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import type { ImportAccountsApplyInput, ImportAccountsPreviewInput } from './accounts.schemas.js';
import type { AccountView } from './accounts.service.js';

/**
 * M16.2.1 — Chart of Accounts CSV import. Validated against the real
 * `expense_codes_336684074.csv` reference file (483 rows, 0 duplicate
 * codes, 480/483 rows with no `Code type`, 1 row explicitly typed
 * `Income`, 49 case-insensitive duplicate names, 1 row with an embedded
 * newline, 39 names with trailing whitespace) — see this module's test
 * fixture and the M16.2.1 ADR.
 *
 * Classifies nothing from the filename (see the requirements doc's
 * explicit warning). A row's classification is resolved, in priority
 * order: (1) an explicit `Code type` cell ("Income"/"Expense") — these are
 * real scheme data, not a guess; (2) a caller-supplied override
 * (`rowClassifications`, keyed by row number); (3) a weak name-keyword
 * heuristic, always surfaced as a non-authoritative suggestion, never
 * silently applied without being shown. A row with none of the three is
 * ERROR and blocks `apply` — AccountClassification is a required field,
 * there is no "unclassified" account.
 *
 * Preview is a pure, unpersisted computation — see AccountImportBatch's
 * doc comment on why no per-row dry-run state is ever stored between a
 * preview call and an apply call. `apply` always re-validates the same
 * file content from scratch; it never trusts a client-reported preview.
 */

export type ImportRowStatus = 'READY' | 'WARNING' | 'ERROR';
export type SuggestionConfidence = 'explicit' | 'heuristic' | 'none';

export interface ImportPreviewRow {
  rowNumber: number;
  code: string;
  name: string;
  codeType: string | null;
  suggestedClassification: AccountClassification | null;
  suggestionConfidence: SuggestionConfidence;
  resolvedClassification: AccountClassification | null;
  status: ImportRowStatus;
  issues: string[];
}

export interface ImportPreviewReport {
  fileName: string | null;
  totalRows: number;
  readyCount: number;
  warningCount: number;
  errorCount: number;
  rows: ImportPreviewRow[];
}

export interface ImportApplyResult {
  batch: { id: string; publicReference: string; totalRows: number; createdCount: number; skippedCount: number };
  accounts: AccountView[];
}

const INCOME_PATTERNS = [/levy contribution/i, /levies due/i, /interest on arrears/i, /\bincome\b/i];
const LIABILITY_PATTERNS = [/accounts payable/i, /\bpayable\b/i, /prepaid levies/i, /\bloan\b/i];
const ASSET_PATTERNS = [/cash at bank/i, /\bbank account\b/i, /\breceivable\b/i, /deposit held/i];
const EXPENSE_PATTERNS = [
  /^admin/i,
  /^maint/i,
  /insurance/i,
  /^utility/i,
  /bank charges/i,
  /legal/i,
  /cleaning/i,
  /\brepairs?\b/i,
  /\brates\b/i,
];

function suggestClassification(
  name: string,
  codeType: string | null,
): { classification: AccountClassification | null; confidence: SuggestionConfidence } {
  const normalizedType = (codeType ?? '').trim().toLowerCase();
  if (normalizedType === 'income') return { classification: 'INCOME', confidence: 'explicit' };
  if (normalizedType === 'expense') return { classification: 'EXPENSE', confidence: 'explicit' };

  if (LIABILITY_PATTERNS.some((p) => p.test(name))) {
    return { classification: 'LIABILITY', confidence: 'heuristic' };
  }
  if (ASSET_PATTERNS.some((p) => p.test(name))) {
    return { classification: 'ASSET', confidence: 'heuristic' };
  }
  if (INCOME_PATTERNS.some((p) => p.test(name))) {
    return { classification: 'INCOME', confidence: 'heuristic' };
  }
  if (EXPENSE_PATTERNS.some((p) => p.test(name))) {
    return { classification: 'EXPENSE', confidence: 'heuristic' };
  }
  return { classification: null, confidence: 'none' };
}

/** Minimal RFC4180-ish CSV parser — handles quoted fields, embedded
 * commas, embedded newlines inside quotes (the real reference CSV has one
 * such row, 160750), and "" as an escaped quote. Not a general-purpose CSV
 * library; sufficient for the Code/Name/Code-type column shape this
 * importer accepts. */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

/** Collapses an embedded newline/whitespace run to a single space and
 * trims the result — fixes the real CSV's `160750` row and the 39 rows
 * with trailing whitespace, without altering any other character. */
function normalizeCell(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export class AccountImportService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, organisationId },
    });
    if (!property) {
      throw new NotFoundError('Property not found');
    }
    return property;
  }

  private buildRows(
    csvContent: string,
    existingCodes: Set<string>,
    existingNamesLower: Set<string>,
    overrides: Record<string, AccountClassification> | undefined,
  ): ImportPreviewRow[] {
    const parsed = parseCsv(csvContent);
    const headerRow = parsed[0];
    if (parsed.length === 0 || !headerRow) {
      throw new ValidationError('The CSV file has no rows.');
    }

    const header = headerRow.map((h) => normalizeCell(h).toLowerCase());
    const codeIdx = header.findIndex((h) => h === 'code');
    const nameIdx = header.findIndex((h) => h === 'name');
    const typeIdx = header.findIndex((h) => h === 'code type' || h === 'codetype');
    if (codeIdx === -1 || nameIdx === -1) {
      throw new ValidationError('The CSV must have "Code" and "Name" columns.');
    }

    const dataRows = parsed.slice(1);
    const codeFirstSeenAt = new Map<string, number>();
    const nameLowerFirstSeenAt = new Map<string, number>();

    const rows: ImportPreviewRow[] = dataRows.map((cells, index) => {
      const rowNumber = index + 1;
      const code = normalizeCell(cells[codeIdx]);
      const name = normalizeCell(cells[nameIdx]);
      const codeType = typeIdx >= 0 ? normalizeCell(cells[typeIdx]) || null : null;

      const issues: string[] = [];
      let status: ImportRowStatus = 'READY';

      if (!code) {
        issues.push('Missing account code.');
        status = 'ERROR';
      }
      if (!name) {
        issues.push('Missing account name.');
        status = 'ERROR';
      }

      if (code) {
        const firstSeen = codeFirstSeenAt.get(code);
        if (firstSeen !== undefined) {
          issues.push(`Duplicate code — already used by row ${firstSeen} in this file.`);
          status = 'ERROR';
        } else {
          codeFirstSeenAt.set(code, rowNumber);
          if (existingCodes.has(code)) {
            issues.push(`Code "${code}" already exists on this property's chart of accounts.`);
            status = 'ERROR';
          }
        }
      }

      if (name) {
        const nameLower = name.toLowerCase();
        const firstSeen = nameLowerFirstSeenAt.get(nameLower);
        if (firstSeen !== undefined) {
          issues.push(`Possible duplicate name — also used by row ${firstSeen} in this file.`);
          if (status !== 'ERROR') status = 'WARNING';
        } else {
          nameLowerFirstSeenAt.set(nameLower, rowNumber);
          if (existingNamesLower.has(nameLower)) {
            issues.push(`An existing account on this property already has this name.`);
            if (status !== 'ERROR') status = 'WARNING';
          }
        }
      }

      const { classification: suggested, confidence } = suggestClassification(name, codeType);
      const override = overrides?.[String(rowNumber)];
      const resolved = override ?? suggested;

      if (!resolved) {
        issues.push('No classification could be suggested — choose one to continue.');
        status = 'ERROR';
      } else if (!override && confidence === 'heuristic') {
        issues.push('Classification is a suggestion based on common naming — please confirm.');
        if (status !== 'ERROR') status = 'WARNING';
      }

      return {
        rowNumber,
        code,
        name,
        codeType,
        suggestedClassification: suggested,
        suggestionConfidence: confidence,
        resolvedClassification: resolved,
        status,
        issues,
      };
    });

    return rows;
  }

  private async existingCodesAndNames(propertyId: string) {
    const accounts = await this.prisma.accountingAccount.findMany({
      where: { propertyId },
      select: { code: true, name: true },
    });
    return {
      codes: new Set(accounts.map((a) => a.code)),
      namesLower: new Set(accounts.map((a) => a.name.toLowerCase())),
    };
  }

  async preview(
    organisationId: string,
    propertyId: string,
    input: ImportAccountsPreviewInput,
  ): Promise<ImportPreviewReport> {
    await this.getOwnedProperty(organisationId, propertyId);
    const { codes, namesLower } = await this.existingCodesAndNames(propertyId);
    const rows = this.buildRows(input.csvContent, codes, namesLower, undefined);
    return summarize(rows, input.fileName ?? null);
  }

  /**
   * Re-validates the file from scratch (never trusts a prior preview) and
   * writes nothing if any row is still ERROR after applying
   * `rowClassifications` — one bad row blocks the whole batch, the same
   * all-or-nothing discipline as FinancialsService.bulkSetLotOpeningPositions.
   * Every created account and the one AccountImportBatch audit row are
   * written in a single transaction.
   */
  async apply(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: ImportAccountsApplyInput,
  ): Promise<ImportApplyResult> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) {
        throw new ConflictError(
          'Start financial setup for this property before importing its chart of accounts.',
        );
      }

      const existingAccounts = await tx.accountingAccount.findMany({
        where: { propertyId },
        select: { code: true, name: true },
      });
      const codes = new Set(existingAccounts.map((a) => a.code));
      const namesLower = new Set(existingAccounts.map((a) => a.name.toLowerCase()));

      const rows = this.buildRows(input.csvContent, codes, namesLower, input.rowClassifications);
      const blocking = rows.filter((r) => r.status === 'ERROR');
      if (blocking.length > 0) {
        throw new ValidationError(
          `${blocking.length} row(s) have blocking errors and must be resolved before this import can be applied.`,
          { blockingRows: blocking.map((r) => ({ rowNumber: r.rowNumber, issues: r.issues })) },
        );
      }

      const batch = await withPublicReference('IMP', (publicReference) =>
        tx.accountImportBatch.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            fileName: input.fileName ?? 'import.csv',
            totalRows: rows.length,
            createdCount: rows.length,
            skippedCount: 0,
            appliedByUserId: actorUserId,
          },
        }),
      );

      // Even though the duplicate-code check above re-reads this
      // property's accounts inside this same transaction, Postgres's
      // default READ COMMITTED isolation does not block a second
      // concurrent apply from reading the same "not yet taken" snapshot
      // before either commits — a genuine write-skew race, not just a
      // theoretical one. The @@unique([propertyId, code]) constraint is
      // the real backstop: a concurrent collision surfaces here as P2002,
      // which is translated into a clean ConflictError (409) so the whole
      // transaction rolls back atomically with a sane response, instead of
      // an unhandled 500.
      const createdAccounts = [];
      try {
        for (const row of rows) {
          const account = await withPublicReference('ACC', (publicReference) =>
            tx.accountingAccount.create({
              data: {
                publicReference,
                organisationId,
                propertyId,
                financialConfigurationId: configuration.id,
                code: row.code,
                name: row.name,
                classification: row.resolvedClassification as AccountClassification,
                externalCode: row.codeType,
                sourceImportBatchId: batch.id,
                createdByUserId: actorUserId,
              },
              include: { restrictedToFund: { select: { name: true } } },
            }),
          );
          createdAccounts.push(account);
        }
      } catch (err) {
        if (isCodeUniqueConstraintViolation(err)) {
          throw new ConflictError(
            'One or more account codes were just taken by a concurrent import — nothing was written. Please retry.',
          );
        }
        throw err;
      }

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_ACCOUNTS_IMPORTED',
        entityType: 'AccountImportBatch',
        entityId: batch.id,
        title: `${createdAccounts.length} account(s) imported from ${batch.fileName}`,
      });

      return {
        batch: {
          id: batch.id,
          publicReference: batch.publicReference,
          totalRows: batch.totalRows,
          createdCount: batch.createdCount,
          skippedCount: batch.skippedCount,
        },
        accounts: createdAccounts.map((a) => ({
          id: a.id,
          publicReference: a.publicReference,
          code: a.code,
          name: a.name,
          description: a.description,
          classification: a.classification,
          parentAccountId: a.parentAccountId,
          restrictedToFundId: a.restrictedToFundId,
          restrictedToFundName: a.restrictedToFund?.name ?? null,
          isActive: a.isActive,
          externalCode: a.externalCode,
          sourceTemplateLineId: a.sourceTemplateLineId,
          sourceImportBatchId: a.sourceImportBatchId,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
      };
    });
  }
}

function isCodeUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002' &&
    String((err as { meta?: { target?: unknown } }).meta?.target ?? '').includes('code')
  );
}

function summarize(rows: ImportPreviewRow[], fileName: string | null): ImportPreviewReport {
  return {
    fileName,
    totalRows: rows.length,
    readyCount: rows.filter((r) => r.status === 'READY').length,
    warningCount: rows.filter((r) => r.status === 'WARNING').length,
    errorCount: rows.filter((r) => r.status === 'ERROR').length,
    rows,
  };
}
