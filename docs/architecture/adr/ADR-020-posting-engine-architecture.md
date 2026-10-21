# ADR-020: General ledger posting engine architecture

**Status:** Accepted · **Date:** 20 October 2026 · **Milestone:** M16.2.2

## Context

M16.2.2 needed a double-entry posting engine every future financial producer (levies, AP,
banking — M16.3+) will eventually call, without those producers needing to understand journal
mechanics themselves. The §7 implementation checklist (written at M16.2.1 closure) set the
working assumptions; this ADR records what was actually built and the decisions made while
implementing it.

## Decisions

**No `DRAFT` journal status.** A `JournalEntry` row's existence *is* posted state. Correction is
always a new, linked reversal entry (`reversalOfJournalId`, unique — a journal can be reversed at
most once). This matches the blueprint's immutable-history principle and avoids an entire class of
"was this actually posted?" bugs a draft/posted toggle would invite.

**One sole writer.** `LedgerPostingService` is the only code that creates `JournalEntry`/
`JournalLine` rows. Every other module calls `post()` with a typed `PostCommand`
(`sourceType`/`sourceId`/`sourceEventVersion`, `effectiveDate`, `narration`, `lines[]`) —
enforced by convention and code review today, the same bar every other "one service owns this
table" rule in this codebase already holds to (e.g. only `AccountsService` writes
`AccountingAccount`).

**Fund lives on the line, not the entry.** A single journal can legitimately touch more than one
fund (an inter-fund transfer). The safeguard "no silent cross-fund accounting" is enforced by
grouping a command's lines by fund and requiring each fund's own subtotal to independently balance
— *unless* the caller explicitly sets `allowCrossFund: true`. The public manual-journal API never
exposes that flag (`postManualJournalSchema` has no such field), so a manual entry can never
cross funds; only internal callers (today: `reverse()`, which sign-swaps an already fund-balanced
original and is therefore safe) can set it.

**`post()` and `reverse()` are each exactly one transaction.** Early in implementation, `reverse()`
called the public `post()` method and then made a *separate* call to link `reversalOfJournalId` —
this was caught and fixed before merging: it left a window where a reversal could post successfully
but fail to record its link if the process crashed in between. The fix factored the core logic into
a private `postInTransaction()` that both `post()` and `reverse()` run inside their own single
`$transaction` — posting, linking, and the audit record either all commit together or none do.

**Idempotency and concurrency share one mechanism.** `@@unique([propertyId, sourceType, sourceId,
sourceEventVersion])` is the same pattern already proven by `WaslSignWebhookEvent.eventId`. Every
write for a property is additionally serialized through a `SELECT ... FOR UPDATE` on its
`FinancialConfiguration` row — the identical lock `FinancialBudgetsService.activate` already uses
for the one-active-budget invariant. Two concurrent posts with the same source key therefore
cannot both decide "nothing exists yet": whichever acquires the lock first creates the journal;
the second, once unblocked, finds it and returns it unchanged. The database unique constraint is
kept as an independent backstop (caught and converted to "return the winner" rather than a raw
constraint error) in case that discipline is ever bypassed.

**`Decimal(14,2)` for every ledger column**, resolving the pre-existing `Decimal(12,2)`/
`Decimal(10,2)` split between `FinancialBudgetLine`/`FinancialOpeningBalance` and
`WorkOrder.estimatedCost`/`ContractorQuote.amount`.

## Consequences

- A future producer (levy issuance, supplier invoice posting) needs no new posting infrastructure
  — it resolves accounts via `PostingProfileService.resolve()` and calls
  `LedgerPostingService.post()`.
- Accounting periods are validated at the service layer under the same lock, not a database
  exclusion constraint — see ADR-021.
- Verified by 21 integration tests covering balanced/unbalanced posting, decimal precision,
  idempotent retries, true concurrent posting races, rollback on invalid references, closed-period
  rejection, reversal integrity (including a blocked second reversal), and cross-org/property/fund
  access.

## Alternatives considered

- **A `DRAFT` → `POSTED` journal lifecycle** (mirroring `FinancialBudget`) — rejected: a ledger
  entry has no meaningful "draft" state a user would want to edit before committing: a manual entry
  either balances and posts, or is rejected outright. Adding draft state would only add another
  place for an entry to silently never post.
- **A fund-agnostic `OPENING_BALANCE_EQUITY`-only journal line with no fund tag** — rejected because
  `JournalLine.financialFundId` is required by design (every line belongs to a real fund
  context); `OpeningJournalService` instead tags the equity side of each 2-line movement with the
  *same* fund as its paired line, so the per-fund balance check holds trivially without a special
  case.
