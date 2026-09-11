import { z } from 'zod';
import { paginationQuerySchema } from '../../../lib/pagination.js';

export const dataExplorerListQuerySchema = paginationQuerySchema.extend({
  /** JSON-encoded object of {field: value} — validated field-by-field
   * against the model's own metadata in the service, never trusted as-is. */
  filters: z.string().trim().min(1).optional(),
});
export type DataExplorerListQuery = z.infer<typeof dataExplorerListQuerySchema>;

export const dataExplorerUpdateSchema = z.object({
  changes: z.record(z.string(), z.unknown()).refine((c) => Object.keys(c).length > 0, {
    message: 'At least one field change is required',
  }),
  reason: z.string().trim().min(1).max(500),
});
export type DataExplorerUpdateInput = z.infer<typeof dataExplorerUpdateSchema>;

export const dataExplorerDeleteSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type DataExplorerDeleteInput = z.infer<typeof dataExplorerDeleteSchema>;
