import { SpaceStatus, SpaceType } from '@prisma/client';
import { z } from 'zod';

export const createSpaceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(40),
  spaceType: z.nativeEnum(SpaceType),
  floor: z.string().trim().max(40).optional(),
  sizeSqft: z.coerce.number().int().positive().optional(),
  /** Foundational strata lot metadata (M11-A) — only settable when the
   * owning property is itself isStrataManaged, which in turn requires the
   * organisation to have STRATA_MANAGEMENT (both enforced in
   * SpacesService). entitlementValue is informational only — never used in
   * any calculation until confirmed business rules exist. */
  isStrataLot: z.boolean().optional(),
  lotNumber: z.string().trim().max(40).optional(),
  entitlementValue: z.coerce.number().positive().optional(),
});
export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;

export const updateSpaceSchema = createSpaceSchema.partial().extend({
  status: z.nativeEnum(SpaceStatus).optional(),
});
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;
