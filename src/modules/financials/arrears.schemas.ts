import { z } from 'zod';
import { dateOnlySchema } from '../../lib/dateOnly.js';

/**
 * M16.6 — Arrears Management (ADR-027). `asOfDate` is accepted everywhere
 * an arrears figure is computed — defaults to today when omitted. See
 * arrears.service.ts for the effective-dated reconstruction this drives.
 */

export const ageingBucketSchema = z.enum(['CURRENT', 'DAYS_1_30', 'DAYS_31_60', 'DAYS_61_90', 'DAYS_90_PLUS']);
export type AgeingBucket = z.infer<typeof ageingBucketSchema>;

export const arrearsSummaryQuerySchema = z.object({
  asOfDate: dateOnlySchema.optional(),
  financialFundId: z.string().trim().min(1).optional(),
});
export type ArrearsSummaryQuery = z.infer<typeof arrearsSummaryQuerySchema>;

export const collectionCaseStatusSchema = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'AWAITING_PAYMENT',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
  /// M16.8 — see CollectionCaseStatus's own schema doc comment.
  'DISPUTED',
  'PAUSED',
]);

export const arrearsRegisterQuerySchema = z.object({
  asOfDate: dateOnlySchema.optional(),
  financialFundId: z.string().trim().min(1).optional(),
  ageingBucket: ageingBucketSchema.optional(),
  collectionStatus: z
    .enum(['OPEN', 'IN_PROGRESS', 'AWAITING_PAYMENT', 'ESCALATED', 'RESOLVED', 'CLOSED', 'DISPUTED', 'PAUSED', 'NONE'])
    .optional(),
});
export type ArrearsRegisterQuery = z.infer<typeof arrearsRegisterQuerySchema>;

export const lotArrearsDetailQuerySchema = z.object({
  asOfDate: dateOnlySchema.optional(),
});
export type LotArrearsDetailQuery = z.infer<typeof lotArrearsDetailQuerySchema>;

export const createCollectionCaseSchema = z.object({
  assignedToUserId: z.string().trim().min(1).optional(),
  nextFollowUpDate: dateOnlySchema.optional(),
});
export type CreateCollectionCaseInput = z.infer<typeof createCollectionCaseSchema>;

export const updateCollectionCaseSchema = z.object({
  status: collectionCaseStatusSchema.optional(),
  assignedToUserId: z.string().trim().min(1).nullable().optional(),
  nextFollowUpDate: dateOnlySchema.nullable().optional(),
  closeReason: z.string().trim().max(500).optional(),
});
export type UpdateCollectionCaseInput = z.infer<typeof updateCollectionCaseSchema>;

export const createCollectionNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  contactAttempted: z.boolean().optional(),
  contactMethod: z.enum(['PHONE', 'EMAIL', 'LETTER', 'IN_PERSON', 'OTHER']).optional(),
});
export type CreateCollectionNoteInput = z.infer<typeof createCollectionNoteSchema>;

export const draftReminderSchema = z.object({
  asOfDate: dateOnlySchema.optional(),
  collectionCaseId: z.string().trim().min(1).optional(),
});
export type DraftReminderInput = z.infer<typeof draftReminderSchema>;
