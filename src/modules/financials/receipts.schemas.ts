import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dateOnly.js';

/**
 * M16.5 — Receipts & Payment Allocation. See receipts.service.ts for the
 * accounting treatment (ADR-026) these schemas feed into.
 */

const manualAllocationInputSchema = z.object({
  lotLevyChargeId: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
});

export const recordReceiptSchema = z.object({
  spaceId: z.string().trim().min(1),
  financialFundId: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER']),
  paymentReference: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  receiptDate: dateOnlySchema,
  /** Defaults to receiptDate when omitted — see Receipt.postingDate's own
   * doc comment for why these two dates may legitimately differ. */
  postingDate: dateOnlySchema.optional(),
  externalBankReference: z.string().trim().max(200).optional(),
  /** Idempotency key — if omitted, one is generated server-side (same
   * convention as postManualJournalSchema's sourceId). */
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  /**
   * Optional immediate allocation, posted in the same request (never the
   * same journal — see this milestone's accounting-treatment doc). Supply
   * EITHER `allocations` (manual, caller-selected charges) OR
   * `autoAllocate: true` (oldest-due-date-first across this lot's
   * outstanding charges in the SAME fund as the receipt — the documented
   * default order) — never both.
   */
  allocations: z.array(manualAllocationInputSchema).optional(),
  autoAllocate: z.boolean().optional(),
});
export type RecordReceiptInput = z.infer<typeof recordReceiptSchema>;

export const listReceiptsQuerySchema = z.object({
  spaceId: z.string().trim().min(1).optional(),
  status: z.enum(['RECORDED', 'REVERSED']).optional(),
});
export type ListReceiptsQuery = z.infer<typeof listReceiptsQuerySchema>;

export const reverseReceiptSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReverseReceiptInput = z.infer<typeof reverseReceiptSchema>;

export const createAllocationSchema = z.object({
  lotLevyChargeId: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export type CreateAllocationInput = z.infer<typeof createAllocationSchema>;

export const reverseAllocationSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReverseAllocationInput = z.infer<typeof reverseAllocationSchema>;
