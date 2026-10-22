import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dateOnly.js';

/** M16.7 — Bank Accounts. See bank-accounts.service.ts for why the raw
 * `accountIdentifier` submitted here is never persisted. */

export const bankAccountTypeSchema = z.enum(['OPERATING', 'RESERVE', 'TRUST', 'OTHER']);
export const bankAccountStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const registerBankAccountSchema = z.object({
  accountName: z.string().trim().min(1).max(200),
  institutionName: z.string().trim().min(1).max(200),
  /** Raw identifier, e.g. "BSB 062-000 ACC 12345678" or an IBAN — masked
   * server-side and never stored or echoed back. */
  accountIdentifier: z.string().trim().min(1).max(200),
  currencyCode: z.string().trim().length(3),
  accountType: bankAccountTypeSchema,
  glCashAccountId: z.string().trim().min(1),
  financialFundId: z.string().trim().min(1).optional(),
  openingReconciledBalance: z.coerce.number().optional(),
  openingReconciledDate: dateOnlySchema.optional(),
});
export type RegisterBankAccountInput = z.infer<typeof registerBankAccountSchema>;

export const updateBankAccountSchema = z.object({
  accountName: z.string().trim().min(1).max(200).optional(),
  status: bankAccountStatusSchema.optional(),
});
export type UpdateBankAccountInput = z.infer<typeof updateBankAccountSchema>;

export const listBankAccountsQuerySchema = z.object({
  activeOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
});
export type ListBankAccountsQuery = z.infer<typeof listBankAccountsQuerySchema>;
