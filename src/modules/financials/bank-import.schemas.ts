import { z } from 'zod';

/** M16.7 — Bank Statement CSV Import. See bank-import.service.ts's doc
 * comment for the normalization/duplicate-detection strategy this feeds. */

export const bankStatementDateFormatSchema = z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY']);

/** Column indices are 0-based, over the parsed CSV rows AFTER the header
 * row (if any) is stripped. Exactly one of (debitColumn & creditColumn) OR
 * amountColumn must be supplied — validated in the service, not here,
 * since it's a cross-field rule. */
export const bankStatementColumnMappingSchema = z
  .object({
    hasHeaderRow: z.boolean(),
    dateFormat: bankStatementDateFormatSchema,
    dateColumn: z.number().int().min(0),
    valueDateColumn: z.number().int().min(0).optional(),
    descriptionColumn: z.number().int().min(0),
    debitColumn: z.number().int().min(0).optional(),
    creditColumn: z.number().int().min(0).optional(),
    amountColumn: z.number().int().min(0).optional(),
    balanceColumn: z.number().int().min(0).optional(),
    referenceColumn: z.number().int().min(0).optional(),
    externalIdColumn: z.number().int().min(0).optional(),
  })
  .refine(
    (m) => (m.amountColumn !== undefined) !== (m.debitColumn !== undefined || m.creditColumn !== undefined),
    'Provide either amountColumn (signed) or debitColumn/creditColumn (separate), never both and never neither.',
  )
  .refine(
    (m) => m.amountColumn !== undefined || (m.debitColumn !== undefined && m.creditColumn !== undefined),
    'When not using a single signed amountColumn, both debitColumn and creditColumn are required.',
  );
export type BankStatementColumnMapping = z.infer<typeof bankStatementColumnMappingSchema>;

export const previewBankStatementSchema = z.object({
  csvContent: z.string().min(1).max(10_000_000),
  fileName: z.string().trim().max(200).optional(),
  columnMapping: bankStatementColumnMappingSchema,
  currencyCode: z.string().trim().length(3),
});
export type PreviewBankStatementInput = z.infer<typeof previewBankStatementSchema>;

export const applyBankStatementSchema = previewBankStatementSchema;
export type ApplyBankStatementInput = z.infer<typeof applyBankStatementSchema>;

export const listBankTransactionsQuerySchema = z.object({
  matchStatus: z.enum(['UNMATCHED', 'SUGGESTED', 'MATCHED', 'IGNORED']).optional(),
  reconciliationStatus: z.enum(['UNRECONCILED', 'RECONCILED']).optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  search: z.string().trim().max(200).optional(),
});
export type ListBankTransactionsQuery = z.infer<typeof listBankTransactionsQuerySchema>;
