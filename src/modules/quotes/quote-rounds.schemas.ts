import { z } from 'zod';
import { currencyCodeSchema } from '../../lib/currencies.js';

export const createQuoteRoundSchema = z.object({
  maintenanceRequestId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  scopeDescription: z.string().trim().min(1).max(4000),
  accessInstructions: z.string().trim().max(2000).optional(),
  desiredStartAt: z.coerce.date().optional(),
  dueAt: z.coerce.date().optional(),
  currencyCode: currencyCodeSchema.optional(),
  /** Contractors to invite immediately — a round is only ever created
   * already OPEN and sent (see QuoteRound.status doc comment), so this is
   * not optional in practice; at least one contractor must be invited. */
  contractorIds: z.array(z.string().trim().min(1)).min(1, 'Invite at least one contractor'),
});
export type CreateQuoteRoundInput = z.infer<typeof createQuoteRoundSchema>;

export const inviteContractorsSchema = z.object({
  contractorIds: z.array(z.string().trim().min(1)).min(1),
});
export type InviteContractorsInput = z.infer<typeof inviteContractorsSchema>;

export const awardQuoteRoundSchema = z.object({
  quoteId: z.string().trim().min(1),
  note: z.string().trim().max(1000).optional(),
});
export type AwardQuoteRoundInput = z.infer<typeof awardQuoteRoundSchema>;

export const cancelQuoteRoundSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});
export type CancelQuoteRoundInput = z.infer<typeof cancelQuoteRoundSchema>;

// --- Public (token-based) contractor response ---

export const rfqPublicSubmitSchema = z.object({
  amount: z.coerce.number().positive('Enter an amount greater than zero'),
  description: z.string().trim().max(2000).optional(),
  proposedStartAt: z.coerce.date().optional(),
  estimatedDuration: z.string().trim().max(200).optional(),
  inclusions: z.string().trim().max(2000).optional(),
  exclusions: z.string().trim().max(2000).optional(),
  warrantyInfo: z.string().trim().max(1000).optional(),
});
export type RfqPublicSubmitInput = z.infer<typeof rfqPublicSubmitSchema>;

export const presignQuoteAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  fileSize: z.coerce.number().positive(),
});
export type PresignQuoteAttachmentInput = z.infer<typeof presignQuoteAttachmentSchema>;
