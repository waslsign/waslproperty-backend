import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dateOnly.js';

/** An opening balance's own fields — shared verbatim across fund creation
 * and fund update (see fundOpeningBalanceInputSchema below), and matching
 * the Section 6.5 requirements: amount, as-of/cutover date, currency,
 * optional reference/note. Money is validated as a non-negative JS number
 * at this boundary (z.coerce.number(), the same pattern already used for
 * ContractorQuote.amount/WorkOrderVariation.amountDelta), then persisted
 * as Prisma.Decimal — never a raw float carried through any arithmetic. */
const fundOpeningBalanceInputSchema = z.object({
  amount: z.coerce.number().nonnegative(),
  asOfDate: dateOnlySchema,
  referenceNote: z.string().trim().max(240).optional(),
});
export type FundOpeningBalanceInput = z.infer<typeof fundOpeningBalanceInputSchema>;

/** Step 1 of the guided setup ("Financial Year & Cutover") — every field
 * optional, mirroring enableStrataSchema's "save progress" philosophy: a
 * manager may start setup before having every date to hand. Cross-field
 * validation (end > start, cutover within/consistent with the year) is
 * NOT done here — it belongs to the reconciliation step (Section 7), which
 * runs against whatever is actually on record at review time, not just
 * what one single request happened to submit together. */
export const startFinancialSetupSchema = z.object({
  financialYearStartDate: dateOnlySchema.optional(),
  financialYearEndDate: dateOnlySchema.optional(),
  cutoverDate: dateOnlySchema.optional(),
});
export type StartFinancialSetupInput = z.infer<typeof startFinancialSetupSchema>;

/** Updating the financial year/cutover fields at any point while setup is
 * SETUP_IN_PROGRESS — same shape as startFinancialSetupSchema, but every
 * field may also be explicitly cleared (null) once already set. Blocked
 * entirely once ACTIVE (FinancialsService.updateFinancialYear) — these
 * become historically fixed on activation. */
export const updateFinancialYearSchema = z.object({
  financialYearStartDate: dateOnlySchema.nullable().optional(),
  financialYearEndDate: dateOnlySchema.nullable().optional(),
  cutoverDate: dateOnlySchema.nullable().optional(),
});
export type UpdateFinancialYearInput = z.infer<typeof updateFinancialYearSchema>;

/** Creating a fund (Step 2) — ADMINISTRATION/CAPITAL_WORKS get a sensible
 * default display name if omitted (see FinancialsService.addFund); OTHER
 * requires an explicit name (there is no sensible default for a
 * special-purpose fund). The opening balance is optional on creation (a
 * fund may be added before its balance is known) but normally supplied in
 * the same request for a smoother wizard step. */
const administrationFundSchema = z.object({
  fundType: z.literal('ADMINISTRATION'),
  name: z.string().trim().min(1).max(160).optional(),
  openingBalance: fundOpeningBalanceInputSchema.optional(),
});
const capitalWorksFundSchema = z.object({
  fundType: z.literal('CAPITAL_WORKS'),
  name: z.string().trim().min(1).max(160).optional(),
  openingBalance: fundOpeningBalanceInputSchema.optional(),
});
const otherFundSchema = z.object({
  fundType: z.literal('OTHER'),
  name: z.string().trim().min(1).max(160),
  openingBalance: fundOpeningBalanceInputSchema.optional(),
});

export const addFundSchema = z.discriminatedUnion('fundType', [
  administrationFundSchema,
  capitalWorksFundSchema,
  otherFundSchema,
]);
export type AddFundInput = z.infer<typeof addFundSchema>;

/** Editing an existing fund's name and/or opening balance — fundType is
 * never editable (changing what KIND of fund this is would silently
 * reinterpret an already-recorded opening balance; create a new fund and
 * leave the old one's name as a correction instead). Blocked entirely
 * once ACTIVE, same as updateFinancialYearSchema. */
export const updateFundSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  openingBalance: fundOpeningBalanceInputSchema.optional(),
});
export type UpdateFundInput = z.infer<typeof updateFundSchema>;

/** One row of the wizard's "Lot Opening Positions" step (Section 6.6) — a
 * bulk upsert exactly like strata's bulkSetLotsSchema, since the UI
 * naturally edits the whole lot list in one table. amountOwing and
 * creditBalance are separate non-negative fields, never one signed
 * number (Section 6.7) — both default to 0 so a lot can be saved with
 * only one of the two genuinely set. */
const lotOpeningPositionEntrySchema = z.object({
  spaceId: z.string().min(1),
  amountOwing: z.coerce.number().nonnegative().default(0),
  creditBalance: z.coerce.number().nonnegative().default(0),
  asOfDate: dateOnlySchema,
  referenceNote: z.string().trim().max(240).optional(),
});

export const bulkSetLotOpeningPositionsSchema = z.object({
  positions: z.array(lotOpeningPositionEntrySchema).min(1),
});
export type BulkSetLotOpeningPositionsInput = z.infer<typeof bulkSetLotOpeningPositionsSchema>;
export type LotOpeningPositionEntry = z.infer<typeof lotOpeningPositionEntrySchema>;
