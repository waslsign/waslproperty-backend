import { Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { formatDateOnly } from '../../lib/dateOnly.js';
import type { LotLedgerQuery } from './lot-ledger.schemas.js';

/**
 * M16.4 — Lot Ledger & Owner Financial Accounts.
 *
 * ARCHITECTURE DECISION — no new persisted subledger table. The Lot
 * Ledger is a read-only PROJECTION over records that are already each
 * individually authoritative:
 *   - LotOpeningPosition (M16.1) — the one-time migration snapshot.
 *   - LotLevyCharge (M16.3, ADR-024) — the real per-lot subledger, one
 *     immutable row per (instalment, lot), never deleted, flipped to
 *     CANCELLED (never removed) when its owning instalment is reversed.
 *   - LevyAdjustment (M16.3) — a signed correction posted as its own
 *     small journal, never an edit to LotLevyCharge.amount.
 * A lot's full history is bounded by construction (one opening row, plus
 * at most one LotLevyCharge per instalment ever issued against that lot,
 * plus any adjustments) — realistically tens to low hundreds of rows even
 * for a very long-lived scheme, never unbounded the way a whole-property
 * journal list could be. That bound is exactly why deriving this live on
 * every request (rather than maintaining a second, independently-writable
 * ledger table that could drift from the GL) is both correct and
 * performant: no caching, no backfill, no reconciliation job — the
 * source records ARE the ledger, every time, by construction. See the
 * M16.4 ADR for the full write-up of this decision and the alternative
 * considered (a persisted `LotLedgerEntry` table) and rejected.
 *
 * SIGN CONVENTION — a debit increases the lot's receivable (amount
 * owing); a credit decreases it. Opening position: debit = amountOwing,
 * credit = creditBalance (both shown separately, never netted into one
 * opening number — see LotOpeningPosition's own "never one signed
 * number" doc comment). A levy charge is a debit for its full face value
 * (`LotLevyCharge.amount`, never `effectiveAmount` — adjustments get
 * their own separate rows so nothing is double-counted). A reversal is a
 * credit for that same face value, posted as ITS OWN row (never a mutation
 * of the original charge row), so the original charge stays visible
 * exactly as it was issued — the two rows net to zero together, which is
 * what makes a reversed charge contribute nothing to the current balance
 * without ever needing to filter CANCELLED charges out of the running
 * total by hand. A positive LevyAdjustment is a debit; a negative one is
 * a credit (mirrors the signed journal createAdjustment itself posts).
 *
 * FUND ATTRIBUTION — every LotLevyCharge/LevyAdjustment row carries a
 * real fund (inherited from the charge's own `financialFundId`, which
 * ADR-023 guarantees matches the schedule's one fund). LotOpeningPosition
 * carries NO fund at all — it is a scheme-wide migration snapshot, not a
 * per-fund balance (confirmed by the schema: no financialFundId column).
 * This service never invents one; the opening row is reported with
 * `financialFundId: null` and excluded from the per-fund breakdown,
 * honestly, rather than defaulted onto the Administration fund.
 *
 * ORDERING — rows are sorted by (transaction date ASC, a fixed type
 * priority ASC, id ASC). The type priority (OPENING=0, CHARGE=1,
 * ADJUSTMENT=2, REVERSAL=3) gives a sensible same-day reading order
 * (a lot's opening position before anything else; a charge before any
 * same-day adjustment or reversal of it). `id` is the final tiebreaker —
 * it guarantees a STABLE, deterministic total order for two rows that
 * are otherwise identical in date and type; it is not claimed to reflect
 * real-world sub-day sequencing (cuids are not strictly time-ordered),
 * only that the same request always returns the same order.
 *
 * PAGINATION — the running balance is computed over this lot's COMPLETE
 * chronological row set first, in memory, and the requested page is then
 * sliced out of that already-correct sequence. A cursor/OFFSET pushed
 * down to the database would be blind to every row outside its own page
 * when computing a running total — it cannot know a correct balance
 * without still having read everything before it. Given this service's
 * own bounded-size guarantee above (never an unbounded whole-property
 * ledger), computing the full sequence per request is deliberately the
 * simple, obviously-correct choice over a materialized running balance
 * or a window-function trick that would buy performance this problem
 * does not need. Documented limitation: this would need revisiting if a
 * single lot could ever accumulate an unbounded transaction count (it
 * cannot today — see the architecture note above).
 */

export type LotLedgerRowType =
  | 'OPENING_POSITION'
  | 'REGULAR_LEVY_CHARGE'
  | 'SPECIAL_LEVY_CHARGE'
  | 'LEVY_REVERSAL'
  | 'LEVY_ADJUSTMENT'
  /** M16.5 — money received against this lot (Dr FUND_CASH / Cr
   * UNAPPLIED_CASH at the GL level) — a real credit toward what the owner
   * owes, posted the moment it's recorded, whether or not it has been
   * allocated to a specific charge yet. */
  | 'RECEIPT'
  | 'RECEIPT_REVERSAL'
  /** M16.5 — purely informational: which already-counted receipt money
   * was matched to which charge. Always debit=credit=0.00 — the credit
   * was already counted on the RECEIPT row; this row would double-count
   * it if it carried any value of its own. Shown for traceability only
   * (see LotLevyCharge.status for the resulting PART_PAID/PAID state). */
  | 'PAYMENT_ALLOCATION';

export type LotBalanceClassification = 'AMOUNT_OWING' | 'CREDIT' | 'SETTLED';

export interface LotLedgerRow {
  id: string;
  date: string;
  postedAt: string;
  type: LotLedgerRowType;
  description: string;
  financialFundId: string | null;
  fundName: string | null;
  debit: string;
  credit: string;
  runningBalance: string;
  sourceReference: string | null;
  levyScheduleId: string | null;
  levyScheduleName: string | null;
  levyInstallmentId: string | null;
  installmentNumber: number | null;
  reversalOfSourceReference: string | null;
  reversalReason: string | null;
  createdByUserId: string | null;
}

export interface LotOpeningPositionView {
  recorded: boolean;
  amountOwing: string;
  creditBalance: string;
  net: string;
  asOfDate: string | null;
  fundAttributed: false;
}

export interface LotFundBreakdownEntry {
  financialFundId: string;
  fundName: string;
  totalIssuedLevyCharges: string;
  totalReversedCharges: string;
  totalAdjustments: string;
  /** M16.5 — sum of non-reversed receipts recorded against this fund for
   * this lot. Already reflected in `netBalance` (never a double-count —
   * see RECEIPT/PAYMENT_ALLOCATION's own doc comments). */
  totalReceipts: string;
  netBalance: string;
}

export interface LotFinancialAccountView {
  spaceId: string;
  propertyId: string;
  lotLabel: string;
  ownerName: string | null;
  currencyCode: string | null;
  financialYearStartDate: string | null;
  financialYearEndDate: string | null;
  openingPosition: LotOpeningPositionView;
  totalIssuedLevyCharges: string;
  totalReversedCharges: string;
  totalAdjustments: string;
  /** M16.5 — sum of non-reversed receipts recorded against this lot,
   * across every fund. */
  totalReceipts: string;
  /** M16.5 — the portion of totalReceipts not yet allocated to any
   * charge (an advance/prepayment, if positive). */
  totalUnapplied: string;
  currentBalance: string;
  balanceClassification: LotBalanceClassification;
  fundBreakdown: LotFundBreakdownEntry[];
  lastActivity: { date: string; description: string; type: LotLedgerRowType } | null;
}

export interface LotLedgerPage {
  items: LotLedgerRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface LotStatementView {
  spaceId: string;
  propertyId: string;
  propertyName: string;
  strataPlanNumber: string | null;
  lotLabel: string;
  ownerName: string | null;
  currencyCode: string | null;
  periodStartDate: string;
  periodEndDate: string;
  openingBalance: string;
  movements: LotLedgerRow[];
  totalDebits: string;
  totalCredits: string;
  closingBalance: string;
  generatedAt: string;
}

const TYPE_PRIORITY: Record<LotLedgerRowType, number> = {
  OPENING_POSITION: 0,
  REGULAR_LEVY_CHARGE: 1,
  SPECIAL_LEVY_CHARGE: 1,
  RECEIPT: 2,
  LEVY_ADJUSTMENT: 3,
  PAYMENT_ALLOCATION: 4,
  LEVY_REVERSAL: 5,
  RECEIPT_REVERSAL: 5,
};

type SpaceRecord = { id: string; propertyId: string; organisationId: string; strataClassification: string; lotNumber: string | null; code: string; name: string };

function lotLabelFor(space: Pick<SpaceRecord, 'lotNumber' | 'code' | 'name'>): string {
  return space.lotNumber ? `Lot ${space.lotNumber}` : space.code || space.name;
}

/** Unsorted, pre-running-balance row shape — internal only. */
interface RawRow {
  id: string;
  date: Date;
  postedAt: Date;
  type: LotLedgerRowType;
  description: string;
  financialFundId: string | null;
  fundName: string | null;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  sourceReference: string | null;
  levyScheduleId: string | null;
  levyScheduleName: string | null;
  levyInstallmentId: string | null;
  installmentNumber: number | null;
  reversalOfSourceReference: string | null;
  reversalReason: string | null;
  createdByUserId: string | null;
}

export class LotLedgerService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getOwnedProperty(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, organisationId } });
    if (!property) throw new NotFoundError('Property not found');
    return property;
  }

  /** Validates the lot belongs to this org/property AND is actually a
   * strata lot — same guard bulkSetLotOpeningPositions uses (see
   * financials.service.ts) — a Lot Ledger for Common Property or an
   * unclassified space would be meaningless; neither can ever carry a
   * LotOpeningPosition or a LotLevyCharge in the first place. */
  private async getOwnedLot(organisationId: string, propertyId: string, spaceId: string): Promise<SpaceRecord> {
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, organisationId, propertyId },
      select: { id: true, propertyId: true, organisationId: true, strataClassification: true, lotNumber: true, code: true, name: true },
    });
    if (!space) throw new NotFoundError('Lot not found');
    if (space.strataClassification !== 'LOT') {
      throw new ConflictError(`${space.name} is not a strata lot — there is no financial account for Common Property or an unclassified space.`);
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

  /** Builds this lot's complete, correctly-ordered row set with running
   * balances already computed — the single source of truth every public
   * method below reads from, so the balance math is never duplicated
   * (and therefore can never disagree with itself) between the financial
   * account summary, the ledger listing and the statement. */
  private async buildFullLedger(organisationId: string, propertyId: string, spaceId: string): Promise<LotLedgerRow[]> {
    const [opening, charges, receipts] = await Promise.all([
      this.prisma.lotOpeningPosition.findUnique({ where: { spaceId } }),
      this.prisma.lotLevyCharge.findMany({
        where: { organisationId, propertyId, spaceId },
        include: {
          adjustments: { orderBy: { createdAt: 'asc' } },
          levySchedule: { select: { id: true, name: true, kind: true } },
          levyInstallment: { select: { id: true, sortOrder: true, issuedAt: true, reversedAt: true, reversedByUserId: true, reversalReason: true } },
          fund: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      // M16.5 — see this file's top-of-file note on why a Receipt row
      // carries the real credit and a PaymentAllocation row never does
      // (avoiding double-counting the same money twice).
      this.prisma.receipt.findMany({
        where: { organisationId, propertyId, spaceId },
        include: {
          fund: { select: { id: true, name: true } },
          allocations: { include: { lotLevyCharge: { select: { publicReference: true } } }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const raw: RawRow[] = [];

    if (opening) {
      raw.push({
        id: `opening:${opening.id}`,
        date: opening.asOfDate,
        postedAt: opening.createdAt,
        type: 'OPENING_POSITION',
        description: opening.referenceNote ? `Opening financial position — ${opening.referenceNote}` : 'Opening financial position',
        financialFundId: null,
        fundName: null,
        debit: opening.amountOwing,
        credit: opening.creditBalance,
        sourceReference: opening.publicReference,
        levyScheduleId: null,
        levyScheduleName: null,
        levyInstallmentId: null,
        installmentNumber: null,
        reversalOfSourceReference: null,
        reversalReason: null,
        createdByUserId: opening.createdByUserId,
      });
    }

    for (const charge of charges) {
      const instalmentNumber = charge.levyInstallment.sortOrder + 1;
      const chargeType: LotLedgerRowType = charge.levySchedule.kind === 'SPECIAL' ? 'SPECIAL_LEVY_CHARGE' : 'REGULAR_LEVY_CHARGE';

      // The charge itself — always at its full face value, always a
      // debit, regardless of whether it was later reversed. Never
      // omitted, never mutated: invariant "issued levy charges must
      // appear exactly once" and "reversed levy charges must remain
      // visible" both hold because this row is unconditional.
      raw.push({
        id: `charge:${charge.id}`,
        date: charge.createdAt,
        postedAt: charge.createdAt,
        type: chargeType,
        description: `${charge.levySchedule.name} — Instalment #${instalmentNumber}`,
        financialFundId: charge.financialFundId,
        fundName: charge.fund.name,
        debit: charge.amount,
        credit: new Prisma.Decimal(0),
        sourceReference: charge.publicReference,
        levyScheduleId: charge.levyScheduleId,
        levyScheduleName: charge.levySchedule.name,
        levyInstallmentId: charge.levyInstallmentId,
        installmentNumber: instalmentNumber,
        reversalOfSourceReference: null,
        reversalReason: null,
        createdByUserId: null,
      });

      if (charge.status === 'CANCELLED' && charge.levyInstallment.reversedAt) {
        raw.push({
          id: `reversal:${charge.id}`,
          date: charge.levyInstallment.reversedAt,
          postedAt: charge.levyInstallment.reversedAt,
          type: 'LEVY_REVERSAL',
          description: `Reversal of ${charge.levySchedule.name} — Instalment #${instalmentNumber}`,
          financialFundId: charge.financialFundId,
          fundName: charge.fund.name,
          debit: new Prisma.Decimal(0),
          credit: charge.amount,
          sourceReference: `${charge.publicReference}-REV`,
          levyScheduleId: charge.levyScheduleId,
          levyScheduleName: charge.levySchedule.name,
          levyInstallmentId: charge.levyInstallmentId,
          installmentNumber: instalmentNumber,
          reversalOfSourceReference: charge.publicReference,
          reversalReason: charge.levyInstallment.reversalReason,
          createdByUserId: charge.levyInstallment.reversedByUserId,
        });
      }

      for (const adjustment of charge.adjustments) {
        const isIncrease = adjustment.amount.greaterThan(0);
        raw.push({
          id: `adjustment:${adjustment.id}`,
          date: adjustment.createdAt,
          postedAt: adjustment.createdAt,
          type: 'LEVY_ADJUSTMENT',
          description: `Adjustment to ${charge.levySchedule.name} — Instalment #${instalmentNumber}: ${adjustment.reason}`,
          financialFundId: charge.financialFundId,
          fundName: charge.fund.name,
          debit: isIncrease ? adjustment.amount : new Prisma.Decimal(0),
          credit: isIncrease ? new Prisma.Decimal(0) : adjustment.amount.abs(),
          sourceReference: adjustment.publicReference,
          levyScheduleId: charge.levyScheduleId,
          levyScheduleName: charge.levySchedule.name,
          levyInstallmentId: charge.levyInstallmentId,
          installmentNumber: instalmentNumber,
          reversalOfSourceReference: null,
          reversalReason: null,
          createdByUserId: adjustment.createdByUserId,
        });
      }
    }

    for (const receipt of receipts) {
      // The real credit — counted once, here, regardless of whether it
      // has been allocated to anything yet (see this file's top-of-file
      // note and LotLedgerRowType.RECEIPT's own doc comment).
      raw.push({
        id: `receipt:${receipt.id}`,
        date: receipt.postingDate,
        postedAt: receipt.createdAt,
        type: 'RECEIPT',
        description: `Receipt recorded (${receipt.paymentMethod}${receipt.paymentReference ? ` — ${receipt.paymentReference}` : ''})`,
        financialFundId: receipt.financialFundId,
        fundName: receipt.fund.name,
        debit: new Prisma.Decimal(0),
        credit: receipt.amount,
        sourceReference: receipt.publicReference,
        levyScheduleId: null,
        levyScheduleName: null,
        levyInstallmentId: null,
        installmentNumber: null,
        reversalOfSourceReference: null,
        reversalReason: null,
        createdByUserId: receipt.createdByUserId,
      });

      if (receipt.status === 'REVERSED' && receipt.reversedAt) {
        raw.push({
          id: `receipt-reversal:${receipt.id}`,
          date: receipt.reversedAt,
          postedAt: receipt.reversedAt,
          type: 'RECEIPT_REVERSAL',
          description: `Reversal of receipt ${receipt.publicReference}`,
          financialFundId: receipt.financialFundId,
          fundName: receipt.fund.name,
          debit: receipt.amount,
          credit: new Prisma.Decimal(0),
          sourceReference: `${receipt.publicReference}-REV`,
          levyScheduleId: null,
          levyScheduleName: null,
          levyInstallmentId: null,
          installmentNumber: null,
          reversalOfSourceReference: receipt.publicReference,
          reversalReason: receipt.reversalReason,
          createdByUserId: receipt.reversedByUserId,
        });
      }

      for (const allocation of receipt.allocations) {
        // Deliberately debit=credit=0 — see PAYMENT_ALLOCATION's own doc
        // comment on LotLedgerRowType. Shown regardless of the
        // allocation's own status (APPLIED/REVERSED) for full
        // traceability, same as every other row type in this ledger.
        raw.push({
          id: `allocation:${allocation.id}`,
          date: allocation.createdAt,
          postedAt: allocation.createdAt,
          type: 'PAYMENT_ALLOCATION',
          description:
            allocation.status === 'REVERSED'
              ? `Allocation of ${receipt.publicReference} to charge ${allocation.lotLevyCharge.publicReference} reversed — ${allocation.amount.toFixed(2)} returned to unapplied`
              : `${allocation.amount.toFixed(2)} of ${receipt.publicReference} applied to charge ${allocation.lotLevyCharge.publicReference}`,
          financialFundId: receipt.financialFundId,
          fundName: receipt.fund.name,
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(0),
          sourceReference: allocation.publicReference,
          levyScheduleId: null,
          levyScheduleName: null,
          levyInstallmentId: null,
          installmentNumber: null,
          reversalOfSourceReference: allocation.status === 'REVERSED' ? allocation.publicReference : null,
          reversalReason: allocation.status === 'REVERSED' ? allocation.reversalReason : null,
          createdByUserId: allocation.createdByUserId,
        });
      }
    }

    raw.sort((a, b) => {
      const dateDiff = a.date.getTime() - b.date.getTime();
      if (dateDiff !== 0) return dateDiff;
      const priorityDiff = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
      if (priorityDiff !== 0) return priorityDiff;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    let balance = new Prisma.Decimal(0);
    return raw.map((row) => {
      balance = balance.plus(row.debit).minus(row.credit);
      return {
        id: row.id,
        date: formatDateOnly(row.date),
        postedAt: row.postedAt.toISOString(),
        type: row.type,
        description: row.description,
        financialFundId: row.financialFundId,
        fundName: row.fundName,
        debit: row.debit.toFixed(2),
        credit: row.credit.toFixed(2),
        runningBalance: balance.toFixed(2),
        sourceReference: row.sourceReference,
        levyScheduleId: row.levyScheduleId,
        levyScheduleName: row.levyScheduleName,
        levyInstallmentId: row.levyInstallmentId,
        installmentNumber: row.installmentNumber,
        reversalOfSourceReference: row.reversalOfSourceReference,
        reversalReason: row.reversalReason,
        createdByUserId: row.createdByUserId,
      };
    });
  }

  async getFinancialAccount(
    organisationId: string,
    propertyId: string,
    spaceId: string,
    includeOwnerNames: boolean,
  ): Promise<LotFinancialAccountView> {
    const property = await this.getOwnedProperty(organisationId, propertyId);
    const space = await this.getOwnedLot(organisationId, propertyId, spaceId);
    const configuration = await this.prisma.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration) {
      throw new ConflictError('Start financial setup for this property before viewing a lot financial account.');
    }

    const [ownerName, opening, rows, funds, receipts] = await Promise.all([
      this.getOwnerName(propertyId, spaceId, includeOwnerNames),
      this.prisma.lotOpeningPosition.findUnique({ where: { spaceId } }),
      this.buildFullLedger(organisationId, propertyId, spaceId),
      this.prisma.financialFund.findMany({ where: { propertyId }, select: { id: true, name: true } }),
      this.prisma.receipt.findMany({
        where: { organisationId, propertyId, spaceId, status: 'RECORDED' },
        include: { allocations: { where: { status: 'APPLIED' } } },
      }),
    ]);

    const totalReceipts = receipts.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));
    const totalApplied = receipts.reduce(
      (sum, r) => sum.plus(r.allocations.reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0))),
      new Prisma.Decimal(0),
    );
    const totalUnapplied = totalReceipts.minus(totalApplied);

    const openingPosition: LotOpeningPositionView = {
      recorded: Boolean(opening),
      amountOwing: (opening?.amountOwing ?? new Prisma.Decimal(0)).toFixed(2),
      creditBalance: (opening?.creditBalance ?? new Prisma.Decimal(0)).toFixed(2),
      net: (opening ? opening.amountOwing.minus(opening.creditBalance) : new Prisma.Decimal(0)).toFixed(2),
      asOfDate: opening ? formatDateOnly(opening.asOfDate) : null,
      fundAttributed: false,
    };

    const totalIssuedLevyCharges = sumRows(rows, (r) => r.type === 'REGULAR_LEVY_CHARGE' || r.type === 'SPECIAL_LEVY_CHARGE', 'debit');
    const totalReversedCharges = sumRows(rows, (r) => r.type === 'LEVY_REVERSAL', 'credit');
    const totalAdjustments = sumRows(rows, (r) => r.type === 'LEVY_ADJUSTMENT', 'debit').minus(
      sumRows(rows, (r) => r.type === 'LEVY_ADJUSTMENT', 'credit'),
    );

    const lastRow = rows.at(-1);
    const currentBalance = lastRow ? new Prisma.Decimal(lastRow.runningBalance) : new Prisma.Decimal(0);
    const balanceClassification: LotBalanceClassification = currentBalance.isZero()
      ? 'SETTLED'
      : currentBalance.isPositive()
        ? 'AMOUNT_OWING'
        : 'CREDIT';

    const fundBreakdown: LotFundBreakdownEntry[] = funds.map((fund) => {
      const fundRows = rows.filter((r) => r.financialFundId === fund.id);
      const issued = sumRows(fundRows, (r) => r.type === 'REGULAR_LEVY_CHARGE' || r.type === 'SPECIAL_LEVY_CHARGE', 'debit');
      const reversed = sumRows(fundRows, (r) => r.type === 'LEVY_REVERSAL', 'credit');
      const adjustments = sumRows(fundRows, (r) => r.type === 'LEVY_ADJUSTMENT', 'debit').minus(
        sumRows(fundRows, (r) => r.type === 'LEVY_ADJUSTMENT', 'credit'),
      );
      const receiptsForFund = sumRows(fundRows, (r) => r.type === 'RECEIPT', 'credit').minus(
        sumRows(fundRows, (r) => r.type === 'RECEIPT_REVERSAL', 'debit'),
      );
      const net = issued.minus(reversed).plus(adjustments).minus(receiptsForFund);
      return {
        financialFundId: fund.id,
        fundName: fund.name,
        totalIssuedLevyCharges: issued.toFixed(2),
        totalReversedCharges: reversed.toFixed(2),
        totalAdjustments: adjustments.toFixed(2),
        totalReceipts: receiptsForFund.toFixed(2),
        netBalance: net.toFixed(2),
      };
    });

    const last = rows.at(-1) ?? null;

    return {
      spaceId: space.id,
      propertyId: property.id,
      lotLabel: lotLabelFor(space),
      ownerName,
      currencyCode: configuration.currencyCode,
      financialYearStartDate: configuration.financialYearStartDate ? formatDateOnly(configuration.financialYearStartDate) : null,
      financialYearEndDate: configuration.financialYearEndDate ? formatDateOnly(configuration.financialYearEndDate) : null,
      openingPosition,
      totalIssuedLevyCharges: totalIssuedLevyCharges.toFixed(2),
      totalReversedCharges: totalReversedCharges.toFixed(2),
      totalAdjustments: totalAdjustments.toFixed(2),
      totalReceipts: totalReceipts.toFixed(2),
      totalUnapplied: totalUnapplied.toFixed(2),
      currentBalance: currentBalance.toFixed(2),
      balanceClassification,
      fundBreakdown,
      lastActivity: last ? { date: last.date, description: last.description, type: last.type } : null,
    };
  }

  async getLedger(
    organisationId: string,
    propertyId: string,
    spaceId: string,
    filters: LotLedgerQuery,
    includeOwnerNames: boolean,
  ): Promise<LotLedgerPage & { ownerName: string | null; lotLabel: string }> {
    await this.getOwnedProperty(organisationId, propertyId);
    const space = await this.getOwnedLot(organisationId, propertyId, spaceId);
    const configuration = await this.prisma.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration) {
      throw new ConflictError('Start financial setup for this property before viewing a lot ledger.');
    }

    const [ownerName, full] = await Promise.all([
      this.getOwnerName(propertyId, spaceId, includeOwnerNames),
      this.buildFullLedger(organisationId, propertyId, spaceId),
    ]);

    const filtered = full.filter((row) => {
      if (filters.financialFundId && row.financialFundId !== filters.financialFundId) return false;
      if (filters.type && row.type !== filters.type) return false;
      if (filters.fromDate && row.date < filters.fromDate) return false;
      if (filters.toDate && row.date > filters.toDate) return false;
      return true;
    });

    const total = filtered.length;
    const start = (filters.page - 1) * filters.pageSize;
    const items = filtered.slice(start, start + filters.pageSize);

    return { items, page: filters.page, pageSize: filters.pageSize, total, ownerName, lotLabel: lotLabelFor(space) };
  }

  async getStatement(
    organisationId: string,
    propertyId: string,
    spaceId: string,
    periodStartDate: string,
    periodEndDate: string,
    includeOwnerNames: boolean,
  ): Promise<LotStatementView> {
    if (periodStartDate > periodEndDate) {
      throw new ConflictError('periodStartDate must not be after periodEndDate.');
    }
    const property = await this.getOwnedProperty(organisationId, propertyId);
    const space = await this.getOwnedLot(organisationId, propertyId, spaceId);
    const configuration = await this.prisma.financialConfiguration.findUnique({ where: { propertyId } });
    if (!configuration) {
      throw new ConflictError('Start financial setup for this property before generating a lot statement.');
    }

    const [ownerName, full] = await Promise.all([
      this.getOwnerName(propertyId, spaceId, includeOwnerNames),
      this.buildFullLedger(organisationId, propertyId, spaceId),
    ]);

    // Opening balance for the statement = the running balance of the last
    // row strictly BEFORE the period starts (zero if there is none) —
    // never recomputed independently of the same full ledger everything
    // else reads from.
    const beforePeriod = full.filter((r) => r.date < periodStartDate);
    const openingBalance = beforePeriod.at(-1)?.runningBalance ?? '0.00';

    const movements = full.filter((r) => r.date >= periodStartDate && r.date <= periodEndDate);
    const totalDebits = sumRows(movements, () => true, 'debit');
    const totalCredits = sumRows(movements, () => true, 'credit');
    const closingBalance = movements.at(-1)?.runningBalance ?? openingBalance;

    return {
      spaceId: space.id,
      propertyId: property.id,
      propertyName: property.name,
      strataPlanNumber: property.strataPlanNumber,
      lotLabel: lotLabelFor(space),
      ownerName,
      currencyCode: configuration.currencyCode,
      periodStartDate,
      periodEndDate,
      openingBalance,
      movements,
      totalDebits: totalDebits.toFixed(2),
      totalCredits: totalCredits.toFixed(2),
      closingBalance,
      generatedAt: new Date().toISOString(),
    };
  }
}

function sumRows(rows: LotLedgerRow[], predicate: (row: LotLedgerRow) => boolean, field: 'debit' | 'credit'): Prisma.Decimal {
  return rows.filter(predicate).reduce((sum, r) => sum.plus(new Prisma.Decimal(r[field])), new Prisma.Decimal(0));
}
