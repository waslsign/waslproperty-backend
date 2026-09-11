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

export const grantPlatformAccessSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
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

export const searchUserQuerySchema = z.object({
  email: z.string().trim().min(1).max(200),
});
