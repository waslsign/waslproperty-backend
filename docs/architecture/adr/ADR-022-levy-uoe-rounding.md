# ADR-022: Deterministic UOE cent allocation (levy rounding)

**Status:** Accepted · **Date:** 20 October 2026 · **Milestone:** M16.3

## Context

A levy's total must be split across lots in proportion to each lot's unit of entitlement (UOE),
and the per-lot amounts must sum **exactly** to the total — the "preview calculations must
reconcile exactly to issued amounts" and "lot-level allocation using `Space.entitlementValue`, with
exact Decimal arithmetic and deterministic cent rounding" requirements. A naive proportional split
(`total × entitlement / sumEntitlement`, rounded to cents per lot) will not generally sum back to
the total — rounding error of up to half a cent per lot accumulates.

## Decision

**Largest-remainder method (Hamilton's method of apportionment)**, implemented in
`levy-allocation.ts`'s `allocateByEntitlement`, operating entirely in integer cents via
`Prisma.Decimal`:

1. Compute each lot's exact raw cent share (`totalCents × entitlement / sumEntitlement`), full
   Decimal precision, no premature rounding.
2. Floor each to whole cents; sum the floors.
3. The difference between the total and the sum of floors is the number of leftover cents (always
   a small non-negative integer, less than the number of lots).
4. Distribute one leftover cent each to the lots with the **largest fractional remainder**, in
   descending order.
5. **Tie-break: ascending `spaceId`** (never insertion order, which would make the result depend on
   how the caller happened to list the lots, and never the entitlement value itself, which is
   exactly where ties are most common — many schemes have several lots with identical
   entitlement).

This is a well-established, standard apportionment method (used for parliamentary seat
allocation, among other applications) — not a bespoke algorithm invented for this milestone. It
guarantees `SUM(result) === totalAmount` exactly, every time, with a fully deterministic result
for a given input (same entries, same order, same amounts in, same amounts out — critical for
preview-equals-issued, see ADR-023).

## Consequences

- Zero or negative aggregate UOE, or any individual negative entitlement, throws a `ValidationError`
  before any allocation is attempted — never divides unsafely or silently allocates zero (the
  "handle zero or invalid aggregate UOE safely" safeguard).
- A non-integer-cent `totalAmount` (sub-cent money) is rejected outright rather than silently
  rounded away.
- Verified by two tests against the real 33/33/34-UOE three-lot stress case: an evenly-divisible
  total ($100 → $33.00/$33.00/$34.00 exactly) and an odd-cent total ($100.01) that forces the
  residual-distribution path, both asserting the sum invariant exactly.

## Alternatives considered

- **"Last lot absorbs the rounding error"** — rejected: arbitrary, not proportional, and
  systematically biased against whichever lot happens to be listed last.
- **Banker's rounding per lot with a manual balancing entry** — rejected: adds an extra journal
  line or a fabricated "rounding adjustment" account with no real meaning to an owner, when the
  largest-remainder method achieves exact reconciliation with no such artifact.
