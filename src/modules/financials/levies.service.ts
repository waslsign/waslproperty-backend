import { Prisma, type LevyInstallmentStatus, type LevyScheduleStatus, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/AppError.js';
import { formatDateOnly, parseDateOnly } from '../../lib/dateOnly.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import { generateManualSourceId, LedgerPostingService } from './ledger-posting.service.js';
import { allocateByEntitlement } from './levy-allocation.js';
import { sendLevyIssuanceNotice } from './levy-notices.js';
import { PostingProfileService } from './posting-profile.service.js';
import type {
  CreateLevyAdjustmentInput,
  CreateRegularLevyScheduleInput,
  CreateSpecialLevyScheduleInput,
  IssueLevyScheduleInput,
} from './levies.schemas.js';

export interface LevyInstallmentView {
  id: string;
  installmentNumber: number;
  dueDate: string;
  amount: string;
  status: LevyInstallmentStatus;
  issuedByUserId: string | null;
  issuedAt: string | null;
  journalEntryId: string | null;
  reversedByUserId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  sortOrder: number;
}

export interface LevyScheduleView {
  id: string;
  publicReference: string;
  financialFundId: string;
  fundName: string;
  financialBudgetId: string | null;
  kind: 'REGULAR' | 'SPECIAL';
  name: string;
  totalAmount: string;
  status: LevyScheduleStatus;
  rationale: string | null;
  externalApprovalDate: string | null;
  externalApprovalReference: string | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  issuedByUserId: string | null;
  issuedAt: string | null;
  journalEntryId: string | null;
  cancelledByUserId: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  reversedByUserId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
  updatedAt: string;
  installments: LevyInstallmentView[];
}

export interface LotAllocationPreviewRow {
  spaceId: string;
  spaceName: string;
  lotNumber: string | null;
  entitlementValue: string;
  installments: { levyInstallmentId: string; dueDate: string; amount: string }[];
  total: string;
}

export interface LotLevyChargeView {
  id: string;
  publicReference: string;
  levyScheduleId: string;
  levyScheduleName: string;
  levyInstallmentId: string;
  installmentNumber: number;
  dueDate: string;
  spaceId: string;
  /** Human-readable lot identifier — lotNumber if recorded, else the
   * space's code/name — never the raw spaceId (M16.3 refinement pass: a
   * strata committee member should never have to recognise a cuid). */
  lotLabel: string;
  /** Present only when the caller holds `people.view` on top of
   * `financials.view` — owner identity is gated separately from charge
   * amounts (same deliberate split as every other people.view-gated
   * field in this codebase). Null for a caller without that capability,
   * or a lot with no recorded OWNER membership. */
  ownerName: string | null;
  financialFundId: string;
  fundName: string;
  amount: string;
  /** amount + SUM(adjustments) — derived, never stored. */
  effectiveAmount: string;
  status: string;
  createdAt: string;
}

export interface LevyAdjustmentView {
  id: string;
  publicReference: string;
  lotLevyChargeId: string;
  amount: string;
  reason: string;
  journalEntryId: string;
  createdByUserId: string;
  createdAt: string;
}

type ScheduleWithInstallments = Prisma.LevyScheduleGetPayload<{
  include: { installments: { orderBy: { sortOrder: 'asc' } } };
}>;

/**
 * M16.3 — Levy Management & UOE Allocation. See prisma/schema.prisma's
 * "Strata Financial Management: Levy Management & UOE Allocation" section
 * doc comment for the three load-bearing decisions (one fund per schedule,
 * one aggregated journal per issuance with LotLevyCharge as the real
 * subledger, issued-is-immutable) this service exists to uphold. Never
 * writes to journal_entries/journal_lines directly — every posting goes
 * through LedgerPostingService.
 */
export class LevyService {
  private readonly posting: LedgerPostingService;
  private readonly profiles: PostingProfileService;

  constructor(private readonly prisma: PrismaClient) {
    this.posting = new LedgerPostingService(prisma);
    this.profiles = new PostingProfileService(prisma);
  }

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, organisationId } });
    if (!property) throw new NotFoundError('Property not found');
    return property;
  }

  private async getOwnedSchedule(
    client: PrismaClient | Prisma.TransactionClient,
    organisationId: string,
    propertyId: string,
    scheduleId: string,
  ): Promise<ScheduleWithInstallments> {
    const schedule = await client.levySchedule.findFirst({
      where: { id: scheduleId, organisationId, propertyId },
      include: { installments: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!schedule) throw new NotFoundError('Levy schedule not found');
    return schedule;
  }

  /** The lot population a schedule allocates against — active LOT spaces
   * on this property with a recorded, non-negative entitlementValue. Never
   * silently includes COMMON_PROPERTY/UNCLASSIFIED spaces (mirrors
   * LotOpeningPosition's own LOT-only discipline). */
  private async getEligibleLots(propertyId: string) {
    const spaces = await this.prisma.space.findMany({
      where: { propertyId, strataClassification: 'LOT' },
      select: { id: true, name: true, code: true, lotNumber: true, entitlementValue: true },
    });
    const missing = spaces.filter((s) => s.entitlementValue === null);
    if (missing.length > 0) {
      throw new ValidationError(
        `${missing.length} lot(s) have no recorded unit-of-entitlement value — record every lot's ` +
          'entitlementValue before raising a levy.',
        { spaceIds: missing.map((s) => s.id) },
      );
    }
    if (spaces.length === 0) {
      throw new ValidationError('This property has no strata lots to allocate a levy against.');
    }
    return spaces as (typeof spaces[number] & { entitlementValue: Prisma.Decimal })[];
  }

  /** REGULAR schedules derive their total from the linked budget's own
   * REVENUE lines — but ONLY the ones explicitly linked (via
   * FinancialBudgetLine.accountId) to whatever account the posting profile
   * currently resolves for LEVY_INCOME on this fund. This is the
   * "distinguish levy revenue from other income" safeguard: a revenue line
   * with no accountId, or one linked to a different account (e.g. interest
   * income), is never assumed to be levy income. */
  private async deriveRegularTotal(
    organisationId: string,
    propertyId: string,
    financialBudgetId: string,
    financialFundId: string,
  ): Promise<Prisma.Decimal> {
    const budget = await this.prisma.financialBudget.findFirst({
      where: { id: financialBudgetId, organisationId, propertyId },
      include: { lines: true },
    });
    if (!budget) throw new NotFoundError('Budget not found');
    // Tightened during the M16.3 closure/refinement pass (ADR-024
    // addendum): APPROVED alone used to be accepted, but APPROVED is only
    // a pre-activation checkpoint — nothing stops a second budget for the
    // same financial year also reaching APPROVED (e.g. a revision created
    // and approved before its predecessor was ever activated or
    // explicitly superseded), so "APPROVED" does not reliably mean "the
    // plan actually operative for this year." Only ACTIVE does: exactly
    // one ACTIVE budget can exist per financial year (the partial unique
    // index budgets.service.ts's activate() relies on), and activating a
    // later revision automatically supersedes whichever was ACTIVE before.
    // A regular levy must be traceable to that one, unambiguous, currently
    // operative plan — never to a budget that merely passed approval at
    // some point.
    if (budget.status !== 'ACTIVE') {
      throw new ConflictError(
        'Regular levy amounts must be traceable to this financial year\'s ACTIVE budget — approve AND ' +
          'activate the budget before creating a regular levy schedule against it.',
      );
    }

    const levyIncomeAccountId = await this.profiles.resolve(
      this.prisma,
      propertyId,
      'LEVY_INCOME',
      financialFundId,
    );

    const levyRevenueLines = budget.lines.filter(
      (l) => l.lineType === 'REVENUE' && l.financialFundId === financialFundId && l.accountId === levyIncomeAccountId,
    );
    if (levyRevenueLines.length === 0) {
      throw new ValidationError(
        'No REVENUE line on this budget is linked to the Levy Income account configured for this fund. ' +
          'Link at least one budget revenue line to that account (Chart of Accounts) before creating a ' +
          'regular levy schedule — a levy total is never assumed from unrelated revenue.',
      );
    }
    return levyRevenueLines.reduce((sum, l) => sum.plus(l.plannedAmount), new Prisma.Decimal(0));
  }

  private validateInstallmentsSumTo(
    installments: { dueDate: string; amount: number }[],
    expectedTotal: Prisma.Decimal,
  ): void {
    const sum = installments.reduce((s, i) => s.plus(i.amount), new Prisma.Decimal(0));
    if (!sum.equals(expectedTotal)) {
      throw new ValidationError(
        `Installment amounts sum to ${sum.toFixed(2)}, which does not equal the required total ${expectedTotal.toFixed(2)}.`,
      );
    }
  }

  async createRegular(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: CreateRegularLevyScheduleInput,
  ): Promise<LevyScheduleView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) {
        throw new ConflictError('Start financial setup for this property before creating a levy schedule.');
      }
      const fund = await tx.financialFund.findFirst({
        where: { id: input.financialFundId, organisationId, propertyId },
      });
      if (!fund) throw new NotFoundError('Fund not found');

      const total = await this.deriveRegularTotal(
        organisationId,
        propertyId,
        input.financialBudgetId,
        input.financialFundId,
      );
      this.validateInstallmentsSumTo(input.installments, total);

      const schedule = await withPublicReference('LEVY', (publicReference) =>
        tx.levySchedule.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            financialConfigurationId: configuration.id,
            financialFundId: input.financialFundId,
            financialBudgetId: input.financialBudgetId,
            kind: 'REGULAR',
            name: input.name,
            totalAmount: total,
            createdByUserId: actorUserId,
            installments: {
              create: input.installments.map((i, index) => ({
                dueDate: parseDateOnly(i.dueDate),
                amount: i.amount,
                sortOrder: index,
              })),
            },
          },
          include: { installments: { orderBy: { sortOrder: 'asc' } } },
        }),
      );

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'LEVY_SCHEDULE_CREATED',
        entityType: 'LevySchedule',
        entityId: schedule.id,
        title: `Regular levy schedule drafted: ${schedule.name} (${fund.name})`,
      });

      return toScheduleView(schedule, fund.name);
    });
  }

  async createSpecial(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: CreateSpecialLevyScheduleInput,
  ): Promise<LevyScheduleView> {
    await this.getOwnedProperty(organisationId, propertyId);

    const externalApprovalDate = parseDateOnly(input.externalApprovalDate);
    if (externalApprovalDate.getTime() > Date.now()) {
      throw new ValidationError('externalApprovalDate cannot be in the future.');
    }

    return this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) {
        throw new ConflictError('Start financial setup for this property before creating a levy schedule.');
      }
      const fund = await tx.financialFund.findFirst({
        where: { id: input.financialFundId, organisationId, propertyId },
      });
      if (!fund) throw new NotFoundError('Fund not found');

      const total = input.installments.reduce((s, i) => s.plus(i.amount), new Prisma.Decimal(0));

      const schedule = await withPublicReference('LEVY', (publicReference) =>
        tx.levySchedule.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            financialConfigurationId: configuration.id,
            financialFundId: input.financialFundId,
            kind: 'SPECIAL',
            name: input.name,
            totalAmount: total,
            rationale: input.rationale,
            externalApprovalDate,
            externalApprovalReference: input.externalApprovalReference ?? null,
            createdByUserId: actorUserId,
            installments: {
              create: input.installments.map((i, index) => ({
                dueDate: parseDateOnly(i.dueDate),
                amount: i.amount,
                sortOrder: index,
              })),
            },
          },
          include: { installments: { orderBy: { sortOrder: 'asc' } } },
        }),
      );

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'LEVY_SCHEDULE_CREATED',
        entityType: 'LevySchedule',
        entityId: schedule.id,
        title: `Special levy schedule drafted: ${schedule.name} (${fund.name})`,
      });

      return toScheduleView(schedule, fund.name);
    });
  }

  async list(organisationId: string, propertyId: string): Promise<LevyScheduleView[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const schedules = await this.prisma.levySchedule.findMany({
      where: { organisationId, propertyId },
      include: { installments: { orderBy: { sortOrder: 'asc' } }, fund: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return schedules.map((s) => toScheduleView(s, s.fund.name));
  }

  async getById(organisationId: string, propertyId: string, scheduleId: string): Promise<LevyScheduleView> {
    await this.getOwnedProperty(organisationId, propertyId);
    const schedule = await this.prisma.levySchedule.findFirst({
      where: { id: scheduleId, organisationId, propertyId },
      include: { installments: { orderBy: { sortOrder: 'asc' } }, fund: { select: { name: true } } },
    });
    if (!schedule) throw new NotFoundError('Levy schedule not found');
    return toScheduleView(schedule, schedule.fund.name);
  }

  async approve(organisationId: string, actorUserId: string, propertyId: string, scheduleId: string) {
    await this.getOwnedProperty(organisationId, propertyId);
    return this.prisma.$transaction(async (tx) => {
      const schedule = await this.getOwnedSchedule(tx, organisationId, propertyId, scheduleId);
      if (schedule.status !== 'DRAFT') {
        throw new ConflictError('Only a draft levy schedule can be approved.');
      }
      const updated = await tx.levySchedule.update({
        where: { id: schedule.id },
        data: { status: 'APPROVED', approvedByUserId: actorUserId, approvedAt: new Date() },
        include: { installments: { orderBy: { sortOrder: 'asc' } }, fund: { select: { name: true } } },
      });
      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'LEVY_SCHEDULE_APPROVED',
        entityType: 'LevySchedule',
        entityId: schedule.id,
        title: `Levy schedule approved: ${schedule.name}`,
      });
      return toScheduleView(updated, updated.fund.name);
    });
  }

  async cancel(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    scheduleId: string,
    reason: string,
  ) {
    await this.getOwnedProperty(organisationId, propertyId);
    return this.prisma.$transaction(async (tx) => {
      const schedule = await this.getOwnedSchedule(tx, organisationId, propertyId, scheduleId);
      if (schedule.status !== 'DRAFT' && schedule.status !== 'APPROVED') {
        throw new ConflictError('Only a draft or approved (not yet issued) levy schedule can be cancelled.');
      }
      // ADR-024: status alone can't be fully trusted for this check any
      // more — an instalment that was issued and later reversed brings
      // the schedule's computed status back down to APPROVED, but real
      // financial history now exists for it. Cancelling would misrepresent
      // that history as "nothing was ever posted."
      if (schedule.installments.some((i) => i.issuedAt !== null)) {
        throw new ConflictError(
          'This schedule has issued (or issued-then-reversed) instalments — it has real financial ' +
            'history and can no longer be cancelled outright.',
        );
      }
      const updated = await tx.levySchedule.update({
        where: { id: schedule.id },
        data: { status: 'CANCELLED', cancelledByUserId: actorUserId, cancelledAt: new Date(), cancelReason: reason },
        include: { installments: { orderBy: { sortOrder: 'asc' } }, fund: { select: { name: true } } },
      });
      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'LEVY_SCHEDULE_CANCELLED',
        entityType: 'LevySchedule',
        entityId: schedule.id,
        title: `Levy schedule cancelled: ${schedule.name}`,
        description: reason,
      });
      return toScheduleView(updated, updated.fund.name);
    });
  }

  /** Computes the per-lot allocation fresh from CURRENT lot entitlements
   * — never persisted until an instalment is actually issued. Only
   * instalments still PENDING are previewed (ADR-024): an already-ISSUED
   * or REVERSED instalment has real LotLevyCharge rows as its source of
   * truth, never a recomputed preview that could drift from what was
   * actually posted — see the charges endpoint for those. Because
   * issue() recomputes from current data too (never reuses a stale
   * preview), the preview and the eventual issued amount for a given
   * instalment are byte-identical UNLESS lot entitlements genuinely
   * changed in between — a documented limitation, not a bug (see
   * ADR-023). */
  async preview(organisationId: string, propertyId: string, scheduleId: string): Promise<LotAllocationPreviewRow[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const schedule = await this.getOwnedSchedule(this.prisma, organisationId, propertyId, scheduleId);
    if (schedule.status === 'CANCELLED') {
      throw new ConflictError('This schedule was cancelled — there is nothing to preview.');
    }
    const lots = await this.getEligibleLots(propertyId);
    const pending = schedule.installments.filter((i) => i.status === 'PENDING');
    return this.allocateInstallments(pending, lots);
  }

  /** Allocates an explicit list of instalments (never a whole schedule
   * implicitly — see preview()/issue()'s own call sites for which subset
   * each passes) across the given lots by units of entitlement, largest-
   * remainder rounding (ADR-022). */
  private allocateInstallments(
    installments: { id: string; dueDate: Date; amount: Prisma.Decimal }[],
    lots: { id: string; name: string; lotNumber: string | null; entitlementValue: Prisma.Decimal }[],
  ): LotAllocationPreviewRow[] {
    const rows = new Map<string, LotAllocationPreviewRow>(
      lots.map((lot) => [
        lot.id,
        {
          spaceId: lot.id,
          spaceName: lot.name,
          lotNumber: lot.lotNumber,
          entitlementValue: lot.entitlementValue.toFixed(2),
          installments: [],
          total: '0.00',
        },
      ]),
    );

    for (const installment of installments) {
      const allocation = allocateByEntitlement(
        installment.amount,
        lots.map((lot) => ({ key: lot.id, entitlementValue: lot.entitlementValue })),
      );
      for (const [spaceId, amount] of allocation) {
        const row = rows.get(spaceId)!;
        row.installments.push({
          levyInstallmentId: installment.id,
          dueDate: formatDateOnly(installment.dueDate),
          amount: amount.toFixed(2),
        });
        row.total = new Prisma.Decimal(row.total).plus(amount).toFixed(2);
      }
    }

    return Array.from(rows.values());
  }

  /**
   * APPROVED -> ISSUED. Locks the FinancialConfiguration row FIRST (before
   * any read used in a decision — the same "lock before check" discipline
   * ADR-021 established after the reversal-race fix), recomputes the
   * allocation fresh, writes every LotLevyCharge row, and posts ONE
   * aggregated journal — all inside one transaction via
   * LedgerPostingService.postWithinTransaction, so the charges and the
   * posting are atomic together. Idempotent: re-issuing an already-ISSUED
   * schedule returns it unchanged rather than posting or charging again.
   */
  async issue(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    scheduleId: string,
    input: IssueLevyScheduleInput,
  ): Promise<LevyScheduleView> {
    await this.getOwnedProperty(organisationId, propertyId);

    const result = await this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) {
        throw new ConflictError('Start financial setup for this property before issuing a levy.');
      }
      // Lock before any further read/decision for this property — see
      // this method's own doc comment.
      await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

      const schedule = await this.getOwnedSchedule(tx, organisationId, propertyId, scheduleId);
      if (schedule.status === 'DRAFT' || schedule.status === 'CANCELLED') {
        throw new ConflictError('Only an approved levy schedule can be issued.');
      }

      const target = input.levyInstallmentId
        ? schedule.installments.find((i) => i.id === input.levyInstallmentId)
        : schedule.installments.find((i) => i.status === 'PENDING');

      const fund = await tx.financialFund.findUniqueOrThrow({ where: { id: schedule.financialFundId } });

      if (!target) {
        if (input.levyInstallmentId) throw new NotFoundError('Instalment not found on this schedule.');
        // No explicit instalment named, and none left PENDING — every
        // instalment is already ISSUED (or REVERSED-with-nothing-left-
        // pending). Idempotent no-op, same contract as re-issuing an
        // already-ISSUED instalment below: a retry of "issue the next
        // one" after a concurrent call already took the last one must
        // return success, not a spurious conflict.
        return { view: toScheduleView(schedule, fund.name), notice: null };
      }

      if (target.status === 'ISSUED') {
        // Idempotent retry of the same instalment — return unchanged,
        // never double-post or double-charge.
        return { view: toScheduleView(schedule, fund.name), notice: null };
      }
      if (target.status !== 'PENDING') {
        throw new ConflictError(
          'This instalment was already reversed and can never be re-issued — raise a fresh correction instead.',
        );
      }

      const lots = await this.getEligibleLotsInTx(tx, propertyId);
      const rows = this.allocateInstallments([target], lots);

      const receivableAccountId = await this.profiles.resolve(
        tx,
        propertyId,
        'LOT_LEVY_RECEIVABLE',
        schedule.financialFundId,
      );
      const incomeAccountId = await this.profiles.resolve(tx, propertyId, 'LEVY_INCOME', schedule.financialFundId);

      const chargedSpaceIds: string[] = [];
      let instalmentTotal = new Prisma.Decimal(0);
      for (const row of rows) {
        const charge = row.installments[0];
        if (!charge || new Prisma.Decimal(charge.amount).lte(0)) continue;
        chargedSpaceIds.push(row.spaceId);
        instalmentTotal = instalmentTotal.plus(charge.amount);
        await withPublicReference('LVC', (publicReference) =>
          tx.lotLevyCharge.create({
            data: {
              publicReference,
              organisationId,
              propertyId,
              levyScheduleId: schedule.id,
              levyInstallmentId: target.id,
              spaceId: row.spaceId,
              financialFundId: schedule.financialFundId,
              amount: charge.amount,
            },
          }),
        );
      }

      const instalmentNumber = target.sortOrder + 1;
      const journal = await this.posting.postWithinTransaction(tx, organisationId, actorUserId, propertyId, {
        effectiveDate: formatDateOnly(new Date()),
        currencyCode: configuration.currencyCode ?? undefined,
        sourceType: schedule.kind === 'REGULAR' ? 'LEVY_REGULAR' : 'LEVY_SPECIAL',
        // Per-instalment, not per-schedule (ADR-024) — a schedule's second
        // and later instalments must each post their own journal under
        // the SAME schedule.id, so the instalment's own id is the
        // idempotency key here, not the schedule's.
        sourceId: target.id,
        narration: `Levy instalment #${instalmentNumber} issued: ${schedule.name} (${fund.name}), due ${formatDateOnly(target.dueDate)}`,
        lines: [
          {
            accountId: receivableAccountId,
            financialFundId: schedule.financialFundId,
            debit: Number(target.amount),
            credit: 0,
            lineNarration: `Lot levy receivable — ${schedule.name} #${instalmentNumber}`,
          },
          {
            accountId: incomeAccountId,
            financialFundId: schedule.financialFundId,
            debit: 0,
            credit: Number(target.amount),
            lineNarration: `Levy income — ${schedule.name} #${instalmentNumber}`,
          },
        ],
      });

      const updatedInstallment = await tx.levyInstallment.update({
        where: { id: target.id },
        data: { status: 'ISSUED', issuedByUserId: actorUserId, issuedAt: new Date(), journalEntryId: journal.id },
      });

      const refreshedInstallments = schedule.installments.map((i) => (i.id === target.id ? updatedInstallment : i));
      const updated = await tx.levySchedule.update({
        where: { id: schedule.id },
        data: { status: computeScheduleStatus(schedule.status, refreshedInstallments) },
        include: { installments: { orderBy: { sortOrder: 'asc' } } },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'LEVY_INSTALLMENT_ISSUED',
        entityType: 'LevyInstallment',
        entityId: target.id,
        title:
          `Levy instalment #${instalmentNumber} issued: ${schedule.name} (${fund.name}) — ` +
          `${instalmentTotal.toFixed(2)} ${journal.currencyCode}, due ${formatDateOnly(target.dueDate)}`,
      });

      return {
        view: toScheduleView(updated, fund.name),
        notice: {
          spaceIds: chargedSpaceIds,
          fundName: fund.name,
          journal,
          instalmentNumber,
          dueDate: formatDateOnly(target.dueDate),
          rows,
        },
      };
    });

    // Notices are sent AFTER the issuance transaction has committed —
    // never inside it, and never able to roll back or duplicate the
    // posting if sending fails (see levy-notices.ts's own doc comment and
    // the "notification failure without duplicate financial postings"
    // safeguard).
    if (result.notice) {
      await sendLevyIssuanceNotice(this.prisma, {
        organisationId,
        propertyId,
        fundName: result.notice.fundName,
        currencyCode: result.notice.journal.currencyCode,
        issuedByUserId: actorUserId,
        scheduleName: result.view.name,
        instalmentNumber: result.notice.instalmentNumber,
        dueDate: result.notice.dueDate,
        perLot: result.notice.rows
          .filter((r) => r.installments.length > 0)
          .map((r) => ({ spaceId: r.spaceId, spaceName: r.spaceName, lotNumber: r.lotNumber, amount: r.installments[0]!.amount })),
      });
    }

    return result.view;
  }

  private async getEligibleLotsInTx(tx: Prisma.TransactionClient, propertyId: string) {
    const spaces = await tx.space.findMany({
      where: { propertyId, strataClassification: 'LOT' },
      select: { id: true, name: true, lotNumber: true, entitlementValue: true },
    });
    const missing = spaces.filter((s) => s.entitlementValue === null);
    if (missing.length > 0) {
      throw new ValidationError(
        `${missing.length} lot(s) have no recorded unit-of-entitlement value — cannot issue this levy.`,
        { spaceIds: missing.map((s) => s.id) },
      );
    }
    if (spaces.length === 0) {
      throw new ValidationError('This property has no strata lots to allocate a levy against.');
    }
    return spaces as (typeof spaces[number] & { entitlementValue: Prisma.Decimal })[];
  }

  /**
   * financials.approve only (ADR-024). Reverses ONE instalment's own
   * posted journal AND cancels that instalment's LotLevyCharge rows, in
   * ONE transaction via LedgerPostingService.reverseWithinTransaction —
   * never a direct edit, never two separate transactions (the M16.3
   * closure review's "lock before check, one transaction" fix applies
   * here exactly as it did to the pre-ADR-024 whole-schedule version:
   * the config lock is acquired before any status check, so two
   * concurrent reversal calls for the same instalment can never both
   * pass the check before either commits). Every OTHER instalment on the
   * schedule, issued or still pending, is completely unaffected for any
   * instalment issued under ADR-024 (each has its own distinct journal).
   *
   * **Legacy exception, found during the 2026-10-21 Harbour View Strata
   * incident investigation.** A pre-ADR-024 schedule's instalments were
   * backfilled all pointing at the SAME shared whole-schedule journal
   * (see ADR-024's migration section and LevyInstallment.journalEntryId's
   * own doc comment). Reversing one of them would call
   * `reverseWithinTransaction` on that shared journal, which reverses the
   * journal's FULL original amount — e.g. reversing 1 of 4 instalments
   * sharing a $48,000 journal incorrectly reverses the whole $48,000,
   * while only that one instalment's LotLevyCharge rows get cancelled.
   * The GL then shows $0 outstanding while the lot subledger still shows
   * 3 instalments' worth of real receivables — a genuine GL/subledger
   * divergence a balanced trial balance never reveals (the reversal is
   * itself a valid, balanced journal, just the wrong size). There is no
   * safe way to post a PARTIAL reversal of a journal that was never
   * itself posted per-instalment — fabricating one would mean inventing a
   * split of history that never actually happened. So below: if this
   * instalment's journal is still shared with any OTHER non-REVERSED
   * instalment, the reversal is rejected outright with a clear business
   * error, never silently reversed in full. This is permanent, not a
   * workaround — a legacy shared-journal instalment can never be
   * reversed through this endpoint; see the M16.4 incident report's demo
   * correction plan for how to actually correct one by hand.
   */
  async reverseInstallment(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    scheduleId: string,
    levyInstallmentId: string,
    reason: string,
  ): Promise<LevyScheduleView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) {
        throw new ConflictError('Start financial setup for this property before reversing a levy.');
      }
      await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

      const schedule = await this.getOwnedSchedule(tx, organisationId, propertyId, scheduleId);
      const target = schedule.installments.find((i) => i.id === levyInstallmentId);
      if (!target) throw new NotFoundError('Instalment not found on this schedule.');
      if (target.status !== 'ISSUED') {
        throw new ConflictError('Only an issued instalment can be reversed.');
      }
      if (!target.journalEntryId) {
        throw new ConflictError('This instalment has no linked journal to reverse.');
      }

      const sharedJournalSiblings = await tx.levyInstallment.count({
        where: {
          journalEntryId: target.journalEntryId,
          id: { not: target.id },
          status: { not: 'REVERSED' },
        },
      });
      if (sharedJournalSiblings > 0) {
        throw new ConflictError(
          `This instalment shares its posted journal with ${sharedJournalSiblings} other still-issued instalment${sharedJournalSiblings === 1 ? '' : 's'} from a legacy whole-schedule posting (pre-ADR-024) — reversing it would incorrectly reverse their receivables too. This legacy posting cannot be safely reversed at the instalment level; correct it manually (see the Lot Ledger incident report) rather than reversing here.`,
        );
      }

      await this.posting.reverseWithinTransaction(
        tx,
        organisationId,
        actorUserId,
        propertyId,
        target.journalEntryId,
        { reason },
      );

      await tx.lotLevyCharge.updateMany({
        where: { levyInstallmentId: target.id },
        data: { status: 'CANCELLED' },
      });
      const updatedInstallment = await tx.levyInstallment.update({
        where: { id: target.id },
        data: { status: 'REVERSED', reversedByUserId: actorUserId, reversedAt: new Date(), reversalReason: reason },
      });

      const refreshedInstallments = schedule.installments.map((i) => (i.id === target.id ? updatedInstallment : i));
      const updated = await tx.levySchedule.update({
        where: { id: schedule.id },
        data: { status: computeScheduleStatus(schedule.status, refreshedInstallments) },
        include: { installments: { orderBy: { sortOrder: 'asc' } }, fund: { select: { name: true } } },
      });
      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'LEVY_INSTALLMENT_REVERSED',
        entityType: 'LevyInstallment',
        entityId: target.id,
        title: `Levy instalment #${target.sortOrder + 1} reversed: ${schedule.name}`,
        description: reason,
      });
      return toScheduleView(updated, updated.fund.name);
    });
  }

  /** `includeOwnerNames` must be set by the CALLER only after confirming
   * the requesting user independently holds `people.view` on this
   * property — this service has no authorization context of its own
   * (see levies.controller.ts), and owner identity is never bundled into
   * a financials.view-gated response by default. */
  async listCharges(
    organisationId: string,
    propertyId: string,
    filters: { spaceId?: string; levyScheduleId?: string },
    includeOwnerNames: boolean,
  ): Promise<LotLevyChargeView[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const charges = await this.prisma.lotLevyCharge.findMany({
      where: {
        organisationId,
        propertyId,
        spaceId: filters.spaceId,
        levyScheduleId: filters.levyScheduleId,
      },
      include: {
        adjustments: true,
        levySchedule: { select: { name: true } },
        levyInstallment: { select: { sortOrder: true, dueDate: true } },
        fund: { select: { name: true } },
        space: { select: { name: true, code: true, lotNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    let ownerNamesBySpaceId = new Map<string, string>();
    if (includeOwnerNames && charges.length > 0) {
      const spaceIds = Array.from(new Set(charges.map((c) => c.spaceId)));
      const owners = await this.prisma.propertyMembership.findMany({
        where: { propertyId, spaceId: { in: spaceIds }, role: 'OWNER', status: 'ACTIVE' },
        include: { contact: { select: { firstName: true, lastName: true } } },
      });
      // A lot can have more than one active OWNER membership (co-owners)
      // — join every owner's name for that lot rather than picking one
      // arbitrarily.
      ownerNamesBySpaceId = owners.reduce((map, m) => {
        const name = `${m.contact.firstName} ${m.contact.lastName}`;
        const existing = map.get(m.spaceId!);
        map.set(m.spaceId!, existing ? `${existing}, ${name}` : name);
        return map;
      }, new Map<string, string>());
    }

    return charges.map((c) => toChargeView(c, ownerNamesBySpaceId.get(c.spaceId) ?? null));
  }

  /** financials.approve only. Posts a small correcting journal (debit/
   * credit LOT_LEVY_RECEIVABLE vs LEVY_INCOME for the signed amount) —
   * never edits LotLevyCharge.amount itself. */
  async createAdjustment(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    chargeId: string,
    input: CreateLevyAdjustmentInput,
  ): Promise<LevyAdjustmentView> {
    await this.getOwnedProperty(organisationId, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) {
        throw new ConflictError('Start financial setup for this property before adjusting a levy charge.');
      }
      await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

      const charge = await tx.lotLevyCharge.findFirst({
        where: { id: chargeId, organisationId, propertyId },
      });
      if (!charge) throw new NotFoundError('Levy charge not found');
      if (charge.status === 'CANCELLED') {
        throw new ConflictError('This charge has been cancelled (its instalment was reversed) and cannot be adjusted.');
      }

      const receivableAccountId = await this.profiles.resolve(tx, propertyId, 'LOT_LEVY_RECEIVABLE', charge.financialFundId);
      const incomeAccountId = await this.profiles.resolve(tx, propertyId, 'LEVY_INCOME', charge.financialFundId);

      const amount = input.amount;
      const magnitude = Math.abs(amount);
      // Positive adjustment: receivable increases (debit) against more
      // income recognized (credit). Negative: the reverse.
      const journal = await this.posting.postWithinTransaction(tx, organisationId, actorUserId, propertyId, {
        effectiveDate: formatDateOnly(new Date()),
        currencyCode: configuration.currencyCode ?? undefined,
        sourceType: 'LEVY_ADJUSTMENT',
        sourceId: input.sourceId ?? generateManualSourceId(),
        narration: `Levy charge adjustment: ${input.reason}`,
        lines:
          amount > 0
            ? [
                { accountId: receivableAccountId, financialFundId: charge.financialFundId, debit: magnitude, credit: 0 },
                { accountId: incomeAccountId, financialFundId: charge.financialFundId, debit: 0, credit: magnitude },
              ]
            : [
                { accountId: incomeAccountId, financialFundId: charge.financialFundId, debit: magnitude, credit: 0 },
                { accountId: receivableAccountId, financialFundId: charge.financialFundId, debit: 0, credit: magnitude },
              ],
      });

      // The journal post above is idempotent on `sourceId` — a retry with
      // the same key returns the SAME journal.id rather than posting
      // again. journalEntryId is @unique on LevyAdjustment, so a naive
      // second `create` here would throw a raw constraint error instead
      // of behaving idempotently; check first and return the existing
      // adjustment unchanged, mirroring LedgerPostingService's own
      // "idempotent request returns the original, never an error"
      // contract.
      const existingAdjustment = await tx.levyAdjustment.findUnique({ where: { journalEntryId: journal.id } });
      if (existingAdjustment) {
        return {
          id: existingAdjustment.id,
          publicReference: existingAdjustment.publicReference,
          lotLevyChargeId: existingAdjustment.lotLevyChargeId,
          amount: existingAdjustment.amount.toFixed(2),
          reason: existingAdjustment.reason,
          journalEntryId: existingAdjustment.journalEntryId,
          createdByUserId: existingAdjustment.createdByUserId,
          createdAt: existingAdjustment.createdAt.toISOString(),
        };
      }

      const adjustment = await withPublicReference('LVA', (publicReference) =>
        tx.levyAdjustment.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            lotLevyChargeId: charge.id,
            amount,
            reason: input.reason,
            journalEntryId: journal.id,
            createdByUserId: actorUserId,
          },
        }),
      );

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'LEVY_CHARGE_ADJUSTED',
        entityType: 'LotLevyCharge',
        entityId: charge.id,
        title: `Levy charge adjusted by ${amount.toFixed(2)}: ${input.reason}`,
      });

      return {
        id: adjustment.id,
        publicReference: adjustment.publicReference,
        lotLevyChargeId: adjustment.lotLevyChargeId,
        amount: adjustment.amount.toFixed(2),
        reason: adjustment.reason,
        journalEntryId: adjustment.journalEntryId,
        createdByUserId: adjustment.createdByUserId,
        createdAt: adjustment.createdAt.toISOString(),
      };
    });
  }
}

function toScheduleView(
  schedule: ScheduleWithInstallments,
  fundName: string,
): LevyScheduleView {
  return {
    id: schedule.id,
    publicReference: schedule.publicReference,
    financialFundId: schedule.financialFundId,
    fundName,
    financialBudgetId: schedule.financialBudgetId,
    kind: schedule.kind,
    name: schedule.name,
    totalAmount: schedule.totalAmount.toFixed(2),
    status: schedule.status,
    rationale: schedule.rationale,
    externalApprovalDate: schedule.externalApprovalDate ? formatDateOnly(schedule.externalApprovalDate) : null,
    externalApprovalReference: schedule.externalApprovalReference,
    createdByUserId: schedule.createdByUserId,
    approvedByUserId: schedule.approvedByUserId,
    approvedAt: schedule.approvedAt ? schedule.approvedAt.toISOString() : null,
    issuedByUserId: schedule.issuedByUserId,
    issuedAt: schedule.issuedAt ? schedule.issuedAt.toISOString() : null,
    journalEntryId: schedule.journalEntryId,
    cancelledByUserId: schedule.cancelledByUserId,
    cancelledAt: schedule.cancelledAt ? schedule.cancelledAt.toISOString() : null,
    cancelReason: schedule.cancelReason,
    reversedByUserId: schedule.reversedByUserId,
    reversedAt: schedule.reversedAt ? schedule.reversedAt.toISOString() : null,
    reversalReason: schedule.reversalReason,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
    installments: schedule.installments.map((i) => ({
      id: i.id,
      installmentNumber: i.sortOrder + 1,
      dueDate: formatDateOnly(i.dueDate),
      amount: i.amount.toFixed(2),
      status: i.status,
      issuedByUserId: i.issuedByUserId,
      issuedAt: i.issuedAt ? i.issuedAt.toISOString() : null,
      journalEntryId: i.journalEntryId,
      reversedByUserId: i.reversedByUserId,
      reversedAt: i.reversedAt ? i.reversedAt.toISOString() : null,
      reversalReason: i.reversalReason,
      sortOrder: i.sortOrder,
    })),
  };
}

/** ADR-024 — the schedule's own status is derived from its instalments'
 * statuses, recomputed after every instalment-level issue/reverse rather
 * than independently set. DRAFT and CANCELLED are untouched here — they
 * only ever change via create()/cancel() directly, never as a side
 * effect of instalment activity. */
function computeScheduleStatus(
  current: LevyScheduleStatus,
  installments: { status: LevyInstallmentStatus }[],
): LevyScheduleStatus {
  if (current === 'DRAFT' || current === 'CANCELLED') return current;
  const issuedCount = installments.filter((i) => i.status === 'ISSUED').length;
  if (issuedCount === 0) return 'APPROVED';
  // ISSUED means every instalment is ISSUED — not merely "none left
  // PENDING". A schedule with one ISSUED and one REVERSED instalment
  // (nothing PENDING either) is NOT fully issued; it is a mix of real
  // posted history and a correction, so it reads as PARTIALLY_ISSUED.
  if (issuedCount === installments.length) return 'ISSUED';
  return 'PARTIALLY_ISSUED';
}

function toChargeView(
  charge: Prisma.LotLevyChargeGetPayload<{
    include: {
      adjustments: true;
      levySchedule: { select: { name: true } };
      levyInstallment: { select: { sortOrder: true; dueDate: true } };
      fund: { select: { name: true } };
      space: { select: { name: true; code: true; lotNumber: true } };
    };
  }>,
  ownerName: string | null,
): LotLevyChargeView {
  const adjustmentTotal = charge.adjustments.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
  return {
    id: charge.id,
    publicReference: charge.publicReference,
    levyScheduleId: charge.levyScheduleId,
    levyScheduleName: charge.levySchedule.name,
    levyInstallmentId: charge.levyInstallmentId,
    installmentNumber: charge.levyInstallment.sortOrder + 1,
    dueDate: formatDateOnly(charge.levyInstallment.dueDate),
    spaceId: charge.spaceId,
    lotLabel: charge.space.lotNumber ? `Lot ${charge.space.lotNumber}` : charge.space.code || charge.space.name,
    ownerName,
    financialFundId: charge.financialFundId,
    fundName: charge.fund.name,
    amount: charge.amount.toFixed(2),
    effectiveAmount: charge.amount.plus(adjustmentTotal).toFixed(2),
    status: charge.status,
    createdAt: charge.createdAt.toISOString(),
  };
}
