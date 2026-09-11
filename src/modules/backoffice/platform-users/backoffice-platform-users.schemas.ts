import { z } from 'zod';

const PLATFORM_ROLES = [
  'PLATFORM_SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'PLATFORM_SUPPORT',
  'PLATFORM_DEVELOPER',
] as const;

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9._-]+$/, 'Use only letters, numbers, dots, underscores, or hyphens');

/** Always creates a brand-new Employee — there is no "grant access to an
 * existing user" path any more, because Employee has no relationship to
 * User at all. A generated temporary password is returned once. */
export const grantPlatformAccessSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  username: usernameSchema,
  role: z.enum(PLATFORM_ROLES),
  reason: z.string().trim().min(1).max(500),
});
export type GrantPlatformAccessInput = z.infer<typeof grantPlatformAccessSchema>;

export const updatePlatformUserSchema = z.object({
  role: z.enum(PLATFORM_ROLES).optional(),
  isActive: z.boolean().optional(),
  username: usernameSchema.optional(),
  reason: z.string().trim().min(1).max(500),
});
export type UpdatePlatformUserInput = z.infer<typeof updatePlatformUserSchema>;

export const resetPlatformUserPasswordSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ResetPlatformUserPasswordInput = z.infer<typeof resetPlatformUserPasswordSchema>;
