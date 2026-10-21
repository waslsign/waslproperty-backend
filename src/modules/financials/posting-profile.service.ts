import type { PostingRole, Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { recordActivity } from '../activity/activity.js';
import type { UpsertPostingProfileRuleInput } from './posting-profile.schemas.js';

export interface PostingProfileRuleView {
  id: string;
  role: PostingRole;
  financialFundId: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * M16.2.2 — Posting Profile. Resolves a semantic PostingRole (+ optional
 * fund) to a concrete AccountingAccount — the one indirection that keeps
 * LedgerPostingService and OpeningJournalService free of any hard-coded
 * account identity (see the "no hardcoded Australian rules in the generic
 * posting engine" safeguard; this applies equally to hard-coded account
 * codes). financials.approve only — this is configuration that controls
 * where real money postings land.
 */
export class PostingProfileService {
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

  async list(organisationId: string, propertyId: string): Promise<PostingProfileRuleView[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const rules = await this.prisma.postingProfileRule.findMany({
      where: { organisationId, propertyId },
      include: { account: { select: { code: true, name: true } } },
      orderBy: [{ role: 'asc' }],
    });
    return rules.map(toView);
  }

  /** Creates or replaces the (role, financialFundId) mapping — upsert
   * semantics so re-saving a corrected account is a single, simple call.
   * Rejects a role/fund combination that already points elsewhere via an
   * explicit pre-check (Postgres treats NULL fund values as distinct, so
   * the DB alone cannot dedupe a null-fund rule — same "service-level
   * dedup" precedent as FinancialFund's own Administration/Capital-Works
   * uniqueness rule). */
  async upsert(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: UpsertPostingProfileRuleInput,
  ): Promise<PostingProfileRuleView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) {
        throw new ConflictError(
          'Start financial setup for this property before configuring its posting profile.',
        );
      }

      const account = await tx.accountingAccount.findFirst({
        where: { id: input.accountId, organisationId, propertyId },
      });
      if (!account) {
        throw new NotFoundError('Account not found');
      }
      if (!account.isActive) {
        throw new ConflictError(
          `Account ${account.code} — ${account.name} is deactivated and can’t be used in the posting profile.`,
        );
      }

      if (input.financialFundId) {
        const fund = await tx.financialFund.findFirst({
          where: { id: input.financialFundId, organisationId, propertyId },
        });
        if (!fund) {
          throw new NotFoundError('Fund not found');
        }
      }

      const existing = await tx.postingProfileRule.findFirst({
        where: { propertyId, role: input.role, financialFundId: input.financialFundId ?? null },
      });

      const rule = existing
        ? await tx.postingProfileRule.update({
            where: { id: existing.id },
            data: { accountId: input.accountId },
            include: { account: { select: { code: true, name: true } } },
          })
        : await tx.postingProfileRule.create({
            data: {
              organisationId,
              propertyId,
              financialConfigurationId: configuration.id,
              role: input.role,
              financialFundId: input.financialFundId ?? null,
              accountId: input.accountId,
              createdByUserId: actorUserId,
            },
            include: { account: { select: { code: true, name: true } } },
          });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'FINANCIAL_POSTING_PROFILE_UPDATED',
        entityType: 'PostingProfileRule',
        entityId: rule.id,
        title: `Posting profile: ${input.role} -> ${account.code} — ${account.name}`,
      });

      return toView(rule);
    });
  }

  /** Resolves a role to an account id inside an existing transaction —
   * the one method LedgerPostingService/OpeningJournalService actually
   * call while posting. Prefers a fund-specific rule over a fund-agnostic
   * one when both exist for the same role. Throws (never guesses or
   * fabricates a fallback account) when nothing is configured — see the
   * M16.2.2 brief's "explicitly block the affected operation" safeguard. */
  async resolve(
    client: PrismaClient | Prisma.TransactionClient,
    propertyId: string,
    role: PostingRole,
    financialFundId?: string,
  ): Promise<string> {
    if (financialFundId) {
      const fundSpecific = await client.postingProfileRule.findFirst({
        where: { propertyId, role, financialFundId },
      });
      if (fundSpecific) return fundSpecific.accountId;
    }
    const general = await client.postingProfileRule.findFirst({
      where: { propertyId, role, financialFundId: null },
    });
    if (general) return general.accountId;

    throw new ConflictError(
      `No posting profile account is configured for role "${role}"${financialFundId ? ' for this fund' : ''}. Configure the posting profile before this action can post to the ledger.`,
    );
  }
}

function toView(rule: {
  id: string;
  role: PostingRole;
  financialFundId: string | null;
  accountId: string;
  account: { code: string; name: string };
  createdAt: Date;
  updatedAt: Date;
}): PostingProfileRuleView {
  return {
    id: rule.id,
    role: rule.role,
    financialFundId: rule.financialFundId,
    accountId: rule.accountId,
    accountCode: rule.account.code,
    accountName: rule.account.name,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}
