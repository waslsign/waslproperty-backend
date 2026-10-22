import { Prisma, type BankReconciliationStatus, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { formatDateOnly, parseDateOnly } from '../../lib/dateOnly.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import type { CreateReconciliationDraftInput } from './bank-reconciliation.schemas.js';

/**
 * M16.7 — bank-to-GL reconciliation. See prisma/schema.prisma's "Banking &
 * Manual Bank Reconciliation" section doc comment, point 2 and point 5.
 *
 * THE RECONCILIATION EQUATION (computed fresh by `calculate`, never
 * trusted as a stored running total between calls):
 *
 *   adjustedGlClosing = glClosingBalance - outstandingDepositsTotal + unpresentedPaymentsTotal
 *   difference        = adjustedGlClosing - statementClosingBalance
 *
 * `glClosingBalance` is the GL cash account's own balance as of
 * periodEndDate — it already includes every receipt/journal posted to
 * date, including ones that haven't yet appeared on ANY bank statement
 * (deposits in transit, unpresented payments). Subtracting those
 * not-yet-on-statement items is what makes the GL-side figure comparable
 * to what the bank's OWN statement says; `difference` must be exactly
 * 0.00 before `complete` will succeed — never silently written off.
 *
 * "Outstanding" (unmatched) is determined per JournalLine on the bank
 * account's own glCashAccountId within the period: a debit line (cash
 * received) counts as matched/cleared if the Receipt whose own journal it
 * belongs to carries a CONFIRMED BankTransactionMatch; a credit line
 * (cash paid) counts as matched if it is itself directly referenced by a
 * CONFIRMED BankTransactionMatch (journalLineId). Everything else in the
 * period is outstanding.
 */

export interface ReconciliationView {
  id: string;
  publicReference: string;
  propertyId: string;
  bankAccountId: string;
  periodStartDate: string;
  periodEndDate: string;
  statementOpeningBalance: string;
  statementClosingBalance: string;
  glOpeningBalance: string;
  glClosingBalance: string;
  outstandingDepositsTotal: string;
  unpresentedPaymentsTotal: string;
  difference: string;
  status: BankReconciliationStatus;
  supersedesReconciliationId: string | null;
  preparedByUserId: string;
  reviewedByUserId: string | null;
  completedAt: string | null;
  reopenedByUserId: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  /** Statement opening + sum of every imported transaction in period
   * (regardless of match status) vs. statement closing — a separate
   * internal-consistency check on the statement itself, not on GL
   * agreement. Computed fresh every time, never persisted. */
  statementInternallyConsistent: boolean;
  outstandingTransactionCount: number;
  createdAt: string;
  updatedAt: string;
}

function toView(r: {
  id: string;
  publicReference: string;
  propertyId: string;
  bankAccountId: string;
  periodStartDate: Date;
  periodEndDate: Date;
  statementOpeningBalance: Prisma.Decimal;
  statementClosingBalance: Prisma.Decimal;
  glOpeningBalance: Prisma.Decimal;
  glClosingBalance: Prisma.Decimal;
  outstandingDepositsTotal: Prisma.Decimal;
  unpresentedPaymentsTotal: Prisma.Decimal;
  difference: Prisma.Decimal;
  status: BankReconciliationStatus;
  supersedesReconciliationId: string | null;
  preparedByUserId: string;
  reviewedByUserId: string | null;
  completedAt: Date | null;
  reopenedByUserId: string | null;
  reopenedAt: Date | null;
  reopenReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}, extra: { statementInternallyConsistent: boolean; outstandingTransactionCount: number }): ReconciliationView {
  return {
    id: r.id,
    publicReference: r.publicReference,
    propertyId: r.propertyId,
    bankAccountId: r.bankAccountId,
    periodStartDate: formatDateOnly(r.periodStartDate),
    periodEndDate: formatDateOnly(r.periodEndDate),
    statementOpeningBalance: r.statementOpeningBalance.toFixed(2),
    statementClosingBalance: r.statementClosingBalance.toFixed(2),
    glOpeningBalance: r.glOpeningBalance.toFixed(2),
    glClosingBalance: r.glClosingBalance.toFixed(2),
    outstandingDepositsTotal: r.outstandingDepositsTotal.toFixed(2),
    unpresentedPaymentsTotal: r.unpresentedPaymentsTotal.toFixed(2),
    difference: r.difference.toFixed(2),
    status: r.status,
    supersedesReconciliationId: r.supersedesReconciliationId,
    preparedByUserId: r.preparedByUserId,
    reviewedByUserId: r.reviewedByUserId,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    reopenedByUserId: r.reopenedByUserId,
    reopenedAt: r.reopenedAt ? r.reopenedAt.toISOString() : null,
    reopenReason: r.reopenReason,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    statementInternallyConsistent: extra.statementInternallyConsistent,
    outstandingTransactionCount: extra.outstandingTransactionCount,
  };
}

export class BankReconciliationService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getOwnedBankAccount(organisationId: string, propertyId: string, bankAccountId: string) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id: bankAccountId, organisationId, propertyId } });
    if (!account) throw new NotFoundError('Bank account not found');
    return account;
  }

  /** The core GL computation, re-run fresh every time — never a stored
   * running total. `effectiveDate <= asOf` (inclusive); see this module's
   * doc comment for the matched/outstanding split. */
  private async computeGlPosition(
    organisationId: string,
    propertyId: string,
    bankAccountId: string,
    glCashAccountId: string,
    financialFundId: string | null,
    periodStart: Date,
    periodEndExclusive: Date,
  ) {
    const fundFilter = financialFundId ? { financialFundId } : {};

    const openingAgg = await this.prisma.journalLine.aggregate({
      where: {
        organisationId,
        propertyId,
        accountId: glCashAccountId,
        ...fundFilter,
        journalEntry: { effectiveDate: { lt: periodStart } },
      },
      _sum: { debit: true, credit: true },
    });
    const glOpeningBalance = new Prisma.Decimal(openingAgg._sum.debit ?? 0).minus(openingAgg._sum.credit ?? 0);

    const periodLines = await this.prisma.journalLine.findMany({
      where: {
        organisationId,
        propertyId,
        accountId: glCashAccountId,
        ...fundFilter,
        journalEntry: { effectiveDate: { gte: periodStart, lt: periodEndExclusive } },
      },
      include: { journalEntry: { select: { id: true } } },
    });

    const periodMovement = periodLines.reduce(
      (sum, l) => sum.plus(l.debit).minus(l.credit),
      new Prisma.Decimal(0),
    );
    const glClosingBalance = glOpeningBalance.plus(periodMovement);

    const journalEntryIds = periodLines.map((l) => l.journalEntryId);
    const [matchedByLine, receiptsOnTheseEntries] = await Promise.all([
      this.prisma.bankTransactionMatch.findMany({
        where: { organisationId, propertyId, status: 'CONFIRMED', journalLineId: { in: periodLines.map((l) => l.id) } },
        select: { journalLineId: true },
      }),
      this.prisma.receipt.findMany({
        where: { organisationId, propertyId, journalEntryId: { in: journalEntryIds } },
        select: { id: true, journalEntryId: true },
      }),
    ]);
    const matchedLineIds = new Set(matchedByLine.map((m) => m.journalLineId));
    const receiptIdByJournalEntryId = new Map(receiptsOnTheseEntries.map((r) => [r.journalEntryId, r.id]));
    const receiptIds = receiptsOnTheseEntries.map((r) => r.id);
    const confirmedReceiptMatches = receiptIds.length
      ? await this.prisma.bankTransactionMatch.findMany({
          where: { organisationId, propertyId, status: 'CONFIRMED', receiptId: { in: receiptIds } },
          select: { receiptId: true },
        })
      : [];
    const matchedReceiptIds = new Set(confirmedReceiptMatches.map((m) => m.receiptId));

    let outstandingDepositsTotal = new Prisma.Decimal(0);
    let unpresentedPaymentsTotal = new Prisma.Decimal(0);
    let outstandingCount = 0;

    for (const line of periodLines) {
      const viaLine = matchedLineIds.has(line.id);
      const receiptId = receiptIdByJournalEntryId.get(line.journalEntryId);
      const viaReceipt = receiptId ? matchedReceiptIds.has(receiptId) : false;
      const matched = viaLine || viaReceipt;
      if (matched) continue;

      outstandingCount++;
      const net = line.debit.minus(line.credit);
      if (net.greaterThan(0)) outstandingDepositsTotal = outstandingDepositsTotal.plus(net);
      else unpresentedPaymentsTotal = unpresentedPaymentsTotal.plus(net.abs());
    }

    return { glOpeningBalance, glClosingBalance, outstandingDepositsTotal, unpresentedPaymentsTotal, outstandingCount };
  }

  private async statementConsistency(
    organisationId: string,
    propertyId: string,
    bankAccountId: string,
    periodStart: Date,
    periodEndExclusive: Date,
    statementOpeningBalance: Prisma.Decimal,
    statementClosingBalance: Prisma.Decimal,
  ): Promise<boolean> {
    const agg = await this.prisma.bankTransaction.aggregate({
      where: {
        organisationId,
        propertyId,
        bankAccountId,
        transactionDate: { gte: periodStart, lt: periodEndExclusive },
      },
      _sum: { amount: true },
    });
    const total = new Prisma.Decimal(agg._sum.amount ?? 0);
    return statementOpeningBalance.plus(total).equals(statementClosingBalance);
  }

  private async recalculateAndPersist(reconciliationId: string): Promise<ReconciliationView> {
    const recon = await this.prisma.bankReconciliation.findUniqueOrThrow({ where: { id: reconciliationId } });
    const account = await this.prisma.bankAccount.findUniqueOrThrow({ where: { id: recon.bankAccountId } });

    const periodEndExclusive = new Date(recon.periodEndDate.getTime() + 24 * 60 * 60 * 1000);
    const { glOpeningBalance, glClosingBalance, outstandingDepositsTotal, unpresentedPaymentsTotal, outstandingCount } =
      await this.computeGlPosition(
        recon.organisationId,
        recon.propertyId,
        recon.bankAccountId,
        account.glCashAccountId,
        account.financialFundId,
        recon.periodStartDate,
        periodEndExclusive,
      );

    const adjustedGlClosing = glClosingBalance.minus(outstandingDepositsTotal).plus(unpresentedPaymentsTotal);
    const difference = adjustedGlClosing.minus(recon.statementClosingBalance);

    const consistent = await this.statementConsistency(
      recon.organisationId,
      recon.propertyId,
      recon.bankAccountId,
      recon.periodStartDate,
      periodEndExclusive,
      recon.statementOpeningBalance,
      recon.statementClosingBalance,
    );

    const updated = await this.prisma.bankReconciliation.update({
      where: { id: reconciliationId },
      data: { glOpeningBalance, glClosingBalance, outstandingDepositsTotal, unpresentedPaymentsTotal, difference },
    });

    return toView(updated, { statementInternallyConsistent: consistent, outstandingTransactionCount: outstandingCount });
  }

  async createDraft(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    bankAccountId: string,
    input: CreateReconciliationDraftInput,
  ): Promise<ReconciliationView> {
    const account = await this.getOwnedBankAccount(organisationId, propertyId, bankAccountId);
    const periodStart = parseDateOnly(input.periodStartDate);
    const periodEnd = parseDateOnly(input.periodEndDate);
    if (periodEnd < periodStart) throw new ConflictError('periodEndDate must not be before periodStartDate.');

    const created = await this.prisma.$transaction(async (tx) => {
      // Overlapping-period guard — any non-REOPENED reconciliation for
      // this account whose period intersects the requested one blocks a
      // new draft (REOPENED rows are explicitly superseded, so a fresh
      // draft covering the same period is exactly the expected next
      // step).
      const overlapping = await tx.bankReconciliation.findFirst({
        where: {
          bankAccountId,
          status: { in: ['DRAFT', 'IN_REVIEW', 'RECONCILED'] },
          periodStartDate: { lte: periodEnd },
          periodEndDate: { gte: periodStart },
        },
      });
      if (overlapping) {
        throw new ConflictError(
          `This period overlaps an existing ${overlapping.status.toLowerCase()} reconciliation (${overlapping.publicReference}, ${formatDateOnly(overlapping.periodStartDate)} to ${formatDateOnly(overlapping.periodEndDate)}).`,
        );
      }

      let superseded: Awaited<ReturnType<typeof tx.bankReconciliation.findFirst>> = null;
      if (input.supersedesReconciliationId) {
        superseded = await tx.bankReconciliation.findFirst({
          where: { id: input.supersedesReconciliationId, organisationId, propertyId, bankAccountId },
        });
        if (!superseded) throw new NotFoundError('Reconciliation to supersede not found');
        if (superseded.status !== 'REOPENED') {
          throw new ConflictError('Only a reopened reconciliation can be superseded by a new draft.');
        }
        // A superseding draft must cover the IDENTICAL period as what it
        // corrects — a different period is a new reconciliation, not a
        // correction, and linking it via supersedesReconciliationId would
        // misrepresent the chain.
        if (
          formatDateOnly(superseded.periodStartDate) !== input.periodStartDate ||
          formatDateOnly(superseded.periodEndDate) !== input.periodEndDate
        ) {
          throw new ConflictError(
            `A superseding draft must cover the same period as the reconciliation it corrects (${formatDateOnly(superseded.periodStartDate)} – ${formatDateOnly(superseded.periodEndDate)}).`,
          );
        }
      }

      // Opening balance continuity — must match the prior completed
      // reconciliation's closing balance, or the account's own configured
      // opening position if this is the first ever reconciliation.
      const priorReconciled = await tx.bankReconciliation.findFirst({
        where: { bankAccountId, status: 'RECONCILED' },
        orderBy: { periodEndDate: 'desc' },
      });
      const expectedOpening = priorReconciled
        ? priorReconciled.statementClosingBalance
        : (account.openingReconciledBalance ?? new Prisma.Decimal(0));
      const statementOpeningBalance = new Prisma.Decimal(input.statementOpeningBalance);
      if (!statementOpeningBalance.equals(expectedOpening)) {
        throw new ConflictError(
          `Statement opening balance (${statementOpeningBalance.toFixed(2)}) does not match the expected continuing balance (${expectedOpening.toFixed(2)}) from ${priorReconciled ? `the prior reconciliation (${priorReconciled.publicReference})` : "this account's configured opening position"}.`,
        );
      }

      // Chain-continuity guard — a NEW (non-superseding) period must never
      // be started while an earlier period for this account sits REOPENED
      // and uncorrected: `priorReconciled` above would silently skip over
      // it and anchor continuity on whatever RECONCILED row happens to be
      // most recent, which may no longer reflect reality once the
      // reopened period's correction lands. The manager must resolve
      // (re-supersede) the reopened period first.
      if (!superseded) {
        const unresolvedReopened = await tx.bankReconciliation.findFirst({
          where: {
            bankAccountId,
            status: 'REOPENED',
            periodEndDate: priorReconciled ? { gt: priorReconciled.periodEndDate } : undefined,
          },
          orderBy: { periodEndDate: 'desc' },
        });
        if (unresolvedReopened) {
          throw new ConflictError(
            `Reconciliation ${unresolvedReopened.publicReference} (${formatDateOnly(unresolvedReopened.periodStartDate)} – ${formatDateOnly(unresolvedReopened.periodEndDate)}) is reopened and awaiting a correcting reconciliation — resolve it before starting a new period.`,
          );
        }
      }

      const reconciliation = await withPublicReference('RECN', (publicReference) =>
        tx.bankReconciliation.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            bankAccountId,
            periodStartDate: periodStart,
            periodEndDate: periodEnd,
            statementOpeningBalance,
            statementClosingBalance: new Prisma.Decimal(input.statementClosingBalance),
            glOpeningBalance: 0,
            glClosingBalance: 0,
            status: 'DRAFT',
            preparedByUserId: actorUserId,
            supersedesReconciliationId: input.supersedesReconciliationId ?? null,
          },
        }),
      );

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_RECONCILIATION_STARTED',
        entityType: 'BankReconciliation',
        entityId: reconciliation.id,
        title: `Bank reconciliation started: ${account.accountName} (${formatDateOnly(periodStart)} – ${formatDateOnly(periodEnd)})`,
        description: null,
      });

      return reconciliation.id;
    });

    return this.recalculateAndPersist(created);
  }

  /** Recomputes GL totals/outstanding items/difference against CURRENT
   * data — callable repeatedly while DRAFT/IN_REVIEW as matches are
   * confirmed, so the manager always sees a live picture before
   * completing. */
  async calculate(organisationId: string, propertyId: string, reconciliationId: string): Promise<ReconciliationView> {
    const recon = await this.prisma.bankReconciliation.findFirst({ where: { id: reconciliationId, organisationId, propertyId } });
    if (!recon) throw new NotFoundError('Reconciliation not found');
    if (recon.status === 'RECONCILED' || recon.status === 'REOPENED') {
      return this.get(organisationId, propertyId, reconciliationId);
    }
    return this.recalculateAndPersist(reconciliationId);
  }

  async get(organisationId: string, propertyId: string, reconciliationId: string): Promise<ReconciliationView> {
    const recon = await this.prisma.bankReconciliation.findFirst({ where: { id: reconciliationId, organisationId, propertyId } });
    if (!recon) throw new NotFoundError('Reconciliation not found');

    const account = await this.prisma.bankAccount.findUniqueOrThrow({ where: { id: recon.bankAccountId } });
    const periodEndExclusive = new Date(recon.periodEndDate.getTime() + 24 * 60 * 60 * 1000);
    const consistent = await this.statementConsistency(
      organisationId,
      propertyId,
      recon.bankAccountId,
      recon.periodStartDate,
      periodEndExclusive,
      recon.statementOpeningBalance,
      recon.statementClosingBalance,
    );
    const outstandingCount = await this.prisma.journalLine.count({
      where: {
        organisationId,
        propertyId,
        accountId: account.glCashAccountId,
        journalEntry: { effectiveDate: { gte: recon.periodStartDate, lt: periodEndExclusive } },
      },
    });

    return toView(recon, { statementInternallyConsistent: consistent, outstandingTransactionCount: outstandingCount });
  }

  async list(organisationId: string, propertyId: string, bankAccountId: string): Promise<ReconciliationView[]> {
    await this.getOwnedBankAccount(organisationId, propertyId, bankAccountId);
    const recons = await this.prisma.bankReconciliation.findMany({
      where: { organisationId, propertyId, bankAccountId },
      orderBy: { periodEndDate: 'desc' },
    });
    return Promise.all(recons.map((r) => this.get(organisationId, propertyId, r.id)));
  }

  /** financials.approve. Requires `difference` to be exactly 0.00 (freshly
   * recomputed, never the possibly-stale stored value) and the statement
   * itself to be internally consistent — see this module's doc comment.
   * Marks every MATCHED transaction in the period as RECONCILED; anything
   * still UNMATCHED/IGNORED legitimately carries forward as next period's
   * outstanding item (never forced to match). */
  async complete(organisationId: string, actorUserId: string, propertyId: string, reconciliationId: string): Promise<ReconciliationView> {
    const recon = await this.prisma.bankReconciliation.findFirst({ where: { id: reconciliationId, organisationId, propertyId } });
    if (!recon) throw new NotFoundError('Reconciliation not found');
    if (recon.status === 'RECONCILED') throw new ConflictError('This reconciliation is already completed.');
    if (recon.status === 'REOPENED') throw new ConflictError('This reconciliation was reopened — create a new draft to supersede it.');

    const fresh = await this.recalculateAndPersist(reconciliationId);
    if (fresh.difference !== '0.00') {
      throw new ConflictError(
        `This reconciliation does not balance — difference of ${fresh.difference}. Resolve or explain every outstanding item before completing; differences are never written off silently.`,
      );
    }
    if (!fresh.statementInternallyConsistent) {
      throw new ConflictError(
        'The imported statement transactions do not sum from the opening to the closing balance you entered — re-check the statement period/balances before completing.',
      );
    }

    const periodEndExclusive = new Date(recon.periodEndDate.getTime() + 24 * 60 * 60 * 1000);

    const completed = await this.prisma.$transaction(async (tx) => {
      await tx.bankTransaction.updateMany({
        where: {
          organisationId,
          propertyId,
          bankAccountId: recon.bankAccountId,
          matchStatus: 'MATCHED',
          transactionDate: { gte: recon.periodStartDate, lt: periodEndExclusive },
        },
        data: { reconciliationStatus: 'RECONCILED', reconciliationId: recon.id },
      });

      const updated = await tx.bankReconciliation.update({
        where: { id: reconciliationId },
        data: { status: 'RECONCILED', reviewedByUserId: actorUserId, completedAt: new Date() },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_RECONCILIATION_COMPLETED',
        entityType: 'BankReconciliation',
        entityId: updated.id,
        title: `Bank reconciliation completed: ${updated.publicReference}`,
        description: `Statement closing balance ${updated.statementClosingBalance.toFixed(2)}, difference 0.00`,
      });

      return updated;
    });

    return this.get(organisationId, propertyId, completed.id);
  }

  /** financials.approve. A RECONCILED row's own snapshot fields are never
   * edited in place — reopening only flips status + records who/when/why,
   * and releases its linked transactions back to UNRECONCILED so a fresh
   * superseding draft (supersedesReconciliationId pointing back here) can
   * be created separately.
   *
   * Chain-continuity guard: reopening an EARLIER period while a LATER
   * period for the same account is already RECONCILED would silently
   * break that later period's own opening-balance continuity the moment
   * this one's closing balance changes — periods must be reopened in
   * reverse-chronological order (unreconcile the newest first), same as
   * standard accounting practice. */
  async reopen(organisationId: string, actorUserId: string, propertyId: string, reconciliationId: string, reason: string): Promise<ReconciliationView> {
    const recon = await this.prisma.bankReconciliation.findFirst({ where: { id: reconciliationId, organisationId, propertyId } });
    if (!recon) throw new NotFoundError('Reconciliation not found');
    if (recon.status !== 'RECONCILED') throw new ConflictError('Only a completed reconciliation can be reopened.');

    const laterReconciled = await this.prisma.bankReconciliation.findFirst({
      where: {
        bankAccountId: recon.bankAccountId,
        status: 'RECONCILED',
        periodStartDate: { gt: recon.periodEndDate },
      },
      orderBy: { periodStartDate: 'asc' },
    });
    if (laterReconciled) {
      throw new ConflictError(
        `Reopen later reconciliation periods first — ${laterReconciled.publicReference} (${formatDateOnly(laterReconciled.periodStartDate)} – ${formatDateOnly(laterReconciled.periodEndDate)}) is already reconciled and depends on this period's closing balance for its own continuity.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bankTransaction.updateMany({
        where: { reconciliationId: recon.id },
        data: { reconciliationStatus: 'UNRECONCILED', reconciliationId: null },
      });

      const updated = await tx.bankReconciliation.update({
        where: { id: reconciliationId },
        data: { status: 'REOPENED', reopenedByUserId: actorUserId, reopenedAt: new Date(), reopenReason: reason },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'BANK_RECONCILIATION_REOPENED',
        entityType: 'BankReconciliation',
        entityId: updated.id,
        title: `Bank reconciliation reopened: ${updated.publicReference}`,
        description: reason,
      });
    });

    return this.get(organisationId, propertyId, reconciliationId);
  }
}
