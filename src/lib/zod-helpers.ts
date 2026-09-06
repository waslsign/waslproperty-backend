import { z } from 'zod';

/**
 * Accepts either a single enum value or a comma-separated list of them, e.g.
 * `?status=NEW` or `?status=NEW,UNDER_REVIEW,IN_PROGRESS` — lets a dashboard
 * link deep-link into a list page pre-filtered by more than one status.
 */
export function csvEnum<T extends Record<string, string>>(enumObject: T) {
  return z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.split(',').map((v) => v.trim()))
    .pipe(z.array(z.nativeEnum(enumObject)).min(1));
}
