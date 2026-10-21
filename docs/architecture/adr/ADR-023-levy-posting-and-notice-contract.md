# ADR-023: Levy posting contract, revenue derivation, and notice integration

**Status:** Accepted · **Date:** 20 October 2026 · **Milestone:** M16.3

## Context

M16.3 is the first real producer against M16.2.2's posting contract. Several decisions had to be
made that the M16.3 preparation checklist flagged but didn't fully resolve, plus one new reusable
addition to `LedgerPostingService` itself.

## Decisions

**`LedgerPostingService.postWithinTransaction` — the reusable contract M16.2.2 anticipated.**
`LevyService.issue()` needs its own `LotLevyCharge` subledger rows and the aggregate journal to
commit atomically together. Rather than duplicate any of `post()`'s validation/locking/idempotency
logic, a new public method exposes the same core (`postInTransaction`) to a caller that already
holds its own `Prisma.TransactionClient`. This is not a new write path — `LedgerPostingService`
remains the sole writer of journal tables; this is the same code, callable one transaction level
up. Documented as the pattern every future producer (AP, banking) should follow.

**One aggregated journal per issuance, not one line per lot.** Two lines (DEBIT
`LOT_LEVY_RECEIVABLE`, CREDIT `LEVY_INCOME`, both tagged with the schedule's fund) regardless of
lot count. `LotLevyCharge` rows, created in the same transaction, are the real per-lot subledger —
`SUM(LotLevyCharge.amount)` for a schedule reconciles exactly to the aggregate receivable line
(verified by test). This keeps journal volume small and matches standard practice: the GL carries
control-account totals, the subledger carries the detail.

**One fund per schedule.** A scheme's Administrative and Capital Works levies are always separate
`LevySchedule` rows. Combined with tagging both lines of every posting with that one fund, a
levy's own posting is trivially fund-balanced without needing the `allowCrossFund` escape hatch at
all (consistent with ADR-020's "no silent cross-fund accounting" design).

**Regular levy total is derived, never caller-supplied — and never assumed from "any revenue
line."** `LevyService.deriveRegularTotal` sums only the budget's `REVENUE` lines whose
`accountId` matches whatever account the posting profile currently resolves for `LEVY_INCOME` on
that fund. A revenue line with no `accountId`, or one linked to a different account (e.g.
interest-on-arrears income), is never included. If no such line exists, schedule creation is
rejected (422) rather than falling back to "sum every revenue line" — this is the concrete
implementation of the brief's "do not automatically assume every revenue budget line is levy
income" safeguard, and it reuses the M16.2.1 budget-line `accountId` field exactly as that
milestone's own doc comment anticipated.

**Special levies never derive from a budget.** Total = `SUM(installments.amount)`, with mandatory
`rationale` + `externalApprovalDate` (never in the future) — same non-fabrication discipline as
`FinancialBudget.externalApprovalDate`.

**Installments are explicit, caller-supplied input — never an invented equal-split policy.** This
milestone doesn't decide "quarterly vs. biannual vs. lump sum" on the scheme's behalf; the
manager enters due dates and amounts, validated to sum exactly to the schedule total.

**Preview is always recomputed live, never cached or reused at issue time.** `preview()` and
`issue()` both call the same `allocateSchedule`/`allocateByEntitlement` logic fresh from current
`Space.entitlementValue` data. They will produce byte-identical results **unless** entitlement
data genuinely changed between the two calls — a documented limitation, not a bug: issuance must
always reflect current data, never a stale snapshot a manager previewed minutes or days earlier.

**Levy notices bypass `CommunicationsService.create()`/`.send()`, writing a `Communication` row
directly instead (`levy-notices.ts`).** Those methods authorize against the *acting user's own*
`communications.manage`/`communications.send` capability via `assertAudienceWithinScope` — which
would wrongly require a manager who holds `financials.approve` to separately hold communications
permissions just to issue a levy. The right authorization question is "was this user allowed to
issue this levy" (already checked), not a second unrelated permission. This still reuses the exact
same `Communication`/`CommunicationRecipient` schema, `SPACE`-scoped audience resolution, and
`CommunicationDeliveryService` delivery pipeline — only the creation path's authorization differs.
One `Communication` per issuance (not one per lot), `SPACE`-scoped to every charged lot in one
call. The notice body is deliberately generic (no per-lot dollar figure) because this model has no
per-recipient merge-field templating — embedding one lot's amount in a message every other
recipient also receives would be actively misleading; recipients are directed to their own lot
ledger instead. **Documented limitation**, not solved this milestone: a templated, per-recipient
notice would need either a Communications-module enhancement or a levy-specific document-generation
step, neither of which this milestone builds.

**Notices are sent strictly after the issuance transaction commits**, and their failure is
swallowed (logged, returns `null`) rather than thrown — the concrete implementation of "notification
failure without duplicate financial postings." Verified by a direct test of `sendLevyIssuanceNotice`
with data guaranteed to fail, asserting it returns `null` without throwing and that the
already-issued levy is completely unaffected.

**Capability split:** draft/approve/cancel (pre-posting) = `financials.manage`; issue/reverse/adjust
(every write that touches posted ledger history) = `financials.approve` — the exact decision
recorded in the M16.3 preparation checklist (§8.6.18), applied consistently.

**Idempotency on adjustments.** `createAdjustment`'s journal posting is idempotent on `sourceId`
(client-supplied or server-generated, same convention as a manual journal); the `LevyAdjustment`
row itself is also checked for an existing match on `journalEntryId` before insert, so a retried
adjustment request returns the original row rather than throwing a raw unique-constraint error —
caught during implementation before any test exercised the gap.

## Consequences

- `PurchaseCommitment`/AP (M16.5) and banking (M16.6) can both reuse `postWithinTransaction` the
  same way `LevyService` does, without this ADR needing revisiting.
- A future "per-lot notice with exact figures" enhancement is additive — it does not require
  reworking how or when notices are triggered, only how their content is generated.

## Alternatives considered

- **Granting `financials.approve` holders an implicit `communications.send`** — rejected: conflates
  two genuinely different capabilities and would let a levy-approver send arbitrary announcements,
  far beyond what issuing a levy needs.
- **One `JournalLine` per lot** — rejected per ADR-020's own "aggregate at the fund level, subledger
  carries detail" precedent; would also make a 100-lot scheme's issuance journal unreadable.
