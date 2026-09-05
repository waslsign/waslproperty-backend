import { z } from 'zod';

export const ALLOWED_ATTACHMENT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const attachmentFileSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_ATTACHMENT_CONTENT_TYPES),
  fileSize: z.number().int().positive(),
});

export const presignAttachmentsSchema = z.object({
  files: z.array(attachmentFileSchema).min(1, 'Select at least one photo'),
});
export type PresignAttachmentsInput = z.infer<typeof presignAttachmentsSchema>;

export const registerAttachmentsSchema = z.object({
  attachments: z
    .array(
      attachmentFileSchema.extend({
        storageKey: z.string().trim().min(1),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});
export type RegisterAttachmentsInput = z.infer<typeof registerAttachmentsSchema>;
