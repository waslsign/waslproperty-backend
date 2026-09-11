import { z } from 'zod';

export const backofficeSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
});
export type BackofficeSearchQuery = z.infer<typeof backofficeSearchQuerySchema>;
