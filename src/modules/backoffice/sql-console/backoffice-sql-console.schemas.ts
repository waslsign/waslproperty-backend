import { z } from 'zod';
import { paginationQuerySchema } from '../../../lib/pagination.js';

export const executeSqlSchema = z.object({
  sql: z.string().trim().min(1, 'SQL text is required').max(20000),
  /** Required by the service for a mutating statement — optional here so a
   * plain SELECT never has to send one. */
  reason: z.string().trim().max(500).optional(),
  /** The typed confirmation phrase — "CONFIRM" for a mutating statement
   * outside production, "PRODUCTION" when NODE_ENV is production. Absent
   * for a read-only SELECT. */
  confirmationPhrase: z.string().trim().max(100).optional(),
});
export type ExecuteSqlInput = z.infer<typeof executeSqlSchema>;

export const sqlConsoleHistoryQuerySchema = paginationQuerySchema;
