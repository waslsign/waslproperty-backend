import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dateOnly.js';

/**
 * M16.3 — Levy Management & UOE Allocation. See levies.service.ts for the
 * schedule-level lifecycle (DRAFT -> APPROVED -> PARTIALLY_ISSUED ->
 * ISSUED, or DRAFT/APPROVED -> CANCELLED) and ADR-024 for the
 * instalment-level issue/reverse model these schemas feed into.
 */

const installmentInputSchema = z.object({
  dueDate: dateOnlySchema,
  /** Explicit, caller-supplied — never auto-split across installments by
   * an equal-division policy this milestone doesn't invent. Must sum
   * exactly to the schedule's total (budget-derived for REGULAR, or the
   * sum itself defines the total for SPECIAL — see levies.service.ts). */
  amount: z.coerce.number().positive(),
});

export const createRegularLevyScheduleSchema = z.object({
  financialFundId: z.string().min(1),
  financialBudgetId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  installments: z.array(installmentInputSchema).min(1),
});
export type CreateRegularLevyScheduleInput = z.infer<typeof createRegularLevyScheduleSchema>;

export const createSpecialLevyScheduleSchema = z.object({
  financialFundId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  rationale: z.string().trim().min(1).max(2000),
  externalApprovalDate: dateOnlySchema,
  externalApprovalReference: z.string().trim().max(240).optional(),
  installments: z.array(installmentInputSchema).min(1),
});
export type CreateSpecialLevyScheduleInput = z.infer<typeof createSpecialLevyScheduleSchema>;

export const approveLevyScheduleSchema = z.object({});
export type ApproveLevyScheduleInput = z.infer<typeof approveLevyScheduleSchema>;

export const cancelLevyScheduleSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type CancelLevyScheduleInput = z.infer<typeof cancelLevyScheduleSchema>;

/** ADR-024 — issuing a schedule issues exactly ONE instalment per call
 * (never the whole schedule at once — see levies.service.ts's issue()).
 * `levyInstallmentId` is optional: omit it to issue the earliest PENDING
 * instalment (the common "strike the next one" action), or supply it to
 * issue a specific instalment out of due-date order (e.g. an AGM decided
 * to bring a later instalment forward). */
export const issueLevyScheduleSchema = z.object({
  levyInstallmentId: z.string().trim().min(1).optional(),
});
export type IssueLevyScheduleInput = z.infer<typeof issueLevyScheduleSchema>;

/** ADR-024 — reversal now targets one specific ISSUED instalment, never
 * the whole schedule (there is no longer one journal per schedule to
 * reverse — see levies.service.ts's reverseInstallment()). */
export const reverseLevyScheduleSchema = z.object({
  levyInstallmentId: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
});
export type ReverseLevyScheduleInput = z.infer<typeof reverseLevyScheduleSchema>;

export const createLevyAdjustmentSchema = z.object({
  /** Signed — positive increases the lot's receivable, negative reduces
   * it. Zero is rejected (there is nothing to adjust). */
  amount: z.coerce.number().refine((v) => v !== 0, 'amount must not be zero'),
  reason: z.string().trim().min(1).max(500),
  /** Idempotency key for this specific adjustment — if omitted, one is
   * generated server-side (so a genuine retry with no client-supplied key
   * cannot be deduplicated; supply it explicitly to make a retried request
   * safely idempotent, same convention as postManualJournalSchema's
   * `sourceId`). */
  sourceId: z.string().trim().min(1).max(200).optional(),
});
export type CreateLevyAdjustmentInput = z.infer<typeof createLevyAdjustmentSchema>;

export const listLotLevyChargesQuerySchema = z.object({
  spaceId: z.string().min(1).optional(),
  levyScheduleId: z.string().min(1).optional(),
});
export type ListLotLevyChargesQuery = z.infer<typeof listLotLevyChargesQuerySchema>;
