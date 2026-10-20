import { z } from 'zod';

/** M16.2.2 — Posting Profile. See PostingRole in prisma/schema.prisma for
 * the fixed set of semantic roles the generic posting engine resolves
 * through this mapping — never a hard-coded account identity anywhere
 * else in the codebase. */
export const postingRoleSchema = z.enum([
  'FUND_CASH',
  'LOT_LEVY_RECEIVABLE',
  'LEVY_INCOME',
  'UNAPPLIED_CASH',
  'ACCOUNTS_PAYABLE',
  'GST_PAYABLE',
  'GST_RECEIVABLE',
  'SUSPENSE',
  'OPENING_BALANCE_EQUITY',
  'INTER_FUND_TRANSFER',
]);

export const upsertPostingProfileRuleSchema = z.object({
  role: postingRoleSchema,
  /** Omitted/null = applies regardless of fund context. */
  financialFundId: z.string().min(1).optional(),
  accountId: z.string().min(1),
});
export type UpsertPostingProfileRuleInput = z.infer<typeof upsertPostingProfileRuleSchema>;
