# ADR-028 — Banking & Manual Bank Reconciliation (M16.7)

**Status:** Accepted
**Date:** 21 October 2026

## Context

M16.1–M16.6 gave WaslProp a complete accrual-accounting core — funds, budgets,
levies, a double-entry general ledger, receipts/allocations, and arrears
management — but no way to confirm that the general ledger's own cash
position actually agrees with what a scheme's real bank account shows. A
strata manager today has to compare the General Ledger trial balance
against a bank statement by hand, with no system of record for the
comparison itself.

M16.7 closes that gap for the MVP: register real bank accounts, import
their statements as CSV, match individual transactions against existing
financial records, and complete an auditable, maker-checker reconciliation
— all without a live bank-feed integration, and without inventing a second
accounting engine alongside the one M16.2.2 already built.

## Decisions

### D1 — Importing a statement never posts a journal

A `BankTransaction` is a read-only record of what the bank's own statement
says happened. It becomes economically real in WaslProp's books only when:

- **matched** to an existing `Receipt` or `JournalLine` (no posting — a
  pure link), or
- used to **create a new `Receipt`** via the existing `ReceiptsService`
  (the only receipt-posting path in the codebase; M16.7 introduces no
  second one).

This mirrors the discipline `ADR-026` already established for receipts
themselves: an event that merely *describes* money is distinct from the
event that *posts* it.

### D2 — Matching and reconciliation are two different operations

The milestone brief draws this distinction explicitly, and the schema
follows it exactly:

- `BankTransactionMatch` links **one bank transaction** to **one existing
  (or newly created) accounting record**.
- `BankReconciliation` separately confirms that, for a **whole statement
  period**, the bank account's statement balance and the GL cash account's
  balance agree.

A transaction can be matched without ever being part of a completed
reconciliation (e.g. mid-month review), and a reconciliation's own
"outstanding" figures are computed from matched/unmatched GL lines, not
stored redundantly per transaction.

### D3 — The account identifier is never persisted in recoverable form

`BankAccount.accountIdentifierMasked` is the **only** representation ever
written to the database — derived once at registration time (keeping only
the last 4 characters visible) and the raw value is discarded immediately
after. This satisfies "never unmasked in logs/activity events/API
responses" trivially: the unmasked value is never persisted at all, not
filtered on the way out. No encryption-at-rest scheme was introduced for
a value that is simply never stored.

### D4 — A bank account is not assumed to equal one fund

The milestone brief is explicit: "Do not assume that one bank account
always equals one financial fund." `BankAccount.financialFundId` is
optional — set only when an account genuinely corresponds to one fund's
own cash (a dedicated Capital Works reserve account, say). The one
mandatory link is `glCashAccountId`, chosen explicitly at registration
(mirrors `Receipt.destinationAccountId`'s own
resolved-and-snapshotted-once discipline) rather than re-resolved through
the posting profile on every use — an operating account's statement can
legitimately mix multiple funds' cash, with matching/allocation then
happening at the transaction level the same way a multi-fund `Receipt`
already chooses its own fund.

### D5 — Duplicate-import detection without a stable bank ID

Most bank CSV exports carry no stable transaction identifier. Rather than
a simplistic `date + amount` uniqueness check (explicitly rejected by the
brief — two legitimate transactions can share both), `BankTransaction.
sourceRowHash` is SHA-256 of `(bankAccountId, transactionDate, amount,
description, bankReference, runningBalance)`, unique per bank account.
Two transactions that are identical across every one of those fields are
indistinguishable by anything the statement provides — treated as the
same row re-appearing (an overlapping statement period), not as two
distinct transactions.

**Known limitation:** two genuinely distinct transactions identical in
every one of those fields (same date, amount, description, reference, and
no distinguishing running balance) cannot be told apart by this strategy.
This is a deliberate, documented trade-off, not an oversight — closing it
further would require either a stable bank-provided ID (used directly,
when present, as `externalTransactionId`) or accepting a different false
tradeoff (collapsing legitimately repeated transactions).

### D6 — Deterministic, explainable matching only — no AI, no fuzzy score

Six priority-ordered rules (see `bank-matching.service.ts`), each
requiring an **exact, unambiguous** candidate before it is ever applied:
external reference, unique payment reference, receipt reference in the
description, exact amount + identifiable lot reference, exact amount +
a 3-day date window, and (for outgoing transactions only) exact amount +
date window against an existing ledger cash line. A rule that yields zero
or more than one candidate is skipped — never guessed. Every suggestion
carries a human-readable explanation, never a bare confidence score.

Default MVP policy throughout: **suggest automatically, confirm
manually.** `generateSuggestion` never changes accounting-visible state by
itself; only `confirmSuggestedMatch`, `manualMatchReceipt`,
`manualMatchJournalLine`, and `createReceiptFromTransaction` do, and each
requires an explicit authorized call.

### D7 — The reconciliation equation

Computed fresh on every `calculate` call, never trusted as a stored
running total between calls:

```
adjustedGlClosing = glClosingBalance - outstandingDepositsTotal + unpresentedPaymentsTotal
difference        = adjustedGlClosing - statementClosingBalance
```

`glClosingBalance` already includes every GL cash movement to date,
including ones that haven't yet appeared on *any* bank statement
(deposits in transit, unpresented payments). Subtracting those
not-yet-on-statement items is what makes the GL-side figure comparable to
what the bank's own statement says. A GL line counts as "outstanding"
(unmatched) unless a CONFIRMED `BankTransactionMatch` references it
(directly via `journalLineId`, or indirectly via the `Receipt` whose own
journal it belongs to).

`difference` must be **exactly 0.00** before `complete` will succeed — per
the brief, "reconciliation differences must never be silently written
off." Per the brief's other explicit instruction — "do not require every
transaction to be matched if legitimate outstanding items are correctly
accounted for" — outstanding items do **not** block completion; they are
mathematically excluded from the comparison, then naturally carry forward
as next period's opening outstanding items.

A second, independent check — `statementInternallyConsistent` (statement
opening balance + sum of every imported transaction in the period equals
the statement closing balance entered) — also gates `complete`, catching a
mistyped balance even when the GL-side difference happens to compute to
zero by coincidence.

### D8 — A completed reconciliation is immutable; correction is reopen + supersede

Mirrors a POSTED `JournalEntry`'s own discipline exactly. `complete` sets
`status = RECONCILED` and the row's balance fields are never edited again.
Correction is `reopen` (financials.approve; an explicit, audited status
flip to `REOPENED` plus `reopenedByUserId`/`reopenedAt`/`reopenReason`,
releasing its linked transactions back to `UNRECONCILED`) followed by a
fresh `DRAFT` reconciliation, optionally linked back via
`supersedesReconciliationId`. The original snapshot's own balance fields
are never mutated by either step.

### D9 — No accounts-payable subsystem

Outgoing transactions match only against **existing** GL cash credits
(manual journals, bank fees, etc. already posted some other way). If no
safe existing accounting representation exists, the transaction is left
as an unresolved exception with a clear status — never a silently created
vendor expense or liability. Building a payables subsystem is explicitly
out of scope for this milestone.

### D10 — Authorization: reuse the existing three-tier model, no new capability

- `financials.view` — read-only: listing accounts/transactions/
  reconciliations, generating a suggestion (changes nothing).
- `financials.manage` — reversible workflow data: registering/updating a
  bank account, importing a statement, confirming/reversing a match that
  only *links* existing records, starting/recalculating a reconciliation
  draft.
- `financials.approve` — actions on immutable-ledger-adjacent state, the
  same maker-checker bar as closing an accounting period or reversing a
  journal: creating a **new** receipt from an unmatched deposit (a real GL
  posting), completing a reconciliation, reopening one.

A distinct `financials.reconcile` capability was considered and rejected:
every action that genuinely warranted a stricter bar already maps onto the
existing `financials.approve` semantics exactly ("actions on posted
financial history"/immutable-ledger-adjacent), so introducing a fourth
capability would fragment an already-coherent three-tier model without
gating anything a combination of the existing three couldn't already
express correctly.

## Consequences

- No parallel financial truth source: every dollar that becomes real in
  WaslProp's books still flows through `LedgerPostingService`/
  `ReceiptsService`, exactly as before M16.7.
- Bank balance and GL cash balance remain two independent concepts,
  reconciled explicitly, never silently assumed equal.
- The duplicate-detection and matching strategies are both deliberately
  conservative — ambiguous cases fall through to manual review rather
  than ever guessing, consistent with every other "no silent assumption
  about money" precedent in this codebase (ADR-026's "do not treat a
  credit balance as automatically allocated", ADR-027's "never a persisted
  independent financial truth").

## Alternatives considered

- **AI/fuzzy matching with a confidence score** — rejected per the brief;
  every match must be deterministic and explainable in plain language.
- **Live bank feeds (Open Banking/Basiq/Akahu-style)** — explicitly out of
  scope; CSV import is bank-independent and requires no integration
  partner, matching the brief's "without requiring live banking
  integrations."
- **A single reconciliation record per bank account (no period concept)**
  — rejected; real strata practice reconciles monthly against a statement
  period, and the equation above is period-scoped by construction.
- **Auto-creating a receipt for every unmatched deposit** — rejected per
  the brief: "do not automatically treat an unmatched deposit as a
  confirmed owner receipt." Creating one is always an explicit,
  `financials.approve`-gated action.

## Addendum (22 October 2026) — hardening pass: eligibility and chain-continuity

A focused post-implementation review found two real gaps, neither an
accounting-policy change — both closed in the services the original ADR
already specified (`bank-accounts.service.ts`, `bank-reconciliation.service.ts`),
with no new models or endpoints beyond one small read.

### H1 — GL account eligibility was too broad

`register` originally accepted any ASSET-classified account as a bank
account's GL cash account. In practice this let a manager pick an account
like "Lot Levy Receivable" or "GST Receivable" — a real asset, but never a
real-world bank balance. Fixed by requiring the account to be assigned the
`FUND_CASH` posting-profile role (the same role `ReceiptsService` already
resolves when posting a receipt's cash side) — reusing the schema's one
existing "which accounts are actually cash" source of truth rather than
adding a second, parallel flag on `AccountingAccount`. Two further checks
were added alongside it: the chosen fund (if any) must match the
`FUND_CASH` rule's own fund even when the account itself isn't formally
`restrictedToFundId`-locked, and the GL account must not already be
claimed by another ACTIVE bank account (two real bank accounts must never
share one GL cash account — that would double-count the same ledger
balance across two separate reconciliations).

A new read endpoint, `GET .../bank-accounts/eligible-gl-accounts`
(`financials.view`), surfaces exactly this same eligibility set to the
frontend picker — single source of truth, never a client-side
re-derivation that could drift from the server's own rule.

### H2 — Reconciliation chain continuity could silently break across a reopen/supersede

The original opening-balance-continuity check (`expectedOpening` = the
most recent RECONCILED reconciliation's closing balance) was correct for
a straight-line sequence of periods, but said nothing about what happens
when an EARLIER period is reopened and corrected after a LATER period has
already been completed against its original (now-stale) closing balance.
Two guards close this:

- `reopen` now refuses to reopen a period while any LATER period for the
  same account is already `RECONCILED` — that later period's own opening
  balance depends on this one's closing balance never silently changing
  underneath it. Periods must be reopened in reverse-chronological order
  (unreconcile the newest first), the same discipline standard accounting
  practice already uses.
- `createDraft` now refuses to start a brand-new (non-superseding) period
  while an earlier period sits `REOPENED` and uncorrected — the
  continuity anchor it would otherwise pick (the latest `RECONCILED` row)
  may no longer reflect reality once that reopened period's correction
  lands. The manager must resolve it (via a superseding draft) first.
- A superseding draft (`supersedesReconciliationId` set) must now cover
  the IDENTICAL period as the reconciliation it corrects — a different
  period is a new reconciliation, not a correction, and linking it via
  `supersedesReconciliationId` would misrepresent the chain.

Together these mean the system can no longer reach a state where two
reconciliations' stored balances silently disagree about the same
account's history — either the inconsistent action is refused outright,
or the chain is kept honest by construction. No existing reconciliation
or GL data was altered to implement this; both guards are pure
precondition checks on new writes.

### Other hardening items (UI only, no invariant change)

- `BankAccountView` gained two derived (never stored) fields:
  `lastReconciledDate` (the latest RECONCILED reconciliation's
  `periodEndDate`) and `reconciliationStatus` (`NEVER_RECONCILED` /
  `UP_TO_DATE` / `DRAFT_IN_PROGRESS` / `REOPENED`), computed fresh on
  every `list`/`get` call from the account's reconciliation rows — same
  "computed, not cached" discipline as every other derived figure in this
  module.
- The frontend's transaction register now shows separate Debit/Credit
  columns instead of one signed amount; every banking screen uses the
  existing `formatAuDate`/`formatAuDateTime` helpers (introduced in
  M16.6) instead of raw ISO/date-only strings; the Bank Reconciliation
  Workspace gained an explicit plain-language explanation of
  bank-vs-GL-balance and outstanding-items treatment; the Financial
  Overview's Banking card now shows a real account count and
  needs-attention status instead of a static "Manage" label.
