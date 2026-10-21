import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/AppError.js';
import { formatDateOnly, parseDateOnly } from '../../lib/dateOnly.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import { AccountingPeriodsService } from './accounting-periods.service.js';
import type { JournalLineInput } from './ledger.schemas.js';

export interface JournalLineView {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  financialFundId: string;
  fundName: string;
  debit: string;
  credit: string;
  lineNarration: string | null;
  sortOrder: number;
}

export interface JournalEntryView {
  id: string;
  publicReference: string;
  accountingPeriodId: string;
  effectiveDate: string;
  postedAt: string;
  currencyCode: string;
  sourceType: string;
  sourceId: string;
  sourceEventVersion: number;
  narration: string;
  postedByUserId: string;
  reversalOfJournalId: string | null;
  reversalReason: string | null;
  totalDebit: string;
  lines: JournalLineView[];
}

type JournalWithLines = Prisma.JournalEntryGetPayload<{
  include: {
    lines: { include: { account: { select: { code: true; name: true } } }; orderBy: { sortOrder: 'asc' } };
  };
}>;

export interface PostCommand {
  effectiveDate: string;
  currencyCode?: string;
  sourceType: string;
  sourceId: string;
  sourceEventVersion?: number;
  narration: string;
  lines: JournalLineInput[];
  /** Explicitly acknowledges that this posting legitimately moves value
   * between funds (see this service's doc comment on the per-fund balance
   * check) — never set implicitly. */
  allowCrossFund?: boolean;
}

const JOURNAL_LINE_INCLUDE = {
  lines: {
    include: { account: { select: { code: true, name: true } } },
    orderBy: { sortOrder: 'asc' as const },
  },
} satisfies Prisma.JournalEntryInclude;

/**
 * M16.2.2 — the ONE place a JournalEntry/JournalLine row is ever written.
 * See prisma/schema.prisma's "General Ledger & Posting Engine" section doc
 * comment for the five load-bearing decisions this class upholds:
 * POSTED-on-creation (no DRAFT), sole-writer, exactly-once idempotency,
 * Decimal(14,2), and fund-balanced lines unless explicitly flagged as an
 * inter-fund transfer. Every business module (future levies/AP/banking)
 * calls `post()` with a typed command — none of them touch journal_entries/
 * journal_lines directly.
 *
 * `post()` and `reverse()` both fully execute inside one database
 * transaction each (`postInTransaction` is the shared core so a reversal's
 * posting, its reversalOfJournalId link, and its audit record are either
 * all committed together or none are — never a reversal that posted but
 * left its link unset, or vice versa).
 */
export class LedgerPostingService {
  private readonly periods: AccountingPeriodsService;

  constructor(private readonly prisma: PrismaClient) {
    this.periods = new AccountingPeriodsService(prisma);
  }

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, organisationId },
    });
    if (!property) {
      throw new NotFoundError('Property not found');
    }
    return property;
  }

  /**
   * Posts one balanced journal. Idempotent: a repeat call with the same
   * (propertyId, sourceType, sourceId, sourceEventVersion) is a no-op that
   * returns the original journal unchanged — never a second posting, never
   * an error. Concurrency-safe: every write for this property is
   * serialized through the same FinancialConfiguration row lock
   * FinancialBudgetsService.activate already uses, so two simultaneous
   * posts for the same source key can never both decide "nothing exists
   * yet" and both insert.
   */
  async post(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    command: PostCommand,
  ): Promise<JournalEntryView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const { journal, fundNames } = await this.postInTransaction(
        tx,
        organisationId,
        actorUserId,
        propertyId,
        command,
      );
      return toJournalView(journal, fundNames);
    });
  }

  /**
   * Same contract as `post()`, but for a caller that already holds its own
   * open `Prisma.TransactionClient` and needs the journal write to commit
   * atomically with its own additional writes (e.g. LevyService writing
   * `LotLevyCharge` subledger rows alongside the aggregate receivable/
   * income journal — see docs/architecture/adr/ADR-023). This is the
   * reusable posting contract the M16.2.2 brief anticipated for future
   * producers: it never bypasses any of `post()`'s own validation, locking,
   * or idempotency — it IS the same code path, just without opening a
   * second transaction around it. The caller's transaction must acquire
   * the same FinancialConfiguration row lock itself, before this method is
   * called, whenever it also needs to read/validate property-scoped state
   * under that lock before posting (see LevyService.issue for the pattern
   * — the same "lock before check" lesson as ADR-021's reversal fix).
   */
  async postWithinTransaction(
    tx: Prisma.TransactionClient,
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    command: PostCommand,
  ): Promise<JournalEntryView> {
    const { journal, fundNames } = await this.postInTransaction(
      tx,
      organisationId,
      actorUserId,
      propertyId,
      command,
    );
    return toJournalView(journal, fundNames);
  }

  /** The shared core — assumes it is already running inside a
   * `$transaction` callback (so both `post()` and `reverse()` can share
   * exactly one transaction scope each). Acquires the row lock itself; a
   * caller that already holds it (none currently do) would simply
   * re-acquire the same lock harmlessly within the same transaction. */
  private async postInTransaction(
    tx: Prisma.TransactionClient,
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    command: PostCommand,
  ): Promise<{ journal: JournalWithLines; fundNames: Map<string, string> }> {
    const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration) {
      throw new ConflictError('Start financial setup for this property before posting to its ledger.');
    }
    // Serializes every ledger write for this property through one lock —
    // the same discipline FinancialBudgetsService.activate uses for the
    // one-active-budget invariant, here backing both the idempotency
    // check and the period-closed check against a concurrent close.
    await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

    const sourceEventVersion = command.sourceEventVersion ?? 1;
    const existing = await tx.journalEntry.findUnique({
      where: {
        propertyId_sourceType_sourceId_sourceEventVersion: {
          propertyId,
          sourceType: command.sourceType,
          sourceId: command.sourceId,
          sourceEventVersion,
        },
      },
      include: JOURNAL_LINE_INCLUDE,
    });
    if (existing) {
      return { journal: existing, fundNames: await this.fundNames(tx, existing.lines.map((l) => l.financialFundId)) };
    }

    if (command.lines.length < 2) {
      throw new ValidationError('A journal entry needs at least two lines.');
    }

    const totalDebit = command.lines.reduce((sum, l) => sum.plus(l.debit), new Prisma.Decimal(0));
    const totalCredit = command.lines.reduce((sum, l) => sum.plus(l.credit), new Prisma.Decimal(0));
    if (!totalDebit.equals(totalCredit)) {
      throw new ValidationError(
        `This journal does not balance: total debits (${totalDebit.toFixed(2)}) must equal total credits (${totalCredit.toFixed(2)}).`,
      );
    }

    if (!command.allowCrossFund) {
      const byFund = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
      for (const line of command.lines) {
        const bucket = byFund.get(line.financialFundId) ?? {
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(0),
        };
        bucket.debit = bucket.debit.plus(line.debit);
        bucket.credit = bucket.credit.plus(line.credit);
        byFund.set(line.financialFundId, bucket);
      }
      for (const [fundId, bucket] of byFund) {
        if (!bucket.debit.equals(bucket.credit)) {
          throw new ValidationError(
            `This journal moves value across funds without being flagged as a transfer — fund ${fundId} has debits ${bucket.debit.toFixed(2)} and credits ${bucket.credit.toFixed(2)}, which must be equal. Set allowCrossFund if this is a genuine inter-fund transfer.`,
          );
        }
      }
    }

    // Every referenced account/fund must belong to this exact property
    // (never cross-property) and the account must currently be active —
    // same discipline as FinancialBudgetsService.assertAccountAssignable.
    const accountIds = [...new Set(command.lines.map((l) => l.accountId))];
    const fundIds = [...new Set(command.lines.map((l) => l.financialFundId))];
    const [accounts, funds] = await Promise.all([
      tx.accountingAccount.findMany({ where: { id: { in: accountIds }, organisationId, propertyId } }),
      tx.financialFund.findMany({ where: { id: { in: fundIds }, organisationId, propertyId } }),
    ]);
    if (accounts.length !== accountIds.length) {
      throw new NotFoundError('One or more accounts were not found on this property.');
    }
    const inactive = accounts.find((a) => !a.isActive);
    if (inactive) {
      throw new ConflictError(
        `Account ${inactive.code} — ${inactive.name} is deactivated and can’t receive new postings.`,
      );
    }
    if (funds.length !== fundIds.length) {
      throw new NotFoundError('One or more funds were not found on this property.');
    }

    const effectiveDate = parseDateOnly(command.effectiveDate);
    const period = await this.periods.findCoveringPeriod(tx, propertyId, effectiveDate);
    if (!period) {
      throw new ConflictError(
        `No accounting period covers ${formatDateOnly(effectiveDate)} — open one before posting.`,
      );
    }
    if (period.status !== 'OPEN') {
      throw new ConflictError(
        `The accounting period covering ${formatDateOnly(effectiveDate)} is closed. Reopen it (financials.approve) or post an adjustment into an open period.`,
      );
    }

    let journal: JournalWithLines;
    try {
      journal = await withPublicReference('JRN', (publicReference) =>
        tx.journalEntry.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            financialConfigurationId: configuration.id,
            accountingPeriodId: period.id,
            effectiveDate,
            currencyCode: command.currencyCode ?? (configuration.currencyCode as string),
            sourceType: command.sourceType,
            sourceId: command.sourceId,
            sourceEventVersion,
            narration: command.narration,
            postedByUserId: actorUserId,
            lines: {
              create: command.lines.map((line, index) => ({
                organisationId,
                propertyId,
                accountId: line.accountId,
                financialFundId: line.financialFundId,
                debit: line.debit,
                credit: line.credit,
                lineNarration: line.lineNarration ?? null,
                sortOrder: index,
              })),
            },
          },
          include: JOURNAL_LINE_INCLUDE,
        }),
      );
    } catch (err) {
      if (isSourceKeyUniqueViolation(err)) {
        // A genuinely concurrent duplicate that slipped past the lock
        // (shouldn't happen given the row lock above, but the DB
        // constraint is the real backstop — see this class's doc
        // comment) — re-fetch and return the winner rather than error.
        const winner = await tx.journalEntry.findUniqueOrThrow({
          where: {
            propertyId_sourceType_sourceId_sourceEventVersion: {
              propertyId,
              sourceType: command.sourceType,
              sourceId: command.sourceId,
              sourceEventVersion,
            },
          },
          include: JOURNAL_LINE_INCLUDE,
        });
        return { journal: winner, fundNames: await this.fundNames(tx, winner.lines.map((l) => l.financialFundId)) };
      }
      throw err;
    }

    await recordActivity(tx, {
      organisationId,
      propertyId,
      actorUserId,
      eventType: 'FINANCIAL_JOURNAL_POSTED',
      entityType: 'JournalEntry',
      entityId: journal.id,
      title: `Journal posted: ${journal.narration} (${totalDebit.toFixed(2)} ${journal.currencyCode})`,
    });

    return { journal, fundNames: await this.fundNames(tx, journal.lines.map((l) => l.financialFundId)) };
  }

  /** financials.approve only. Creates a new journal with every line's
   * debit/credit swapped, linked via reversalOfJournalId — the original
   * is never updated or deleted. A journal can be reversed at most once.
   * The "already reversed" check and the reversal's own posting both run
   * under the SAME FinancialConfiguration row lock (acquired here, before
   * the check — not left to postInTransaction's own re-acquisition of the
   * same lock, which happens later and would be too late to prevent a
   * second concurrent reverse() call from passing the check too). Without
   * this ordering, two concurrent reverse() calls for the same journal
   * could both pass the "not yet reversed" check before either commits;
   * the shared idempotency key still prevents a second JOURNAL from being
   * created, but the second call would still re-run the link/audit steps
   * against the first call's already-created reversal — silently
   * overwriting its reversalReason with the second caller's own reason.
   * Posting the reversal, linking it, and recording the audit event all
   * happen inside one transaction — never left partially done. */
  async reverse(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    journalId: string,
    input: { effectiveDate?: string; reason: string },
  ): Promise<JournalEntryView> {
    await this.getOwnedProperty(organisationId, propertyId);
    return this.prisma.$transaction((tx) =>
      // allowLevySourced: false — this is the generic MANUAL-journal
      // reversal entrypoint. A journal the levy subledger generated must
      // be reversed through LevyService.reverseInstallment (which calls
      // reverseWithinTransaction below with allowLevySourced: true, and
      // which also keeps LotLevyCharge/LevyInstallment state consistent
      // with the ledger) — reversing it here would leave that subledger
      // state completely untouched while the GL shows it reversed. Found
      // during the live Harbour View Strata incident investigation
      // (2026-10-21): the actual incident went through the levy workflow,
      // not this one, but this gap was real and independent of it.
      this.reverseInTransaction(tx, organisationId, actorUserId, propertyId, journalId, input, {
        allowLevySourced: false,
      }),
    );
  }

  /**
   * Same contract as `reverse()`, but for a caller that already holds its
   * own open transaction and needs the reversal to commit atomically with
   * its own additional writes — e.g. LevyService.reverseIssuance also
   * needs to cancel every LotLevyCharge and mark the LevySchedule REVERSED
   * in the same transaction as the journal reversal itself. Without this,
   * a crash between "journal reversed" and "subledger updated" would leave
   * the ledger correctly reversed but the levy subledger still showing
   * ISSUED — caught and fixed during the M16.3 closure review before any
   * test exercised the gap (see the M16.3 verification notes). The
   * caller's transaction must still acquire the FinancialConfiguration
   * row lock itself before this is called if it reads/validates
   * property-scoped state beforehand — this method re-acquires the same
   * lock internally regardless (harmless re-entrant no-op within one
   * transaction), the same "lock before check" discipline as `post()`.
   */
  async reverseWithinTransaction(
    tx: Prisma.TransactionClient,
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    journalId: string,
    input: { effectiveDate?: string; reason: string },
  ): Promise<JournalEntryView> {
    return this.reverseInTransaction(tx, organisationId, actorUserId, propertyId, journalId, input, {
      allowLevySourced: true,
    });
  }

  private async reverseInTransaction(
    tx: Prisma.TransactionClient,
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    journalId: string,
    input: { effectiveDate?: string; reason: string },
    options: { allowLevySourced: boolean },
  ): Promise<JournalEntryView> {
    const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration) {
      throw new ConflictError('Start financial setup for this property before reversing a journal.');
    }
    // Must happen BEFORE the "already reversed" check below — see this
    // method's own doc comment and ADR-021's closure addendum.
    await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

    const original = await tx.journalEntry.findFirst({
      where: { id: journalId, organisationId, propertyId },
      include: { lines: true },
    });
    if (!original) {
      throw new NotFoundError('Journal entry not found');
    }

    // Guard added after the 2026-10-21 Harbour View Strata incident
    // investigation — a levy-generated journal (LEVY_REGULAR/LEVY_SPECIAL/
    // LEVY_ADJUSTMENT) must never be reversed through the generic manual
    // workflow: doing so posts a correct, balanced GL reversal while
    // leaving LotLevyCharge/LevyInstallment completely untouched, which
    // would desync the lot subledger from the ledger just as surely as
    // the instalment-level bug this same investigation found (see
    // LevyService.reverseInstallment's own shared-journal guard).
    if (!options.allowLevySourced && (original.sourceType === 'LEVY_REGULAR' || original.sourceType === 'LEVY_SPECIAL' || original.sourceType === 'LEVY_ADJUSTMENT')) {
      throw new ConflictError(
        'This journal was generated by the levy subledger and cannot be reversed through the generic manual-journal workflow — use the levy schedule’s own reverse-instalment action (or reverse the adjustment’s source charge) so lot-level charge state stays consistent with the ledger.',
      );
    }

    const alreadyReversed = await tx.journalEntry.findFirst({
      where: { reversalOfJournalId: original.id },
    });
    if (alreadyReversed) {
      throw new ConflictError('This journal has already been reversed.');
    }

    const reversalLines: JournalLineInput[] = original.lines.map((line) => ({
      accountId: line.accountId,
      financialFundId: line.financialFundId,
      // Swapped: what was debited is now credited, and vice versa — the
      // exact opposite entry, per the "reversal integrity" requirement.
      debit: Number(line.credit),
      credit: Number(line.debit),
      lineNarration: line.lineNarration ?? undefined,
    }));

    const { journal, fundNames } = await this.postInTransaction(tx, organisationId, actorUserId, propertyId, {
      effectiveDate: input.effectiveDate ?? formatDateOnly(new Date()),
      currencyCode: original.currencyCode,
      sourceType: 'REVERSAL',
      sourceId: original.id,
      sourceEventVersion: 1,
      narration: `Reversal of ${original.publicReference}: ${input.reason}`,
      lines: reversalLines,
      // The original's own per-fund balance already held when it was
      // first posted (postInTransaction enforced it then); an exact
      // sign-swap of an already fund-balanced journal is necessarily
      // fund-balanced too, so re-deriving that here is redundant, not a
      // safety gap.
      allowCrossFund: true,
    });

    const linked = await tx.journalEntry.update({
      where: { id: journal.id },
      data: { reversalOfJournalId: original.id, reversalReason: input.reason },
      include: JOURNAL_LINE_INCLUDE,
    });

    await recordActivity(tx, {
      organisationId,
      propertyId,
      actorUserId,
      eventType: 'FINANCIAL_JOURNAL_REVERSED',
      entityType: 'JournalEntry',
      entityId: original.id,
      title: `Journal ${original.publicReference} reversed by ${linked.publicReference}`,
      description: input.reason,
    });

    return toJournalView(linked, fundNames);
  }

  async get(organisationId: string, propertyId: string, journalId: string): Promise<JournalEntryView> {
    await this.getOwnedProperty(organisationId, propertyId);
    const journal = await this.prisma.journalEntry.findFirst({
      where: { id: journalId, organisationId, propertyId },
      include: JOURNAL_LINE_INCLUDE,
    });
    if (!journal) {
      throw new NotFoundError('Journal entry not found');
    }
    return toJournalView(journal, await this.fundNames(this.prisma, journal.lines.map((l) => l.financialFundId)));
  }

  async list(
    organisationId: string,
    propertyId: string,
    filters: { sourceType?: string; accountingPeriodId?: string },
  ): Promise<JournalEntryView[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const journals = await this.prisma.journalEntry.findMany({
      where: {
        organisationId,
        propertyId,
        sourceType: filters.sourceType,
        accountingPeriodId: filters.accountingPeriodId,
      },
      include: JOURNAL_LINE_INCLUDE,
      orderBy: [{ effectiveDate: 'desc' }, { postedAt: 'desc' }],
    });
    const fundIds = journals.flatMap((j) => j.lines.map((l) => l.financialFundId));
    const funds = await this.fundNames(this.prisma, fundIds);
    return journals.map((j) => toJournalView(j, funds));
  }

  /** A simple as-of trial balance: SUM(debit)/SUM(credit) per account
   * across every posted line up to and including `asOfDate` (default
   * today) — a read-only aggregation over immutable postings, never an
   * independently maintained running balance (see the "no independently
   * maintained running balances" safeguard). */
  /** `financialFundId` (M16.3 refinement pass) restricts the trial
   * balance to journal lines tagged with that one fund — useful for a
   * scheme with multiple funds where an unrestricted account (e.g.
   * GST Payable, Accounts Payable) carries balances from more than one
   * fund and a reviewer wants to see just one fund's slice. Omitted,
   * the trial balance covers every fund, exactly as before. */
  async trialBalance(organisationId: string, propertyId: string, asOfDate?: string, financialFundId?: string) {
    await this.getOwnedProperty(organisationId, propertyId);
    const cutoff = asOfDate ? parseDateOnly(asOfDate) : new Date();

    const lines = await this.prisma.journalLine.findMany({
      where: {
        organisationId,
        propertyId,
        financialFundId,
        journalEntry: { effectiveDate: { lte: cutoff } },
      },
      include: { account: { select: { code: true, name: true, classification: true } } },
    });

    const byAccount = new Map<
      string,
      { code: string; name: string; classification: string; debit: Prisma.Decimal; credit: Prisma.Decimal }
    >();
    for (const line of lines) {
      const bucket = byAccount.get(line.accountId) ?? {
        code: line.account.code,
        name: line.account.name,
        classification: line.account.classification,
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      };
      bucket.debit = bucket.debit.plus(line.debit);
      bucket.credit = bucket.credit.plus(line.credit);
      byAccount.set(line.accountId, bucket);
    }

    // Conventional presentation (M16.3 refinement pass): ASSET/EXPENSE
    // accounts normally carry a debit balance, LIABILITY/EQUITY/INCOME a
    // credit balance. A trial balance is conventionally shown as one
    // amount in EITHER the Debit or the Credit column per row — never a
    // single signed "net" figure, which reads as "negative revenue" to a
    // non-accountant. `netBalance` (signed, debit-positive) is kept for
    // any caller relying on the raw figure; `presentedSide`/
    // `presentedBalance` are the conventional, always-positive pair.
    const creditNormal = new Set(['LIABILITY', 'EQUITY', 'INCOME']);
    return Array.from(byAccount.entries())
      .map(([accountId, b]) => {
        const net = b.debit.minus(b.credit);
        const isCreditNormal = creditNormal.has(b.classification);
        const presentedSide = net.isZero() ? (isCreditNormal ? 'CREDIT' : 'DEBIT') : net.gt(0) ? 'DEBIT' : 'CREDIT';
        return {
          accountId,
          accountCode: b.code,
          accountName: b.name,
          classification: b.classification,
          totalDebit: b.debit.toFixed(2),
          totalCredit: b.credit.toFixed(2),
          netBalance: net.toFixed(2),
          presentedSide: presentedSide as 'DEBIT' | 'CREDIT',
          presentedBalance: net.abs().toFixed(2),
        };
      })
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  private async fundNames(
    client: PrismaClient | Prisma.TransactionClient,
    fundIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(fundIds)];
    if (unique.length === 0) return new Map();
    const funds = await client.financialFund.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(funds.map((f) => [f.id, f.name]));
  }
}

/** Generates a fresh sourceId for a manual posting that didn't supply one
 * — exported so the controller can use the same convention without
 * reaching into node:crypto itself. */
export function generateManualSourceId(): string {
  return randomUUID();
}

function toJournalView(journal: JournalWithLines, fundNames: Map<string, string>): JournalEntryView {
  const totalDebit = journal.lines.reduce((sum, l) => sum.plus(l.debit), new Prisma.Decimal(0));
  return {
    id: journal.id,
    publicReference: journal.publicReference,
    accountingPeriodId: journal.accountingPeriodId,
    effectiveDate: formatDateOnly(journal.effectiveDate),
    postedAt: journal.postedAt.toISOString(),
    currencyCode: journal.currencyCode,
    sourceType: journal.sourceType,
    sourceId: journal.sourceId,
    sourceEventVersion: journal.sourceEventVersion,
    narration: journal.narration,
    postedByUserId: journal.postedByUserId,
    reversalOfJournalId: journal.reversalOfJournalId,
    reversalReason: journal.reversalReason,
    totalDebit: totalDebit.toFixed(2),
    lines: journal.lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      accountCode: line.account.code,
      accountName: line.account.name,
      financialFundId: line.financialFundId,
      fundName: fundNames.get(line.financialFundId) ?? 'Unknown fund',
      debit: line.debit.toFixed(2),
      credit: line.credit.toFixed(2),
      lineNarration: line.lineNarration,
      sortOrder: line.sortOrder,
    })),
  };
}

function isSourceKeyUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002' &&
    String((err as { meta?: { target?: unknown } }).meta?.target ?? '').includes('sourceType')
  );
}
