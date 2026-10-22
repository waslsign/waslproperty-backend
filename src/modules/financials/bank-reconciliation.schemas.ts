import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dateOnly.js';

/** M16.7 — Bank Reconciliation. */

export const createReconciliationDraftSchema = z.object({
  periodStartDate: dateOnlySchema,
  periodEndDate: dateOnlySchema,
  statementOpeningBalance: z.coerce.number(),
  statementClosingBalance: z.coerce.number(),
  /** Set only when this draft is the controlled correction for a
   * previously REOPENED reconciliation — see
   * BankReconciliationService.createDraft. */
  supersedesReconciliationId: z.string().trim().min(1).optional(),
});
export type CreateReconciliationDraftInput = z.infer<typeof createReconciliationDraftSchema>;

export const reopenReconciliationSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReopenReconciliationInput = z.infer<typeof reopenReconciliationSchema>;
