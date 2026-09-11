import { CommunicationStatus, PropertyRole } from '@prisma/client';
import { z } from 'zod';

// WHATSAPP is deliberately never accepted from the client here — it exists
// in the Prisma enum so the domain doesn't need a redesign once a provider
// is configured, but must never be selectable until then.
export const selectableChannelSchema = z.enum(['IN_APP', 'EMAIL']);

export const audienceCriteriaSchema = z
  .object({
    scope: z.enum(['ORGANISATION', 'PROPERTY', 'SPACE']),
    propertyIds: z.array(z.string().trim().min(1)).optional(),
    spaceIds: z.array(z.string().trim().min(1)).optional(),
    roles: z.array(z.nativeEnum(PropertyRole)).optional(),
    includeContactIds: z.array(z.string().trim().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === 'PROPERTY' && !value.propertyIds?.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select at least one property',
        path: ['propertyIds'],
      });
    }
    if (value.scope === 'SPACE' && !value.spaceIds?.length) {
      ctx.addIssue({ code: 'custom', message: 'Select at least one space', path: ['spaceIds'] });
    }
  });
export type AudienceCriteriaInput = z.infer<typeof audienceCriteriaSchema>;

export const createCommunicationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
  channels: z.array(selectableChannelSchema).min(1, 'Select at least one delivery channel'),
  audienceCriteria: audienceCriteriaSchema,
  savedAudienceId: z.string().trim().min(1).optional(),
});
export type CreateCommunicationInput = z.infer<typeof createCommunicationSchema>;

export const updateCommunicationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(10_000).optional(),
  channels: z.array(selectableChannelSchema).min(1).optional(),
  audienceCriteria: audienceCriteriaSchema.optional(),
  savedAudienceId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateCommunicationInput = z.infer<typeof updateCommunicationSchema>;

export const sendCommunicationSchema = z.object({
  /** Omitted, or in the past — sends as soon as the delivery worker's next
   * tick picks it up. In the future — schedules for then. Either way the
   * fan-out always happens outside this request. */
  scheduledAt: z.coerce.date().optional(),
});
export type SendCommunicationInput = z.infer<typeof sendCommunicationSchema>;

export const previewAudienceSchema = z.object({
  audienceCriteria: audienceCriteriaSchema,
});

export const communicationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(CommunicationStatus).optional(),
  search: z.string().trim().min(1).optional(),
});
export type CommunicationsQuery = z.infer<typeof communicationsQuerySchema>;
