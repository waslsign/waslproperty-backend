import { z } from 'zod';

export const platformLoginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;
