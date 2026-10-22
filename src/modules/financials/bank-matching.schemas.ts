import { z } from 'zod';

/** M16.7 — Bank Transaction Matching. */

export const confirmSuggestedMatchSchema = z.object({
  bankTransactionMatchId: z.string().trim().min(1),
});
export type ConfirmSuggestedMatchInput = z.infer<typeof confirmSuggestedMatchSchema>;

export const manualMatchReceiptSchema = z.object({
  receiptId: z.string().trim().min(1),
});
export type ManualMatchReceiptInput = z.infer<typeof manualMatchReceiptSchema>;

export const manualMatchJournalLineSchema = z.object({
  journalLineId: z.string().trim().min(1),
});
export type ManualMatchJournalLineInput = z.infer<typeof manualMatchJournalLineSchema>;

export const reverseMatchSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReverseMatchInput = z.infer<typeof reverseMatchSchema>;

export const ignoreTransactionSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type IgnoreTransactionInput = z.infer<typeof ignoreTransactionSchema>;

/** Creates a brand-new Receipt from an unmatched deposit, via the
 * existing ReceiptsService — never a second posting implementation. Only
 * the fields ReceiptsService.recordReceipt actually needs beyond what the
 * bank transaction itself already supplies (date, amount, currency,
 * externalBankReference are taken from the transaction, never
 * re-entered). */
export const createReceiptFromTransactionSchema = z.object({
  spaceId: z.string().trim().min(1),
  financialFundId: z.string().trim().min(1),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER']).default('BANK_TRANSFER'),
  paymentReference: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  autoAllocate: z.boolean().optional(),
});
export type CreateReceiptFromTransactionInput = z.infer<typeof createReceiptFromTransactionSchema>;
