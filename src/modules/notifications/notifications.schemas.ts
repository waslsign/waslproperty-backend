import { z } from 'zod';

// z.coerce.boolean() is a footgun for query params: every query value
// arrives as a string, and JS's Boolean("false") is true — so a literal
// "?unreadOnly=false" would coerce to true. Parse the actual string instead.
const booleanQueryParam = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

export const notificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: booleanQueryParam,
  entityType: z.string().trim().min(1).optional(),
});
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
