import {
  Prisma,
  type LevyChargeStatus,
  type PaymentAllocationStatus,
  type PrismaClient,
  type ReceiptPaymentMethod,
  type ReceiptStatus,
} from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { formatDateOnly, parseDateOnly } from '../../lib/dateOnly.js';
import { withPublicReference } from '../../lib/public-reference.js';
import { recordActivity } from '../activity/activity.js';
import { generateManualSourceId, LedgerPostingService } from './ledger-posting.service.js';
import { PostingProfileService } from './posting-profile.service.js';
import type { CreateAllocationInput, RecordReceiptInput } from './receipts.schemas.js';

/**
 * M16.5 — Receipts & Payment Allocation (ADR-026). Extends the existing
 * General Ledger and Lot Ledger — see prisma/schema.prisma's "Strata
 * Financial Management: Receipts & Payment Allocation" section doc
 * comment for the two-event model (Receipt = cash arrived, always posts
 * Dr FUND_CASH / Cr UNAPPLIED_CASH; PaymentAllocation = cash applied to a
 * specific receivable, Dr UNAPPLIED_CASH / Cr LOT_LEVY_RECEIVABLE) this
 * service exists to uphold. Never writes to journal_entries/journal_lines
 * directly — every posting goes through LedgerPostingService, exactly
 * like LevyService.
 */

export interface PaymentAllocationView {
  id: string;
  publicReference: string;
  receiptId: string;
  receiptPublicReference: string;
  lotLevyChargeId: string;
  lotLevyChargePublicReference: string;
  amount: string;
  status: PaymentAllocationStatus;
  journalEntryId: string;
  reversedByUserId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface ReceiptView {
  id: string;
  publicReference: string;
  propertyId: string;
  spaceId: string;
  lotLabel: string;
  /** Present only when the caller independently holds `people.view` on
   * top of `financials.view` — same deliberate split as every other
   * people.view-gated field in this codebase. */
  ownerName: string | null;
  financialFundId: string;
  fundName: string;
  destinationAccountId: string;
  destinationAccountCode: string;
  destinationAccountName: string;
  amount: string;
  /** SUM of APPLIED allocations against this receipt — derived, never stored. */
  appliedAmount: string;
  /** amount - appliedAmount — the unapplied/advance balance, if any. */
  unappliedAmount: string;
  currencyCode: string;
  paymentMethod: ReceiptPaymentMethod;
  paymentReference: string | null;
  description: string | null;
  receiptDate: string;
  postingDate: string;
  externalBankReference: string | null;
  status: ReceiptStatus;
  journalEntryId: string;
  reversedByUserId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdByUserId: string;
  createdAt: string;
  allocations: PaymentAllocationView[];
}

const RECEIPT_INCLUDE = {
  space: { select: { name: true, code: true, lotNumber: true } },
  fund: { select: { name: true } },
  destinationAccount: { select: { code: true, name: true } },
  allocations: {
    include: { receipt: { select: { publicReference: true } }, lotLevyCharge: { select: { publicReference: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.ReceiptInclude;

type ReceiptWithIncludes = Prisma.ReceiptGetPayload<{ include: typeof RECEIPT_INCLUDE }>;

function lotLabelFor(space: { lotNumber: string | null; code: string; name: string }): string {
  return space.lotNumber ? `Lot ${space.lotNumber}` : space.code || space.name;
}

function toAllocationView(a: {
  id: string;
  publicReference: string;
  receiptId: string;
  receipt: { publicReference: string };
  lotLevyChargeId: string;
  lotLevyCharge: { publicReference: string };
  amount: Prisma.Decimal;
  status: PaymentAllocationStatus;
  journalEntryId: string;
  reversedByUserId: string | null;
  reversedAt: Date | null;
  reversalReason: string | null;
  createdByUserId: string;
  createdAt: Date;
}): PaymentAllocationView {
  return {
    id: a.id,
    publicReference: a.publicReference,
    receiptId: a.receiptId,
    receiptPublicReference: a.receipt.publicReference,
    lotLevyChargeId: a.lotLevyChargeId,
    lotLevyChargePublicReference: a.lotLevyCharge.publicReference,
    amount: a.amount.toFixed(2),
    status: a.status,
    journalEntryId: a.journalEntryId,
    reversedByUserId: a.reversedByUserId,
    reversedAt: a.reversedAt ? a.reversedAt.toISOString() : null,
    reversalReason: a.reversalReason,
    createdByUserId: a.createdByUserId,
    createdAt: a.createdAt.toISOString(),
  };
}

function toReceiptView(receipt: ReceiptWithIncludes, ownerName: string | null): ReceiptView {
  const applied = receipt.allocations
    .filter((a) => a.status === 'APPLIED')
    .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
  return {
    id: receipt.id,
    publicReference: receipt.publicReference,
    propertyId: receipt.propertyId,
    spaceId: receipt.spaceId,
    lotLabel: lotLabelFor(receipt.space),
    ownerName,
    financialFundId: receipt.financialFundId,
    fundName: receipt.fund.name,
    destinationAccountId: receipt.destinationAccountId,
    destinationAccountCode: receipt.destinationAccount.code,
    destinationAccountName: receipt.destinationAccount.name,
    amount: receipt.amount.toFixed(2),
    appliedAmount: applied.toFixed(2),
    unappliedAmount: receipt.amount.minus(applied).toFixed(2),
    currencyCode: receipt.currencyCode,
    paymentMethod: receipt.paymentMethod,
    paymentReference: receipt.paymentReference,
    description: receipt.description,
    receiptDate: formatDateOnly(receipt.receiptDate),
    postingDate: formatDateOnly(receipt.postingDate),
    externalBankReference: receipt.externalBankReference,
    status: receipt.status,
    journalEntryId: receipt.journalEntryId,
    reversedByUserId: receipt.reversedByUserId,
    reversedAt: receipt.reversedAt ? receipt.reversedAt.toISOString() : null,
    reversalReason: receipt.reversalReason,
    createdByUserId: receipt.createdByUserId,
    createdAt: receipt.createdAt.toISOString(),
    allocations: receipt.allocations.map((a) =>
      toAllocationView({ ...a, receipt: { publicReference: receipt.publicReference } }),
    ),
  };
}

export class ReceiptsService {
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

  /** Mirrors LotLedgerService.getOwnedLot exactly — a receipt only ever
   * makes sense against a real strata lot. */
  private async getOwnedLot(
    client: PrismaClient | Prisma.TransactionClient,
    organisationId: string,
    propertyId: string,
    spaceId: string,
  ) {
    const space = await client.space.findFirst({
      where: { id: spaceId, organisationId, propertyId },
      select: { id: true, strataClassification: true, lotNumber: true, code: true, name: true },
    });
    if (!space) throw new NotFoundError('Lot not found');
    if (space.strataClassification !== 'LOT') {
      throw new ConflictError(`${space.name} is not a strata lot — a receipt can only be recorded against a Lot.`);
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

  /** The charge's current effective amount (face value + adjustments) and
   * how much of it is still outstanding after APPLIED allocations —
   * derived fresh every time, never stored (same discipline as
   * LotLevyCharge.effectiveAmount in levies.service.ts). A CANCELLED
   * (reversed instalment) charge is always reported as zero outstanding —
   * there is nothing left to pay against a receivable that was itself
   * reversed. */
  private async chargeOutstanding(
    tx: Prisma.TransactionClient,
    chargeId: string,
  ): Promise<{ charge: Prisma.LotLevyChargeGetPayload<object>; effectiveAmount: Prisma.Decimal; applied: Prisma.Decimal; outstanding: Prisma.Decimal }> {
    const charge = await tx.lotLevyCharge.findUniqueOrThrow({ where: { id: chargeId } });
    const [adjustments, applications] = await Promise.all([
      tx.levyAdjustment.aggregate({ where: { lotLevyChargeId: chargeId }, _sum: { amount: true } }),
      tx.paymentAllocation.aggregate({ where: { lotLevyChargeId: chargeId, status: 'APPLIED' }, _sum: { amount: true } }),
    ]);
    const effectiveAmount = charge.amount.plus(adjustments._sum.amount ?? new Prisma.Decimal(0));
    const applied = new Prisma.Decimal(applications._sum.amount ?? 0);
    const outstanding = charge.status === 'CANCELLED' ? new Prisma.Decimal(0) : effectiveAmount.minus(applied);
    return { charge, effectiveAmount, applied, outstanding };
  }

  private async updateChargeStatus(tx: Prisma.TransactionClient, chargeId: string): Promise<void> {
    const { charge, effectiveAmount, applied } = await this.chargeOutstanding(tx, chargeId);
    if (charge.status === 'CANCELLED') return; // reversal is terminal; payment status never overrides it
    let next: LevyChargeStatus = 'ISSUED';
    if (applied.greaterThanOrEqualTo(effectiveAmount) && effectiveAmount.greaterThan(0)) next = 'PAID';
    else if (applied.greaterThan(0)) next = 'PART_PAID';
    if (next !== charge.status) {
      await tx.lotLevyCharge.update({ where: { id: chargeId }, data: { status: next } });
    }
  }

  private async receiptUnapplied(tx: Prisma.TransactionClient, receiptId: string): Promise<Prisma.Decimal> {
    const receipt = await tx.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    const applied = await tx.paymentAllocation.aggregate({
      where: { receiptId, status: 'APPLIED' },
      _sum: { amount: true },
    });
    return receipt.amount.minus(applied._sum.amount ?? new Prisma.Decimal(0));
  }

  /** The one place that actually posts an allocation — shared by
   * immediate allocation at receipt time, auto-allocation, and the
   * standalone "allocate previously unapplied cash" endpoint, so the
   * same validation runs every time regardless of entry point. */
  private async applyAllocationWithinTransaction(
    tx: Prisma.TransactionClient,
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    receiptId: string,
    lotLevyChargeId: string,
    amount: number,
    idempotencyKey: string | undefined,
  ) {
    const receipt = await tx.receipt.findFirst({ where: { id: receiptId, organisationId, propertyId } });
    if (!receipt) throw new NotFoundError('Receipt not found');
    if (receipt.status !== 'RECORDED') {
      throw new ConflictError('This receipt has been reversed and cannot be allocated further.');
    }

    // Idempotency is checked BEFORE any amount/outstanding validation — a
    // retried request for an allocation that already succeeded must
    // return the original result even if the charge/receipt balance has
    // since moved (e.g. it is now fully paid), never fail an
    // over-allocation check it would no longer pass on a fresh attempt.
    const sourceId = idempotencyKey ?? generateManualSourceId();
    const existingJournal = await tx.journalEntry.findUnique({
      where: {
        propertyId_sourceType_sourceId_sourceEventVersion: {
          propertyId,
          sourceType: 'PAYMENT_ALLOCATION',
          sourceId,
          sourceEventVersion: 1,
        },
      },
    });
    if (existingJournal) {
      const existingAllocation = await tx.paymentAllocation.findUnique({ where: { journalEntryId: existingJournal.id } });
      if (existingAllocation) return existingAllocation;
    }

    const { charge, outstanding } = await this.chargeOutstanding(tx, lotLevyChargeId);
    if (charge.organisationId !== organisationId || charge.propertyId !== propertyId) {
      throw new NotFoundError('Levy charge not found');
    }
    if (charge.status === 'CANCELLED') {
      throw new ConflictError('This charge has been cancelled (its instalment was reversed) and cannot be allocated against.');
    }
    // Cross-fund allocation is deliberately not supported — see ADR-026
    // and this module's own doc comment on prisma/schema.prisma.
    if (charge.financialFundId !== receipt.financialFundId) {
      throw new ConflictError(
        'This receipt was recorded against a different fund than this charge — cross-fund allocation is not supported. Record a fund-matching receipt, or use an explicit inter-fund transfer (not built this milestone).',
      );
    }

    const amountDecimal = new Prisma.Decimal(amount);
    if (amountDecimal.greaterThan(outstanding)) {
      throw new ConflictError(
        `This would over-allocate the charge — only ${outstanding.toFixed(2)} is still outstanding on it.`,
      );
    }
    const unapplied = await this.receiptUnapplied(tx, receiptId);
    if (amountDecimal.greaterThan(unapplied)) {
      throw new ConflictError(
        `This would allocate more than this receipt has left unapplied (${unapplied.toFixed(2)} remaining).`,
      );
    }

    const receivableAccountId = await this.profiles.resolve(tx, propertyId, 'LOT_LEVY_RECEIVABLE', charge.financialFundId);
    if (!receivableAccountId) {
      throw new ConflictError('No LOT_LEVY_RECEIVABLE account configured for this fund.');
    }
    const unappliedAccountId = await this.profiles.resolve(tx, propertyId, 'UNAPPLIED_CASH');
    if (!unappliedAccountId) {
      throw new ConflictError('No UNAPPLIED_CASH account configured for this property.');
    }

    const journal = await this.posting.postWithinTransaction(tx, organisationId, actorUserId, propertyId, {
      effectiveDate: formatDateOnly(new Date()),
      currencyCode: receipt.currencyCode,
      sourceType: 'PAYMENT_ALLOCATION',
      sourceId,
      narration: `Allocation of receipt ${receipt.publicReference} against charge ${charge.publicReference}`,
      // Dr UNAPPLIED_CASH (the liability clears — this cash is no longer
      // "unapplied") / Cr LOT_LEVY_RECEIVABLE (the asset shrinks — the lot
      // owes less). Matches the sign convention LevyService.createAdjustment
      // already documents for this account (Dr increases what's owed, Cr
      // decreases it) — a payment applied must credit the receivable, never
      // debit it.
      lines: [
        { accountId: unappliedAccountId, financialFundId: charge.financialFundId, debit: amount, credit: 0 },
        { accountId: receivableAccountId, financialFundId: charge.financialFundId, debit: 0, credit: amount },
      ],
    });

    const allocation = await withPublicReference('PAL', (publicReference) =>
      tx.paymentAllocation.create({
        data: {
          publicReference,
          organisationId,
          propertyId,
          receiptId,
          lotLevyChargeId,
          amount,
          journalEntryId: journal.id,
          createdByUserId: actorUserId,
        },
      }),
    );

    await this.updateChargeStatus(tx, lotLevyChargeId);

    await recordActivity(tx, {
      organisationId,
      propertyId,
      actorUserId,
      eventType: 'PAYMENT_ALLOCATION_CREATED',
      entityType: 'PaymentAllocation',
      entityId: allocation.id,
      title: `Allocated ${amountDecimal.toFixed(2)} from receipt ${receipt.publicReference} to charge ${charge.publicReference}`,
      description: null,
    });

    return allocation;
  }

  /** The documented default automatic-allocation order: this lot's
   * outstanding charges IN THE SAME FUND as the receipt, oldest due date
   * first (standard ageing-first AR practice) — never an arbitrary or
   * caller-order-dependent sequence. Stops once the receipt's balance is
   * exhausted or no charge remains outstanding; any leftover stays
   * unapplied (an honest advance/prepayment), never force-allocated. */
  private async autoAllocateWithinTransaction(
    tx: Prisma.TransactionClient,
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    receiptId: string,
    spaceId: string,
    financialFundId: string,
  ) {
    const candidates = await tx.lotLevyCharge.findMany({
      where: {
        organisationId,
        propertyId,
        spaceId,
        financialFundId,
        status: { in: ['ISSUED', 'PART_PAID'] },
      },
      include: { levyInstallment: { select: { dueDate: true, sortOrder: true } } },
      orderBy: [{ levyInstallment: { dueDate: 'asc' } }, { levyInstallment: { sortOrder: 'asc' } }],
    });

    const created = [];
    for (const candidate of candidates) {
      const remaining = await this.receiptUnapplied(tx, receiptId);
      if (remaining.lessThanOrEqualTo(0)) break;
      const { outstanding } = await this.chargeOutstanding(tx, candidate.id);
      if (outstanding.lessThanOrEqualTo(0)) continue;
      const toApply = Prisma.Decimal.min(remaining, outstanding);
      created.push(
        await this.applyAllocationWithinTransaction(
          tx,
          organisationId,
          actorUserId,
          propertyId,
          receiptId,
          candidate.id,
          toApply.toNumber(),
          undefined,
        ),
      );
    }
    return created;
  }

  async recordReceipt(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: RecordReceiptInput,
  ): Promise<ReceiptView> {
    await this.getOwnedProperty(organisationId, propertyId);

    const receiptId = await this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) {
        throw new ConflictError('Start financial setup for this property before recording a receipt.');
      }
      await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

      const space = await this.getOwnedLot(tx, organisationId, propertyId, input.spaceId);
      const fund = await tx.financialFund.findFirst({ where: { id: input.financialFundId, organisationId, propertyId } });
      if (!fund) throw new NotFoundError('Fund not found');

      const sourceId = input.idempotencyKey ?? generateManualSourceId();
      const existingJournal = await tx.journalEntry.findUnique({
        where: {
          propertyId_sourceType_sourceId_sourceEventVersion: {
            propertyId,
            sourceType: 'RECEIPT',
            sourceId,
            sourceEventVersion: 1,
          },
        },
      });
      if (existingJournal) {
        const existingReceipt = await tx.receipt.findUnique({ where: { journalEntryId: existingJournal.id } });
        if (existingReceipt) return existingReceipt.id;
      }

      const cashAccountId = await this.profiles.resolve(tx, propertyId, 'FUND_CASH', input.financialFundId);
      if (!cashAccountId) {
        throw new ConflictError(`No FUND_CASH account configured for ${fund.name} — configure the posting profile first.`);
      }
      const unappliedAccountId = await this.profiles.resolve(tx, propertyId, 'UNAPPLIED_CASH');
      if (!unappliedAccountId) {
        throw new ConflictError('No UNAPPLIED_CASH account configured for this property — configure the posting profile first.');
      }

      const postingDate = input.postingDate ?? input.receiptDate;

      const journal = await this.posting.postWithinTransaction(tx, organisationId, actorUserId, propertyId, {
        effectiveDate: postingDate,
        currencyCode: fund.currencyCode,
        sourceType: 'RECEIPT',
        sourceId,
        narration: `Receipt recorded (${input.paymentMethod}${input.paymentReference ? ` — ${input.paymentReference}` : ''})`,
        lines: [
          { accountId: cashAccountId, financialFundId: input.financialFundId, debit: input.amount, credit: 0 },
          { accountId: unappliedAccountId, financialFundId: input.financialFundId, debit: 0, credit: input.amount },
        ],
      });

      const receipt = await withPublicReference('RCT', (publicReference) =>
        tx.receipt.create({
          data: {
            publicReference,
            organisationId,
            propertyId,
            financialConfigurationId: configuration.id,
            spaceId: space.id,
            financialFundId: input.financialFundId,
            destinationAccountId: cashAccountId,
            amount: input.amount,
            currencyCode: fund.currencyCode,
            paymentMethod: input.paymentMethod,
            paymentReference: input.paymentReference ?? null,
            description: input.description ?? null,
            receiptDate: parseDateOnly(input.receiptDate),
            postingDate: parseDateOnly(postingDate),
            externalBankReference: input.externalBankReference ?? null,
            journalEntryId: journal.id,
            createdByUserId: actorUserId,
          },
        }),
      );

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'RECEIPT_RECORDED',
        entityType: 'Receipt',
        entityId: receipt.id,
        title: `Receipt recorded: ${new Prisma.Decimal(input.amount).toFixed(2)} ${fund.currencyCode}`,
        description: input.description ?? null,
      });

      if (input.allocations?.length) {
        for (const alloc of input.allocations) {
          await this.applyAllocationWithinTransaction(
            tx,
            organisationId,
            actorUserId,
            propertyId,
            receipt.id,
            alloc.lotLevyChargeId,
            alloc.amount,
            undefined,
          );
        }
      } else if (input.autoAllocate) {
        await this.autoAllocateWithinTransaction(
          tx,
          organisationId,
          actorUserId,
          propertyId,
          receipt.id,
          space.id,
          input.financialFundId,
        );
      }

      return receipt.id;
    });

    return this.getReceipt(organisationId, propertyId, receiptId, false);
  }

  async listReceipts(
    organisationId: string,
    propertyId: string,
    filters: { spaceId?: string; status?: ReceiptStatus },
    includeOwnerNames: boolean,
  ): Promise<ReceiptView[]> {
    await this.getOwnedProperty(organisationId, propertyId);
    const receipts = await this.prisma.receipt.findMany({
      where: { organisationId, propertyId, spaceId: filters.spaceId, status: filters.status },
      include: RECEIPT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const spaceIds = [...new Set(receipts.map((r) => r.spaceId))];
    const ownerNames = await this.ownerNamesBySpace(propertyId, spaceIds, includeOwnerNames);
    return receipts.map((r) => toReceiptView(r, ownerNames.get(r.spaceId) ?? null));
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

  async getReceipt(
    organisationId: string,
    propertyId: string,
    receiptId: string,
    includeOwnerNames: boolean,
  ): Promise<ReceiptView> {
    await this.getOwnedProperty(organisationId, propertyId);
    const receipt = await this.prisma.receipt.findFirst({
      where: { id: receiptId, organisationId, propertyId },
      include: RECEIPT_INCLUDE,
    });
    if (!receipt) throw new NotFoundError('Receipt not found');
    const ownerName = await this.getOwnerName(propertyId, receipt.spaceId, includeOwnerNames);
    return toReceiptView(receipt, ownerName);
  }

  /** financials.approve only. A receipt with any still-APPLIED allocation
   * cannot be reversed directly — every allocation against it must be
   * reversed first (see reverseAllocation), the same staged-unwind
   * discipline as LevySchedule.cancel() blocking once anything has ever
   * been issued. */
  async reverseReceipt(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    receiptId: string,
    reason: string,
  ): Promise<ReceiptView> {
    await this.getOwnedProperty(organisationId, propertyId);

    await this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) throw new ConflictError('Start financial setup for this property before reversing a receipt.');
      await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

      const receipt = await tx.receipt.findFirst({ where: { id: receiptId, organisationId, propertyId } });
      if (!receipt) throw new NotFoundError('Receipt not found');
      if (receipt.status !== 'RECORDED') {
        throw new ConflictError('This receipt has already been reversed.');
      }
      const appliedCount = await tx.paymentAllocation.count({ where: { receiptId, status: 'APPLIED' } });
      if (appliedCount > 0) {
        throw new ConflictError(
          `This receipt has ${appliedCount} active allocation(s) against it — reverse those first, then reverse the receipt.`,
        );
      }

      await this.posting.reverseWithinTransaction(tx, organisationId, actorUserId, propertyId, receipt.journalEntryId, {
        reason,
      });

      await tx.receipt.update({
        where: { id: receiptId },
        data: { status: 'REVERSED', reversedByUserId: actorUserId, reversedAt: new Date(), reversalReason: reason },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'RECEIPT_REVERSED',
        entityType: 'Receipt',
        entityId: receipt.id,
        title: `Receipt reversed: ${receipt.publicReference}`,
        description: reason,
      });
    });

    return this.getReceipt(organisationId, propertyId, receiptId, false);
  }

  /** financials.approve only — the standalone "allocate previously
   * unapplied cash" action (also used for a correction's re-allocation
   * after reverseAllocation). */
  async createAllocation(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    receiptId: string,
    input: CreateAllocationInput,
  ): Promise<PaymentAllocationView> {
    await this.getOwnedProperty(organisationId, propertyId);
    const allocation = await this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) throw new ConflictError('Start financial setup for this property before allocating a receipt.');
      await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

      return this.applyAllocationWithinTransaction(
        tx,
        organisationId,
        actorUserId,
        propertyId,
        receiptId,
        input.lotLevyChargeId,
        input.amount,
        input.idempotencyKey,
      );
    });
    const full = await this.prisma.paymentAllocation.findUniqueOrThrow({
      where: { id: allocation.id },
      include: { receipt: { select: { publicReference: true } }, lotLevyCharge: { select: { publicReference: true } } },
    });
    return toAllocationView(full);
  }

  /** financials.approve only. Never edits `amount` — posts the exact
   * opposite journal (Dr LOT_LEVY_RECEIVABLE / Cr UNAPPLIED_CASH,
   * restoring the charge's outstanding balance and the receipt's
   * unapplied balance) and flips this row's own status, the same
   * "reversal is its own event, never a mutation" discipline as every
   * other reversal in this module. */
  async reverseAllocation(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    allocationId: string,
    reason: string,
  ): Promise<PaymentAllocationView> {
    await this.getOwnedProperty(organisationId, propertyId);

    await this.prisma.$transaction(async (tx) => {
      const configuration = await tx.financialConfiguration.findUnique({ where: { propertyId } });
      if (!configuration) throw new ConflictError('Start financial setup for this property before reversing an allocation.');
      await tx.$queryRaw`SELECT id FROM "financial_configurations" WHERE id = ${configuration.id} FOR UPDATE`;

      const allocation = await tx.paymentAllocation.findFirst({ where: { id: allocationId, organisationId, propertyId } });
      if (!allocation) throw new NotFoundError('Allocation not found');
      if (allocation.status !== 'APPLIED') {
        throw new ConflictError('This allocation has already been reversed.');
      }

      await this.posting.reverseWithinTransaction(tx, organisationId, actorUserId, propertyId, allocation.journalEntryId, {
        reason,
      });

      await tx.paymentAllocation.update({
        where: { id: allocationId },
        data: { status: 'REVERSED', reversedByUserId: actorUserId, reversedAt: new Date(), reversalReason: reason },
      });

      await this.updateChargeStatus(tx, allocation.lotLevyChargeId);

      await recordActivity(tx, {
        organisationId,
        propertyId,
        actorUserId,
        eventType: 'PAYMENT_ALLOCATION_REVERSED',
        entityType: 'PaymentAllocation',
        entityId: allocation.id,
        title: `Allocation reversed: ${allocation.publicReference}`,
        description: reason,
      });
    });

    const full = await this.prisma.paymentAllocation.findUniqueOrThrow({
      where: { id: allocationId },
      include: { receipt: { select: { publicReference: true } }, lotLevyCharge: { select: { publicReference: true } } },
    });
    return toAllocationView(full);
  }
}
