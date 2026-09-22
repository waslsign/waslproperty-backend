import { PropertyRole } from '@prisma/client';
import { z } from 'zod';
import { CAPABILITIES } from '../authorization/capabilities.js';

const capabilitySchema = z.enum(CAPABILITIES);
const propertyRoleSchema = z.nativeEnum(PropertyRole);

export const updateRolePermissionsSchema = z.object({
  // Full replacement of this role's overrides in one call — mirrors the
  // "Save" button in the Roles & Permissions editor: the frontend computes
  // the full override set (default XOR checkbox state) and sends it as one
  // atomic write, never a series of incremental per-checkbox PATCHes that
  // could leave the row set half-applied if the user navigates away.
  overrides: z.array(
    z.object({
      capability: capabilitySchema,
      granted: z.boolean(),
    }),
  ),
});
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;

export const rolePermissionsRoleParamSchema = z.object({
  role: propertyRoleSchema,
});
