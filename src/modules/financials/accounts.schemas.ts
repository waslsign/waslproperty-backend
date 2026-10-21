import { z } from 'zod';

/**
 * M16.2.1 — Chart of Accounts. See prisma/schema.prisma's "Strata
 * Financial Management: Chart of Accounts" section doc comment for the
 * three load-bearing decisions (scheme-specific, fund-flexible,
 * deactivate-not-delete) AccountsService exists to uphold.
 */

export const accountClassificationSchema = z.enum([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
]);

export const createAccountSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  classification: accountClassificationSchema,
  parentAccountId: z.string().min(1).optional(),
  /** Null/omitted — the common case — means usable against any fund; see
   * AccountingAccount.restrictedToFundId's doc comment. */
  restrictedToFundId: z.string().min(1).optional(),
  externalCode: z.string().trim().max(64).optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

/** Every field optional — an account can be edited one field at a time.
 * `code` is deliberately absent: changing a code after other data may
 * already reference it by label is a correction, not a routine edit — see
 * AccountsService.update's doc comment on why it's rejected outright
 * rather than silently accepted. */
export const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  classification: accountClassificationSchema.optional(),
  parentAccountId: z.string().min(1).nullable().optional(),
  restrictedToFundId: z.string().min(1).nullable().optional(),
});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const listAccountsQuerySchema = z.object({
  classification: accountClassificationSchema.optional(),
  fundId: z.string().min(1).optional(),
  /** Defaults to true — the common list view. Pass "false" to include
   * deactivated accounts too. */
  activeOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
  search: z.string().trim().max(200).optional(),
});
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

/** Preview is a pure, unpersisted computation over the uploaded file
 * content — see AccountImportBatch's doc comment on why no per-row dry-run
 * state is ever stored. `csvContent` is the raw file text (the frontend
 * reads the uploaded File client-side and sends its text — no separate
 * multipart upload pipeline for M16.2.1). */
export const importAccountsPreviewSchema = z.object({
  csvContent: z.string().min(1).max(5_000_000),
  fileName: z.string().trim().max(200).optional(),
});
export type ImportAccountsPreviewInput = z.infer<typeof importAccountsPreviewSchema>;

/** Applying an import re-validates the same file content from scratch
 * (never trusts a client-reported preview — see AccountImportBatch's doc
 * comment) and accepts `rowClassifications` to resolve rows the dry-run
 * could only suggest a classification for (keyed by 1-based row number as
 * a string, since JSON object keys are always strings). A row with no
 * resolvable classification (no suggestion, no override) blocks the whole
 * apply — see AccountImportService.apply. */
export const importAccountsApplySchema = z.object({
  csvContent: z.string().min(1).max(5_000_000),
  fileName: z.string().trim().max(200).optional(),
  rowClassifications: z.record(z.string(), accountClassificationSchema).optional(),
});
export type ImportAccountsApplyInput = z.infer<typeof importAccountsApplySchema>;

export const createAccountTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  lines: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(200),
        classification: accountClassificationSchema,
        parentCode: z.string().trim().min(1).max(32).optional(),
      }),
    )
    .min(1),
});
export type CreateAccountTemplateInput = z.infer<typeof createAccountTemplateSchema>;

export const provisionFromTemplateSchema = z.object({
  accountTemplateId: z.string().min(1),
});
export type ProvisionFromTemplateInput = z.infer<typeof provisionFromTemplateSchema>;
