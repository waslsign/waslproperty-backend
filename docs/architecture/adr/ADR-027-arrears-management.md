# ADR-027: Arrears calculation as a derived view, and collection workflow as the only persisted state

**Status:** Accepted · **Date:** 21 October 2026 · **Milestone:** M16.6

## Context

M16.5 (ADR-026) gave WaslProp real receipts, payment allocations, unapplied cash, and a
`LotLevyCharge.status` that actually reflects payment state (ISSUED/PART_PAID/PAID). M16.6 needs
to tell a strata manager which charges are now overdue, by how much and for how long, and let them
run a manual (never automatic) collection workflow against that — without inventing a second
arrears ledger that could drift from the GL/subledger ADR-025/026 already established as the single
source of truth.

## Decision

**Arrears figures are computed, never stored.** Every overdue amount, ageing bucket, and
property/fund-level total is derived live from `LotLevyCharge`, `LevyAdjustment`,
`PaymentAllocation`, `LevyInstallment` and `Receipt` — the exact same records M16.4/M16.5 already
read. No `LotArrearsBalance` table, no cached "current overdue amount" column anywhere. Only the
*collection workflow* — a human process layered on top of the numbers, not a financial fact —
gets new tables: `CollectionCase`, `CollectionNote`, `PaymentReminder`.

**Outstanding, overdue, and ageing — definitions.**

- **Outstanding** (a charge): `effectiveAmount - SUM(APPLIED allocations)`, where
  `effectiveAmount = charge.amount + SUM(signed LevyAdjustment.amount)` — the exact same formula
  `receipts.service.ts`'s `chargeOutstanding` already uses for allocation validation (ADR-026). A
  positive adjustment increases what's owing, a negative one decreases it; this milestone makes no
  assumption that an adjustment always increases the balance.
- **Overdue** (a charge), as of a given date: issued (trivially true — a `LotLevyCharge` row only
  ever exists once its instalment has been issued, ADR-024), its instalment's `dueDate` is earlier
  than the as-of date, its outstanding balance is strictly positive, and its instalment has not
  been reversed (a reversed instalment's charges are `CANCELLED` and carry zero outstanding by
  construction — see `chargeOutstanding`). A charge that is `PART_PAID` can still be overdue (only
  its *remaining* balance counts); a `PAID` charge never is (outstanding is zero).
- **Current / not-yet-due**: issued, outstanding > 0, due date on or after the as-of date.
- **Ageing bucket**: `asOfDate - dueDate` in days, bucketed `CURRENT` (not yet due) /
  `1–30` / `31–60` / `61–90` / `90+`. Always keyed to the **due date**, never the charge's
  `createdAt`/issuance date — a levy issued late is not thereby "younger" in arrears terms.
- **Unapplied owner credit**: a `RECORDED` receipt's `unappliedAmount` (ADR-026). Never netted into
  a charge's outstanding balance and never assumed allocated — a manager must allocate it
  explicitly (ADR-026's own "never force-allocated" rule carries over unchanged). Reported as its
  own total, separate from overdue/outstanding, at both lot and property level.
- **Net owner financial position**: the lot's `currentBalance` as M16.4/M16.5 already compute it
  (`LotLedgerService.getFinancialAccount`) — issued charges, less reversals, plus/minus
  adjustments, less receipts (applied and unapplied alike). M16.6 reuses this figure rather than
  recomputing it; it is explicitly **not** the same number as "total overdue" (a lot can be
  AMOUNT_OWING overall while having zero overdue charges, if everything owing isn't yet due).
- **Collection workflow status**: a `CollectionCase`'s own `status` — entirely independent of the
  financial calculation above. A lot can be financially current with an open collection case (a
  payment plan being monitored) and, symmetrically, heavily overdue with no case opened yet.

**`LotLevyCharge.status`'s reserved `OVERDUE` value stays permanently unused.** It was reserved
back in M16.3 ("modelled now so a receipts milestone can drive them without a schema change") but
"overdue" is a point-in-time classification relative to an as-of date, while `status` is a single
stored value — a charge cannot be simultaneously `PART_PAID` (a real, stored payment fact) and
`OVERDUE` (a derived, date-relative fact) in one enum slot without one silently overwriting the
other every time the clock ticks past midnight with no new event to trigger a write. M16.6 computes
"is this overdue, as of when" entirely in the service layer, same discipline as `LotLedgerRowType`/
`LotBalanceClassification` (TS unions, never Prisma enums, in ADR-025/026) — never writes to this
column. Documented here so a future reader doesn't wonder why a clearly-reserved value is dead.

**As-of date handling, and real historical reconstruction.** Every arrears endpoint accepts an
optional `asOfDate` (defaults to today, plain `DATE`, same no-timezone convention `LevyInstallment.
dueDate`/`Receipt.receiptDate` already use — there is no scheme-local timezone concept anywhere in
this system to be more precise than that). For a date other than today, the calculation
reconstructs the position **as it actually stood on that date**, not today's allocations applied
retroactively:

- A charge is included only if its instalment's `issuedAt` falls on or before the as-of date (it
  didn't exist yet, financially, before that).
- A charge counts as cancelled-as-of only if its instalment's `reversedAt` falls on or before the
  as-of date (a later reversal doesn't erase an earlier historical overdue position).
- Only `LevyAdjustment`s created on or before the as-of date count toward `effectiveAmount`.
- Only `PaymentAllocation`s created on or before the as-of date count as applied — and one that was
  later reversed only stops counting once its own `reversedAt` falls on or before the as-of date
  (an allocation reversed *after* the as-of date still reduced the balance as of that date).

This is real effective-dated reconstruction, not a shortcut — every input it needs
(`issuedAt`/`reversedAt`/`createdAt`/`reversedAt`) already exists on the tables M16.3–M16.5 built,
so implementing it correctly costs no new columns. "As of today" is simply the general case where
nothing has a future timestamp, so there is only one code path, not two.

**Opening balances are never classified as overdue.** `LotOpeningPosition` (M16.1) carries an
`amountOwing`/`creditBalance` with no originating levy, no due date, no fund attribution — exactly
as ADR-025 already established for the Lot Ledger. M16.6 reports it as its own, clearly-labelled
`openingBalance` field on the lot arrears detail (amount, `asOfDate` it was recorded at) —
**never** merged into the aged-charges list, never assigned a fabricated due date or ageing bucket,
never counted into "total overdue." A manager sees it as "this much is owed from before this
system's cutover, with no further ageing detail available" — an honest gap, not a guessed one.

**NSW-specific scope — explicitly deferred.** No interest calculation, no statutory notice
generation, no debt-recovery charges, no enforcement actions. `WaslProp_Complete_Financial_
Requirements_Option_B.md` and the existing ADRs record no explicit client-approved NSW interest
rate, notice period, or recovery-fee schedule — inventing one here would violate the same
"assumptions must be stated, not invented" rule ADR-018/023 already establish for levy rounding
and posting rules. **Unresolved, recorded for a future milestone / client confirmation:**
(1) the NSW *Strata Schemes Management Act 2015*'s interest-on-arrears provisions and whether/how
this scheme's by-laws opt into them; (2) any statutory notice-before-action requirement and its
minimum period; (3) whether recovery costs may be charged back to the lot and how they'd post.

**Collection workflow — reversible, non-ledger state, gated on `financials.manage`.**
`CollectionCase`/`CollectionNote`/`PaymentReminder` never touch `JournalEntry`/`JournalLine` and
never require `financials.approve` (reserved for immutable-ledger actions per that capability's own
doc comment) — they're reversible workflow records, the same tier as a budget draft or an account
definition, so `financials.manage` is the right gate, with `financials.view` for read-only access
to the summary/register/lot-detail and case/reminder content. `people.view` continues to gate
`ownerName` independently, same split as every other financials endpoint since M16.3.

**Reminders are drafted, never sent.** `PaymentReminder.status` only ever reaches `DRAFT` or
`CANCELLED` in this milestone — there is no dispatch path, no email is ever sent, automatically or
otherwise. The existing `communications` module (announcements) is deliberately **not** reused
here: it has a real SMTP delivery path behind it, and this session's own standing guidance is to
never exercise that pipeline outside an explicit, approved send. A reminder's `content` is
generated and stored as a point-in-time **snapshot** (the charges and amounts as understood when
drafted) purely for display/preview — never read back as current arrears truth; the live arrears
endpoints remain the only source of "what's actually owed right now." `SENT`/`FAILED` reminder
statuses are reserved in the enum for a future, explicitly-authorised dispatch milestone and are
never set by this one.

## Consequences

- Arrears can never drift from the GL/subledger, because it has no storage of its own to drift
  from — same guarantee ADR-025 gives the Lot Ledger, extended to a property-wide, ageing-aware
  view.
- Historical ageing ("what did arrears look like on 1 September?") is genuinely correct, not a
  today-only approximation silently mislabelled as historical.
- A future interest/notice/recovery milestone has a clean foundation (real overdue amounts, real
  ageing, a case to attach a notice/interest line to) without this milestone having guessed at any
  of those numbers.
- Computing live over every charge/adjustment/allocation on every request is the same bounded-size
  argument ADR-025 already relies on (a scheme's lot/charge count is small); if that bound is ever
  lifted, this would need revisiting the same way ADR-025 flags for itself.

## Alternatives considered

- **A persisted `LotArrearsBalance`/`current overdue` column, recalculated on a schedule.**
  Rejected: duplicates the same "second ledger that can drift" risk ADR-025/026 already rejected,
  and buys nothing at this scale.
- **Writing `LotLevyCharge.status = OVERDUE`.** Rejected: a stored status cannot represent two
  independent, simultaneously-true facts (payment state and date-relative overdue state) in one
  enum slot without one clobbering the other on every day boundary — see the dedicated section
  above.
- **Approximating historical ageing from today's state.** Rejected: the task explicitly calls this
  out as a known trap, and the real effective-dated reconstruction is achievable with the columns
  already in place — there was no good reason to ship the wrong answer when the right one costs no
  schema change.
- **Reusing the `communications` module for reminders.** Rejected for this milestone: it has a real
  delivery path, and the risk of accidentally exercising it outweighs the convenience; a
  purpose-built, send-less draft model is safer and still satisfies the requirement ("drafting and
  preview only").
