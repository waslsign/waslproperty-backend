# ADR-026: Receipts and Payment Allocation as two separate posting events

**Status:** Accepted · **Date:** 21 October 2026 · **Milestone:** M16.5

## Context

M16.4 (ADR-024, ADR-025) gave strata managers an auditable lot-level view of issued levy
charges, but WaslProp had no model yet for the money owners actually pay. M16.5 needs to let a
manager record a receipt, apply it against one or more `LotLevyCharge`s, and keep the owner's
lot account accurate — without inventing a second accounting system alongside the General Ledger
(`JournalEntry`/`JournalLine`, ADR-020) or the Lot Ledger projection (ADR-025).

`PostingRole` already carried `UNAPPLIED_CASH` and `INTER_FUND_TRANSFER` values from M16.1,
unused until now — the schema anticipated this milestone's shape before it was built.
`LevyChargeStatus` already defined `PART_PAID`/`PAID`/`OVERDUE` with a doc comment stating they
would be "modelled now so a receipts milestone can drive them without a schema change."

## Decision

**A receipt and its allocation are two separate events, each with its own journal.** A `Receipt`
is the cash event: money arrived, from a specific owner/lot, into a specific bank/cash account,
on a specific date, by a specific method. Recording one always posts exactly one journal,
unconditionally — **Dr fund cash (`FUND_CASH`) / Cr unapplied cash (`UNAPPLIED_CASH`)** — whether
or not it is allocated to anything yet. This is the only path by which a receipt's cash enters
the books. A `PaymentAllocation` is the separate act of applying part or all of a receipt's
balance to one `LotLevyCharge`; it posts its own journal — **Dr unapplied cash / Cr the fund's
lot-levy-receivable** — for the allocation's own amount. Even when a receipt is allocated "at the
same time" it is recorded (the common case), these are two separate journals, never one combined
posting — so either side can be reversed independently, each with its own traceable reference,
without touching the other.

**`UNAPPLIED_CASH` is the clearing account, and it is also the "advance payment" state.** A
receipt with nothing yet allocated sits in `UNAPPLIED_CASH` exactly as an advance/prepayment
would — no separate "prepayment" model was built, because none is needed: an unallocated
`Receipt` already IS that state, correctly represented in the GL. Allocating it later — in full,
in part, immediately, or months afterward — is the same `PaymentAllocation` posting regardless of
timing. This also answers "allocation of previously unapplied cash" (Phase 3.C.4 of this
milestone's brief): it is not a different code path from ordinary allocation, only a later call to
the same one.

**Cross-fund allocation is rejected, not implemented.** `createAllocation`/`recordReceipt`
throw `ConflictError` if `charge.financialFundId !== receipt.financialFundId`. ADR-020 already
forbids silent cross-fund netting; this milestone does not introduce an inter-fund transfer
mechanism (the `INTER_FUND_TRANSFER` posting role some future milestone would need remains
unused), so the honest answer for "where permitted" is "not yet" — recorded here as an explicit
gap rather than guessed at. A manager who receives one cheque covering both an Admin Fund and a
Capital Works Fund levy must record it as separate receipts against the matching funds.

**The Lot Ledger renders a `PAYMENT_ALLOCATION` row at zero, deliberately.** At the owner-facing
Lot Ledger (ADR-025), a `RECEIPT` row carries the real credit (`credit = receipt.amount`). A
`PAYMENT_ALLOCATION` row is always shown with **debit = 0.00, credit = 0.00** — purely
informational ("$X of RCT-… applied to LVC-…") — because the money was already counted once on
the `RECEIPT` row; giving the allocation row its own nonzero value would double-count the same
cash in the lot's running balance. This is a Lot Ledger *presentation* rule only — the underlying
GL postings for both events are full, real journal lines; nothing is zeroed at the ledger.

**Default automatic-allocation order is oldest-due-date-first.** When a manager opts into
`autoAllocate` instead of manually choosing charges, allocation walks the lot's outstanding
(`ISSUED`/`PART_PAID`) charges in the same fund as the receipt, ordered by
`levyInstallment.dueDate ASC, sortOrder ASC`, applying as much of the receipt as each charge can
absorb before moving to the next. This is standard ageing-first accounts-receivable practice.
Any balance left over after every outstanding charge in that fund is satisfied stays unapplied —
auto-allocation never force-allocates past what is actually owed, and never touches a different
fund's charges.

**`LotLevyCharge.status` is now driven by allocations, using the field's own anticipated
values.** `updateChargeStatus` recomputes `effectiveAmount` (face value + adjustments) versus the
sum of `APPLIED` allocations after every allocation or reversal, and writes `ISSUED` (nothing
applied), `PART_PAID`, or `PAID` — never touching a `CANCELLED` charge. No new field was added; the
enum values already existed for exactly this purpose.

**Reversal is staged, mirroring the levy-schedule discipline.** A `Receipt` with any still-
`APPLIED` allocation cannot be reversed directly — `reverseReceipt` throws `ConflictError`
directing the caller to reverse every allocation first. This mirrors `LevySchedule.cancel()`'s
"blocked once anything has ever issued" rule: an event cannot disappear out from under something
still depending on it. Reversing a `PaymentAllocation` posts its own balancing journal against
*its own* journal only (never the receipt's cash journal) and recomputes the charge's status.
Both reversal paths are guarded in `LedgerPostingService.reverseInTransaction`'s
`SUBLEDGER_SOURCE_TYPES` set (alongside the pre-existing levy guard) so a Receipt/PaymentAllocation
journal can never be reversed through the generic manual-journal endpoint, leaving
`Receipt.status`/`PaymentAllocation.status`/`LotLevyCharge.status` out of sync with the GL.

**Idempotency and concurrency reuse existing mechanisms, not new ones.** Both `recordReceipt`
and `createAllocation` accept an optional `idempotencyKey` (defaulting to a generated UUID),
checked the same way `LevyService.createAdjustment` already does — by looking up an existing
journal for the same key before posting a new one. Both acquire the same
`SELECT … FOR UPDATE` lock on the property's `financial_configurations` row used throughout the
financials module, so two concurrent allocation requests against the same receipt or charge
serialize rather than race past each other's balance checks.

## Consequences

- Money received, money applied, and money still unapplied are three independently queryable,
  independently reversible facts — never conflated into one mutable "payment" record.
- The Lot Ledger (ADR-025) gains three new row types (`RECEIPT`, `RECEIPT_REVERSAL`,
  `PAYMENT_ALLOCATION`) without becoming a second ledger: every row is still derived live from
  `Receipt`/`PaymentAllocation`, the same discipline ADR-025 established for charges/adjustments.
- Cross-fund receipts (one payment covering multiple funds) are not yet supported end-to-end —
  recorded here as a known gap for a future inter-fund-transfer milestone, not silently worked
  around with netting.
- A receipt is never described as "bank-reconciled" merely by being recorded — `externalBankReference`
  is a caller-supplied reference only; M16.7 (Banking & Reconciliation) is the milestone
  responsible for an actual reconciliation state.

## Alternatives considered

- **One combined journal per "immediate" receipt+allocation.** Rejected: it would conflate two
  independently-meaningful events into one posting, making it impossible to reverse an allocation
  without also touching the cash-receipt journal, and impossible to tell from the GL alone whether
  a receipt was ever actually applied.
- **A separate `Prepayment`/`AdvancePayment` model for unallocated cash.** Rejected: redundant —
  an unallocated `Receipt` already is that state, correctly represented via the existing
  `UNAPPLIED_CASH` posting role from M16.1.
- **Allowing cross-fund allocation with an automatic offsetting inter-fund entry.** Rejected for
  this milestone: ADR-020's no-silent-netting rule and the absence of any inter-fund-transfer
  workflow make this unsafe to build implicitly; it is deferred, explicitly, rather than guessed.
- **A new `isPaid`/`balanceOwing` column on `LotLevyCharge`.** Rejected: `status` already carries
  `PART_PAID`/`PAID` for exactly this purpose (see the field's own pre-existing doc comment);
  adding a parallel column would duplicate the same fact in two places that could drift apart.

## Addendum (21 October 2026) — posting-direction defect, found and fixed

This ADR's own decision above was never wrong — "Dr UNAPPLIED_CASH / Cr LOT_LEVY_RECEIVABLE" for an
allocation is the correct entry — but the **implementation** in `receipts.service.ts` posted the
two lines reversed (Dr Receivable / Cr Unapplied) until a live validation pass during M16.6 caught
it by reconciling the GL against the lot subledger. Every application-layer figure this milestone
produces (`PaymentAllocationView`, the Lot Ledger, arrears) was unaffected throughout, because none
of them are computed by summing GL journal lines — they read `PaymentAllocation.amount`/`status`
directly, which is why the defect was invisible everywhere except a direct GL-vs-subledger
reconciliation. The code is fixed, with a regression test now pinning the exact debit/credit per
account. A scoped, approved correcting journal (`JRN-46PXXV`) was posted against the Harbour View
Strata demo tenant to fix the resulting historical distortion — see the traceability matrix's
"M16.5 historical correction" entry for the full reconciliation and before/after evidence. Lesson
recorded here for future posting-logic changes in this module: a balanced journal (debit = credit)
proves nothing about which account was meant to move which way — only an external reconciliation
against the subledger that doesn't share the same code path can catch a consistently-mirrored
direction error like this one.
