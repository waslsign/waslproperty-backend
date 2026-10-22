import { Prisma, type CollectionCaseStatus, type PaymentReminderStatus, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { formatDateOnly, parseDateOnly } from '../../lib/dateOnly.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import type {
  AgeingBucket,
  CreateCollectionCaseInput,
  CreateCollectionNoteInput,
  UpdateCollectionCaseInput,
} from './arrears.schemas.js';

/**
 * M16.6 — Arrears Management (ADR-027). Every arrears figure is computed
 * live from LotLevyCharge/LevyAdjustment/PaymentAllocation/LevyInstallment/
 * Receipt — never a persisted financial truth. Only the collection
 * workflow (CollectionCase/CollectionNote/PaymentReminder) is persisted
 * here, and it never drives or is driven by the financial calculation.
 */

const CHARGE_INCLUDE = {
  adjustments: true,
  allocations: true,
  levySchedule: { select: { name: true, publicReference: true } },
  levyInstallment: { select: { dueDate: true, sortOrder: true, issuedAt: true, reversedAt: true } },
  fund: { select: { id: true, name: true } },
  space: { select: { id: true, name: true, code: true, lotNumber: true } },
} satisfies Prisma.LotLevyChargeInclude;

type ChargeWithIncludes = Prisma.LotLevyChargeGetPayload<{ include: typeof CHARGE_INCLUDE }>;

export interface ChargeArrearsView {
  lotLevyChargeId: string;
  publicReference: string;
  levyScheduleId: string;
  levyScheduleName: string;
  levyInstallmentId: string;
  dueDate: string;
  financialFundId: string;
  fundName: string;
  originalAmount: string;
  adjustmentsTotal: string;
  effectiveAmount: string;
  appliedAmount: string;
  outstandingAmount: string;
  isOverdue: boolean;
  daysOverdue: number;
  ageingBucket: AgeingBucket;
}

export interface LotArrearsSummaryView {
  spaceId: string;
  lotLabel: string;
  ownerName: string | null;
  financialFundId: string | null;
  totalOutstanding: string;
  totalOverdue: string;
  oldestDueDate: string | null;
  maxDaysOverdue: number;
  ageingBucket: AgeingBucket | null;
  unappliedCredits: string;
  collectionStatus: CollectionCaseStatus | 'NONE';
  collectionCaseId: string | null;
  lastActivityAt: string | null;
}

export interface ArrearsSummaryView {
  propertyId: string;
  asOfDate: string;
  currencyCode: string | null;
  totalOverdue: string;
  totalCurrentOutstanding: string;
  totalUnappliedCredits: string;
  lotsInArrearsCount: number;
  ageingBuckets: Record<AgeingBucket, string>;
  overdueByFund: { financialFundId: string; fundName: string; totalOverdue: string }[];
}

/** "2026-10-21" -> the exclusive upper-bound instant (UTC midnight the
 * NEXT day) — a timestamp is "on or before" the as-of date iff it is
 * strictly less than this. Keeps every effective-dated comparison below
 * to one simple `<` rather than fiddly end-of-day millisecond math. */
function endOfDateOnlyExclusive(dateOnly: string): Date {
  const start = parseDateOnly(dateOnly);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function ageingBucketFor(daysOverdue: number): AgeingBucket {
  if (daysOverdue <= 0) return 'CURRENT';
  if (daysOverdue <= 30) return 'DAYS_1_30';
  if (daysOverdue <= 60) return 'DAYS_31_60';
  if (daysOverdue <= 90) return 'DAYS_61_90';
  return 'DAYS_90_PLUS';
}

const AGEING_BUCKET_ORDER: AgeingBucket[] = ['CURRENT', 'DAYS_1_30', 'DAYS_31_60', 'DAYS_61_90', 'DAYS_90_PLUS'];

function lotLabelFor(space: { lotNumber: string | null; code: string; name: string }): string {
  return space.lotNumber ? `Lot ${space.lotNumber}` : space.code || space.name;
}

/** PaymentReminder.totalAmountOwing is a Prisma Decimal — formatted here
 * to exactly 2dp before leaving the service, same discipline as every
 * other money field in this codebase (a bare Decimal's own toString/
 * toJSON drops trailing zeros, e.g. "500" instead of "500.00"). */
function toCollectionCaseView<T extends { nextFollowUpDate: Date | null }>(
  kase: T,
): Omit<T, 'nextFollowUpDate'> & { nextFollowUpDate: string | null } {
  return { ...kase, nextFollowUpDate: kase.nextFollowUpDate ? formatDateOnly(kase.nextFollowUpDate) : null };
}

function toReminderView<T extends { totalAmountOwing: Prisma.Decimal; asOfDate: Date }>(
  reminder: T,
): Omit<T, 'totalAmountOwing' | 'asOfDate'> & { totalAmountOwing: string; asOfDate: string } {
  return { ...reminder, totalAmountOwing: reminder.totalAmountOwing.toFixed(2), asOfDate: formatDateOnly(reminder.asOfDate) };
}

/** The one place a charge's position is computed as of a given date —
 * real effective-dated reconstruction (ADR-027), not today's state
 * naively relabelled. `asOfDate` defaults to today upstream; every
 * comparison here is driven by it, so "today" is just the ordinary case
 * where nothing has a future timestamp. */
function computeChargeArrears(charge: ChargeWithIncludes, asOfDate: string): ChargeArrearsView | null {
  const asOfExclusive = endOfDateOnlyExclusive(asOfDate);
  const asOfStart = parseDateOnly(asOfDate);

  // The charge did not exist, financially, before its instalment was
  // actually issued — never show it in a historical position that
  // predates its own issuance.
  if (charge.levyInstallment.issuedAt && charge.levyInstallment.issuedAt.getTime() >= asOfExclusive.getTime()) {
    return null;
  }

  const cancelledAsOf = Boolean(
    charge.levyInstallment.reversedAt && charge.levyInstallment.reversedAt.getTime() < asOfExclusive.getTime(),
  );

  const adjustmentsTotal = charge.adjustments
    .filter((a) => a.createdAt.getTime() < asOfExclusive.getTime())
    .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
  const effectiveAmount = charge.amount.plus(adjustmentsTotal);

  const appliedAmount = charge.allocations
    .filter((a) => {
      if (a.createdAt.getTime() >= asOfExclusive.getTime()) return false;
      const reversedAsOf = a.status === 'REVERSED' && a.reversedAt && a.reversedAt.getTime() < asOfExclusive.getTime();
      return !reversedAsOf;
    })
    .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));

  const outstandingAmount = cancelledAsOf ? new Prisma.Decimal(0) : effectiveAmount.minus(appliedAmount);

  const dueDate = charge.levyInstallment.dueDate;
  const daysOverdue = Math.max(0, Math.round((asOfStart.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000)));
  const isOverdue = !cancelledAsOf && dueDate.getTime() < asOfStart.getTime() && outstandingAmount.greaterThan(0);

  return {
    lotLevyChargeId: charge.id,
    publicReference: charge.publicReference,
    levyScheduleId: charge.levyScheduleId,
    levyScheduleName: charge.levySchedule.name,
    levyInstallmentId: charge.levyInstallmentId,
    dueDate: formatDateOnly(dueDate),
    financialFundId: charge.financialFundId,
    fundName: charge.fund.name,
    originalAmount: charge.amount.toFixed(2),
    adjustmentsTotal: adjustmentsTotal.toFixed(2),
    effectiveAmount: effectiveAmount.toFixed(2),
    appliedAmount: appliedAmount.toFixed(2),
    outstandingAmount: outstandingAmount.toFixed(2),
    isOverdue,
    daysOverdue: isOverdue ? daysOverdue : 0,
    ageingBucket: cancelledAsOf || outstandingAmount.lessThanOrEqualTo(0) ? 'CURRENT' : ageingBucketFor(daysOverdue),
  };
}

export class ArrearsService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, organisationId } });
    if (!property) throw new NotFoundError('Property not found');
    return property;
  }

  private async getOwnedLot(organisationId: string, propertyId: string, spaceId: string) {
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, organisationId, propertyId },
      select: { id: true, strataClassification: true, lotNumber: true, code: true, name: true },
    });
    if (!space) throw new NotFoundError('Lot not found');
    if (space.strataClassification !== 'LOT') {
      throw new ConflictError(`${space.name} is not a strata lot.`);
    }
    return space;
  }

  private async getOwnerName(propertyId: string, spaceId: string, includeOwnerNames: boolean): Promise<string | null> {
    if (!includeOwnerNames) return null;
    const owners = await this.prisma.propertyMembership.findMany({
      where: { propertyId, spaceId, role: 'OWNER', status: 'ACTIVE' },
      include: { contact: { select: { firstName: true, lastName: true } } },
    });
    if (owners.length === 0) return null;
    return owners.map((m) => `${m.contact.firstName} ${m.contact.lastName}`).join(', ');
  }

  private async ownerNamesBySpace(propertyId: string, spaceIds: string[], includeOwnerNames: boolean) {
    const map = new Map<string, string>();
    if (!includeOwnerNames || spaceIds.length === 0) return map;
    const owners = await this.prisma.propertyMembership.findMany({
      where: { propertyId, spaceId: { in: spaceIds }, role: 'OWNER', status: 'ACTIVE' },
      include: { contact: { select: { firstName: true, lastName: true } } },
    });
    for (const m of owners) {
      const name = `${m.contact.firstName} ${m.contact.lastName}`;
      const existing = map.get(m.spaceId!);
      map.set(m.spaceId!, existing ? `${existing}, ${name}` : name);
    }
    return map;
  }

  /** Every lot's arrears charges + unapplied credits + opening balance +
   * latest collection case, as of `asOfDate`. The one place every arrears
   * endpoint (summary/register/lot-detail) reads from — never duplicated
   * per endpoint, so their totals can never silently disagree. */
  private async computeAllLots(
    organisationId: string,
    propertyId: string,
    asOfDate: string,
    financialFundId: string | undefined,
    includeOwnerNames: boolean,
  ) {
    const [charges, receipts, lots, openingPositions, latestCases] = await Promise.all([
      this.prisma.lotLevyCharge.findMany({
        where: { organisationId, propertyId, financialFundId },
        include: CHARGE_INCLUDE,
      }),
      this.prisma.receipt.findMany({
        where: { organisationId, propertyId, status: 'RECORDED', financialFundId },
        include: { allocations: true },
      }),
      this.prisma.space.findMany({
        where: { organisationId, propertyId, strataClassification: 'LOT' },
        select: { id: true, name: true, code: true, lotNumber: true },
      }),
      this.prisma.lotOpeningPosition.findMany({ where: { organisationId, propertyId } }),
      this.prisma.collectionCase.findMany({
        where: { organisationId, propertyId },
        orderBy: { openedAt: 'desc' },
      }),
    ]);

    const asOfExclusive = endOfDateOnlyExclusive(asOfDate);
    const spaceIds = lots.map((l) => l.id);
    const ownerNames = await this.ownerNamesBySpace(propertyId, spaceIds, includeOwnerNames);

    const chargesBySpace = new Map<string, ChargeArrearsView[]>();
    for (const charge of charges) {
      const view = computeChargeArrears(charge, asOfDate);
      if (!view) continue;
      const list = chargesBySpace.get(charge.spaceId) ?? [];
      list.push(view);
      chargesBySpace.set(charge.spaceId, list);
    }

    const unappliedBySpace = new Map<string, Prisma.Decimal>();
    for (const receipt of receipts) {
      if (receipt.createdAt.getTime() >= asOfExclusive.getTime()) continue;
      const appliedAsOf = receipt.allocations
        .filter((a) => {
          if (a.createdAt.getTime() >= asOfExclusive.getTime()) return false;
          const reversedAsOf = a.status === 'REVERSED' && a.reversedAt && a.reversedAt.getTime() < asOfExclusive.getTime();
          return !reversedAsOf;
        })
        .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
      const unapplied = receipt.amount.minus(appliedAsOf);
      if (unapplied.lessThanOrEqualTo(0)) continue;
      const existing = unappliedBySpace.get(receipt.spaceId) ?? new Prisma.Decimal(0);
      unappliedBySpace.set(receipt.spaceId, existing.plus(unapplied));
    }

    const openingBySpace = new Map<string, (typeof openingPositions)[number]>(
      openingPositions.map((o) => [o.spaceId, o]),
    );
    const caseBySpace = new Map<string, (typeof latestCases)[number]>();
    for (const c of latestCases) {
      if (!caseBySpace.has(c.spaceId)) caseBySpace.set(c.spaceId, c);
    }

    return lots.map((lot) => {
      const lotCharges = chargesBySpace.get(lot.id) ?? [];
      const overdueCharges = lotCharges.filter((c) => c.isOverdue);
      const totalOutstanding = lotCharges.reduce((sum, c) => sum.plus(c.outstandingAmount), new Prisma.Decimal(0));
      const totalOverdue = overdueCharges.reduce((sum, c) => sum.plus(c.outstandingAmount), new Prisma.Decimal(0));
      const oldest = overdueCharges.length
        ? overdueCharges.reduce((a, b) => (a.dueDate < b.dueDate ? a : b))
        : null;
      const maxDaysOverdue = overdueCharges.reduce((max, c) => Math.max(max, c.daysOverdue), 0);
      const latestCase = caseBySpace.get(lot.id) ?? null;

      const view: LotArrearsSummaryView & {
        charges: ChargeArrearsView[];
        openingPosition: (typeof openingPositions)[number] | null;
      } = {
        spaceId: lot.id,
        lotLabel: lotLabelFor(lot),
        ownerName: ownerNames.get(lot.id) ?? null,
        financialFundId: financialFundId ?? null,
        totalOutstanding: totalOutstanding.toFixed(2),
        totalOverdue: totalOverdue.toFixed(2),
        oldestDueDate: oldest?.dueDate ?? null,
        maxDaysOverdue,
        ageingBucket: oldest ? oldest.ageingBucket : null,
        unappliedCredits: (unappliedBySpace.get(lot.id) ?? new Prisma.Decimal(0)).toFixed(2),
        collectionStatus: latestCase ? latestCase.status : 'NONE',
        collectionCaseId: latestCase?.id ?? null,
        lastActivityAt: null,
        charges: lotCharges,
        openingPosition: openingBySpace.get(lot.id) ?? null,
      };
      return view;
    });
  }

  /** M16.8 — the one place ReminderEligibilityService reads per-lot
   * overdue figures from, so the automated evaluator computes arrears
   * exactly the same way the Arrears Dashboard/Register do — never a
   * second, independently-maintained overdue calculation. Thin public
   * wrapper around the same computeAllLots every other arrears read
   * already uses; deliberately excludes owner-name enrichment (the
   * evaluator has no use for it) and any fund filter (reminders consider
   * a lot's total position across every fund). */
  async getOverdueLotsForReminders(organisationId: string, propertyId: string, asOfDate: string) {
    return this.computeAllLots(organisationId, propertyId, asOfDate, undefined, false);
  }

  async getSummary(
    organisationId: string,
    propertyId: string,
    asOfDate: string,
    financialFundId: string | undefined,
  ): Promise<ArrearsSummaryView> {
    const property = await this.getOwnedProperty(organisationId, propertyId);
    const configuration = await this.prisma.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration) {
      throw new ConflictError('Financial management has not been configured for this property.');
    }
    const funds = await this.prisma.financialFund.findMany({ where: { organisationId, propertyId } });

    const lots = await this.computeAllLots(organisationId, propertyId, asOfDate, financialFundId, false);

    const ageingBuckets: Record<AgeingBucket, Prisma.Decimal> = {
      CURRENT: new Prisma.Decimal(0),
      DAYS_1_30: new Prisma.Decimal(0),
      DAYS_31_60: new Prisma.Decimal(0),
      DAYS_61_90: new Prisma.Decimal(0),
      DAYS_90_PLUS: new Prisma.Decimal(0),
    };
    const overdueByFund = new Map<string, Prisma.Decimal>();
    let totalOverdue = new Prisma.Decimal(0);
    let totalCurrentOutstanding = new Prisma.Decimal(0);
    let totalUnapplied = new Prisma.Decimal(0);
    let lotsInArrearsCount = 0;

    for (const lot of lots) {
      totalUnapplied = totalUnapplied.plus(lot.unappliedCredits);
      if (new Prisma.Decimal(lot.totalOverdue).greaterThan(0)) lotsInArrearsCount += 1;
      for (const charge of lot.charges) {
        const outstanding = new Prisma.Decimal(charge.outstandingAmount);
        if (outstanding.lessThanOrEqualTo(0)) continue;
        if (charge.isOverdue) {
          totalOverdue = totalOverdue.plus(outstanding);
          ageingBuckets[charge.ageingBucket] = ageingBuckets[charge.ageingBucket].plus(outstanding);
          const existing = overdueByFund.get(charge.financialFundId) ?? new Prisma.Decimal(0);
          overdueByFund.set(charge.financialFundId, existing.plus(outstanding));
        } else {
          totalCurrentOutstanding = totalCurrentOutstanding.plus(outstanding);
        }
      }
    }

    void property;
    return {
      propertyId,
      asOfDate,
      currencyCode: configuration.currencyCode,
      totalOverdue: totalOverdue.toFixed(2),
      totalCurrentOutstanding: totalCurrentOutstanding.toFixed(2),
      totalUnappliedCredits: totalUnapplied.toFixed(2),
      lotsInArrearsCount,
      ageingBuckets: Object.fromEntries(
        AGEING_BUCKET_ORDER.map((bucket) => [bucket, ageingBuckets[bucket].toFixed(2)]),
      ) as Record<AgeingBucket, string>,
      overdueByFund: funds
        .map((f) => ({
          financialFundId: f.id,
          fundName: f.name,
          totalOverdue: (overdueByFund.get(f.id) ?? new Prisma.Decimal(0)).toFixed(2),
        }))
        .filter((f) => Number(f.totalOverdue) > 0 || funds.length <= 4),
    };
  }

  async getRegister(
    organisationId: string,
    propertyId: string,
    asOfDate: string,
    filters: { financialFundId?: string; ageingBucket?: AgeingBucket; collectionStatus?: string },
    includeOwnerNames: boolean,
  ): Promise<LotArrearsSummaryView[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const lots = await this.computeAllLots(organisationId, propertyId, asOfDate, filters.financialFundId, includeOwnerNames);

    return lots
      .filter((l) => !filters.ageingBucket || l.ageingBucket === filters.ageingBucket)
      .filter((l) => !filters.collectionStatus || l.collectionStatus === filters.collectionStatus)
      .map(({ charges, openingPosition, ...rest }) => {
        void charges;
        void openingPosition;
        return rest;
      })
      .sort((a, b) => Number(b.totalOverdue) - Number(a.totalOverdue));
  }

  async getLotDetail(
    organisationId: string,
    propertyId: string,
    spaceId: string,
    asOfDate: string,
    includeOwnerNames: boolean,
  ) {
    await this.getOwnedProperty(organisationId, propertyId);
    const space = await this.getOwnedLot(organisationId, propertyId, spaceId);
    const ownerName = await this.getOwnerName(propertyId, spaceId, includeOwnerNames);

    const [charges, receipts, openingPosition, cases] = await Promise.all([
      this.prisma.lotLevyCharge.findMany({ where: { organisationId, propertyId, spaceId }, include: CHARGE_INCLUDE }),
      this.prisma.receipt.findMany({
        where: { organisationId, propertyId, spaceId },
        include: { allocations: { include: { lotLevyCharge: { select: { publicReference: true } } } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.lotOpeningPosition.findUnique({ where: { spaceId } }),
      this.prisma.collectionCase.findMany({
        where: { organisationId, propertyId, spaceId },
        include: {
          notes: { orderBy: { createdAt: 'desc' } },
          reminders: { orderBy: { generatedAt: 'desc' } },
        },
        orderBy: { openedAt: 'desc' },
      }),
    ]);

    const chargeViews = charges
      .map((c) => computeChargeArrears(c, asOfDate))
      .filter((v): v is ChargeArrearsView => v !== null);
    const overdueCharges = chargeViews.filter((c) => c.isOverdue);
    const totalOutstanding = chargeViews.reduce((sum, c) => sum.plus(c.outstandingAmount), new Prisma.Decimal(0));
    const totalOverdue = overdueCharges.reduce((sum, c) => sum.plus(c.outstandingAmount), new Prisma.Decimal(0));

    const asOfExclusive = endOfDateOnlyExclusive(asOfDate);
    const recordedReceipts = receipts.filter((r) => r.createdAt.getTime() < asOfExclusive.getTime());
    const unappliedCredits = recordedReceipts
      .filter((r) => r.status === 'RECORDED')
      .reduce((sum, r) => {
        const appliedAsOf = r.allocations
          .filter((a) => {
            if (a.createdAt.getTime() >= asOfExclusive.getTime()) return false;
            const reversedAsOf = a.status === 'REVERSED' && a.reversedAt && a.reversedAt.getTime() < asOfExclusive.getTime();
            return !reversedAsOf;
          })
          .reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0));
        const unapplied = r.amount.minus(appliedAsOf);
        return unapplied.greaterThan(0) ? sum.plus(unapplied) : sum;
      }, new Prisma.Decimal(0));

    return {
      spaceId,
      propertyId,
      lotLabel: lotLabelFor(space),
      ownerName,
      asOfDate,
      totalOutstanding: totalOutstanding.toFixed(2),
      totalOverdue: totalOverdue.toFixed(2),
      unappliedCredits: unappliedCredits.toFixed(2),
      charges: chargeViews,
      openingPosition: openingPosition
        ? {
            amountOwing: openingPosition.amountOwing.toFixed(2),
            creditBalance: openingPosition.creditBalance.toFixed(2),
            asOfDate: formatDateOnly(openingPosition.asOfDate),
            ageingBucket: 'UNKNOWN' as const,
          }
        : null,
      receipts: recordedReceipts.map((r) => ({
        id: r.id,
        publicReference: r.publicReference,
        amount: r.amount.toFixed(2),
        status: r.status,
        receiptDate: formatDateOnly(r.receiptDate),
        allocations: r.allocations.map((a) => ({
          id: a.id,
          publicReference: a.publicReference,
          lotLevyChargePublicReference: a.lotLevyCharge.publicReference,
          amount: a.amount.toFixed(2),
          status: a.status,
        })),
      })),
      collectionCases: cases.map((c) => ({
        id: c.id,
        publicReference: c.publicReference,
        status: c.status,
        assignedToUserId: c.assignedToUserId,
        nextFollowUpDate: c.nextFollowUpDate ? formatDateOnly(c.nextFollowUpDate) : null,
        openedAt: c.openedAt.toISOString(),
        closedAt: c.closedAt ? c.closedAt.toISOString() : null,
        closeReason: c.closeReason,
        notes: c.notes.map((n) => ({
          id: n.id,
          body: n.body,
          contactAttempted: n.contactAttempted,
          contactMethod: n.contactMethod,
          createdByUserId: n.createdByUserId,
          createdAt: n.createdAt.toISOString(),
        })),
        reminders: c.reminders.map((r) => ({
          id: r.id,
          publicReference: r.publicReference,
          status: r.status,
          asOfDate: formatDateOnly(r.asOfDate),
          totalAmountOwing: r.totalAmountOwing.toFixed(2),
          generatedAt: r.generatedAt.toISOString(),
        })),
      })),
    };
  }

  // --- Collection workflow (reversible, non-ledger state) ---

  async createCollectionCase(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    spaceId: string,
    input: CreateCollectionCaseInput,
  ) {
    await this.getOwnedProperty(organisationId, propertyId);
    await this.getOwnedLot(organisationId, propertyId, spaceId);

    const kase = await withPublicReference('COL', (publicReference) =>
      this.prisma.collectionCase.create({
        data: {
          publicReference,
          organisationId,
          propertyId,
          spaceId,
          assignedToUserId: input.assignedToUserId ?? null,
          nextFollowUpDate: input.nextFollowUpDate ? parseDateOnly(input.nextFollowUpDate) : null,
          openedByUserId: actorUserId,
        },
      }),
    );

    await recordActivity(this.prisma, {
      organisationId,
      propertyId,
      actorUserId,
      eventType: 'COLLECTION_CASE_OPENED',
      entityType: 'CollectionCase',
      entityId: kase.id,
      title: `Collection case opened: ${kase.publicReference}`,
      description: null,
    });

    return toCollectionCaseView(kase);
  }

  async updateCollectionCase(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    caseId: string,
    input: UpdateCollectionCaseInput,
  ) {
    await this.getOwnedProperty(organisationId, propertyId);
    const existing = await this.prisma.collectionCase.findFirst({ where: { id: caseId, organisationId, propertyId } });
    if (!existing) throw new NotFoundError('Collection case not found');
    if (existing.status === 'CLOSED') {
      throw new ConflictError('This collection case is closed — open a new case for further follow-up.');
    }

    const closing = input.status === 'CLOSED' || input.status === 'RESOLVED';
    const updated = await this.prisma.collectionCase.update({
      where: { id: caseId },
      data: {
        status: input.status ?? undefined,
        assignedToUserId: input.assignedToUserId === undefined ? undefined : input.assignedToUserId,
        nextFollowUpDate:
          input.nextFollowUpDate === undefined
            ? undefined
            : input.nextFollowUpDate === null
              ? null
              : parseDateOnly(input.nextFollowUpDate),
        closeReason: input.closeReason ?? undefined,
        closedByUserId: closing ? actorUserId : undefined,
        closedAt: closing ? new Date() : undefined,
      },
    });

    await recordActivity(this.prisma, {
      organisationId,
      propertyId,
      actorUserId,
      eventType: closing ? 'COLLECTION_CASE_CLOSED' : 'COLLECTION_CASE_UPDATED',
      entityType: 'CollectionCase',
      entityId: updated.id,
      title: closing
        ? `Collection case closed: ${updated.publicReference}`
        : `Collection case updated: ${updated.publicReference}`,
      description: input.closeReason ?? null,
    });

    return toCollectionCaseView(updated);
  }

  async getCollectionCase(organisationId: string, propertyId: string, caseId: string) {
    await this.getOwnedProperty(organisationId, propertyId);
    const kase = await this.prisma.collectionCase.findFirst({
      where: { id: caseId, organisationId, propertyId },
      include: { notes: { orderBy: { createdAt: 'desc' } }, reminders: { orderBy: { generatedAt: 'desc' } } },
    });
    if (!kase) throw new NotFoundError('Collection case not found');
    return {
      ...toCollectionCaseView(kase),
      reminders: kase.reminders.map((r) => toReminderView(r)),
    };
  }

  async addCollectionNote(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    caseId: string,
    input: CreateCollectionNoteInput,
  ) {
    await this.getOwnedProperty(organisationId, propertyId);
    const kase = await this.prisma.collectionCase.findFirst({ where: { id: caseId, organisationId, propertyId } });
    if (!kase) throw new NotFoundError('Collection case not found');

    const note = await this.prisma.collectionNote.create({
      data: {
        collectionCaseId: caseId,
        organisationId,
        propertyId,
        body: input.body,
        contactAttempted: input.contactAttempted ?? false,
        contactMethod: input.contactMethod ?? null,
        createdByUserId: actorUserId,
      },
    });

    await recordActivity(this.prisma, {
      organisationId,
      propertyId,
      actorUserId,
      eventType: 'COLLECTION_NOTE_ADDED',
      entityType: 'CollectionNote',
      entityId: note.id,
      title: `Note added to collection case ${kase.publicReference}`,
      description: input.body,
    });

    return note;
  }

  // --- Reminders (drafted, never sent — see ADR-027) ---

  async draftReminder(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    spaceId: string,
    asOfDate: string,
    collectionCaseId: string | undefined,
  ) {
    await this.getOwnedProperty(organisationId, propertyId);
    const space = await this.getOwnedLot(organisationId, propertyId, spaceId);
    const configuration = await this.prisma.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration || !configuration.currencyCode) {
      throw new ConflictError('Financial management has not been fully configured for this property.');
    }
    const currencyCode = configuration.currencyCode;

    if (collectionCaseId) {
      const kase = await this.prisma.collectionCase.findFirst({
        where: { id: collectionCaseId, organisationId, propertyId, spaceId },
      });
      if (!kase) throw new NotFoundError('Collection case not found');
    }

    const detail = await this.getLotDetail(organisationId, propertyId, spaceId, asOfDate, false);
    const overdueCharges = detail.charges.filter((c) => c.isOverdue);
    const totalAmountOwing = overdueCharges.reduce((sum, c) => sum.plus(c.outstandingAmount), new Prisma.Decimal(0));

    const content = {
      lotLabel: detail.lotLabel,
      asOfDate,
      totalAmountOwing: totalAmountOwing.toFixed(2),
      currencyCode,
      charges: overdueCharges.map((c) => ({
        publicReference: c.publicReference,
        levyScheduleName: c.levyScheduleName,
        dueDate: c.dueDate,
        fundName: c.fundName,
        outstandingAmount: c.outstandingAmount,
        daysOverdue: c.daysOverdue,
      })),
    };

    const reminder = await withPublicReference('PRM', (publicReference) =>
      this.prisma.paymentReminder.create({
        data: {
          publicReference,
          organisationId,
          propertyId,
          spaceId,
          collectionCaseId: collectionCaseId ?? null,
          asOfDate: parseDateOnly(asOfDate),
          totalAmountOwing: totalAmountOwing.toFixed(2),
          currencyCode,
          content,
          generatedByUserId: actorUserId,
        },
      }),
    );

    await recordActivity(this.prisma, {
      organisationId,
      propertyId,
      actorUserId,
      eventType: 'PAYMENT_REMINDER_DRAFTED',
      entityType: 'PaymentReminder',
      entityId: reminder.id,
      title: `Payment reminder drafted for ${lotLabelFor(space)}`,
      description: `${overdueCharges.length} overdue charge(s), ${totalAmountOwing.toFixed(2)} ${currencyCode}`,
    });

    return toReminderView(reminder);
  }

  async getReminder(organisationId: string, propertyId: string, reminderId: string) {
    await this.getOwnedProperty(organisationId, propertyId);
    const reminder = await this.prisma.paymentReminder.findFirst({ where: { id: reminderId, organisationId, propertyId } });
    if (!reminder) throw new NotFoundError('Reminder not found');
    return toReminderView(reminder);
  }

  async cancelReminder(organisationId: string, actorUserId: string, propertyId: string, reminderId: string) {
    await this.getOwnedProperty(organisationId, propertyId);
    const reminder = await this.prisma.paymentReminder.findFirst({ where: { id: reminderId, organisationId, propertyId } });
    if (!reminder) throw new NotFoundError('Reminder not found');
    if (reminder.status !== 'DRAFT') {
      throw new ConflictError('Only a draft reminder can be cancelled.');
    }

    const updated = await this.prisma.paymentReminder.update({
      where: { id: reminderId },
      data: { status: 'CANCELLED' as PaymentReminderStatus, cancelledByUserId: actorUserId, cancelledAt: new Date() },
    });

    await recordActivity(this.prisma, {
      organisationId,
      propertyId,
      actorUserId,
      eventType: 'PAYMENT_REMINDER_CANCELLED',
      entityType: 'PaymentReminder',
      entityId: updated.id,
      title: `Payment reminder cancelled: ${updated.publicReference}`,
      description: null,
    });

    return toReminderView(updated);
  }
}
