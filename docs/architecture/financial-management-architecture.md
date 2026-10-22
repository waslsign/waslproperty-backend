# Financial Management — Architecture

**Date:** 21 October 2026 · **Audience:** engineers working on or extending the financials module.
**Purpose:** a topic-by-topic map of the architecture, each pointing to the ADR that made the
decision and the code that implements it. **This page does not restate any ADR's content** — read
the linked ADR for the context, decision, and alternatives considered. This page exists so a
reader doesn't have to open twelve ADRs to find which one covers what.

All ADRs referenced below were re-checked against the current implementation while writing this
page (e.g. the "sole writer" claim for `LedgerPostingService`, and the three `financials.*`
capability names, were both re-verified directly against the code, not assumed from the ADR text).

---

## Financial configuration and funds

`FinancialConfiguration` (one per property: setup status, financial year, cutover date, currency)
and `FinancialFund` (Administration / Capital Works / Other — long-lived, not itself frozen by
activation). Established in M16.1, before any ADR existed for this module; the chart-of-accounts
and ledger layers built on top of it (below) without changing its shape.

- Code: `financials.service.ts`
- No ADR (pre-ADR-numbered milestone) — see the implementation plan's M16.1 sections instead.

## Chart of accounts

Property-scoped `AccountingAccount`, optionally provisioned by copying an organisation
`AccountTemplate`. An account may serve more than one fund (fund lives on the consuming record,
not the account). CSV import classifies nothing from a filename or an unconfirmed code-range
pattern — only from an explicit column, a caller override, or a disclosed heuristic suggestion.

- Code: `accounts.service.ts`, `account-templates.service.ts`, `account-import.service.ts`
- **ADR-016** (ownership, fund flexibility, code-range inference), **ADR-019** (CSV import: preview
  is unpersisted, apply always re-validates, no multipart pipeline)

## Budget lifecycle

Typed lines (`REVENUE | EXPENDITURE | TRANSFER | RESERVE_CONTRIBUTION | OTHER`), each optionally
linked to a chart-of-accounts account. `DRAFT → APPROVED → ACTIVE → SUPERSEDED`, with revisions
and exactly one `ACTIVE` budget per property/financial year — enforced by a partial unique database
index, not application logic alone. `activate()` walks the activated budget's own revision chain to
supersede any skipped-over `APPROVED` ancestor, not only whichever budget was previously `ACTIVE`.

- Code: `budgets.service.ts`
- **ADR-017** (line typing, the `totalBudget` → `totalBudgetedRevenue`/`totalBudgetedExpenditure`/
  `budgetedSurplusDeficit` breaking rename)

## General Ledger and posting profiles

`LedgerPostingService` is the **sole** writer of `JournalEntry`/`JournalLine` — re-verified
directly: exactly one `journalEntry.create` call site exists in the entire financials module.
Every other producer (levies, receipts, allocations) calls `post()`/`postWithinTransaction()` with
a typed command; none writes ledger tables directly. `PostingProfileRule` resolves semantic roles
(`LEVY_RECEIVABLE`, `LEVY_INCOME`, `FUND_CASH`, `UNAPPLIED_CASH`, …) to a real account, optionally
per fund — no module hard-codes an account identity.

- Code: `ledger-posting.service.ts`, `posting-profile.service.ts`, `accounting-periods.service.ts`
- **ADR-020** (posting engine: no `DRAFT` state, fund-balance-unless-flagged, atomic
  `postInTransaction`), **ADR-021** (idempotency key shape, row-lock concurrency model, period
  non-overlap as a service-level check)

## Immutable journal entries

A `JournalEntry` row's existence *is* posted state — there is no draft/posted toggle. Correction is
always a new, linked reversal (`reversalOfJournalId`), never an in-place edit. A journal can be
reversed at most once. Posting into a missing or `CLOSED` `AccountingPeriod` is rejected before any
row is written.

- Code: `ledger-posting.service.ts` (`reverse()`/`reverseWithinTransaction()`)
- **ADR-020**, **ADR-021** (including the closure addendum: the "already reversed" check must run
  *inside* the row lock, not before it — found and fixed during M16.2.2 closure)

## Levy issuance and reversal

Issuance is **per instalment**, not per schedule (`LevyInstallment` is the real issuance/reversal
unit) — matches NSW SSMA 2015 s.81/s.85, where each instalment is separately struck and accrues
interest from its own due date. A Regular levy's total is derived strictly from the *active*
budget's `REVENUE` lines linked to the configured `LEVY_INCOME` account; a Special levy requires
explicit approval evidence and never derives from a budget. One aggregated, fund-balanced journal
per instalment issuance (not one line per lot) — `LotLevyCharge` is the real per-lot subledger
detail. Issued charges are immutable; correction is a `LevyAdjustment` or a full instalment
reversal.

- Code: `levies.service.ts`, `levy-notices.ts`
- **ADR-023** (posting contract, revenue derivation, notice integration, capability split),
  **ADR-024** (why issuance moved to the instalment level, the ACTIVE-budget-only gate, and the
  human-readable/trial-balance presentation changes that came out of the same review)

## UOE allocation and rounding

Per-lot amounts use `Space.entitlementValue` (the same field strata already maintains — no second
entitlement concept introduced for levies) via the **largest-remainder method** (Hamilton's method
of apportionment), operating in integer cents. Guarantees `SUM(LotLevyCharge.amount) === total`
exactly, every time, with a deterministic tie-break (ascending `spaceId`) — never "last lot
absorbs the remainder."

- Code: `levy-allocation.ts` (`allocateByEntitlement`)
- **ADR-022**

## Lot subledger projection

The Lot Ledger is a **read-only projection**, not a second ledger — it has no table of its own and
therefore cannot drift from the General Ledger/subledger it reads. Built live, per request, from
`LotOpeningPosition` + `LotLevyCharge` (+ adjustments) at M16.4, extended with `Receipt`/
`PaymentAllocation` row types at M16.5. Bounded by construction (one opening row, at most one
charge per instalment ever issued against that lot), which is exactly why computing it live, every
time, is both correct and sufficient — nothing is cached or reconciled after the fact.

- Code: `lot-ledger.service.ts`
- **ADR-025** (the projection decision, sign convention, ordering/pagination), with **ADR-026**
  extending it (new row types for receipts/allocations)

## Receipts and unapplied cash

A `Receipt` (cash arriving) and a `PaymentAllocation` (applying it to a charge) are two separate
events, each posting its own journal — either can be reversed independently. An unallocated
receipt sits in `UNAPPLIED_CASH`, which **is** the advance-payment state (no separate prepayment
model was built, because none is needed). Default auto-allocation order is oldest-due-date-first
within the same fund.

- Code: `receipts.service.ts`
- **ADR-026**, including its addendum recording the real posting-direction defect found during
  M16.6 validation (fixed in code; the historical distortion corrected via an approved journal —
  see the traceability matrix's "M16.5 historical correction" entry, not duplicated here)

## Payment allocations

`LotLevyCharge.status` (`ISSUED → PART_PAID → PAID`) is driven entirely by allocations against it,
using enum values the schema reserved back in M16.3 for exactly this purpose. Cross-fund allocation
is rejected outright (409) — not implemented, not worked around with netting. A receipt with any
still-applied allocation cannot be reversed directly; its allocations must be reversed first.

- Code: `receipts.service.ts`
- **ADR-026**

## Arrears calculations

Computed live, never stored — the same "no second ledger" discipline as the Lot Ledger, extended
to a property-wide, ageing-aware view. Ageing buckets (`CURRENT`/`1–30`/`31–60`/`61–90`/`90+`) key
to each charge's **due date**, never its issuance date. `asOfDate` support is genuine effective-
dated reconstruction (which charges existed, which allocations had landed, which reversals had
happened, as of that date) — not today's state replayed backwards. `LotLevyCharge.status`'s
reserved `OVERDUE` value stays permanently unused, since a stored status cannot represent both a
payment fact and a date-relative fact in one slot without one clobbering the other.

- Code: `arrears.service.ts`
- **ADR-027**

## Collection cases and reminders

The *only* newly persisted state M16.6 introduces (`CollectionCase`, `CollectionNote`,
`PaymentReminder`) — a human workflow layered on top of the computed arrears figures, never itself
a source of financial truth. Gated on `financials.manage`, not `financials.approve` (reserved for
immutable-ledger actions), since this state is fully reversible. Reminders reach `DRAFT` or
`CANCELLED` only — there is no dispatch path, and the existing Communications module's real SMTP
pipeline is deliberately not reused here.

- Code: `arrears.service.ts` (same module — collection workflow is not split into a separate
  service)
- **ADR-027**

## Banking and bank reconciliation

Five load-bearing decisions (ADR-028): (1) importing a statement never posts a journal — a
`BankTransaction` becomes economically real only via a confirmed match (a link to an existing
`Receipt`/`JournalLine`) or `createReceiptFromTransaction` (delegates to the existing
`ReceiptsService`, never a second posting path); (2) matching (one transaction ↔ one record) and
reconciliation (one statement period's totals agreeing with the GL) are deliberately separate
tables/operations, never conflated; (3) `BankAccount.accountIdentifierMasked` is the only
persisted representation of an account identifier — the raw value is discarded at registration
time, never stored or logged; (4) a bank account is not assumed to equal one fund —
`financialFundId` is optional, `glCashAccountId` is the one mandatory, explicitly-chosen link; (5)
duplicate-import detection uses `sourceRowHash` (SHA-256 of bank account + date + amount +
description + reference + running balance), not a simplistic date+amount check.

Matching is six priority-ordered, exact-match-only rules (external reference → unique payment
reference → receipt reference in description → amount+lot → amount+date window → outgoing
amount+date window against an existing ledger line) — a rule yielding zero or multiple candidates
is skipped, never guessed. "Suggest automatically, confirm manually": `generateSuggestion` changes
nothing; only `confirmSuggestedMatch`/`manualMatchReceipt`/`manualMatchJournalLine`/
`createReceiptFromTransaction` do.

The reconciliation equation (computed fresh every `calculate` call):

```
adjustedGlClosing = glClosingBalance - outstandingDepositsTotal + unpresentedPaymentsTotal
difference        = adjustedGlClosing - statementClosingBalance
```

`difference` must be exactly `0.00` to `complete`; outstanding (unmatched) GL items do not block
completion — they are mathematically excluded from the comparison and carry forward, per the
milestone's own "do not require every transaction to be matched" instruction. A second check,
`statementInternallyConsistent` (opening balance + sum of imported transactions = closing balance),
also gates completion. A `RECONCILED` row's balance fields are never edited again; correction is
`reopen` (status → `REOPENED`, releases linked transactions, audited) plus a fresh superseding
`DRAFT`.

- Code: `bank-accounts.service.ts`, `bank-import.service.ts`, `bank-matching.service.ts`,
  `bank-reconciliation.service.ts`
- **ADR-028**

## Financial permissions and audit controls

Three capabilities, re-verified directly in `capabilities.ts`: `financials.view` (read),
`financials.manage` (draft/configure/reversible workflow actions), `financials.approve`
(everything that touches posted ledger history — issuance, reversal, period close, posting-profile
changes). None is granted to any `PropertyRole` by default; only organisation `OWNER`/`ADMIN` pass
by default, same as every other financials-adjacent capability in this codebase.
`people.view` independently gates owner-name enrichment wherever it appears (levy charges, lot
ledger, arrears) — a user with financial access but not `people.view` sees every dollar figure,
never an owner's name.

Every financial mutation records an `ActivityEvent` inside the same transaction as the change
itself, so an audit record and the change it describes can never exist independently of one
another — the same convention as every other module in this codebase.

- Code: `src/modules/authorization/capabilities.ts`; `recordActivity()` calls throughout the
  financials module's services
- **ADR-020** §"Audit history and authorization" (introduces `financials.approve`); **ADR-023**
  §"Capability split" (applies it to levies); **ADR-026**/**ADR-027**/**ADR-028** (apply the same
  split to receipts/allocations, the collection workflow, and banking/reconciliation — no new
  capability introduced for M16.7; see ADR-028 D10 for why)

---

## Cross-cutting decisions that apply to every topic above

- **`Decimal(14,2)` for every ledger column** (resolving the pre-existing `Decimal(12,2)`/
  `Decimal(10,2)` split elsewhere in the schema) — ADR-020.
- **Idempotency key `(propertyId, sourceType, sourceId, sourceEventVersion)`**, reused by every
  producer without reinvention — ADR-021.
- **Concurrency via a `FinancialConfiguration` row lock**, not optimistic retry — serializes every
  ledger-affecting write for one property through a single lock — ADR-021.
- **GST and jurisdiction policy are a lookup, not a strategy layer**, Australia-only until a second
  jurisdiction is funded — ADR-018.

## What is explicitly not yet decided

ADR-018 records five accounting-policy recommendations (D4 budget remaining/actual/committed
formula, D5 advance-payment posting, D6 GST, D8 opening-receivable fund split, D9 year-end close
semantics) that are **working assumptions**, not confirmed client/accountant decisions. D5 and D8
are now load-bearing in shipped code (M16.2.2); D4, D6, and D9 remain unimplemented and gate work
that hasn't started yet. See ADR-018 directly for the recommendation and what confirmation is
still needed for each — not duplicated here.

---

**See also:** [`financial-management-overview.md`](./financial-management-overview.md) for the
business-facing workflow and current implemented/planned status;
[`financial-requirements-traceability.md`](./financial-requirements-traceability.md) for
requirement-by-requirement status.
