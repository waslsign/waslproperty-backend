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

/** Staff-entered on behalf of a contractor — there is no contractor login in M8. */
export const submitQuoteSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  description: z.string().trim().min(1).max(2000).optional(),
});
export type SubmitQuoteInput = z.infer<typeof submitQuoteSchema>;

const settableWorkflowModes = [
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
