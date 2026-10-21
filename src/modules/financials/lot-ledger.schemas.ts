import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dateOnly.js';

/**
 * M16.4 — Lot Ledger & Owner Financial Accounts. See lot-ledger.service.ts
 * for the row-type vocabulary these filters select against.
 */

export const lotLedgerRowTypeSchema = z.enum([
  'OPENING_POSITION',
  'REGULAR_LEVY_CHARGE',
  'SPECIAL_LEVY_CHARGE',
  'LEVY_REVERSAL',
  'LEVY_ADJUSTMENT',
]);

export const lotLedgerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  financialFundId: z.string().min(1).optional(),
  type: lotLedgerRowTypeSchema.optional(),
  fromDate: dateOnlySchema.optional(),
  toDate: dateOnlySchema.optional(),
});
export type LotLedgerQuery = z.infer<typeof lotLedgerQuerySchema>;

/** A statement period is always explicit — never "since the beginning of
 * time" or an implicit financial year, so a manager always knows exactly
 * what window of movements they are looking at. */
export const lotStatementQuerySchema = z.object({
  periodStartDate: dateOnlySchema,
  periodEndDate: dateOnlySchema,
});
export type LotStatementQuery = z.infer<typeof lotStatementQuerySchema>;
