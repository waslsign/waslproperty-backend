import type { z } from 'zod';
import { paginationQuerySchema } from '../../../lib/pagination.js';

export const backofficeUsersQuerySchema = paginationQuerySchema;
export type BackofficeUsersQuery = z.infer<typeof backofficeUsersQuerySchema>;
