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

/** Either grants access to an existing WaslProperty user (by email), or —
 * when email is omitted — creates a brand-new platform-only account (no
 * customer relationship) from firstName/lastName, with a generated
 * temporary password returned once in the response. */
export const grantPlatformAccessSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    username: usernameSchema,
    role: z.enum(PLATFORM_ROLES),
    reason: z.string().trim().min(1).max(500),
  })
  .refine((data) => data.email ?? (data.firstName && data.lastName), {
    message: 'Provide either the email of an existing WaslProperty user, or a first and last name to create a new platform-only account.',
    path: ['firstName'],
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

export const resetPlatformUserPasswordSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ResetPlatformUserPasswordInput = z.infer<typeof resetPlatformUserPasswordSchema>;
