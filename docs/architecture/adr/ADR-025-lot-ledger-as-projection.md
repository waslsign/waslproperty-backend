# ADR-025: Lot Ledger as a read-only projection, not a second ledger

**Status:** Accepted · **Date:** 21 October 2026 · **Milestone:** M16.4

## Context

M16.4 needs to give a strata manager a reliable, auditable financial account for every lot —
opening position, issued levy charges, reversals, adjustments, outstanding balance, and a
chronological transaction history. The General Ledger (`JournalEntry`/`JournalLine`) remains the
accounting source of truth, but its lines are posted at the aggregate fund level (ADR-023: one
aggregated journal per issuance, never one line per lot) — there is no `spaceId` on `JournalLine`
at all. Lot-level detail only exists in `LotLevyCharge` (M16.3, ADR-024) and `LevyAdjustment`.

## Decision

**No new persisted subledger table.** `LotLedgerService` (`lot-ledger.service.ts`) builds a lot's
full transaction history live, on every request, by reading three already-authoritative sources —
`LotOpeningPosition`, `LotLevyCharge` (with its `levySchedule`/`levyInstallment`/`fund`/
`adjustments` relations), and nothing else. A lot's complete history is bounded by construction
(one opening row, at most one `LotLevyCharge` per instalment ever issued against that lot, plus
its adjustments) — realistically tens to low hundreds of rows even for a long-lived scheme, never
unbounded the way a whole-property journal list could be. That bound is exactly why deriving this
live, every time, is both correct and performant: there is nothing to cache, backfill, or
reconcile against the GL after the fact — the source records themselves ARE the ledger. This
mirrors the General Ledger's own "no independently-maintained running balance" discipline
(ADR-018) one level down, at the lot scope.

**Sign convention.** A debit increases the lot's receivable (amount owing); a credit decreases it.
Opening position: `debit = LotOpeningPosition.amountOwing`, `credit = LotOpeningPosition.creditBalance`
— shown as two separate rows-worth-of-value, never netted into one signed opening number (mirrors
`LotOpeningPosition`'s own "never one signed number" doc comment, M16.1). A levy charge is a debit
for its full face value (`LotLevyCharge.amount`, never `effectiveAmount` — adjustments get their own
rows so nothing is double-counted). A reversal is a **separate row**, a credit for that same face
value, keyed to the original charge's reference — never a mutation of the charge row, which stays
exactly as issued. The two net to zero together without the service ever needing to special-case
"skip CANCELLED charges" when computing a balance — the arithmetic does that for free. A positive
`LevyAdjustment` is a debit; a negative one is a credit (mirrors the signed journal
`LevyService.createAdjustment` itself posts).

**Fund attribution is honest, not invented.** Every `LotLevyCharge`/`LevyAdjustment` row carries a
real fund (inherited from the charge's `financialFundId`, which ADR-023 guarantees matches the
schedule's one fund). `LotOpeningPosition` has no fund column at all — it is a scheme-wide
migration snapshot. The opening row is reported with `financialFundId: null` and excluded from the
per-fund breakdown; it is never defaulted onto the Administration fund or any other fund.

**Ordering and pagination.** Rows sort by `(date ASC, a fixed type priority ASC, id ASC)` —
OPENING=0, CHARGE=1, ADJUSTMENT=2, REVERSAL=3 — for a deterministic same-day reading order. The
running balance is computed over the lot's *complete* row set first, in memory, and the requested
page is sliced out of that already-correct sequence afterward. A database-level `OFFSET`/cursor
would be blind to every row outside its own page when computing a running total; given this
service's bounded-size guarantee above, computing the full sequence per request is the simple,
obviously-correct choice over a materialized running balance or a window-function trick the
problem does not need.

**Opening-position mutability.** Unchanged from M16.1: `LotOpeningPosition` is editable only while
`FinancialConfiguration.status` is `SETUP_IN_PROGRESS`. This ADR does not add any new write path to
it.

## Consequences

- No migration was required for M16.4 — every field the Lot Ledger needs already exists.
- The Lot Ledger can never drift from the GL/subledger it reads, because it has no storage of its
  own to drift from.
- If a lot's transaction volume were ever to become genuinely unbounded (it is not today — see the
  bound above), this approach would need revisiting in favour of a materialized projection with its
  own reconciliation job. That is explicitly out of scope for M16.4.
- A future payments/receipts milestone (M16.5+) that wants to show a lot's payment history would
  extend this same service with one more row type, following the same "derive from authoritative
  records, never invent a second ledger" discipline — it should NOT retrofit a payment concept into
  this ADR's row model without its own accounting-design pass.

## Alternatives considered

- **A persisted `LotLedgerEntry` table, written alongside `LotLevyCharge`/`LevyAdjustment`.**
  Rejected: it would duplicate every financial event into a second place that could silently drift
  from the real postings, and buys nothing given the bounded-size guarantee above — the exact
  "do not introduce a second accounting ledger" risk this milestone's brief explicitly warns
  against.
- **Collapsing a reversed charge's row instead of adding a separate reversal row.** Rejected: it
  would violate "reversed levy charges must remain visible, with traceable reversal references" —
  the charge must stay visible exactly as issued, with the reversal as its own auditable event.
