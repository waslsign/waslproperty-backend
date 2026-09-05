import { z } from 'zod';

export const inviteTokenParamSchema = z.object({
  token: z.string().trim().min(1, 'Token is required'),
});
export type InviteTokenParam = z.infer<typeof inviteTokenParamSchema>;

export const acceptInviteSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
