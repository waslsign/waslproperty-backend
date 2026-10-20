# ADR-021: Ledger idempotency key, concurrency model, and period locking

**Status:** Accepted · **Date:** 20 October 2026 · **Milestone:** M16.2.2

## Context

The M16.2.2 brief required "no duplicate posting under retries or concurrent requests" and
"transactional posting service with idempotency, concurrency protection and rollback safety" as
hard safeguards, plus closed-period protection and non-overlapping accounting periods. This ADR
records the exact mechanism and its tested guarantees.

## Decisions

**Idempotency key.** `(propertyId, sourceType, sourceId, sourceEventVersion)`, unique on
`JournalEntry`. `sourceId` is caller-supplied (a future levy run's id, a specific manual
correction's generated UUID, `FinancialConfiguration.id` for the one-time opening journal).
`sourceEventVersion` (default 1) exists so a source event can legitimately post more than once
over its lifetime without colliding with its own prior posting — mirrors `FinancialBudget.version`'s
reasoning, not a new pattern.

**Concurrency protection via row lock, not optimistic retry.** Every posting (`post()`, and the
posting inside `reverse()`) takes `SELECT ... FOR UPDATE` on the property's
`FinancialConfiguration` row before touching `journal_entries`/`journal_lines` — identical to
`FinancialBudgetsService.activate`'s lock for the one-active-budget invariant and
`AccountingPeriodsService`'s lock for period non-overlap. This means **all** ledger-affecting
writes for one property serialize through a single lock: two concurrent `post()` calls, two
concurrent `close()`/`reopen()` calls, or a `post()` racing a `close()`, can never interleave in a
way that produces an inconsistent result. A concurrency test (`Promise.all` of two identical posts)
confirms exactly one `JournalEntry` row results and both HTTP responses return the same journal id.

**The database unique constraint is kept as an independent backstop**, not the primary mechanism —
if a `P2002` on the source key ever surfaces despite the lock (it shouldn't, given the lock
discipline above, but defense in depth matters for financial data), it is caught and the existing
winning journal is fetched and returned rather than raising a raw constraint error to the caller.

**Accounting-period non-overlap: service-level validation under the same lock, not a database
exclusion constraint.** A true Postgres exclusion constraint over a date range would need the
`btree_gist` extension, which this project doesn't otherwise depend on. Given every period mutation
already serializes through the `FinancialConfiguration` lock, a service-level check (read all
existing periods, verify no overlap, then insert) is equivalent in practice and avoids the new
dependency. This is a deliberate, documented trade-off, not an oversight — recorded in
`AccountingPeriod`'s own schema doc comment.

**Closed-period posting is rejected, never silently redirected.** `post()` resolves
`effectiveDate` to a covering `AccountingPeriod`; if none exists, or the one found is `CLOSED`,
the whole transaction is rejected (409) before any row is written — verified by a rollback test
asserting zero `JournalEntry` rows exist after the rejected attempt.

**Rollback safety is inherent, not bolted on.** Every validation (unbalanced totals, per-fund
imbalance, cross-property account/fund references, inactive account, missing/closed period) runs
*before* the `journalEntry.create` call, inside the same `$transaction` — a failure at any check
throws before any row is written, and Prisma's transaction wrapper rolls back anything already
staged. No manual compensation logic was needed; this is the same discipline every other financial
service in this codebase already follows (e.g. `FinancialsService.bulkSetLotOpeningPositions`).

## Closure verification addendum (20 October 2026)

A focused accounting-integrity review before closing M16.2.2 found one more instance of the same
class of bug this ADR already fixed once in `post()`/`reverse()`'s atomicity (see ADR-020): the
**"already reversed" check in `reverse()` ran before any lock was acquired** — the row lock only
happened later, inside the shared `postInTransaction()` core. Two concurrent `reverse()` calls for
the same original journal could both pass the "not yet reversed" check before either committed.
The idempotency key still prevented a second journal from being created (the losing call's
`postInTransaction` would find the winner's journal via the source key and return it), but the
losing call would then still re-run its own `reversalOfJournalId`/`reversalReason` update and
`recordActivity` call against that same winning journal — silently overwriting the first caller's
reversal reason with the second caller's, and duplicating the audit log entry.

**Fix:** `reverse()` now acquires the `FinancialConfiguration` row lock itself, *before* the
"already reversed" check, not after it. `postInTransaction`'s own lock acquisition later in the
same call is a harmless re-entrant no-op (Postgres row locks are reentrant within one
transaction). With the check now fully inside the lock, a genuinely concurrent second `reverse()`
call correctly sees the first call's committed reversal and is rejected (409) — it never reaches
the update/audit steps at all. Verified by a true `Promise.all` concurrency test: exactly one
reversal journal exists afterward, and its `reversalReason` matches whichever caller's response
actually returned 201 — never silently clobbered by the loser.

This is the same "lock before check, not lock during write" lesson as the rest of this ADR —
recorded here because it was found in the one place a lock-ordering review hadn't yet been applied
end-to-end.

## Consequences

- A future levy-issuance or AP-payment producer inherits all of this for free by calling
  `LedgerPostingService.post()` — it does not need to re-implement locking, idempotency, or
  rollback safety.
- The lock is coarse (per-property, not per-account or per-period) — acceptable at current
  expected posting volume (one strata scheme's transactions are not high-frequency), flagged here
  as the first thing to revisit if a future milestone's posting volume ever makes this a real
  throughput bottleneck.

## Alternatives considered

- **Optimistic concurrency (version column + retry loop)** on `JournalEntry` — rejected: would
  still need the idempotency unique constraint anyway, and a pessimistic lock on a row that's
  already read on every posting path is simpler to reason about for financial correctness than a
  retry loop that could, if implemented incorrectly, double-post under contention.
- **A separate `AccountingPeriod` database exclusion constraint via `btree_gist`** — rejected for
  now (see above); revisit only if period mutations ever need to happen outside the existing lock
  path.
