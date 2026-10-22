/**
 * M16.8 — the one place a UTC instant becomes a property-local calendar
 * date. Every DateTime column throughout this schema stays stored in UTC
 * (no change here) — only the day-boundary math for "is this lot overdue
 * as of today, in this property's own timezone" goes through this
 * function, via Intl.DateTimeFormat's real IANA tz-database support
 * (correctly DST-aware for Australia/Sydney's October/April transitions,
 * never a fixed UTC+10/+11 offset).
 */
export function formatDateInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}
