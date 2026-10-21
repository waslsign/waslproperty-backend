import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dateOnly.js';

/**
 * M16.2 — Budget Management. See budgets.service.ts for the full lifecycle
 * (DRAFT -> APPROVED -> ACTIVE -> SUPERSEDED) and versioning rules these
 * schemas feed into.
 */

/** Step 1 — creating a budget, either freshly (`source: 'CREATED'`, the
 * default) or as the scheme's already-approved current budget captured
 * during onboarding (`source: 'IMPORTED'`) — see FinancialBudget.source's
 * doc comment. The financial year dates are immutable once set (no
 * update endpoint changes them — see budgets.service.ts), so they must be
 * right at creation time; cross-field validation against the property's
 * configured financial year cadence happens in the service layer, which
 * has the FinancialConfiguration row to compare against. */
export const createBudgetSchema = z.object({
  financialYearStartDate: dateOnlySchema,
  financialYearEndDate: dateOnlySchema,
  source: z.enum(['CREATED', 'IMPORTED']).default('CREATED'),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

/** Updating a DRAFT budget's own metadata — notes only. Financial year
 * dates, currency, and source are all immutable after creation (see
 * budgets.service.ts for why). Rejected once the budget is no longer
 * DRAFT. */
export const updateBudgetMetadataSchema = z.object({
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateBudgetMetadataInput = z.infer<typeof updateBudgetMetadataSchema>;

/** M16.2.1 — see FinancialBudgetLine.lineType's doc comment. Defaults to
 * EXPENDITURE, matching every pre-M16.2.1 line's backfilled value, so an
 * existing integration that never sends this field keeps behaving exactly
 * as before. */
export const budgetLineTypeSchema = z.enum([
  'REVENUE',
  'EXPENDITURE',
  'TRANSFER',
  'RESERVE_CONTRIBUTION',
  'OTHER',
]);

/** A budget line's planned amount is validated as a non-negative JS number
 * at this boundary (z.coerce.number(), same pattern as M16.1's
 * fundOpeningBalanceInputSchema), then persisted as Prisma.Decimal — never
 * a raw float carried through any arithmetic. A $0 line is valid (see the
 * FinancialBudgetLine.plannedAmount doc comment); only negative is
 * rejected. `accountId` is optional (M16.2.1) — see
 * FinancialBudgetLine.accountId's doc comment. */
export const addBudgetLineSchema = z.object({
  financialFundId: z.string().min(1),
  lineType: budgetLineTypeSchema.default('EXPENDITURE'),
  category: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  plannedAmount: z.coerce.number().nonnegative(),
  notes: z.string().trim().max(500).optional(),
  accountId: z.string().min(1).optional(),
});
export type AddBudgetLineInput = z.infer<typeof addBudgetLineSchema>;

/** Every field optional — a line can be edited one field at a time.
 * financialFundId is never changed by update (moving a line to a different
 * fund is a delete + re-add, so the fund a line was budgeted against is
 * never ambiguous in history); budgetId is implicit from the route.
 * `accountId: null` clears a previously-set account reference. */
export const updateBudgetLineSchema = z.object({
  lineType: budgetLineTypeSchema.optional(),
  category: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  plannedAmount: z.coerce.number().nonnegative().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  accountId: z.string().min(1).nullable().optional(),
});
export type UpdateBudgetLineInput = z.infer<typeof updateBudgetLineSchema>;

/** Approving a budget. For an IMPORTED budget, `externalApprovalDate` is
 * required (the real-world date the scheme itself approved this budget,
 * before ever touching WaslProp) and must be on or before today — WaslProp
 * never fabricates an approval event that happened inside it; see
 * FinancialBudget.externalApprovalDate's doc comment. For a CREATED
 * budget, supplying either field is rejected (422) — a native approval has
 * no external context to preserve, and silently accepting-but-ignoring
 * these fields would invite confusion about what was actually recorded. */
export const approveBudgetSchema = z.object({
  externalApprovalDate: dateOnlySchema.optional(),
  externalApprovalReference: z.string().trim().max(240).optional(),
});
export type ApproveBudgetInput = z.infer<typeof approveBudgetSchema>;

/** Creating the next version (revision) of a budget — optional notes for
 * why the revision was made. Everything else (financial year, source,
 * version number, starting lines) is derived server-side from the budget
 * being revised; see budgets.service.ts createRevision. */
export const createBudgetRevisionSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});
export type CreateBudgetRevisionInput = z.infer<typeof createBudgetRevisionSchema>;
