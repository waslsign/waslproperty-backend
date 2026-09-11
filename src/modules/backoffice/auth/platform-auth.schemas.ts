import { z } from 'zod';

export const platformLoginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

export const platformChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export type PlatformChangePasswordInput = z.infer<typeof platformChangePasswordSchema>;
