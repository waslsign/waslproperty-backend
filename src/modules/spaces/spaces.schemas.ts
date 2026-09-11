import { SpaceStatus, SpaceType } from '@prisma/client';
import { z } from 'zod';

export const createSpaceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(40),
  spaceType: z.nativeEnum(SpaceType),
  floor: z.string().trim().max(40).optional(),
  sizeSqft: z.coerce.number().int().positive().optional(),
});
export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;

export const updateSpaceSchema = createSpaceSchema.partial().extend({
  status: z.nativeEnum(SpaceStatus).optional(),
});
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;
