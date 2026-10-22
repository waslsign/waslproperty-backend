import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dateOnly.js';

/**
 * FIN-021 (limited scope) — Financial Statements & Reporting. See
 * docs/architecture/financial-statements-reporting-spec.md and ADR-030.
 * All four reports are read-only (financials.view) and reuse
 * LedgerPostingService.trialBalance / LotLedgerService.getStatement —
 * these schemas only validate the reporting window, never a new
 * accounting input.
 */

export const incomeExpenseQuerySchema = z
  .object({
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    financialFundId: z.string().trim().min(1).optional(),
  })
  .refine((q) => q.startDate <= q.endDate, {
    message: 'startDate must not be after endDate',
    path: ['startDate'],
  });
export type IncomeExpenseQuery = z.infer<typeof incomeExpenseQuerySchema>;

export const balanceSheetQuerySchema = z.object({
  asOfDate: dateOnlySchema,
  financialFundId: z.string().trim().min(1).optional(),
});
export type BalanceSheetQuery = z.infer<typeof balanceSheetQuerySchema>;

/** Property Financial Summary is the Income & Expense Statement for
 * [startDate, endDate] plus the Balance Sheet as at endDate — one window,
 * not two independently-chosen dates, so the summary reads as one
 * coherent point-in-time view rather than two reports that happen to be
 * glued together. */
export const propertyFinancialSummaryQuerySchema = incomeExpenseQuerySchema;
export type PropertyFinancialSummaryQuery = z.infer<typeof propertyFinancialSummaryQuerySchema>;
