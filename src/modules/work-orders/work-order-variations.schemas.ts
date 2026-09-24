import { WorkflowMode } from '@prisma/client';
import { z } from 'zod';

export const createVariationSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  amountDelta: z.coerce.number().refine((n) => n !== 0, 'Enter a non-zero amount'),
});
export type CreateVariationInput = z.infer<typeof createVariationSchema>;

export const rejectVariationSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});
export type RejectVariationInput = z.infer<typeof rejectVariationSchema>;

// Mirrors quotes.schemas.ts's settableWorkflowModes exactly — NONE is
// settable too, confirming a variation genuinely needs no approval or
// signature (only ever allowed when the organisation's Approval &
// Acceptance policy doesn't require more).
const settableVariationWorkflowModes = [
  WorkflowMode.NONE,
  WorkflowMode.APPROVAL_ONLY,
  WorkflowMode.SIGNATURE_ONLY,
  WorkflowMode.APPROVAL_THEN_SIGNATURE,
] as const;

export const setVariationWorkflowModeSchema = z.object({
  workflowMode: z.enum(settableVariationWorkflowModes),
});
export type SetVariationWorkflowModeInput = z.infer<typeof setVariationWorkflowModeSchema>;

export const presignVariationAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  fileSize: z.coerce.number().int().positive(),
});
export type PresignVariationAttachmentInput = z.infer<typeof presignVariationAttachmentSchema>;

export const registerVariationAttachmentSchema = z.object({
  storageKey: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1),
  fileSize: z.coerce.number().int().positive(),
});
export type RegisterVariationAttachmentInput = z.infer<typeof registerVariationAttachmentSchema>;
