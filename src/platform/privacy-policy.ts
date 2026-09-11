import { env } from '../config/env.js';

/**
 * The only PII fields that actually exist in the schema today — hand-
 * maintained, not inferred, so it's a deliberate decision to classify a
 * field, not a guess. A test asserts every plausibly-PII-named column on
 * these models is accounted for here, as a tripwire against a new field
 * being added without ever being classified.
 */
export const PII_FIELDS: Record<string, readonly string[]> = {
  User: ['email'],
  PropertyContact: ['email', 'phone'],
  Contractor: ['email', 'phone'],
};

/** Fields that must never be returned to the Backoffice under any role or
 * environment — not masked, simply never serialized. */
export const SECRET_FIELDS: Record<string, readonly string[]> = {
  User: ['passwordHash'],
  Session: ['refreshTokenHash'],
  ContactInvite: ['tokenHash'],
};

/**
 * Masked in production by default, and fails closed on anything
 * ambiguous — an invalid/missing BACKOFFICE_PII_MODE in production still
 * means masked, never a silent fall-through to full visibility.
 */
export function resolveGeneralPiiMode(): 'masked' | 'full' {
  if (env.NODE_ENV === 'production') {
    return env.BACKOFFICE_PII_MODE === 'full' ? 'full' : 'masked';
  }
  return env.BACKOFFICE_PII_MODE === 'masked' ? 'masked' : 'full';
}

/**
 * Whether unmasked PII may be shown to THIS actor on a general Backoffice
 * surface (Organisation 360 / User 360 / search / Data Explorer) — requires
 * both the `pii.view` capability and the environment policy allowing it.
 * Raw SQL has its own, separate gate — see resolveSqlUnmaskedPiiAllowed.
 */
export function canViewUnmaskedPii(capabilities: readonly string[]): boolean {
  return capabilities.includes('pii.view') && resolveGeneralPiiMode() === 'full';
}

/**
 * Whether raw SQL SELECT results may return unmasked PII to THIS actor —
 * deliberately independent of resolveGeneralPiiMode/canViewUnmaskedPii:
 * flipping the general policy must never silently unmask SQL results too,
 * and vice versa. Requires both the SQL-specific capability and the
 * SQL-specific config switch.
 */
export function canViewUnmaskedPiiInSql(capabilities: readonly string[]): boolean {
  return (
    capabilities.includes('database.sql.pii.unmasked') &&
    env.BACKOFFICE_RAW_SQL_UNMASKED_PII_ENABLED
  );
}

function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  return `${value[0]}***${value.slice(at)}`;
}

function maskPhone(value: string): string {
  if (value.length <= 4) return '***';
  return `${value.slice(0, Math.max(3, value.length - 6))}${'*'.repeat(3)}${value.slice(-3)}`;
}

function maskField(field: string, value: string): string {
  if (field.toLowerCase().includes('email')) return maskEmail(value);
  if (field.toLowerCase().includes('phone')) return maskPhone(value);
  return `${value[0] ?? ''}***`;
}

/**
 * Masks a record's classified PII fields in place (returns a new object —
 * never mutates the input). This is the ONLY function that should ever
 * decide whether a PII value leaves the process unmasked; every Backoffice
 * surface that returns User/PropertyContact-shaped data must route through
 * it, including raw SQL result serialization (Phase F).
 */
export function maskPiiFields<T extends Record<string, unknown>>(
  modelName: string,
  record: T,
  capabilities: readonly string[],
): T {
  const fields = PII_FIELDS[modelName];
  if (!fields || fields.length === 0) return record;
  if (canViewUnmaskedPii(capabilities)) return record;

  const masked: Record<string, unknown> = { ...record };
  for (const field of fields) {
    const value = masked[field];
    if (typeof value === 'string' && value.length > 0) {
      masked[field] = maskField(field, value);
    }
  }
  return masked as T;
}
