import { Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/AppError.js';
import { formatDateOnly } from '../../lib/dateOnly.js';
import { LedgerPostingService, type JournalEntryView } from './ledger-posting.service.js';
import { PostingProfileService } from './posting-profile.service.js';
import type { GenerateOpeningJournalInput } from './ledger.schemas.js';

/**
 * M16.2.2 — the one-time transition from M16.1's immutable opening
 * snapshots (FinancialOpeningBalance, LotOpeningPosition) into a posted
 * ledger journal. Per ADR-018 (D8) and the M16.2.2 brief's "no fabricated
 * opening-balance allocations" safeguard:
 *
 * - M16.1 snapshots are NEVER rewritten — this service only reads them.
 * - LotOpeningPosition has no fund dimension, so the caller must supply an
 *   explicit, exact fund split for every recorded lot's amountOwing/
 *   creditBalance. A lot left unresolved, or a split that doesn't sum
 *   exactly to the recorded amounts, blocks the whole generation (422) —
 *   never defaulted, never partially posted.
 * - Idempotent via LedgerPostingService's own exactly-once mechanism
 *   (sourceType "OPENING_BALANCE", sourceId = financialConfigurationId):
 *   calling generate() again after a successful post is a no-op that
 *   returns the existing journal, never a duplicate opening position.
 *
 * Each (fund cash, lot receivable, lot credit) movement is posted against
 * OPENING_BALANCE_EQUITY tagged with THAT SAME fund on both lines, so the
 * journal balances per-fund automatically without needing the cross-fund
 * exception — see LedgerPostingService's own doc comment.
 */
export class OpeningJournalService {
  private readonly posting: LedgerPostingService;
  private readonly profiles: PostingProfileService;

  constructor(private readonly prisma: PrismaClient) {
    this.posting = new LedgerPostingService(prisma);
    this.profiles = new PostingProfileService(prisma);
  }

  async generate(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: GenerateOpeningJournalInput,
  ): Promise<JournalEntryView> {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, organisationId },
    });
    if (!property) {
      throw new NotFoundError('Property not found');
    }

    const configuration = await this.prisma.financialConfiguration.findUnique({
      where: { propertyId },
    });
    if (!configuration) {
      throw new ConflictError('Start financial setup for this property before generating its opening journal.');
    }
    if (configuration.status !== 'ACTIVE') {
      throw new ConflictError(
        'Financial management must be ACTIVE (opening position reconciled and activated) before generating the opening journal.',
      );
    }

    const effectiveDate =
      input.effectiveDate ?? (configuration.cutoverDate ? formatDateOnly(configuration.cutoverDate) : undefined);
    if (!effectiveDate) {
      throw new ValidationError('No cutoverDate is recorded on this property and no effectiveDate was supplied.');
    }

    const [openingBalances, lotPositions] = await Promise.all([
      this.prisma.financialOpeningBalance.findMany({
        where: { propertyId },
        include: { fund: true },
      }),
      this.prisma.lotOpeningPosition.findMany({ where: { propertyId } }),
    ]);

    // --- Explicit, exact fund-split validation — never fabricated. ---
    const splitBySpace = new Map(input.lotFundSplits.map((s) => [s.spaceId, s]));
    const unresolvedLots: string[] = [];
    const mismatchedLots: { spaceId: string; reason: string }[] = [];

    for (const position of lotPositions) {
      // position.amountOwing/creditBalance are already Prisma.Decimal (read
      // straight from the immutable M16.1 snapshot) — compared exactly,
      // never via a float tolerance band (the "no arbitrary floating-point
      // monetary calculations" safeguard applies to this validation just
      // as much as to the posting itself).
      const owing = position.amountOwing;
      const credit = position.creditBalance;
      if (owing.isZero() && credit.isZero()) continue; // nothing to allocate for this lot

      const split = splitBySpace.get(position.spaceId);
      if (!split) {
        unresolvedLots.push(position.spaceId);
        continue;
      }
      const sumOwing = split.allocations.reduce(
        (sum, a) => sum.plus(a.amountOwing),
        new Prisma.Decimal(0),
      );
      const sumCredit = split.allocations.reduce(
        (sum, a) => sum.plus(a.creditBalance),
        new Prisma.Decimal(0),
      );
      if (!sumOwing.equals(owing)) {
        mismatchedLots.push({
          spaceId: position.spaceId,
          reason: `allocated amountOwing (${sumOwing.toFixed(2)}) does not equal the recorded amount (${owing.toFixed(2)})`,
        });
      }
      if (!sumCredit.equals(credit)) {
        mismatchedLots.push({
          spaceId: position.spaceId,
          reason: `allocated creditBalance (${sumCredit.toFixed(2)}) does not equal the recorded amount (${credit.toFixed(2)})`,
        });
      }
    }

    if (unresolvedLots.length > 0 || mismatchedLots.length > 0) {
      throw new ValidationError(
        'Every lot with a nonzero opening position needs an exact fund-split allocation before the opening journal can be generated.',
        { unresolvedLots, mismatchedLots },
      );
    }

    // --- Resolve posting-profile accounts. ---
    const fundCashRoleFor = (fundId: string) =>
      this.profiles.resolve(this.prisma, propertyId, 'FUND_CASH', fundId);
    const lotReceivableRoleFor = (fundId: string) =>
      this.profiles.resolve(this.prisma, propertyId, 'LOT_LEVY_RECEIVABLE', fundId);
    const unappliedCashRoleFor = (fundId: string) =>
      this.profiles.resolve(this.prisma, propertyId, 'UNAPPLIED_CASH', fundId);
    const equityRoleFor = (fundId: string) =>
      this.profiles.resolve(this.prisma, propertyId, 'OPENING_BALANCE_EQUITY', fundId);

    const lines: {
      accountId: string;
      financialFundId: string;
      debit: number;
      credit: number;
      lineNarration?: string;
    }[] = [];

    for (const balance of openingBalances) {
      const amount = Number(balance.amount);
      if (amount === 0) continue;
      const [cashAccountId, equityAccountId] = await Promise.all([
        fundCashRoleFor(balance.financialFundId),
        equityRoleFor(balance.financialFundId),
      ]);
      lines.push({
        accountId: cashAccountId,
        financialFundId: balance.financialFundId,
        debit: amount,
        credit: 0,
        lineNarration: `Opening cash balance — ${balance.fund.name}`,
      });
      lines.push({
        accountId: equityAccountId,
        financialFundId: balance.financialFundId,
        debit: 0,
        credit: amount,
        lineNarration: `Opening cash balance — ${balance.fund.name}`,
      });
    }

    for (const position of lotPositions) {
      const split = splitBySpace.get(position.spaceId);
      if (!split) continue;
      for (const allocation of split.allocations) {
        if (allocation.amountOwing > 0) {
          const [receivableAccountId, equityAccountId] = await Promise.all([
            lotReceivableRoleFor(allocation.financialFundId),
            equityRoleFor(allocation.financialFundId),
          ]);
          lines.push({
            accountId: receivableAccountId,
            financialFundId: allocation.financialFundId,
            debit: allocation.amountOwing,
            credit: 0,
            lineNarration: `Opening lot receivable — space ${position.spaceId}`,
          });
          lines.push({
            accountId: equityAccountId,
            financialFundId: allocation.financialFundId,
            debit: 0,
            credit: allocation.amountOwing,
            lineNarration: `Opening lot receivable — space ${position.spaceId}`,
          });
        }
        if (allocation.creditBalance > 0) {
          const [unappliedAccountId, equityAccountId] = await Promise.all([
            unappliedCashRoleFor(allocation.financialFundId),
            equityRoleFor(allocation.financialFundId),
          ]);
          lines.push({
            accountId: equityAccountId,
            financialFundId: allocation.financialFundId,
            debit: allocation.creditBalance,
            credit: 0,
            lineNarration: `Opening lot credit balance — space ${position.spaceId}`,
          });
          lines.push({
            accountId: unappliedAccountId,
            financialFundId: allocation.financialFundId,
            debit: 0,
            credit: allocation.creditBalance,
            lineNarration: `Opening lot credit balance — space ${position.spaceId}`,
          });
        }
      }
    }

    if (lines.length === 0) {
      throw new ValidationError('There is no nonzero opening balance or lot position to post.');
    }

    return this.posting.post(organisationId, actorUserId, propertyId, {
      effectiveDate,
      currencyCode: configuration.currencyCode ?? undefined,
      sourceType: 'OPENING_BALANCE',
      sourceId: configuration.id,
      sourceEventVersion: 1,
      narration: `Opening balance journal — ${property.name}`,
      lines,
    });
  }
}
