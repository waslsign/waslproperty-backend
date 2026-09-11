import { z } from 'zod';
import { audienceCriteriaSchema } from '../communications/communications.schemas.js';

export const createSavedAudienceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  criteria: audienceCriteriaSchema,
});
export type CreateSavedAudienceInput = z.infer<typeof createSavedAudienceSchema>;

export const updateSavedAudienceSchema = createSavedAudienceSchema.partial();
export type UpdateSavedAudienceInput = z.infer<typeof updateSavedAudienceSchema>;
