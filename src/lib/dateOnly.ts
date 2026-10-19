import { z } from 'zod';

/**
 * Plain accounting-date (no time-of-day, no timezone) helpers — introduced
 * for M16.1's `@db.Date` columns (financial year/cutover/as-of dates),
 * the first `@db.Date` usage in this schema (every other date column is a
 * full DateTime). A naive `new Date(str)`/`.toLocaleDateString()` round
 * trip is timezone-sensitive and can silently roll a calendar date
 * backward or forward a day depending on the server's or caller's
 * timezone — these helpers always operate in UTC explicitly so the same
 * "2026-07-01" goes in and comes back out regardless of where the process
 * or the reader happens to be.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A request-body field holding a plain calendar date — accepts only
 * "YYYY-MM-DD", never a full ISO timestamp (that would carry a spurious
 * time/timezone component this domain must never depend on). */
export const dateOnlySchema = z
  .string()
  .trim()
  .regex(DATE_ONLY_PATTERN, 'Expected a date in YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(parseDateOnly(value).getTime()), {
    message: 'Not a valid calendar date',
  });

/** "2026-07-01" -> a Date at UTC midnight on that day — safe to persist
 * directly into a `@db.Date` column. Never constructed via the
 * ambiguous/local-timezone `new Date(str)` form; always explicit UTC. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** The inverse of parseDateOnly — reads a `@db.Date` column's value (or
 * any Date known to represent a calendar date, not an instant) back out
 * as "YYYY-MM-DD" using its UTC fields, never `.toLocaleDateString()` or
 * any local-timezone-dependent formatting. */
export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
