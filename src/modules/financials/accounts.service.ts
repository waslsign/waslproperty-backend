import type { AccountClassification, Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/AppError.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import type {
  CreateAccountInput,
  ListAccountsQuery,
  UpdateAccountInput,
} from './accounts.schemas.js';

export interface AccountView {
  id: string;
  publicReference: string;
  code: string;
  name: string;
  description: string | null;
  classification: AccountClassification;
  parentAccountId: string | null;
  restrictedToFundId: string | null;
  restrictedToFundName: string | null;
  isActive: boolean;
  externalCode: string | null;
  sourceTemplateLineId: string | null;
  sourceImportBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

type AccountWithFund = Prisma.AccountingAccountGetPayload<{
  include: { restrictedToFund: { select: { name: true } } };
}>;

/**
 * M16.2.1 — Chart of Accounts. See prisma/schema.prisma's "Strata
 * Financial Management: Chart of Accounts" section doc comment for the
 * three load-bearing design decisions (scheme-specific, fund-flexible,
 * deactivate-not-delete) every method here upholds. Mirrors
 * FinancialsService/FinancialBudgetsService's structure deliberately —
 * same organisation/property ownership checks, same publicReference
 * discipline, same recordActivity-inside-the-transaction pattern.
 */
export class AccountsService {
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

  /** Accounts may be set up any time financial onboarding has started —
   * unlike budgets, the chart of accounts is not gated on activation, so a
   * manager can build it out while FinancialConfiguration is still
   * SETUP_IN_PROGRESS. */
  private async getConfiguration(client: PrismaClient | Prisma.TransactionClient, propertyId: string) {
    const configuration = await client.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration) {
      throw new ConflictError(
        'Start financial setup for this property before managing its chart of accounts.',
      );
    }
    return configuration;
  }

  private async getOwnedAccount(
    client: PrismaClient | Prisma.TransactionClient,
    organisationId: string,
    propertyId: string,
    accountId: string,
  ): Promise<AccountWithFund> {
    const account = await client.accountingAccount.findFirst({
      where: { id: accountId, organisationId, propertyId },
      include: { restrictedToFund: { select: { name: true } } },
    });
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    return account;
  }

  /** `code` uniqueness is enforced per-property (see @@unique on the
   * model) — this is a pre-check for a clean 409 message; the DB
   * constraint is the real backstop against a concurrent duplicate. */
  private async assertCodeAvailable(
    client: PrismaClient | Prisma.TransactionClient,
    propertyId: string,
    code: string,
    excludeAccountId?: string,
  ): Promise<void> {
    const existing = await client.accountingAccount.findFirst({
      where: { propertyId, code, ...(excludeAccountId ? { NOT: { id: excludeAccountId } } : {}) },
    });
    if (existing) {
      throw new ConflictError(`An account with code "${code}" already exists for this property.`);
    }
  }

  async list(
    organisationId: string,
    propertyId: string,
    query: ListAccountsQuery,
  ): Promise<AccountView[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const accounts = await this.prisma.accountingAccount.findMany({
      where: {
        organisationId,
        propertyId,
        classification: query.classification,
        restrictedToFundId: query.fundId,
        isActive: query.activeOnly ? true : undefined,
        ...(query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { restrictedToFund: { select: { name: true } } },
      orderBy: [{ classification: 'asc' }, { code: 'asc' }],
    });
    return accounts.map(toView);
  }

  async create(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: CreateAccountInput,
  ): Promise<AccountView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await this.getConfiguration(tx, propertyId);
      await this.assertCodeAvailable(tx, propertyId, input.code);

      if (input.parentAccountId) {
        await this.getOwnedAccount(tx, organisationId, propertyId, input.parentAccountId);
      }
      if (input.restrictedToFundId) {
        const fund = await tx.financialFund.findFirst({
          where: { id: input.restrictedToFundId, organisationId, propertyId },
        });
        if (!fund) {
          throw new NotFoundError('Fund not found');
        }
      }

      let account: AccountWithFund;
      try {
        account = await withPublicReference('ACC', (publicReference) =>
          tx.accountingAccount.create({
            data: {
              publicReference,
              organisationId,
              propertyId,
              financialConfigurationId: configuration.id,
              code: input.code,
              name: input.name,
              description: input.description ?? null,
              classification: input.classification,
              parentAccountId: input.parentAccountId ?? null,
              restrictedToFundId: input.restrictedToFundId ?? null,
              externalCode: input.externalCode ?? null,
              createdByUserId: actorUserId,
            },
            include: { restrictedToFund: { select: { name: true } } },
          }),
        );
      } catch (err) {
        if (isUniqueConstraintViolation(err)) {
          throw new ConflictError(
            `An account with code "${input.code}" already exists for this property.`,
          );
        }
        throw err;
      }

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_ACCOUNT_CREATED',
        entityType: 'AccountingAccount',
        entityId: account.id,
        title: `Account ${account.code} — ${account.name} added`,
      });

      return toView(account);
    });
  }

  /** `code` is never editable here — see UpdateAccountInput's doc comment.
   * `parentAccountId: null` clears it; `undefined` leaves it unchanged. */
  async update(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    accountId: string,
    input: UpdateAccountInput,
  ): Promise<AccountView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const account = await this.getOwnedAccount(tx, organisationId, propertyId, accountId);

      if (input.parentAccountId) {
        if (input.parentAccountId === accountId) {
          throw new ValidationError('An account cannot be its own parent.');
        }
        const parent = await this.getOwnedAccount(tx, organisationId, propertyId, input.parentAccountId);
        if (parent.parentAccountId === accountId) {
          throw new ValidationError('This would create a circular parent/child relationship.');
        }
      }
      if (input.restrictedToFundId) {
        const fund = await tx.financialFund.findFirst({
          where: { id: input.restrictedToFundId, organisationId, propertyId },
        });
        if (!fund) {
          throw new NotFoundError('Fund not found');
        }
      }

      const updated = await tx.accountingAccount.update({
        where: { id: account.id },
        data: {
          name: input.name,
          description: input.description === undefined ? undefined : input.description,
          classification: input.classification,
          parentAccountId: input.parentAccountId === undefined ? undefined : input.parentAccountId,
          restrictedToFundId:
            input.restrictedToFundId === undefined ? undefined : input.restrictedToFundId,
        },
        include: { restrictedToFund: { select: { name: true } } },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_ACCOUNT_UPDATED',
        entityType: 'AccountingAccount',
        entityId: updated.id,
        title: `Account ${updated.code} — ${updated.name} updated`,
      });

      return toView(updated);
    });
  }

  /** Deactivate, never delete — see this module's doc comment. Idempotent:
   * deactivating an already-inactive account is a no-op, not an error
   * (matches FinancialsService.activate's own idempotent-for-already-done
   * convention). */
  async deactivate(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    accountId: string,
  ): Promise<AccountView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const account = await this.getOwnedAccount(tx, organisationId, propertyId, accountId);
      if (!account.isActive) {
        return toView(account);
      }

      const updated = await tx.accountingAccount.update({
        where: { id: account.id },
        data: { isActive: false },
        include: { restrictedToFund: { select: { name: true } } },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_ACCOUNT_DEACTIVATED',
        entityType: 'AccountingAccount',
        entityId: updated.id,
        title: `Account ${updated.code} — ${updated.name} deactivated`,
      });

      return toView(updated);
    });
  }

  async reactivate(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    accountId: string,
  ): Promise<AccountView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const account = await this.getOwnedAccount(tx, organisationId, propertyId, accountId);
      if (account.isActive) {
        return toView(account);
      }

      const updated = await tx.accountingAccount.update({
        where: { id: account.id },
        data: { isActive: true },
        include: { restrictedToFund: { select: { name: true } } },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_ACCOUNT_UPDATED',
        entityType: 'AccountingAccount',
        entityId: updated.id,
        title: `Account ${updated.code} — ${updated.name} reactivated`,
      });

      return toView(updated);
    });
  }

  /** Plain CSV text — same columns as the input import format (Code,
   * Name, Code type, Classification, Fund, Active) — so an export can be
   * re-imported unchanged. */
  async exportCsv(organisationId: string, propertyId: string): Promise<string> {
    await this.getOwnedProperty(organisationId, propertyId);
    const accounts = await this.prisma.accountingAccount.findMany({
      where: { organisationId, propertyId },
      include: { restrictedToFund: { select: { name: true } } },
      orderBy: [{ classification: 'asc' }, { code: 'asc' }],
    });
    const header = 'Code,Name,Classification,Fund,Active,External Code';
    const rows = accounts.map((a) =>
      [
        csvField(a.code),
        csvField(a.name),
        csvField(a.classification),
        csvField(a.restrictedToFund?.name ?? 'Any Fund'),
        csvField(a.isActive ? 'Active' : 'Inactive'),
        csvField(a.externalCode ?? ''),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }
}

function toView(account: AccountWithFund): AccountView {
  return {
    id: account.id,
    publicReference: account.publicReference,
    code: account.code,
    name: account.name,
    description: account.description,
    classification: account.classification,
    parentAccountId: account.parentAccountId,
    restrictedToFundId: account.restrictedToFundId,
    restrictedToFundName: account.restrictedToFund?.name ?? null,
    isActive: account.isActive,
    externalCode: account.externalCode,
    sourceTemplateLineId: account.sourceTemplateLineId,
    sourceImportBatchId: account.sourceImportBatchId,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

function csvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}
