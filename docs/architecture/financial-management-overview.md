# Financial Management — Overview

**Date:** 21 October 2026 · **Covers:** M16.1 – M16.7 (implemented) and M16.8+ (planned)
**Audience:** anyone who needs the current, true state of WaslProp's financial management
capability without reading the full milestone-by-milestone implementation log.
**Source of truth:** this page summarises and cross-references
[`financial-requirements-traceability.md`](./financial-requirements-traceability.md) (the FIN
requirements matrix) and [`financial-management-implementation-plan.md`](./financial-management-implementation-plan.md)
(the full per-milestone implementation record). Where this page and either of those disagree, the
other two are authoritative — this page is a synthesis, not a new source of facts.

---

## 1. The implemented workflow

```
Financial onboarding              IMPLEMENTED  (M16.1)
        ↓
Opening balances (funds + lots)   IMPLEMENTED  (M16.1)
        ↓
Chart of Accounts                 IMPLEMENTED  (M16.2.1)
        ↓
Budgets (typed, versioned)        IMPLEMENTED  (M16.2 / M16.2.1)
        ↓
General Ledger + Posting Engine   IMPLEMENTED  (M16.2.2)
        ↓
Levy schedules (Regular/Special)  IMPLEMENTED  (M16.3)
        ↓
Instalment issuance + reversal    IMPLEMENTED  (M16.3, instalment-level per ADR-024)
        ↓
Lot Ledger (per-lot projection)   IMPLEMENTED  (M16.4)
        ↓
Receipts                          IMPLEMENTED  (M16.5)
        ↓
Payment allocation                IMPLEMENTED  (M16.5)
        ↓
Arrears management                IMPLEMENTED  (M16.6)
  (ageing, register, dashboard,
   collection cases, reminders —
   drafting/preview only)
- - - - - - - - - - - - - - - - - - - - - - - -  (implemented ends here)
        ↓
Banking & reconciliation          PLANNED  (M16.7)
        ↓
Commitments, AP, GST/BAS,
owner statements, year close,
external adapters, AI assistance  PLANNED  (M16.8+)
```

Every stage above the dashed line is real, tested, and verified live against a persistent demo
property ("Harbour View Strata", code `HARBOURVIEW-DEMO`). Nothing below the dashed line has any
backend code, schema, or route.

---

## 2. What each implemented stage actually does

### Financial onboarding & opening balances (M16.1)
A property's financial setup starts with its financial year, cutover date, and funds
(Administration, Capital Works, or a custom "Other" fund), then records each fund's opening cash
balance and each lot's opening amount-owing/credit-balance as at cutover — kept as two separate
non-negative figures, never netted into one signed number. A reconciliation check must pass before
the whole configuration is **activated**; after activation, the opening figures are historically
fixed (see §4, Invariant 2).

### Chart of Accounts (M16.2.1)
Property-scoped accounts (`AccountingAccount`), optionally provisioned from an organisation
template, with CSV import (preview → validate → atomic apply) built against the client's real
483-row reference file. Deactivate-only, never delete.

### Budgets (M16.2 / M16.2.1)
Typed budget lines (`REVENUE | EXPENDITURE | TRANSFER | RESERVE_CONTRIBUTION | OTHER`), each
optionally linked to a chart-of-accounts account. Full lifecycle `DRAFT → APPROVED → ACTIVE →
SUPERSEDED` with revisions and exactly one `ACTIVE` budget per property/financial year, enforced
at both the application and database level.

### General Ledger & Posting Engine (M16.2.2)
`LedgerPostingService` is the **sole** writer of `JournalEntry`/`JournalLine` rows — verified
directly in code (exactly one `journalEntry.create` call site in the entire financials module).
Every journal must balance (debit = credit) overall and per fund unless explicitly flagged as a
transfer (a flag no public endpoint exposes). Posting is idempotent
(`propertyId, sourceType, sourceId, sourceEventVersion`), concurrency-safe (a `FinancialConfiguration`
row lock), and rejected outright into a missing or closed `AccountingPeriod`. There is no `DRAFT`
journal status — a row's existence *is* posted state; correction is always a linked reversal.

### Levy schedules & instalment issuance (M16.3)
A Regular levy's total is derived strictly from the active budget's `REVENUE` lines linked to the
configured `LEVY_INCOME` account (never assumed from unrelated income); a Special levy requires
explicit AGM/committee approval evidence. Per-lot amounts use `Space.entitlementValue` with the
**largest-remainder method** so the per-lot sum always reconciles exactly to the total, with no
rounding fudge line. Issuance is **per instalment**, not per schedule (ADR-024 — matches NSW SSMA
2015 s.81/s.85, where each instalment is separately struck and accrues interest from its own due
date). Issued charges are immutable; correction is an explicit `LevyAdjustment` or a full
instalment reversal.

### Lot Ledger (M16.4)
A read-only **projection**, not a second ledger — `LotLedgerService` builds a lot's complete
transaction history live, every request, from `LotOpeningPosition`, `LotLevyCharge`, and their
adjustments/reversals. There is no persisted subledger table to drift from the General Ledger.
Gives a manager a per-lot financial account, a paginated/filterable ledger, and a statement for an
explicit period. **No payment tracking at this stage** — that arrives in M16.5.

### Receipts & payment allocation (M16.5)
A `Receipt` (money arrived) and a `PaymentAllocation` (money applied to a specific charge) are two
separate events, each posting its own journal — so either can be reversed independently. An
unallocated receipt sits in `UNAPPLIED_CASH`, which **is** the advance-payment state (no separate
prepayment model exists or is needed). `LotLevyCharge.status` is driven by allocations
(`ISSUED → PART_PAID → PAID`). **Cross-fund allocation is rejected, not supported** — a payment
covering two funds must be two separate receipts.

### Arrears management (M16.6)
Overdue amounts and ageing buckets (`CURRENT`, `1–30`, `31–60`, `61–90`, `90+`, keyed to each
charge's due date) are **computed live** from the same M16.3–M16.5 records — never stored. A
manager gets a property-wide dashboard, a per-lot/fund ageing register, and a per-lot arrears
detail. A manual collection workflow (`CollectionCase` → `CollectionNote`, plus a
`PaymentReminder`) sits alongside the numbers as the only genuinely *new* persisted state this
milestone introduces — it never becomes a source of financial truth itself.

### Banking & manual bank reconciliation (M16.7)
A scheme registers its real bank accounts (each linked to an existing GL cash account — never
assumed to be one account per fund) with only a masked identifier ever stored. Bank statements are
imported as CSV — the manager maps whichever columns their bank's own export uses (a signed amount
column, or separate debit/credit columns; configurable date format including Australian
`DD/MM/YYYY`) — previewed and validated before anything is saved, with duplicate rows detected and
skipped automatically. A deterministic engine then suggests matches between imported transactions
and existing receipts (or, for outgoing money, existing ledger entries), always with a
plain-language reason and never a bare confidence score; nothing changes until a manager explicitly
confirms it. An unmatched deposit can become a brand-new receipt through the existing receipts
process — never invented or auto-confirmed. Finally, a manager runs a **bank reconciliation** for a
statement period: the system compares the bank's closing balance against the ledger's own cash
balance (adjusted for genuinely outstanding items not yet on the statement) and will only let the
period be marked complete once the two agree exactly — never a silent write-off of a difference. A
completed reconciliation is a permanent record; correcting one later requires an explicit, audited
reopen, never a quiet edit.

---

## 3. Implemented vs. planned — at a glance

| Capability | Status |
|---|---|
| Financial onboarding, opening balances, reconciliation, activation | ✅ Implemented (M16.1) |
| Chart of Accounts, templates, CSV import/export | ✅ Implemented (M16.2.1) |
| Typed, versioned budgets with approval lifecycle | ✅ Implemented (M16.2 / M16.2.1) |
| General Ledger, accounting periods, posting profiles, reversal | ✅ Implemented (M16.2.2) |
| Regular & Special levy schedules, UOE allocation | ✅ Implemented (M16.3) |
| Per-instalment issuance & reversal | ✅ Implemented (M16.3, ADR-024) |
| Lot-level financial ledger & statements | ✅ Implemented (M16.4) |
| Receipts & payment allocation | ✅ Implemented (M16.5) |
| Arrears ageing, register, dashboard | ✅ Implemented (M16.6) |
| Manual collection cases & notes | ✅ Implemented (M16.6) |
| Reminder **drafting/preview** | ✅ Implemented (M16.6) |
| Reminder **dispatch** (email/SMS send) | ❌ Not implemented — no send path exists at all |
| Interest on arrears | ❌ Not implemented — NSW rate/period unconfirmed (ADR-027) |
| Statutory notices / debt-recovery charges | ❌ Not implemented — unresolved client/legal decision |
| Bank accounts & CSV statement import | ✅ Implemented (M16.7) |
| Deterministic bank transaction matching | ✅ Implemented (M16.7, ADR-028) |
| Manual bank reconciliation (statement vs. GL) | ✅ Implemented (M16.7, ADR-028) |
| Live bank feeds (Open Banking-style) | ❌ Not implemented — explicitly out of scope for M16.7 |
| Automated accounts-payable from bank matching | ❌ Not implemented — rejected outright (ADR-028 D9) |
| Cross-fund payment allocation | ❌ Not implemented — rejected outright, not built |
| Purchase commitments / Accounts Payable | ❌ Not implemented (planned M16.8+) |
| GST/BAS | ❌ Not implemented — mandatory accountant sign-off outstanding (ADR-018 D6) |
| Owner statements (PDF), year-end close/rollover | ❌ Not implemented (planned M16.8+) |
| External payment/accounting adapters, AI assistance | ❌ Not implemented (planned M16.8+) |

---

## 4. Non-negotiable invariants (true across every implemented stage)

1. **No mutable "current balance" field anywhere.** Every balance — fund, lot, arrears — is
   computed fresh from immutable source records on every read.
2. **Once activated/posted/issued, a financial fact is not edited in place.** Correction is always
   a new, linked record: a reversal, an adjustment, or a budget revision.
3. **Money is `Prisma.Decimal` only**, `Decimal(14,2)` on every ledger table — never raw
   floating-point arithmetic in a monetary calculation.
4. **Every journal balances**, overall and per fund, checked in code and enforced by locking —
   never just hoped for.
5. **Posting is idempotent and concurrency-safe** via one shared mechanism
   (`(propertyId, sourceType, sourceId, sourceEventVersion)` + a `FinancialConfiguration` row
   lock), reused by every producer (levies, receipts, allocations) rather than reinvented per
   module.
6. **An imported/external approval is never represented as a WaslProp-native one.** `source`,
   `externalApprovalDate`, and `externalApprovalReference` keep the two kinds of fact structurally
   distinct, for budgets and special levies alike.
7. **Nothing here is ever posted or decided by AI.** Financial calculations are deterministic code,
   not a model inference (consistent with ADR-007 elsewhere in this codebase).

---

## 5. M16.6 closure — what was actually delivered

- **Arrears Dashboard** — property-wide overdue total, ageing distribution across the five
  buckets, per-fund breakdown, unapplied-credit total shown separately.
- **Arrears Register** — every lot's outstanding/overdue/current figures in one filterable table.
- **Lot Arrears Detail** — a single lot's aged charges, opening-balance (shown separately, never
  aged), and its collection case/notes if one exists.
- **Collection cases & notes** — open a case against a lot, log contact attempts and notes, close
  it. Entirely reversible workflow state, gated on `financials.manage` (not `financials.approve`,
  which is reserved for immutable-ledger actions).
- **Reminder drafting & preview** — a point-in-time snapshot of a lot's charges/amounts, for
  review only.
- **Effective-dated ageing** — an `asOfDate` query parameter genuinely reconstructs the arrears
  position as it stood on that date (which charges existed, which allocations had landed, which
  reversals had happened) — not today's state replayed backwards. Verified live: a pre-receipt date
  shows a charge still overdue; today's date shows the same charge paid.
- **NSW interest and statutory recovery — explicitly deferred.** No rate, notice period, or
  recovery-fee schedule has been invented. Recorded as an open question for client/legal
  confirmation (ADR-027), not guessed at.
- **Email dispatch — disabled/not implemented.** `PaymentReminder.status` only ever reaches `DRAFT`
  or `CANCELLED`. No endpoint on the arrears/collection-workflow routes calls the email service —
  confirmed in code, not just by absence of a button.

A real defect was found during M16.6's live validation — **not in M16.6 itself**, but in M16.5's
receipt-allocation posting direction (the two journal lines were swapped). Every user-facing
balance throughout M16.4–M16.6 was unaffected (none of them are computed by summing GL lines), but
the General Ledger's own receivable account balance was distorted for one fund. Fixed in code, with
a regression test, and the historical distortion on the demo property corrected with a single
client-approved, append-only journal (`JRN-46PXXV`), independently re-verified nine ways afterward.
Full detail: the traceability matrix's "M16.6" and "M16.5 historical correction" entries.

---

## 5a. M16.7 closure — what was actually delivered

- **Bank Accounts** — register a scheme's real bank accounts, each linked to an existing GL cash
  account; only a masked identifier (e.g. "••••4321") is ever stored.
- **CSV statement import** — bank-independent column mapping (signed amount, or separate
  debit/credit; configurable date format), a validated preview before anything is saved, and
  automatic duplicate detection (both against prior imports and within the same file).
- **Deterministic matching** — six priority-ordered, exact-match-only rules; every suggestion
  carries a plain-language explanation; ambiguous cases are never guessed, only surfaced for
  manual review. "Suggest automatically, confirm manually" throughout — nothing changes
  accounting-visible state until a manager explicitly confirms it.
- **New-receipt-from-deposit** — an unmatched deposit can become a real `Receipt` through the
  *existing* receipts service (no second posting path), gated at `financials.approve`.
- **Bank reconciliation** — a full statement-period reconciliation (opening/closing balances,
  outstanding deposits/unpresented payments, a computed difference that must reach exactly 0.00),
  with immutable completed snapshots and an explicit, audited reopen workflow for corrections.
- **Example, worked live on the Harbour View Strata demo property:** an Administration Fund
  operating account was registered, a one-line CSV statement imported, matched by amount and the
  lot reference in its description to a newly recorded receipt, and reconciled for October 2026 —
  the workspace showed `AUD 0.00` difference and the reconciliation completed successfully, all
  through the real UI, start to finish.
- **No live bank feed, no accounts-payable subsystem.** Both explicitly out of scope — see
  ADR-028, decisions D9 and the alternatives-considered section.
- **Hardening pass (22 October 2026).** A focused review found and fixed two real gaps: bank
  account registration originally accepted any ASSET-classified account (e.g. a receivable) as a
  GL cash account rather than a genuine cash account, and reopening an earlier reconciliation
  period while a later one was already completed could silently break that later period's own
  opening-balance continuity. Both closed with precondition checks in the existing services — no
  accounting-policy change, no new models. Full detail: ADR-028 Addendum, traceability matrix's
  "M16.7 hardening pass" entry.

---

## 6. Known limitations (current, as of 21 October 2026)

These are deliberate scope boundaries, not oversights — each is a named decision in an ADR, not a
silent gap.

| Limitation | Why | Reference |
|---|---|---|
| **Live bank feeds are not implemented.** | M16.7 delivers CSV import and manual reconciliation only — a live feed integration (Open Banking/Basiq-style) is a future extension point, not built this milestone. | ADR-028 |
| **Automated accounts-payable from bank matching is not implemented.** | Outgoing transactions only match against existing GL cash movements already posted some other way; a full payables subsystem was explicitly out of scope. | ADR-028 D9 |
| **Cross-fund payment allocation is unsupported.** | Rejected outright (409), not built — a payment covering two funds must be recorded as two separate receipts. No inter-fund-transfer mechanism exists yet. | ADR-026 |
| **No automatic interest calculation on arrears.** | NSW SSMA 2015's interest provisions, and whether/how a scheme's by-laws opt in, remain unconfirmed by the client/legal review. Inventing a rate was explicitly avoided. | ADR-027 |
| **No automatic arrears reminder dispatch.** | Reminders are drafted/previewed only; no send path exists. Reusing the Communications module's real SMTP pipeline for this was deliberately avoided pending an explicit, separately-authorised decision. | ADR-027 |
| **Lot Statement PDF export is deferred.** | The statement is print-friendly (`window.print()`), but WaslProp has no existing, reusable server-side PDF-generation pattern this milestone could safely extend — documented as a follow-up rather than a faked button. | M16.4 implementation report |
| **Browser UI click-through QA is outstanding for M16.3–M16.6.** | No browser-automation tool was available in this environment for that frontend work. Every one of those screens was verified by (a) inspecting the generated Stitch HTML/screenshot before implementing, and (b) the React Testing Library suite — never a live browser session. **M16.7 is the exception:** a live Playwright session against the Harbour View Strata demo property verified the full bank-account-registration → statement-import → match-confirmation → reconciliation-completion flow end to end in a real browser. | each milestone's implementation report |
| **GST/BAS is not implemented.** | Mandatory accountant sign-off on registration threshold, BAS cycle, and per-scheme applicability is outstanding — confirmed no WaslProp scheme is currently GST-registered. | ADR-018 (D6) |
| **Purchase commitments / Accounts Payable do not exist.** | Planned M16.8+; work orders and quotes currently carry no fund/account/financial link. | roadmap §4 |
| **Owner statements (formal), year-end close/rollover do not exist.** | Planned M16.8+; "Finalise Book" semantics are an open question pending client confirmation of what the reference product currently does. | ADR-018 (D9) |

---

## 7. Where to go next

- **Requirement-by-requirement status:** [`financial-requirements-traceability.md`](./financial-requirements-traceability.md)
- **Architecture decisions, by topic:** [`financial-management-architecture.md`](./financial-management-architecture.md)
- **Full milestone-by-milestone implementation record (the detailed journal this page summarises):**
  [`financial-management-implementation-plan.md`](./financial-management-implementation-plan.md)
- **Live demonstration evidence:** [`docs/testing/financial-e2e-demo-report.md`](../testing/financial-e2e-demo-report.md)
