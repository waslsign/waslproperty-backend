import type { BankAccountStatus, BankAccountType, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { formatDateOnly, parseDateOnly } from '../../lib/dateOnly.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import type { RegisterBankAccountInput, UpdateBankAccountInput } from './bank-accounts.schemas.js';

/**
 * M16.7 — Banking & Manual Bank Reconciliation. See prisma/schema.prisma's
 * "Strata Financial Management: Banking & Manual Bank Reconciliation"
 * section doc comment for the five load-bearing decisions this milestone
 * upholds, above all point 3: the raw account identifier is NEVER
 * persisted — this service masks it and discards the original the instant
 * it's received, so "never unmasked in logs/activity events/API
 * responses" holds trivially (there is nothing unmasked left anywhere to
 * leak).
 */

/** A coarse, at-a-glance label for the account list/overview — derived
 * from its reconciliation history, never a separate stored flag (same
 * "computed, not cached" discipline as every other derived figure in this
 * module). Priority (highest first): an open draft always takes
 * precedence over a stale REOPENED one, which takes precedence over
 * "up to date". */
export type BankAccountReconciliationStatus = 'NEVER_RECONCILED' | 'UP_TO_DATE' | 'DRAFT_IN_PROGRESS' | 'REOPENED';

export interface BankAccountView {
  id: string;
  publicReference: string;
  propertyId: string;
  accountName: string;
  institutionName: string;
  accountIdentifierMasked: string;
  currencyCode: string;
  accountType: BankAccountType;
  glCashAccountId: string;
  glCashAccountCode: string;
  glCashAccountName: string;
  financialFundId: string | null;
  fundName: string | null;
  status: BankAccountStatus;
  openingReconciledBalance: string | null;
  openingReconciledDate: string | null;
  /** The periodEndDate of the latest RECONCILED reconciliation for this
   * account, or null if it has never been reconciled. */
  lastReconciledDate: string | null;
  reconciliationStatus: BankAccountReconciliationStatus;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

const INCLUDE = {
  glCashAccount: { select: { code: true, name: true } },
  financialFund: { select: { name: true } },
} as const;

type AccountWithIncludes = {
  id: string;
  publicReference: string;
  propertyId: string;
  accountName: string;
  institutionName: string;
  accountIdentifierMasked: string;
  currencyCode: string;
  accountType: BankAccountType;
  glCashAccountId: string;
  glCashAccount: { code: string; name: string };
  financialFundId: string | null;
  financialFund: { name: string } | null;
  status: BankAccountStatus;
  openingReconciledBalance: { toFixed: (n: number) => string } | null;
  openingReconciledDate: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

/** Derives the coarse reconciliation-status label + last-reconciled date
 * from an account's raw reconciliation rows — see
 * BankAccountReconciliationStatus's doc comment for the priority order. */
function deriveReconciliationSummary(
  reconciliations: Array<{ status: string; periodEndDate: Date }>,
): { lastReconciledDate: string | null; reconciliationStatus: BankAccountReconciliationStatus } {
  const hasOpenDraft = reconciliations.some((r) => r.status === 'DRAFT' || r.status === 'IN_REVIEW');
  const hasReopened = reconciliations.some((r) => r.status === 'REOPENED');
  const reconciled = reconciliations.filter((r) => r.status === 'RECONCILED');
  const lastReconciledDate =
    reconciled.length > 0
      ? formatDateOnly(reconciled.reduce((latest, r) => (r.periodEndDate > latest ? r.periodEndDate : latest), reconciled[0]!.periodEndDate))
      : null;

  let reconciliationStatus: BankAccountReconciliationStatus = 'NEVER_RECONCILED';
  if (hasOpenDraft) reconciliationStatus = 'DRAFT_IN_PROGRESS';
  else if (hasReopened) reconciliationStatus = 'REOPENED';
  else if (reconciled.length > 0) reconciliationStatus = 'UP_TO_DATE';

  return { lastReconciledDate, reconciliationStatus };
}

function toView(
  a: AccountWithIncludes,
  reconciliationSummary: { lastReconciledDate: string | null; reconciliationStatus: BankAccountReconciliationStatus },
): BankAccountView {
  return {
    id: a.id,
    publicReference: a.publicReference,
    propertyId: a.propertyId,
    accountName: a.accountName,
    institutionName: a.institutionName,
    accountIdentifierMasked: a.accountIdentifierMasked,
    currencyCode: a.currencyCode,
    accountType: a.accountType,
    glCashAccountId: a.glCashAccountId,
    glCashAccountCode: a.glCashAccount.code,
    glCashAccountName: a.glCashAccount.name,
    financialFundId: a.financialFundId,
    fundName: a.financialFund?.name ?? null,
    status: a.status,
    openingReconciledBalance: a.openingReconciledBalance ? a.openingReconciledBalance.toFixed(2) : null,
    openingReconciledDate: a.openingReconciledDate ? formatDateOnly(a.openingReconciledDate) : null,
    lastReconciledDate: reconciliationSummary.lastReconciledDate,
    reconciliationStatus: reconciliationSummary.reconciliationStatus,
    createdByUserId: a.createdByUserId,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/** Keeps only the last 4 characters of a raw account identifier visible —
 * the ONLY representation ever persisted (see this module's doc comment).
 * Works for any reasonable identifier shape (BSB+account, IBAN, a bank's
 * own masked statement text) without assuming a specific Australian
 * format, since schemes may hold accounts with non-Australian banks. */
export function maskAccountIdentifier(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '');
  if (trimmed.length <= 4) return '••••'.slice(0, Math.max(0, 4 - trimmed.length)) + trimmed;
  return `••••${trimmed.slice(-4)}`;
}

export class BankAccountsService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, organisationId } });
    if (!property) throw new NotFoundError('Property not found');
    return property;
  }

  async register(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: RegisterBankAccountInput,
  ): Promise<BankAccountView> {
    await this.getOwnedProperty(organisationId, propertyId);

    const created = await this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) {
        throw new ConflictError('Start financial setup for this property before registering a bank account.');
      }

      const glAccount = await tx.accountingAccount.findFirst({
        where: { id: input.glCashAccountId, organisationId, propertyId },
      });
      if (!glAccount) throw new NotFoundError('GL cash account not found');
      if (!glAccount.isActive) {
        throw new ConflictError(`Account ${glAccount.code} — ${glAccount.name} is deactivated.`);
      }
      if (glAccount.classification !== 'ASSET') {
        throw new ConflictError('The GL cash account for a bank account must be an ASSET-classified account.');
      }

      // Eligibility is deliberately narrower than "any ASSET account" — an
      // ASSET account like "Lot Levy Receivable" or "GST Receivable" is
      // never a real-world bank balance. The posting profile's FUND_CASH
      // role mapping is this schema's one existing, authoritative source
      // of "which accounts are actually cash" (the same role
      // LedgerPostingService/ReceiptsService already resolve when posting
      // a receipt) — reused here rather than inventing a second,
      // parallel "is this a bank account" flag on AccountingAccount.
      const cashRoleRules = await tx.postingProfileRule.findMany({
        where: { organisationId, propertyId, role: 'FUND_CASH' },
      });
      const cashRule = cashRoleRules.find((r) => r.accountId === glAccount.id);
      if (!cashRule) {
        throw new ConflictError(
          `${glAccount.code} — ${glAccount.name} is not configured as a Fund Cash account in the Posting Profile. ` +
            'Only accounts assigned the FUND_CASH role can be registered as a bank account\'s GL cash account.',
        );
      }

      if (input.financialFundId) {
        const fund = await tx.financialFund.findFirst({
          where: { id: input.financialFundId, organisationId, propertyId },
        });
        if (!fund) throw new NotFoundError('Fund not found');
        // A fund-restricted GL account must match the chosen fund, if the
        // account is restricted at all — never silently pair a bank
        // account's fund with an account that is restricted to a
        // DIFFERENT fund.
        if (glAccount.restrictedToFundId && glAccount.restrictedToFundId !== fund.id) {
          throw new ConflictError('This GL cash account is restricted to a different fund.');
        }
        // The posting profile's own FUND_CASH mapping is equally
        // authoritative on fund compatibility — a cash account mapped to
        // fund A's FUND_CASH role can never be paired with a bank
        // account declared to belong to fund B, even if the account
        // itself isn't formally fund-restricted.
        if (cashRule.financialFundId && cashRule.financialFundId !== fund.id) {
          throw new ConflictError(
            `${glAccount.code} — ${glAccount.name} is configured as the Fund Cash account for a different fund.`,
          );
        }
      }

      // Two distinct real-world bank accounts must never share one GL
      // cash account — that would double-count the same ledger balance
      // against two separate reconciliations. Deactivated bank accounts
      // are excluded: re-registering against a GL account whose prior
      // bank-account mapping was retired is a legitimate correction.
      const existingMapping = await tx.bankAccount.findFirst({
        where: { organisationId, propertyId, glCashAccountId: glAccount.id, status: 'ACTIVE' },
      });
      if (existingMapping) {
        throw new ConflictError(
          `${glAccount.code} — ${glAccount.name} is already linked to another active bank account (${existingMapping.accountName}).`,
        );
      }

      // Cross-property GL reference is already impossible by construction
      // (the account lookup above is scoped to this propertyId), but a
      // duplicate account registration against the same masked identifier
      // and institution is a useful safety prompt, not a hard block — two
      // real accounts can legitimately share a masked last-4 by
      // coincidence, so this is a ConflictError the caller can override by
      // re-confirming intent via a distinct accountName, not a silent
      // dedupe.
      const masked = maskAccountIdentifier(input.accountIdentifier);
      const duplicate = await tx.bankAccount.findFirst({
        where: {
          organisationId,
          propertyId,
          institutionName: input.institutionName,
          accountIdentifierMasked: masked,
          accountName: input.accountName,
        },
      });
      if (duplicate) {
        throw new ConflictError('A bank account with this name, institution and identifier is already registered.');
      }

      const account = await withPublicReference('BANK', (publicReference) =>
        tx.bankAccount.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            financialConfigurationId: configuration.id,
            accountName: input.accountName,
            institutionName: input.institutionName,
            accountIdentifierMasked: masked,
            currencyCode: input.currencyCode,
            accountType: input.accountType,
            glCashAccountId: glAccount.id,
            financialFundId: input.financialFundId ?? null,
            status: 'ACTIVE',
            openingReconciledBalance: input.openingReconciledBalance ?? null,
            openingReconciledDate: input.openingReconciledDate ? parseDateOnly(input.openingReconciledDate) : null,
            createdByUserId: actorUserId,
          },
        }),
      );

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_ACCOUNT_CREATED',
        entityType: 'BankAccount',
        entityId: account.id,
        title: `Bank account registered: ${account.accountName} (${masked})`,
        description: null,
      });

      return account.id;
    });

    return this.get(organisationId, propertyId, created);
  }

  async update(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    bankAccountId: string,
    input: UpdateBankAccountInput,
  ): Promise<BankAccountView> {
    await this.getOwnedProperty(organisationId, propertyId);

    await this.prisma.$transaction(async (tx) => {
      const account = await tx.bankAccount.findFirst({ where: { id: bankAccountId, organisationId, propertyId } });
      if (!account) throw new NotFoundError('Bank account not found');

      await tx.bankAccount.update({
        where: { id: bankAccountId },
        data: {
          accountName: input.accountName ?? undefined,
          status: input.status ?? undefined,
        },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_ACCOUNT_UPDATED',
        entityType: 'BankAccount',
        entityId: account.id,
        title: `Bank account updated: ${input.accountName ?? account.accountName}`,
        description: null,
      });
    });

    return this.get(organisationId, propertyId, bankAccountId);
  }

  async list(organisationId: string, propertyId: string, activeOnly: boolean): Promise<BankAccountView[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const accounts = await this.prisma.bankAccount.findMany({
      where: { organisationId, propertyId, status: activeOnly ? 'ACTIVE' : undefined },
      include: INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    if (accounts.length === 0) return [];

    const reconciliations = await this.prisma.bankReconciliation.findMany({
      where: { organisationId, propertyId, bankAccountId: { in: accounts.map((a) => a.id) } },
      select: { bankAccountId: true, status: true, periodEndDate: true },
    });
    const byAccount = new Map<string, typeof reconciliations>();
    for (const r of reconciliations) {
      const list = byAccount.get(r.bankAccountId) ?? [];
      list.push(r);
      byAccount.set(r.bankAccountId, list);
    }

    return accounts.map((a) => toView(a, deriveReconciliationSummary(byAccount.get(a.id) ?? [])));
  }

  async get(organisationId: string, propertyId: string, bankAccountId: string): Promise<BankAccountView> {
    await this.getOwnedProperty(organisationId, propertyId);
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, organisationId, propertyId },
      include: INCLUDE,
    });
    if (!account) throw new NotFoundError('Bank account not found');
    const reconciliations = await this.prisma.bankReconciliation.findMany({
      where: { organisationId, propertyId, bankAccountId },
      select: { status: true, periodEndDate: true },
    });
    return toView(account, deriveReconciliationSummary(reconciliations));
  }

  /** The same eligibility `register` enforces, surfaced for the frontend
   * so the "GL cash account" picker only ever lists accounts that would
   * actually be accepted — never an arbitrary ASSET account (a lot levy
   * receivable, GST receivable, etc.), and never one already claimed by
   * another active bank account. Single source of truth: both this and
   * `register` read the same FUND_CASH posting-profile rules. */
  async listEligibleGlAccounts(organisationId: string, propertyId: string): Promise<EligibleGlAccountView[]> {
    await this.getOwnedProperty(organisationId, propertyId);

    const [cashRules, alreadyLinked] = await Promise.all([
      this.prisma.postingProfileRule.findMany({
        where: { organisationId, propertyId, role: 'FUND_CASH' },
        include: { account: { select: { id: true, code: true, name: true, isActive: true } }, fund: { select: { id: true, name: true } } },
      }),
      this.prisma.bankAccount.findMany({
        where: { organisationId, propertyId, status: 'ACTIVE' },
        select: { glCashAccountId: true },
      }),
    ]);

    const linkedAccountIds = new Set(alreadyLinked.map((b) => b.glCashAccountId));

    return cashRules
      .filter((rule) => rule.account.isActive && !linkedAccountIds.has(rule.account.id))
      .map((rule) => ({
        accountId: rule.account.id,
        accountCode: rule.account.code,
        accountName: rule.account.name,
        financialFundId: rule.financialFundId,
        fundName: rule.fund?.name ?? null,
      }));
  }
}

export interface EligibleGlAccountView {
  accountId: string;
  accountCode: string;
  accountName: string;
  financialFundId: string | null;
  fundName: string | null;
}
