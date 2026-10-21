# ADR-024: Instalment-level levy issuance, budget-activation gate, and charge/trial-balance presentation

**Status:** Accepted · **Date:** 20 October 2026 · **Milestone:** M16.3 refinement pass (post-demo review)

## Context

A real end-to-end demonstration of M16.3 (Harbour View Strata, a fictional 12-lot NSW scheme)
surfaced six findings against the shipped levy workflow and its screens. This ADR records the
accounting-architecture decisions among them; the presentation-only changes (human-readable
labels, trial-balance formatting) are recorded here too since they follow directly from the same
review.

## Decisions

### 1. Regular levies must be backed by the ACTIVE budget, not merely an APPROVED one

`LevyService.deriveRegularTotal` previously accepted a budget in either `APPROVED` or `ACTIVE`
status. `APPROVED` is only a pre-activation checkpoint (`budgets.service.ts`'s own lifecycle:
`DRAFT -> APPROVED -> ACTIVE -> SUPERSEDED`) — nothing stops a second budget for the same
financial year also reaching `APPROVED` (e.g. a revision created and approved before its
predecessor was ever activated), so `APPROVED` alone does not reliably identify "the plan actually
operative for this year." Only `ACTIVE` does: a hand-written partial unique index enforces exactly
one `ACTIVE` budget per financial year, and activating a later revision automatically supersedes
whichever was `ACTIVE` before (`budgets.service.ts`'s `activate()`). A regular levy's total is
money that will actually be levied against owners — it must be traceable to that one, unambiguous
plan, never to a budget that merely passed approval at some point. **Tightened to require
`ACTIVE`.** This was found by observing the real demonstration: both levy schedules were issued
against budgets that had been approved but never explicitly activated, which is a real
accounting-lifecycle gap, not a demo-script oversight to simply paper over.

No migration was needed for this change (it only tightens a creation-time check); it does mean a
caller must now call `POST .../budgets/{id}/activate` after `approve`, which `createApprovedLevyBudget`-style test helpers and the frontend budget screen already expose as a distinct action.

### 2. Issuance is now per-instalment, not per-schedule — the NSW-compatible model

**Problem.** The original M16.3 design (ADR-022/023) posted one aggregated journal for a
schedule's ENTIRE set of instalments the moment it was issued — a quarterly schedule's four
instalments were all struck simultaneously, regardless of how far in the future the later ones
fell. Reviewed against NSW Strata Schemes Management Act 2015 s.81 (determining contributions) and
s.85 (interest on unpaid contributions, which accrues from EACH instalment's own due date): a
scheme's annual contribution is determined once (the budget), but each instalment is in practice
separately levied — struck and invoiced at its own time, so that a correction, an AGM decision to
bring a later instalment forward, or simply "not yet due" is possible without reissuing or
reversing the whole year. Posting all four quarters' receivables on day one does not reflect this,
and silently treats money not yet due as already receivable.

**Decision.** `LevyInstallment` is now the real issuance unit:

- New columns: `status` (`PENDING -> ISSUED -> REVERSED`, terminal), `issuedByUserId`, `issuedAt`,
  `journalEntryId` (the journal THIS instalment's issuance produced — not `@unique`, since the
  migration backfill below legitimately points more than one pre-ADR-024 instalment at the same
  shared journal), `reversedByUserId`, `reversedAt`, `reversalReason`.
- `LevyScheduleStatus` gains `PARTIALLY_ISSUED` and is now DERIVED from its instalments
  (`LevyService.computeScheduleStatus`): `APPROVED` while none are issued, `ISSUED` only once
  EVERY instalment is `ISSUED` (not merely "none left PENDING" — a schedule with one `ISSUED` and
  one `REVERSED` instalment is `PARTIALLY_ISSUED`, never `ISSUED`), `PARTIALLY_ISSUED` otherwise.
  `REVERSED` is now a legacy-only terminal value (see migration below) that no schedule reaches
  going forward.
- `POST .../levy-schedules/{id}/issue` issues exactly ONE instalment per call — the earliest
  `PENDING` one by default, or a specific one via an optional `levyInstallmentId` body field (an
  AGM may decide to bring a later instalment forward out of due-date order). Each call creates
  `LotLevyCharge` rows for ONLY that instalment and posts its own journal
  (`sourceId` = the instalment's own id, not the schedule's — the idempotency key moved down a
  level with the issuance unit). Calling with nothing left `PENDING` is an idempotent no-op
  (returns the schedule unchanged), matching the previous "re-issuing an ISSUED schedule is a
  no-op" contract at the new granularity.
- `POST .../levy-schedules/{id}/reverse` now requires `levyInstallmentId` and reverses only that
  instalment — every other instalment, issued or still pending, is completely unaffected. This
  uses `LedgerPostingService.reverseWithinTransaction` exactly as the whole-schedule version did
  (same lock-before-check discipline from the M16.3 closure review).
- `LevyService.cancel()` is blocked once ANY instalment has ever been issued, even if later
  reversed (`installments.some(i => i.issuedAt !== null)`) — real financial history exists by
  then, and cancelling would misrepresent it as "nothing was ever posted," even though the
  schedule's derived status may have fallen back to `APPROVED`.

**Migration (`20261020141640_m16_3_instalment_level_issuance`).** Adds the columns above and backfills
every PRE-existing `ISSUED`/`REVERSED` schedule's instalments from that schedule's own
`issuedByUserId`/`issuedAt`/`journalEntryId` (and `reversedByUserId`/`reversedAt`/`reversalReason`
for `REVERSED` schedules) — i.e. every instalment of an already-issued schedule is marked `ISSUED`
and pointed at the SAME shared journal that schedule's one aggregated posting produced, which is
factually what happened. **No existing posted journal, charge, or schedule record is rewritten,
deleted, or reissued** — the migration only adds descriptive detail to data that already exists,
satisfying "preserve existing financial history" without fabricating a per-instalment history that
was never actually posted.

`LevySchedule.issuedByUserId`/`issuedAt`/`journalEntryId`/`reversedByUserId`/`reversedAt`/
`reversalReason` and `LevyScheduleStatus.REVERSED` remain in the schema exactly as-is (never
rewritten) — they are now legacy-only, populated solely by that migration, never written by new
code.

### 3. Personalised levy notices — one Communication per charged lot

`Communication.body` is one field shared by every resolved recipient, with no per-recipient
merge-field templating. The original design's single shared Communication per issuance therefore
had to stay deliberately generic ("log in to see your charges"). To satisfy personalisation (lot,
fund, amount, due date) without adding a merge-field system to the Communications module — out of
scope for this pass — `sendLevyIssuanceNotice` now creates ONE Communication PER charged lot, each
`SPACE`-scoped to exactly that one `spaceId`, with a body containing that lot's own instalment
number, amount, and due date. This is `O(lots)` Communication rows per instalment issuance rather
than one — an accepted, explicit cost for genuinely personalised content on the existing model. A
per-lot failure is isolated (logged, skipped) and never affects any other lot's notice or the
already-posted levy.

### 4. Human-readable levy charges, owner-identity gating

`GET .../lot-levy-charges` previously returned only raw `spaceId`/`levyInstallmentId`/
`financialFundId` foreign keys. It now also returns `lotLabel` (lotNumber if recorded, else the
space's code/name — never the raw cuid), `fundName`, `levyScheduleName`, `installmentNumber`
(1-based), and `dueDate`. `ownerName` is additionally included, joined from `PropertyMembership`
rows with `role: 'OWNER'` on that lot — but ONLY when the caller independently holds `people.view`
on top of `financials.view`/`financials.approve` (checked in `levies.controller.ts` via
`authorizationService.can`, passed into the service as a plain boolean — the service itself holds
no authorization context). This mirrors the existing split between financial data and personal
identity used elsewhere in the codebase: a property manager with financial capabilities but not
`people.view` sees every dollar figure, never an owner's name. Co-owners' names are joined
(comma-separated) rather than arbitrarily picking one.

### 5. Trial balance: conventional Debit/Credit presentation and a fund filter

`GET .../trial-balance` previously returned only a signed `netBalance` (debit-positive) per
account — a credit-normal account (income, liability, equity) therefore showed a negative number,
which reads as "negative revenue" to a non-accountant reviewing the screen. Each row now also
carries `presentedSide` (`'DEBIT'`|`'CREDIT'`, the side the balance actually sits on — an
abnormally-signed account, e.g. a bank overdraft, is presented on its true side, not its
classification's textbook-normal side) and `presentedBalance` (always non-negative). `totalDebit`/
`totalCredit`/`netBalance` are unchanged for any caller relying on the raw figures. A new optional
`financialFundId` query parameter restricts the whole aggregation to one fund's `JournalLine` rows
— useful where an unrestricted account (GST Payable, Accounts Payable) carries balances from more
than one fund and a reviewer wants just one fund's slice; omitted, behaviour is unchanged (every
fund).

## Consequences

- Every existing M16.3 integration test exercising whole-schedule issue/reverse was rewritten for
  the per-instalment contract (helper functions `issueInstallment`/`reverseInstallment` replace
  `issueSchedule`/`reverseSchedule`'s old semantics; `createApprovedLevyBudget` now also activates).
  New tests cover: issuing a 4-instalment schedule one at a time (including out-of-order
  targeting), reversing one instalment without touching another, the cancel-after-issue-then-
  reverse guard, charge-view enrichment, `people.view` gating, and the trial-balance fund filter/
  presentation fields.
- `LevySchedule.journalEntryId`/`issuedAt`/`issuedByUserId`/`reversedAt`/`reversedByUserId`/
  `reversalReason` are frozen as legacy/migration-only fields; a future cleanup milestone could
  consider dropping them once no pre-ADR-024 data remains in any environment, but that is
  explicitly out of scope here (dropping columns with live historical data is never done casually).
- M16.4 (receipts/payments) still applies against `LotLevyCharge`, which is unaffected in shape by
  this ADR beyond the status-transition timing (a charge now only exists once its OWN instalment
  has been issued, not the whole schedule) — no forward dependency is broken.
