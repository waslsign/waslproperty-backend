import { WorkflowMode } from '@prisma/client';
import { z } from 'zod';
import { currencyCodeSchema } from '../../lib/currencies.js';

export const createQuoteSchema = z.object({
  workOrderId: z.string().trim().min(1),
  contractorId: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  /** Optional — when omitted, QuotesService.create falls back to the
   * organisation's own currencyCode. Kept overridable since a contractor
   * may genuinely quote in a different currency than the org default. */
  currencyCode: currencyCodeSchema.optional(),
  description: z.string().trim().min(1).max(2000).optional(),
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

/** Used both by staff entering a quote on a contractor's behalf and by a
 * contractor submitting through their own secure RFQ link — the same
 * commercial content either way. Free text throughout for the proposal
 * fields (see ContractorQuote's own schema comment for why). */
export const submitQuoteSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  proposedStartAt: z.coerce.date().optional(),
  estimatedDuration: z.string().trim().max(200).optional(),
  inclusions: z.string().trim().max(2000).optional(),
  exclusions: z.string().trim().max(2000).optional(),
  warrantyInfo: z.string().trim().max(1000).optional(),
});
export type SubmitQuoteInput = z.infer<typeof submitQuoteSchema>;

// NONE is settable too — a manager confirming that a quote genuinely needs
// no approval or signature (only ever allowed when the organisation's
// Approval & Acceptance policy doesn't require more — see
// QuotesService.setWorkflowMode's meetsOrExceedsRequirement check).
const settableWorkflowModes = [
  WorkflowMode.NONE,
  WorkflowMode.APPROVAL_ONLY,
  WorkflowMode.SIGNATURE_ONLY,
  WorkflowMode.APPROVAL_THEN_SIGNATURE,
] as const;

export const setWorkflowModeSchema = z.object({
  workflowMode: z.enum(settableWorkflowModes),
});
export type SetWorkflowModeInput = z.infer<typeof setWorkflowModeSchema>;

export const rejectQuoteSchema = z.object({
  reason: z.string().trim().min(1).max(1000).optional(),
});
export type RejectQuoteInput = z.infer<typeof rejectQuoteSchema>;
