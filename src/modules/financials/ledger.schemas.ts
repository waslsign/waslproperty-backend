import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dateOnly.js';

/**
 * M16.2.2 — General Ledger & Posting Engine. See
 * docs/architecture/financial-management-implementation-plan.md §7 and
 * ledger-posting.service.ts for the invariants these schemas feed into.
 */

/** A posting amount is validated as a non-negative JS number at this
 * boundary (same z.coerce.number() pattern as every other money field in
 * this codebase), then persisted as Prisma.Decimal — never a raw float
 * carried through arithmetic. */
const nonNegativeAmount = z.coerce.number().nonnegative();

export const journalLineInputSchema = z
  .object({
    accountId: z.string().min(1),
    financialFundId: z.string().min(1),
    debit: nonNegativeAmount.default(0),
    credit: nonNegativeAmount.default(0),
    lineNarration: z.string().trim().max(500).optional(),
  })
  .refine((line) => (line.debit > 0) !== (line.credit > 0), {
    message: 'Each line must have exactly one of debit or credit greater than zero, not both.',
  });
export type JournalLineInput = z.infer<typeof journalLineInputSchema>;

/** Posting a manual journal entry (financials.approve) — the generic,
 * always-available entry point for corrections and entries with no other
 * producer yet. `sourceId`, if omitted, is generated server-side so every
 * manual posting still has a stable idempotency key; supply it explicitly
 * only to make a specific manual entry itself idempotent against retries
 * from the caller's side. */
export const postManualJournalSchema = z.object({
  effectiveDate: dateOnlySchema,
  narration: z.string().trim().min(1).max(500),
  sourceId: z.string().trim().min(1).max(200).optional(),
  lines: z.array(journalLineInputSchema).min(2),
});
export type PostManualJournalInput = z.infer<typeof postManualJournalSchema>;

export const reverseJournalSchema = z.object({
  effectiveDate: dateOnlySchema.optional(),
  reason: z.string().trim().min(1).max(500),
});
export type ReverseJournalInput = z.infer<typeof reverseJournalSchema>;

export const listJournalsQuerySchema = z.object({
  sourceType: z.string().trim().max(100).optional(),
  accountingPeriodId: z.string().min(1).optional(),
});
export type ListJournalsQuery = z.infer<typeof listJournalsQuerySchema>;

export const trialBalanceQuerySchema = z.object({
  asOfDate: dateOnlySchema.optional(),
  /** Restricts the trial balance to one fund's journal lines (M16.3
   * refinement pass) — see LedgerPostingService.trialBalance's doc
   * comment. */
  financialFundId: z.string().trim().min(1).optional(),
});
export type TrialBalanceQuery = z.infer<typeof trialBalanceQuerySchema>;

/** Generating the M16.1 -> ledger opening journal (financials.approve).
 * `lotFundSplits` is mandatory, explicit, per-lot fund allocation — see
 * OpeningJournalService's doc comment on why this is never inferred or
 * defaulted (the "no fabricated opening-balance allocations" safeguard). */
export const generateOpeningJournalSchema = z.object({
  effectiveDate: dateOnlySchema.optional(),
  lotFundSplits: z.array(
    z.object({
      spaceId: z.string().min(1),
      allocations: z
        .array(
          z.object({
            financialFundId: z.string().min(1),
            amountOwing: nonNegativeAmount.default(0),
            creditBalance: nonNegativeAmount.default(0),
          }),
        )
        .min(1),
    }),
  ),
});
export type GenerateOpeningJournalInput = z.infer<typeof generateOpeningJournalSchema>;
