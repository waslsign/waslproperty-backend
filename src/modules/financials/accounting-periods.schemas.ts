import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dateOnly.js';

/**
 * M16.2.2 — Accounting Periods. See accounting-periods.service.ts for the
 * lifecycle (OPEN -> CLOSED -> OPEN via reopen) these schemas feed into.
 */

export const createAccountingPeriodSchema = z.object({
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
});
export type CreateAccountingPeriodInput = z.infer<typeof createAccountingPeriodSchema>;

export const closeAccountingPeriodSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CloseAccountingPeriodInput = z.infer<typeof closeAccountingPeriodSchema>;

export const reopenAccountingPeriodSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReopenAccountingPeriodInput = z.infer<typeof reopenAccountingPeriodSchema>;
