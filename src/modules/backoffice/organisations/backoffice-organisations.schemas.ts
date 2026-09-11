import { z } from 'zod';
import { paginationQuerySchema } from '../../../lib/pagination.js';

export const backofficeOrganisationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});
export type BackofficeOrganisationsQuery = z.infer<typeof backofficeOrganisationsQuerySchema>;

export const updateOrganisationSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  reason: z.string().trim().min(1).max(500),
});
export type UpdateOrganisationInput = z.infer<typeof updateOrganisationSchema>;
