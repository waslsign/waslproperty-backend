import { PropertyStatus, PropertyType } from '@prisma/client';
import { z } from 'zod';

export const createPropertySchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(40),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().max(120).optional(),
  country: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().max(20).optional(),
  propertyType: z.nativeEnum(PropertyType),
  /** Foundational strata metadata (M11-A) — only settable when the
   * organisation has STRATA_MANAGEMENT (enforced in PropertiesService, not
   * just this schema). */
  isStrataManaged: z.boolean().optional(),
  strataPlanNumber: z.string().trim().max(60).optional(),
  strataSchemeName: z.string().trim().max(160).optional(),
});
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

export const updatePropertySchema = createPropertySchema.partial().extend({
  status: z.nativeEnum(PropertyStatus).optional(),
});
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
