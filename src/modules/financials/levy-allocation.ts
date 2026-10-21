import { Prisma } from '@prisma/client';
import { ValidationError } from '../../errors/AppError.js';

/**
 * M16.3 — deterministic UOE (unit-of-entitlement) cent allocation. See
 * docs/architecture/adr/ADR-022 for the rationale: the largest-remainder
 * method (Hamilton's method of apportionment), operating entirely in
 * integer cents via Prisma.Decimal, so `SUM(result) === totalAmount`
 * exactly, every time, with a stable deterministic tie-break — never an
 * arbitrary "last lot absorbs the rounding error" fudge.
 */

export interface EntitlementEntry {
  /** A stable, deterministic sort key for tie-breaking (e.g. spaceId) —
   * never the entitlement value itself, which is exactly where ties are
   * most likely to occur (many schemes have several lots with identical
   * entitlement). */
  key: string;
  entitlementValue: Prisma.Decimal;
}

/**
 * Splits `totalAmount` across `entries` in proportion to each entry's
 * `entitlementValue`, returning a Map<key, Decimal> whose values sum
 * exactly to `totalAmount`. Throws ValidationError (never silently
 * allocates zero or divides unsafely) if the aggregate entitlement is zero
 * or negative, or if `entries` is empty — the "handle zero or invalid
 * aggregate UOE safely" safeguard.
 */
export function allocateByEntitlement(
  totalAmount: Prisma.Decimal,
  entries: EntitlementEntry[],
): Map<string, Prisma.Decimal> {
  if (entries.length === 0) {
    throw new ValidationError('Cannot allocate a levy with no lots to allocate against.');
  }
  const sumEntitlement = entries.reduce(
    (sum, e) => sum.plus(e.entitlementValue),
    new Prisma.Decimal(0),
  );
  if (sumEntitlement.lte(0)) {
    throw new ValidationError(
      'Total unit-of-entitlement across these lots is zero or negative — cannot allocate a levy. ' +
        'Confirm every lot has a valid entitlementValue recorded.',
    );
  }
  for (const entry of entries) {
    if (entry.entitlementValue.lt(0)) {
      throw new ValidationError(`Lot ${entry.key} has a negative entitlementValue — cannot allocate a levy.`);
    }
  }

  const totalCents = totalAmount.times(100);
  if (!totalCents.isInteger()) {
    // totalAmount must already be a valid Decimal(14,2) — a non-integer
    // cent total means a caller passed a sub-cent amount, which must never
    // silently round away real money.
    throw new ValidationError('totalAmount must be a whole number of cents.');
  }

  const rawCents = entries.map((e) => ({
    key: e.key,
    raw: totalCents.times(e.entitlementValue).dividedBy(sumEntitlement),
  }));
  const floors = rawCents.map(({ key, raw }) => ({
    key,
    floorCents: raw.floor(),
    remainder: raw.minus(raw.floor()),
  }));

  const sumFloors = floors.reduce((sum, f) => sum.plus(f.floorCents), new Prisma.Decimal(0));
  const leftoverCents = totalCents.minus(sumFloors).toNumber();

  // Stable, deterministic tie-break: largest remainder first; ties broken
  // by ascending key (never insertion order, which would make the result
  // depend on how the caller happened to list the lots).
  const ordered = [...floors].sort((a, b) => {
    const byRemainder = b.remainder.comparedTo(a.remainder);
    if (byRemainder !== 0) return byRemainder;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const result = new Map<string, Prisma.Decimal>();
  for (const [index, { key, floorCents }] of ordered.entries()) {
    const cents = index < leftoverCents ? floorCents.plus(1) : floorCents;
    result.set(key, cents.dividedBy(100).toDecimalPlaces(2));
  }

  return result;
}
