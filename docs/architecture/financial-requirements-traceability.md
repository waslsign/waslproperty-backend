# Financial Requirements Traceability Matrix

**Updated:** 21 October 2026 (M16.1–M16.6 implemented; M16.7+ planned — FIN-013/FIN-023 rows
below corrected during a consolidated-documentation pass to match M16.4/M16.6 as actually shipped;
no other row changed) · Source: `WaslProp_Complete_Financial_Requirements_Option_B.md`

Maintained as part of every financial milestone, not as a separate pass (see CLAUDE.md). Status:
**Done** (implemented and tested this milestone), **Partial** (some of the requirement ships this
milestone), **Planned** (scoped to a named future milestone), **Deferred** (explicitly out of
scope, reason given).

**See also** the consolidated, narrative-form companions to this matrix:
[`financial-management-overview.md`](./financial-management-overview.md) (the implemented workflow
and current implemented/planned status, for a reader who doesn't need per-requirement detail) and
[`financial-management-architecture.md`](./financial-management-architecture.md) (architecture by
topic, each pointing to its governing ADR).

| FIN ID | Requirement | Milestone | Status | Code | Tests | ADR |
|---|---|---|---|---|---|---|
| FIN-001 | Fiscal year, cutover, currency, fund setup | M16.1 | Done | `financials.service.ts` | `financial-accounts.test.ts`(reuse), `financials.test.ts` | — |
| FIN-002 | Opening fund and lot positions | M16.1 | Done | `financials.service.ts` | `financials.test.ts` | — |
| FIN-003 | Account code catalog with types and hierarchy | **M16.2.1** | **Done** | `accounts.service.ts`, `AccountingAccount` model | `financial-accounts.test.ts` (CRUD, hierarchy guard, deactivate-not-delete, org isolation, capability enforcement) | ADR-016 |
| FIN-004 | CoA template and CSV import/export | **M16.2.1** | **Done** | `account-import.service.ts`, `account-templates.service.ts` | `financial-accounts.test.ts` (dry run, atomic apply, real 483-row CSV, export, true concurrent-import race) | ADR-019 |
| FIN-005 | Revenue/expense/transfer/reserve budget classification | **M16.2.1** | **Done** | `FinancialBudgetLine.lineType` | `financial-budgets.test.ts` (positive/negative/zero surplus, transfer/reserve exclusion, inactive-account assignment guard, historical-reference preservation) | ADR-017 |
| FIN-006 | Versioned budget approvals and history | M16.2 | Done | `budgets.service.ts` | `financial-budgets.test.ts` | — |
| FIN-007 | Funding requirement calculation | **M16.2.1 partial** | **Partial** | `totalBudgetedRevenue`/`totalBudgetedExpenditure`/`budgetedSurplusDeficit` in `budgets.service.ts` | `financial-budgets.test.ts` (zero/negative/positive surplus cases verified) | ADR-017, ADR-018 (D4) |
| FIN-008 | GL, periods, journals, posting engine | **M16.2.2** | **Done** | `ledger-posting.service.ts`, `accounting-periods.service.ts`, `posting-profile.service.ts` | `financial-ledger.test.ts` (balanced/unbalanced, idempotency, concurrency, rollback, closed-period, reversal integrity) | ADR-020, ADR-021 |
| FIN-009 | Fund-specific accounting controls | **M16.2.2** | **Done** | Per-fund balance check in `LedgerPostingService.postInTransaction`; `JournalLine.financialFundId` required | `financial-ledger.test.ts` (cross-fund-without-flag rejection; opening journal's per-fund-tagged equity lines) | ADR-016 (D2), ADR-020 |
| FIN-010 | Opening journal migration | **M16.2.2** | **Done** | `opening-journal.service.ts` | `financial-ledger.test.ts` (balanced generation, idempotent retry, unresolved/mismatched lot rejection, posting-profile-not-configured block) | ADR-018 (D8), ADR-020 |
| FIN-011 | Regular levy schedules and allocations | **M16.3** | **Done** | `levies.service.ts`, `levy-allocation.ts` | `financial-levies.test.ts` (UOE rounding, budget-derived total, idempotency, concurrency, closed-period rejection) | ADR-022, ADR-023 |
| FIN-012 | Special levies and adjustments | **M16.3** | **Done** | `levies.service.ts` (`createSpecial`, `createAdjustment`) | `financial-levies.test.ts` (approval evidence required, adjustment never edits original amount, idempotent) | ADR-023 |
| FIN-013 | Lot financial subledger | **M16.3 (charges) / M16.4 (ledger)** | **Done** | `LotLevyCharge` (M16.3, issuance) + `lot-ledger.service.ts` (M16.4, read-only live projection — per-lot account, paginated ledger, period statement) | `financial-levies.test.ts`, `financial-lot-ledger.test.ts` (21 tests: ordering, running balance, multi-fund breakdown, ownership-change survival, statement reconciliation) | ADR-023, ADR-025 |
| FIN-014 | Owner receipts and allocations | **M16.5** (was M16.4) | **Done** (backend, frontend, and tests — Record Receipt/Allocate Payment modals and Receipt Detail page shipped Stitch-first) | `receipts.service.ts`, `receipts.controller.ts`, `receipts.schemas.ts` | `financial-receipts.test.ts` (29 tests) | ADR-018 (D5 recommendation), ADR-026 |
| FIN-015 | PO commitments and budget reservations | **M16.8+** (was M16.5) | Planned | — | — | ADR-018 (D4 recommendation) |
| FIN-016 | Supplier invoices and AP | **M16.8+** (was M16.5) | Planned | — | — | — |
| FIN-017 | Budget actual/committed/available dashboard | **M16.8+** (was M16.5) | Planned | — | — | ADR-018 (D4) |
| FIN-018 | Bank accounts and statement import | **M16.7** (was M16.6) | Planned | — | — | — |
| FIN-019 | Bank reconciliation | **M16.7** (was M16.6) | Planned | — | — | — |
| FIN-020 | GST and tax treatment | **M16.8+** (was M16.8) | Planned | — | — | ADR-018 (D6 recommendation, mandatory validation flagged) |
| FIN-021 | Financial statements and owner statements | **M16.8+** (was M16.8) | Planned | — | — | — |
| FIN-022 | Year-end close and rollover | **M16.8+** (was M16.8) | Planned | — | — | ADR-018 (D9 recommendation) |
| FIN-023 | Arrears, interest and collections | **M16.6** (was M16.7) | **Partial** | `arrears.service.ts` — live ageing/register/dashboard computation and the manual `CollectionCase`/`CollectionNote`/`PaymentReminder` workflow are **Done**; interest calculation, statutory notices, and recovery-cost charge-backs are **Deferred** (no NSW rate/period/fee schedule confirmed — see ADR-027); reminder **dispatch** (send) is **Deferred** (drafting/preview only, no send path exists) | `financial-arrears.test.ts` (23 tests) | ADR-027 |
| FIN-024 | External payment/bank/accounting adapters | **M16.8+** (was M16.9) | Planned | — | — | — |
| FIN-025 | Financial AI assistance | **M16.8+** (was M16.9) | Deferred | — | — | AI must not auto-post; no change this milestone |
| FIN-026 | Multi-jurisdiction financial policy | Architecture (ongoing) | Partial | `AccountClassification` is jurisdiction-neutral; no AU-specific rule hard-coded in CoA/import | `financial-accounts.test.ts` | ADR-018 (D6 notes AU-specific GST threshold explicitly, not globalized) |

## Milestone renumbering (21 October 2026) — dependency-driven resequencing

The original roadmap (line "M16.3 — Levies & receivables → M16.4 — Lot ledger, receipts &
allocations → M16.5 — Commitments & AP → M16.6 — Banking & reconciliation → M16.7 — Arrears →
M16.8 — Statements, GST/BAS, year close → M16.9 — AI assistance" below) bundled receipts/
allocations into M16.4 alongside the lot ledger. In practice M16.4 shipped only the lot ledger
(FIN-013 partial, read-only projection — see ADR-025); receipts/allocations (FIN-014) was deferred
whole. Arrears management (FIN-023) cannot be built honestly without a real payment/receipt record
to be in arrears against — it was sequenced ahead of receipts in the original plan, which this
resequencing corrects.

**No requirement ID, scope, or acceptance criterion is removed or altered — only the `Milestone`
column above.** This is a resequencing record, not a requirements change:

| Requirement | Was | Now |
|---|---|---|
| FIN-014 (Owner receipts and allocations) | M16.4 (planned, never built) | **M16.5** — this milestone |
| FIN-023 (Arrears, interest and collections) | M16.7 | **M16.6** — now depends on FIN-014's real receipt records existing first |
| FIN-018/019 (Bank accounts, reconciliation) | M16.6 | **M16.7** — reconciliation needs real receipts to reconcile against |
| FIN-015/016/017 (PO commitments, Supplier AP, Actual/committed dashboard) | M16.5 | **M16.8+** |
| FIN-020/021/022 (GST, owner statements, year-end close) | M16.8 | **M16.8+** (unchanged in substance, folded into the same forward bucket) |
| FIN-024/025 (External adapters, AI assistance) | M16.9 | **M16.8+** |

`financial-management-implementation-plan.md`'s own milestone-sequence line is updated to match
(see that file). "M16.8+" is deliberately not broken back out into M16.8/M16.9 sub-numbers here —
the relative order among those remaining items is not yet a dependency-driven decision the way
M16.5→M16.6→M16.7 is, so it is recorded as one forward bucket rather than a precision this
resequencing doesn't actually have evidence for.

## M16.2.1 closure verification (20 October 2026)

A focused verification pass before starting M16.2.2 found and fixed two real defects, both within
M16.2.1 scope:

1. **Inactive accounts could be newly assigned to a budget line.** `FinancialBudgetsService` validated
   that `accountId` belonged to the same property but never checked `isActive`. Fixed:
   `assertAccountAssignable` now rejects (409) assigning an inactive account on `addLine` and on
   `updateLine` whenever `accountId` is part of the write — while a line's pre-existing reference to
   an account later deactivated is left untouched (verified: reading the budget, and editing an
   unrelated field on the same line, both still succeed and still show the historical account).
2. **A concurrent-import code collision surfaced as an unhandled 500.** Postgres's default READ
   COMMITTED isolation does not prevent two concurrent `apply` transactions from both reading "code
   not yet taken" before either commits. The `@@unique([propertyId, code])` constraint already
   caught this at the database level (so no duplicate was ever actually written), but the resulting
   `P2002` was not translated into a clean error. Fixed: it is now caught and returned as 409,
   confirmed by a true-concurrency test (`Promise.all` of two overlapping `apply` calls) asserting
   exactly one account with that code exists afterward.

Everything else verified without changes needed: zero/negative/positive budget surplus math
(Decimal-exact); organisation/property isolation and `financials.view`/`financials.manage`
enforcement on every new account endpoint; the migration is purely additive with safe defaults
(no data loss, confirmed by inspecting the generated SQL); frontend types/OpenAPI/API client field
names match the implemented response shape exactly (checked field-by-field).

**Result: 802/802 backend tests passing (58 files, 36 new/updated for this verification pass),
222/222 frontend tests passing (40 files), typecheck and lint clean. M16.2.1 is closed.**

## M16.2.2 implementation summary (20 October 2026)

General Ledger & Posting Engine shipped: `AccountingPeriod`, `PostingProfileRule`, `JournalEntry`,
`JournalLine`; `LedgerPostingService` (the sole writer, enforcing balanced/per-fund-balanced
Decimal(14,2) postings, exactly-once idempotency via a `FinancialConfiguration` row lock,
closed-period rejection, and linked reversals), `AccountingPeriodsService`,
`PostingProfileService`, `OpeningJournalService` (M16.1 → ledger transition with mandatory exact
per-lot fund splits — never fabricated). New `financials.approve` capability gates every write
against posted history. 10 new API endpoints, OpenAPI updated and route-coverage-verified. Two new
Stitch-designed frontend pages (General Ledger Settings; Journals & Trial Balance). One real defect
(a non-atomic `reverse()`) was caught and fixed during implementation, before any test exercised it
— see ADR-020.

**Result: 823/823 backend tests (59 files, 21 new for this milestone), 222/222 frontend tests
(40 files), typecheck and lint clean on both. See ADR-020 and ADR-021 for the architecture
decisions.**

### M16.2.2 closure verification (20 October 2026)

A focused accounting-integrity review across all seven required areas (reversal atomicity/
idempotency/linking; opening-journal reconciliation and fund integrity; cross-fund flag isolation;
trial-balance correctness; posting-profile account validation; accounting-period non-overlap/
closed-period/concurrency; organisation/property/permission isolation) found and fixed **two
genuine defects**, both in the reversal path's concurrency handling and the opening journal's
validation arithmetic:

1. **`reverse()`'s "already reversed" check ran before any lock was acquired.** Two concurrent
   reversal attempts on the same journal could both pass the check before either committed; the
   idempotency key still prevented a second *journal* from being created, but the losing call
   would still overwrite the winner's `reversalReason` and log a duplicate audit event. Fixed by
   acquiring the `FinancialConfiguration` row lock before the check, not after — see ADR-021's
   closure addendum. Verified by a true concurrent-reversal test.
2. **The opening-journal fund-split validation used float addition with an arbitrary `±0.001`
   tolerance** instead of exact `Decimal` comparison. Fixed to match the posting engine's own
   exact-equality discipline — see ADR-018's closure addendum.

Six new test groups added (8 tests): concurrent-reversal race, `allowCrossFund` injection
(confirmed unreachable from the public API), posting-profile inactive/cross-property/cross-fund
account rejection, concurrent overlapping-period creation, organisation isolation for periods and
posting profile, and `financials.manage`-without-`financials.approve` rejection across every
approve-gated action.

**Final result: 831/831 backend tests (59 files, 29 in `financial-ledger.test.ts`), 222/222
frontend tests (40 files), typecheck and lint clean on both. M16.2.2 is closed.**

## M16.3 implementation summary (20 October 2026)

Levy Management & UOE Allocation shipped: `LevySchedule`, `LevyInstallment`, `LotLevyCharge`,
`LevyAdjustment` — no new ledger table; every posting goes through
`LedgerPostingService.postWithinTransaction` (new reusable contract, see ADR-023). Regular levies
derive their total exclusively from budget REVENUE lines linked to the `LEVY_INCOME` posting-profile
account (never assumed from unrelated income); special levies require explicit AGM/committee
approval evidence. Lot-level allocation uses `Space.entitlementValue` with the largest-remainder
rounding method (ADR-022) — exact reconciliation, no residual fudge. Issuance posts one aggregated,
fund-balanced journal per schedule and writes every `LotLevyCharge` atomically in the same
transaction; idempotent and concurrency-safe via the same `FinancialConfiguration` lock discipline
as every other M16.2.2 producer. Issued charges are immutable — corrections are a posted
`LevyAdjustment` or a full schedule reversal via `LedgerPostingService.reverse()`, never a direct
edit. Owner notices integrate with the existing Communications module (ADR-023) as a best-effort,
non-blocking post-commit step. New frontend: Levy Schedules list (with Regular/Special creation)
and Levy Schedule Detail (lot allocation preview, issuance, audit history) — both designed in
Stitch (project `17365736688974073408`) before implementation.

**Result: 850/851 backend tests (60 files, 20 new for this milestone; the single failure is a
pre-existing live AI-vision test timing out against an external API — `strata-plan-vision-
live.test.ts`, unrelated to any financial code, not a regression), 222/222 frontend tests
(40 files), typecheck and lint clean on both.**

## Decisions still requiring explicit client/accountant confirmation before production

Carried from the architecture blueprint (D1–D12) and this milestone's ADRs — not blocking further
development, but blocking a production accounting go-live:

- D1/D2/D3 (CoA ownership, fund flexibility, code-range meaning) — ADR-016, recommendation applied, confirmation still requested.
- D4 (exact Remaining/Actual/Committed formula) — ADR-018, recommendation only.
- D5 (advance payment posting) — ADR-018, recommendation only.
- D6 (GST registration/BAS cycle per scheme) — ADR-018, **mandatory accountant validation before any scheme is GST-enabled**.
- D8 (opening receivable fund split) — ADR-018, recommendation only.
- D9 (Finalise Book semantics match or diverge from the reference product) — ADR-018, open question #11 from the requirements doc.

## M16.3 closure verification & financial end-to-end demo (20 October 2026)

A focused closure review of the levy workflow (lot charge reconciliation, concurrent-issuance
idempotency, reversal/adjustment audit trail integrity, levy-income budget-line funding gate,
financial permission/property isolation, notice-delivery/posting independence) found **one genuine
defect**:

- **`LevyService.reverseIssuance()` reversed the GL and updated the lot subledger in two separate
  transactions.** A crash between them would leave the ledger reversed but `LevySchedule`/
  `LotLevyCharge` still showing `ISSUED` — the same class of atomicity gap already closed in
  `LedgerPostingService.reverse()` itself during the M16.2.2 closure pass. Fixed by adding
  `LedgerPostingService.reverseWithinTransaction()` (mirroring the existing
  `postWithinTransaction()` contract) and rewriting `reverseIssuance()` to perform the lock, the
  "already reversed" check, the GL reversal, the subledger update, and the activity record all
  inside one transaction. Verified with a new true-concurrency test asserting exactly one reversal
  journal, a fully `CANCELLED` subledger, and a zero receivable balance on the trial balance after
  two simultaneous reversal requests.

Every other reviewed area was already correctly enforced by the existing M16.3 implementation and
its 20 integration tests — no further defects found. **Full suite after the fix: 856/857 backend
tests passing (62 files); the one failure (`financial-accounts.test.ts` — "rejects a cross-property
account reference") is a 5s-timeout flake under full-suite load, confirmed passing in isolation in
279ms, unrelated to any file this closure pass touched.**

### Email-safety gate (zero outbound email)

Before any demo data was created, outbound email was verified suppressed at the single shared
transport chokepoint (`EmailService.send()` in `src/lib/email.ts`), two layers deep:

1. The pre-existing test-time mock (`vi.mock('.../lib/email.js', ...)`, already used by every test
   touching a real send path) — re-verified with a new regression test
   (`test/unit/emailSuppression.test.ts`).
2. A new `EMAIL_SEND_DISABLED` env-gated kill switch inside `EmailService.send()` itself, checked
   *before* any provider (SMTP/Resend) is selected or constructed — so a suppressed send never
   opens a network connection. Verified directly (`test/unit/emailSuppressionReal.test.ts`) by
   spying on `selectEmailProvider` and proving it is never called while suppressed, while also
   proving the spy is a meaningful negative (it *is* called when actually invoked). Set to `true`
   in both `.env` (the real dev credentials file) and `.env.test` (defense in depth).

Exhaustive grep confirmed exactly 4 call sites to `emailService.send()` exist in the codebase
(`invites.service.ts`, `communications.delivery.ts` ×2, `quote-rounds.service.ts` ×1) plus the
two in-process background schedulers started by `main.ts` (`getDeliveryScheduler()`,
`getComplianceScheduler()`) — every one funnels through the same chokepoint, so no bypass path
exists. Those two schedulers actually fired during the demo run (their periodic sweep found queued
communications/compliance items from this dev database's existing data) — the backend log shows
**24 "Outbound email suppressed" warnings, zero SMTP/Resend connection attempts**, confirming the
kill switch intercepted a real recurring send path live, not just a theoretical one.

### Harbour View Strata demo property

A persistent demo property, "WaslProp Demo — Harbour View Strata" (code `HARBOURVIEW-DEMO`,
organisation "Iconic Property Care"), was created via real API calls (no direct DB writes) under
`hello@amaltventures.com`, exercising the full lifecycle: 12 residential lots (varied UOE, 60–120,
total 950) → 12 fictional owners (`*.invalid` emails, never deliverable) → financial onboarding
(FY2026/27, two funds with distinct opening cash balances) → 18-account Chart of Accounts →
11-rule posting profile → one FY accounting period → opening journal (fund cash vs. opening
balance equity) → one FY2026/27 budget (REVENUE + EXPENDITURE lines for both funds, $96,000 Admin
/ $48,000 Capital Works) → two quarterly regular levy schedules (4 × $24,000 and 4 × $12,000) →
preview, approval, and issuance. Full detail, figures, and reconciliation evidence:
`docs/testing/financial-e2e-demo-report.md`. The property, its lots, owners, and all posted
journals are preserved for manual review — not deleted after testing.

## M16.3 refinement pass (20 October 2026, post-demo review)

Reviewing the completed Harbour View Strata demo and its screens against real NSW strata practice
surfaced six findings, all addressed without rebuilding the core workflow — see ADR-024 for full
detail:

1. **Budgets stayed APPROVED, never ACTIVE, while levies were issued against them.** Found to be
   a genuine lifecycle gap, not a demo-script omission: `APPROVED` alone doesn't reliably identify
   the financial year's one operative plan (two budgets for the same FY can both reach `APPROVED`).
   `LevyService.deriveRegularTotal` now requires the budget's status to be `ACTIVE`.
2. **Raw lot database ids in the levy charge table** — `GET .../lot-levy-charges` now returns
   `lotLabel`, `fundName`, `levyScheduleName`, `installmentNumber`, `dueDate`, and (gated on the
   caller separately holding `people.view`) `ownerName`. Never a raw `spaceId`/cuid shown as the
   lot identifier.
3. **Whole-schedule issuance did not match NSW practice.** Researched against Strata Schemes
   Management Act 2015 s.81/s.85 (contributions are determined once but levied — and interest-
   accrued — per instalment, at each instalment's own date). `LevyInstallment` is now the real
   issuance/reversal unit (new `status`/`issuedAt`/`journalEntryId`/reversal fields,
   `LevyScheduleStatus.PARTIALLY_ISSUED`), with a migration (`20261020141640_...`) that backfills
   every pre-existing whole-schedule issuance's detail onto its instalments — no posted journal,
   charge, or schedule record was rewritten, deleted, or reissued.
4. **Trial balance showed a signed "net" figure** (a credit-normal account read as negative
   revenue) **with no fund filter.** Added `presentedSide`/`presentedBalance` (conventional
   Debit/Credit-column presentation) and an optional `financialFundId` query filter; the raw
   `totalDebit`/`totalCredit`/`netBalance` fields are unchanged.
5. **Levy notices were generic**, with no per-lot figure (a documented M16.3 limitation —
   `Communication.body` has no per-recipient merge-field templating). Now one Communication PER
   charged lot, each containing that lot's own fund/amount/due date/instalment number — verified
   still fully suppressed in demo/test mode by the existing `EMAIL_SEND_DISABLED` kill switch and
   test-time mock (no code path change to the suppression layer itself was needed; new/updated
   tests re-verify it end to end through the per-lot notice path).
6. **Financial overview dashboard** — proposed, not built this pass (see the Stitch design brief
   referenced in `financial-management-implementation-plan.md`); a design-first screen to surface
   fund balances, levy receivables, budget status, and recent financial activity in one place.

**Result after this pass: 863/863 backend tests passing (62 files; `financial-levies.test.ts` alone
27/27, 6 net-new for this refinement: multi-instalment separate-issuance including out-of-order
targeting, per-instalment reversal isolation, cancel-after-issue-then-reverse,
charge-view enrichment, people.view gating, trial-balance fund filter/presentation), typecheck and
lint clean on both repos. Frontend: 223/223 (1 new). Demo property (`HARBOURVIEW-DEMO`)
re-verified live against the corrected workflow via its real API — its FY2026/27 budget was
activated (fixing finding 1 on real data), and its full prior posted history (96 lot levy charges,
both funds' journals) is byte-identical to before this pass, preserved untouched.**

## Financial Overview Dashboard implemented (20 October 2026, same day, following the refinement pass)

The dashboard proposed (not built) in the refinement pass above is now implemented. Inspected the
actual Stitch-generated HTML (not just its screenshot) for the "Financial Overview Dashboard
(Proposal Desktop)" screen and implemented it faithfully using the app's existing component
library/design tokens — **except** for the mock's own fabricated figures (bank account numbers,
a "Target Buffer"/variance against an unconfigured target, a "10-Year Plan Forecast", a "fully
funded %" compliance claim, an invented generic activity timeline), which this accounting
implementation does not have real data for and which the brief's data-integrity requirement
explicitly rules out reproducing. Those are replaced with either a real equivalent (e.g. the
fund's actual configured cash account and recorded opening balance, instead of a fabricated bank
account number) or an honest "not configured"/"not available" state.

**No new backend endpoint was added** — every figure is composed client-side from existing
endpoints/hooks already in use elsewhere in the app (`GET .../financials`,
`.../posting-profile`, `.../trial-balance`, `.../budgets`, `.../levy-schedules`,
`.../lot-levy-charges`, `.../journals`, `.../periods`, `.../accounts`), reusing
`financials.view`'s existing backend enforcement on every one of them. Pure composition logic
(fund cash balance resolution via the posting profile, budget-vs-actual pairing, levy receivable
totals, trial-balance-balanced check, posting-profile completeness) lives in
`waslproperty-frontend/src/modules/financials/dashboard-selectors.ts`, unit-tested independently
of rendering. No OpenAPI change was needed (no API changed).

New route `/properties/:propertyId/financials/overview`
(`FinancialOverviewDashboardPage.tsx`), linked from the existing Financials tab. Sections:
per-fund cash balance KPIs + detail cards (real cash account, real recorded opening balance —
never a fabricated bank account number), Levy Receivables Outstanding (explicitly labelled as a
receivable, not cash received — WaslProp has no receipts/payments yet), Current Budget Status,
Fund Balances comparative bar, Levy Schedules table (status/total/next due date), Budget vs
Actual (budgeted REVENUE vs posted LEVY_INCOME per fund — budgeted/actual EXPENDITURE is
explicitly labelled unavailable, since WaslProp posts no actual expenditure yet), Recent
Journals + trial-balance-balanced badge, and a Financial Setup Status checklist (CoA count,
posting-profile completeness, open-period coverage) — the one section the Stitch mock didn't
depict at all, added using the same existing card/badge components for the brief's explicit
"financial setup status" requirement.

**Verified live against the Harbour View Strata demo property** (`HARBOURVIEW-DEMO`) by
replicating the selector composition against its real API responses: Administration Fund
$42,500.00, Capital Works Fund $118,750.50 (total $161,250.50 cash); both levy schedules now
fully issued (8/8 instalments, 0 pending) with $144,000.00 outstanding receivables; FY2026/27
budget ACTIVE with both funds at 100% of budgeted levy income posted; trial balance balanced at
$305,250.50 each side; posting profile complete; no missing setup. No demo data was modified.

**Result: 236/236 frontend tests passing (43 files; 13 new — 11 selector unit tests +
2 dashboard component tests, including an explicit assertion that none of the Stitch mock's
fabricated figures ever render), typecheck and lint clean. No backend files changed this pass.**

## Financial Overview Dashboard — UX refinement (20 October 2026, same day)

The dashboard above was reviewed as too dense (narrow centered column, excessive nested bordered
cards). Revised in Stitch by editing the existing screen (not an independent redesign) — the
regenerated screen widens the content area to `max-w-[1400px]`, drops the nested-card pattern down
to one outer surface per section, and restructures into exactly the sections requested: a plain
header (title, FY, one budget-status badge), 4 KPI cards (Total Cash Across Funds, Outstanding
Levy Receivables, Annual Levy Budget, Ledger Reconciliation), a single-surface Fund Balances
comparison, two side-by-side panels (Levy Schedules, Recent Ledger Activity), and a slim secondary
strip (Budget Summary + Financial Setup Status) rather than full cards.

**Financial accuracy, carried through the redesign:** "Outstanding Levy Receivables" is captioned
"N of M instalments issued — levied, not yet received" (never implies cash collected); "Annual
Levy Budget" sums only each fund's REVENUE lines linked to its LEVY_INCOME account (the same
figures Budget vs Actual already paired against posted income), not every budgeted revenue line;
budgeted vs actual EXPENDITURE is still not shown anywhere (WaslProp posts no actual expenditure
yet); the Stitch mock's own sample "Recent Ledger Activity" rows (a fabricated +/- cash-flow sign
per journal, a contractor payment, a bank-interest credit) were not reproduced — WaslProp's
double-entry journals have no single "is this an inflow" direction to color that way without
inventing one, so journal amounts are shown plainly with their real source-type badge.

**Financial Overview is now the primary landing view of the Financials section** — selecting the
"Financials" tab on Property 360 navigates straight to `/properties/:id/financials/overview`
instead of an inline summary panel. The now-fully-superseded `FinancialsTab` component (and its
test file) were deleted as genuinely dead code, not left as an unused shim.

No backend endpoint was touched — same composition-only architecture as the dashboard's first
implementation. **Result: 232/232 frontend tests passing (42 files — one pre-existing file for the
deleted component removed, its coverage absorbed into `property-detail.test.tsx`'s navigation
assertion), typecheck and lint clean. Verified live against the Harbour View Strata demo property's
real API: Total Cash AUD 161,250.50, Outstanding Levy Receivables AUD 144,000.00 (8 of 8
instalments issued), Annual Levy Budget AUD 144,000.00, Ledger Reconciliation balanced at
AUD 305,250.50 each side — unchanged from the prior pass, confirming the redesign introduced no
figure drift.**

## General Ledger / Trial Balance UI polish + dashboard follow-ups (20 October 2026, same day)

Focused consistency pass, not a redesign: widened `JournalsPage` to the dashboard's `max-w-[1400px]`
standard; generated a new Stitch screen ("General Ledger: Journals & Trial Balance (Desktop)",
inspected before implementing) since no such screen actually existed in the project despite an old
code comment claiming otherwise (same gap found and documented during the original M16.3 Stitch
pass). Journals tab rebuilt as a two-column list + detail panel: fixed-width Reference/Date/Source/
Total/Status columns, an unconstrained wrapping Narration column (no `truncate`, nothing cut with
an ellipsis), and a sticky detail panel showing the selected journal's full line-level detail
(account, fund, debit, credit, totals) — reusing the list endpoint's own already-included
`lines`, no new API call. Added a real client-side search over reference/narration.

Two small, in-scope dashboard follow-ups (not a KPI redesign): (1) the Fund Balances section once
again shows each fund's real configured cash-account name (e.g. "101000 — Term Deposit — Capital
Works Fund") so a reader can tell cash-at-bank from a term deposit — using only the account name
text the system already has, since `AccountingAccount.classification` has no separate liquidity
subtype to draw on (no new classification was invented); (2) Financial Setup Status collapses to
one "All set up" line when the posting profile is complete and a period is open today, expanding
back to the full per-item checklist only when something needs attention.

**No backend changes** — everything was achievable from already-fetched data. Full frontend suite:
**235/235 passing** (44 files, 4 new — 3 for the rebuilt Journals page), typecheck and lint clean.
Verified live against the Harbour View Strata demo: journals endpoint already returns full
`lines` for all 3 posted journals; FUND_CASH posting-profile accounts confirmed as `100000 — Cash

## M16.3 Financial UI Closure — Budget & Levy screens (21 October 2026)

All six Budget/Levy screens (Budget List, Budget Detail, Record Existing Budget, Levy Schedules
List, Levy Schedule Detail, Special Levy creation — the last embedded in the Levy Schedules List
page's own modal, confirmed by reading the file rather than assuming a separate route exists)
brought to the Financial Overview Dashboard's width/spacing standard. Stitch-first: two new
screens generated and inspected before implementing — "Budget Detail (Desktop FY 2026/27 v2)" and
"Levy Schedule Detail (Desktop)" (both project `17365736688974073408`, design system
`assets/2931000950875540063`) — covering the two screens whose structure changed materially; the
remaining four screens reused the already-approved table/width conventions from the dashboard,
Journals, and these two new screens directly, rather than generating a near-duplicate Stitch
screen for a page that only needed a width/table-readability pass.

**Budget lifecycle bug (item 4), root-caused and fixed in the backend:** `activate()` only ever
superseded whichever budget was currently ACTIVE — never an APPROVED ancestor earlier in the
*activated* budget's own revision chain that had been skipped over (e.g. v1 approved, then v2
created as v1's revision and activated directly, leaving v1 stuck APPROVED forever even though v2
was now ACTIVE). Fixed in `budgets.service.ts`'s `activate()` by walking the activated budget's
own `revisionOfBudgetId` chain and superseding any still-APPROVED ancestor found in it — never an
unrelated APPROVED budget outside that lineage. `approvedAt`/`approvedByUserId`/`lines` are never
touched, only `status`/`supersededAt`, preserving the historical approval record exactly as it
happened. `FinancialBudgetStatus`'s doc comment in `schema.prisma` updated to document this one
exception to the "strictly forward" state machine. Two new backend tests added (ancestor correctly
superseded on activation; an APPROVED budget in an unrelated financial year is left untouched);
one pre-existing concurrency test's assertion was loosened from a fixed `[200, 200]` to an
invariant-based check (`toContain(200)` plus every status ∈ {200, 409}, plus exactly one ACTIVE
budget in the DB afterwards) since the fix makes the pairing genuinely lock-order-dependent —
verified non-flaky over 5 repeated runs either way the race resolves.

**Budget List (item 4, UI half):** history is now grouped by financial year (newest year first,
versions within a year newest-first), each row showing "revision of vN" / "superseded by vN" text
derived from `revisionOfBudgetId` — made trustworthy by the lifecycle fix above, since a SUPERSEDED
row now always really is non-current. **Budget Detail (item 3):** each fund's lines are now a real
financial table (account code, name/category, type badge, description, planned amount) with a
Revenue/Expenditure group divider and a fund subtotal/net row, replacing the prior stacked-card
line list; all lifecycle actions (approve/activate/revise) and calculations
(totalBudgetedRevenue/Expenditure/surplus) are unchanged. **Record Existing Budget (item 5):** the
CREATED/IMPORTED source toggle is now two self-explanatory cards instead of two plain buttons, and
a "use this scheme's current financial year" quick-fill was added; the accounting meaning of an
IMPORTED budget (its `source` value and where its approval evidence is recorded) is unchanged —
left at its existing narrow form width, since a short form doesn't benefit from the 1400px
convention the data-dense screens use. **Levy Schedules List (item 6):** widened; added "instalments
issued" (N of M) and "next due date" columns, both derived from data the list endpoint already
returns (`installments[]` is already included — confirmed in `levies.service.ts`'s `list()` —
so no backend change was needed). **Levy Schedule Detail (item 7):** split into three tabs —
Instalments (unchanged issue/reverse table), Lot Allocations (added a client-side search box), and
Charge History (added a client-side search box plus 10-per-page pagination) — so each scales
independently rather than stacking indefinitely on one page; `listLotLevyCharges` already returns
every charge with no backend pagination, and a scheme's realistic charge counts (lots × issued
instalments) are well within what client-side paging handles cleanly, so no new endpoint was added.
No payment/arrears status is shown or implied anywhere — `LotLevyCharge.status` is rendered
plainly (ISSUED/CANCELLED only; PART_PAID/PAID/OVERDUE are schema-anticipated for a future
payments milestone and are never actually set by this codebase). **Special Levy (item 8):** the
creation modal (in Levy Schedules List) now shows a running total per instalment row as it's
entered, and an explicit note that approval evidence is text-only — WaslProp has no meeting-minutes
or document-attachment feature to link a resolution to, confirmed by grep across both repos (a
"meeting" module doesn't exist; `PropertyDocument` is a dedicated strata-plan-onboarding extraction
pipeline, not a general attachment store) — documented as a gap rather than papered over with an
invented upload feature. The pre-issuance preview requirement is met by the Lot Allocations tab
above, which already applies to Special schedules (the code doesn't discriminate by `kind`).

**Result:** backend — 70/70 passing (`financial-budgets.test.ts` 43/43 including 2 new tests,
`financial-levies.test.ts` 27/27 unaffected), `prisma format` clean (comment-only schema change, no
migration). Frontend — 235/235 passing after updating 2 pre-existing tests whose assertions
targeted now-intentionally-changed UI (a budget-history row's clickable text, and the levy charges
table now living behind its own tab) rather than a regression; typecheck (`tsc -b`) and lint clean.
No new backend endpoints were added — every screen reused its existing API contract. Verification
was by targeted test runs and reading real API response shapes, not a live browser session — no
browser-automation tool is available in this environment, so visual fidelity against the Stitch
screenshots was not independently confirmed beyond inspecting the generated HTML/screenshot
output before implementing, consistent with every prior UI milestone in this project.

**Remaining gap, carried forward (not started here):** Special Levy approval evidence has no
document/meeting-record attachment — a real product gap, not an oversight, flagged for a future
milestone decision rather than solved by inventing a minimal upload feature out of scope for this
closure pass. M16.4 was explicitly not started.

## M16.4 — Lot Ledger & Owner Financial Accounts (21 October 2026)

**Data model:** no migration. The Lot Ledger is a read-only projection over `LotOpeningPosition`
(M16.1), `LotLevyCharge`/`LevyAdjustment` (M16.3) — see ADR-025 for the full decision record
("no new persisted subledger table," sign convention, fund-attribution honesty, deterministic
ordering, and why pagination computes the running balance over the complete row set before
slicing). `LotLedgerService` is the single place that builds this row set; the financial-account
summary, the ledger listing, and the statement all read from it, so the balance math can never
disagree with itself across the three.

**Backend:** `src/modules/financials/lot-ledger.{service,controller,schemas}.ts`, three new routes
under the existing `/:propertyId/financials/...` convention: `GET .../lots/:spaceId/financial-account`,
`.../lots/:spaceId/ledger` (paginated, filterable by fund/type/date range), `.../lots/:spaceId/statement`
(explicit period; opening + movements = closing, asserted in tests). All three require
`financials.view`; `people.view` is checked independently inside the controller before `ownerName`
is populated — never bundled into a financials-gated response by default, same split as
`listLotLevyCharges` (M16.3). Owner names are resolved from `PropertyMembership` (role=OWNER,
status=ACTIVE) at request time — the ledger itself carries no owner reference anywhere, so an
ownership change never loses or reattributes history (verified by test: end one OWNER membership,
add another, the lot's balance and transaction count are unchanged, only the displayed name
updates). OpenAPI updated (`financial-lot-ledger.paths.ts`, new `Lot*` schemas in
`entities.schemas.ts`); `openapi-route-coverage.test.ts` confirms all three routes are documented.

**Frontend:** three new screens — Lot Financial Account (Stitch-designed, project
`17365736688974073408`, screen "Wasl Property — Lot Financial Account (Desktop)" — hero balance
card, 4 plain KPI cards with no fabricated payment-status chip, fund breakdown table, last-activity
line), Lot Ledger (reuses the M16.3 Levy Schedule Detail "Charge History" tab's filter/pagination
table conventions rather than a near-duplicate Stitch generation — see the page's own doc comment),
and Lot Statement (print-friendly via `window.print()` with `print:hidden` added to
`DesktopSidebar`/`TopBar`/`MobileHeader`/`AppShell`'s content wrapper; **no PDF export** — WaslProp
has no existing, reusable server-side PDF-generation pattern this milestone could safely extend,
so PDF export is documented as a follow-up rather than faked with a dead button). Integration:
a "Financial account" action on `SpaceDetailPage` (gated on `isStrataLot && financials.view`), a
drill-down from every Levy Schedule Detail "Charge History" row's lot label straight to that lot's
ledger, and a modest "View lot accounts" link from the Financial Overview Dashboard's Levy
Schedules panel (no new KPI card, nothing added to the dashboard's own 4-KPI row). The Property
Overview's "Annual strata levies" Coming Soon card was already replaced in an earlier session
(`PropertyFinancialsSummaryCard`) — reviewed again here and confirmed still accurate; no further
change needed.

**Explicitly not built (M16.9 out-of-scope list):** payment gateways, bank feeds/reconciliation,
automatic payment matching, manual payment posting, interest calculation, debt recovery, arrears
reminders, an owner payment portal. `LotFinancialAccount` has no payment-status field and the UI
has no payment button anywhere — confirmed by test (`screen.queryByRole('button', {name: /pay/i})`
asserted absent).

**Result:** backend — new `financial-lot-ledger.test.ts`, 21/21 passing (opening debit/credit/zero,
issued-vs-unissued instalments, partial issuance, regular+special levies, reversal visibility
alongside the original charge, no duplicate entries, deterministic ordering, running balance
correct across 2 pages, multi-fund breakdown excluding the unattributed opening row, cross-property
and cross-organisation 404 isolation, financials.view-only 403, people.view-independent owner-name
gating, ownership-change history survival, Decimal precision across opening+charge+adjustment,
statement reconciliation, empty period, and a financial-year-boundary exclusion test); full backend
suite 886/886 passing (63 files), `tsc --noEmit` clean, lint clean. Frontend — 3 new test files
(10 tests: balance classification + no-payment-UI assertions, reversal-row linkage + pagination +
filter reset, statement reconciliation + print-not-PDF + empty period), full suite 258/258 passing
(49 files), typecheck and lint clean.

**Known limitations:** (1) no PDF export (documented above, follow-up); (2) the ledger/statement
endpoints have no free-text search parameter, so neither page offers one — documented in each
page's own comment rather than faking client-side search that would silently stop working past one
page; (3) `getStatement`'s and `getLedger`'s in-memory pagination/filtering is correct only because
a single lot's transaction count is bounded by construction (see ADR-025) — this would need
revisiting if that bound were ever lifted, which nothing in M16.4 does.

**M16.5 readiness:** the Lot Ledger's row-type model has an obvious, additive extension point for a
future payments/receipts milestone (one more row type, following the same "derive from
authoritative records" discipline) — but that is a new accounting design in its own right and was
explicitly not started here.
at Bank — Administrative Fund` and `101000 — Term Deposit — Capital Works Fund`.

## M16.5 — Receipts & Payment Allocation (21 October 2026)

**Data model:** two new tables, `Receipt` and `PaymentAllocation` (migrations
`20261021064805_m16_5_receipts_and_payment_allocation`, `20261021065222_m16_5_receipt_activity_events`).
Full accounting-design rationale in **ADR-026**: a `Receipt` is the cash event (always posts
Dr fund cash / Cr `UNAPPLIED_CASH`, unconditionally); a `PaymentAllocation` is the separate
application event (Dr `UNAPPLIED_CASH` / Cr `LOT_LEVY_RECEIVABLE`), posted as its own journal even
when "immediate." Cross-fund allocation is explicitly rejected (409), not built. `LotLevyCharge.status`
is now driven by allocations, using the `PART_PAID`/`PAID` enum values M16.1 had already reserved
for exactly this.

**Backend:** `src/modules/financials/receipts.{service,controller,schemas}.ts`, six new routes
under `/:propertyId/financials/...`: `POST .../receipts` (record, with optional immediate manual or
auto allocation), `GET .../receipts`, `GET .../receipts/:receiptId`, `POST .../receipts/:receiptId/reverse`,
`POST .../receipts/:receiptId/allocations` (allocate previously-unapplied cash), `POST
.../payment-allocations/:allocationId/reverse`. `recordReceipt`/`reverseReceipt`/`createAllocation`/
`reverseAllocation` require `financials.approve` (they post immediately, matching the levy module's
own bar); `listReceipts`/`getReceipt` require `financials.view`, with `people.view` checked
independently for `ownerName` — same split as every other financials endpoint. `LedgerPostingService`'s
existing subledger-reversal guard was extended to cover `RECEIPT`/`PAYMENT_ALLOCATION` sourceTypes,
so neither journal can be reversed through the generic manual-journal endpoint and leave
`Receipt.status`/`PaymentAllocation.status`/`LotLevyCharge.status` out of sync with the GL — the
exact same risk ADR-024's levy guard already protected against. OpenAPI updated
(`financial-receipts.paths.ts`, new `Receipt`/`PaymentAllocation` schemas in `entities.schemas.ts`);
`openapi-route-coverage.test.ts` confirms all six routes are documented. Lot Ledger (ADR-025)
extended with three new row types (`RECEIPT`, `RECEIPT_REVERSAL`, `PAYMENT_ALLOCATION` — the last
always rendered debit=0/credit=0, since its money was already counted once on the `RECEIPT` row)
and two new summary fields (`totalReceipts`, `totalUnapplied`).

**Frontend:** Record Receipt and Allocate Payment modals, and a standalone Receipt Detail page —
all three designed in Stitch first (project `17365736688974073408`: "Wasl Property — Record Receipt
Modal (Desktop)", "Wasl Property — Allocate Payment Modal (Desktop)", "Wasl Property — Receipt
Detail RCT-4H8D1Q (Desktop)"), inspected, then implemented against the real API using existing
shared components (`FormModal`, `RadioCardGroup`, `SegmentedControl`, `Select`, `StatTile`,
`ProgressBar`) rather than copy-pasted Stitch markup. Lot Financial Account gained a "Record
Receipt" action (gated on `financials.approve`), two new KPI cards (Total Receipts, Unapplied
Balance), a Receipts fund-column and a Receipts list linking to each receipt's detail page. Lot
Ledger renders the three new row types via the same table. Financial Overview Dashboard gained an
"Unapplied Credits" KPI (property-wide, distinct from Outstanding Levy Receivables) — explicitly
does not claim any bank-reconciliation status, since this system does not yet track one.

**Result:** backend — new `financial-receipts.test.ts`, 29/29 passing (full/partial allocation,
multiple charges per receipt, auto-allocation ageing order, leftover-stays-unapplied, advance
payment allocated later, over-allocation rejection (both against the charge and against the
receipt), cross-fund rejection, duplicate-idempotency-key safety for both receipt and allocation
creation, reversal of an unallocated receipt, the staged-unwind block on a receipt with an active
allocation, reversal-then-reversal rejection, the generic-journal-reversal guard, exact Decimal
arithmetic on a non-round-cent split, a closed-period rejection, Lot Ledger no-double-counting
assertions (including an advance-only lot and a post-reversal lot), cross-property/cross-org 404
isolation, `financials.approve`/`financials.view` 403s, a concurrent-allocation race that is
serialized to exactly one success, and a regression check that M16.3/M16.4's own levy
issue/reverse flow is unaffected); full backend suite 920/920 passing (64 files), `tsc --noEmit`
clean, lint clean (2 pre-existing unrelated warnings only). One real bug was found and fixed during
test-writing: `applyAllocationWithinTransaction`'s idempotency check originally ran *after* the
over-allocation checks, so a retried allocation request would fail once the first attempt had
already fully paid the charge — the idempotency lookup was moved to run first, immediately after
the receipt/charge existence checks, so a genuine retry always returns the original result
regardless of how the balance has since moved. Frontend — `tsc --noEmit`/`npm run build` clean
(one generic-inference build error from `SegmentedControl`/`RadioCardGroup` needing an explicit
type argument in build mode, fixed), full suite 258/258 passing (49 files, including two existing
Financial Overview Dashboard assertions extended to cover the new mocked `receipt-api` and the
Unapplied Credits KPI), lint clean.

**Harbour View Strata live demonstration (21 October 2026, same day):** executed against the real
demo property (`PROP-TNET87`, code `HARBOURVIEW-DEMO`, verified by code before any write) via
authenticated API calls as Olivia Bennett — no reset, no reseed, no browser automation available
(UI click-through NOT TESTED; API-level validation only). Email safety: `EMAIL_SEND_DISABLED=true`
confirmed in the running server's environment and `isEmailSendSuppressed()`'s short-circuit (before
any provider client is constructed) re-confirmed in code; no notification-triggering endpoint was
called by any of the five scenarios below in any case (`recordReceipt`/`createAllocation`/
`reverseAllocation` never call the email service). Baseline trial balance before any scenario:
AUD 389,250.50 debit = credit. Five scenarios, all via real API calls, each verified to the cent:

1. **Fully paid charge** — Lot 1, receipt RCT-NLJSLU, AUD 3,031.58 bank transfer, fully allocated
   to LVC-UCHUKA in one call. Charge status ISSUED → **PAID**. Lot balance 16,673.69 → 13,642.11
   (exactly −3,031.58).
2. **Partially paid charge** — Lot 2, receipt RCT-RUAX99, AUD 1,000.00 cash, allocated against
   LVC-K56EJV (face value 2,400.00). Charge status ISSUED → **PART_PAID**. Lot balance 13,200.00 →
   12,200.00 (exactly −1,000.00).
3. **One receipt across multiple charges** — Lot 3, receipt RCT-VTPU34, AUD 3,400.00 bank transfer,
   allocated 2,400.00 to LVC-YXU8RJ (→ **PAID**) and 1,000.00 to LVC-6QQDKS (→ **PART_PAID**) in the
   same request, as two separate allocation journals. Lot balance 13,200.00 → 9,800.00 (exactly
   −3,400.00).
4. **Advance/unapplied payment** — Lot 4, receipt RCT-YPPGQS, AUD 500.00 bank transfer, no
   allocation. `appliedAmount` 0.00, `unappliedAmount` 500.00. Lot balance 11,115.79 → 10,615.79
   (the credit is counted even though unapplied, per ADR-026 — never force-allocated).
5. **Controlled reversal** — Lot 5, receipt RCT-YLKBMJ, AUD 2,021.05 cheque, allocated in full to
   LVC-MUXCKD (→ PAID), then the allocation itself reversed ("allocated to the wrong instalment").
   Charge status reverted PAID → **ISSUED**; receipt's `unappliedAmount` returned to 2,021.05; the
   Lot Ledger shows one `PAYMENT_ALLOCATION` row whose description reflects the reversed state
   (debit/credit still 0.00/0.00 — the reversal never creates a second, differently-valued row).
   Lot balance settled at 9,094.74, exactly matching the Lot Ledger's own final running balance.

After all five scenarios: trial balance AUD 410,676.81 debit = credit (still balanced — the
increase is the double-entry effect of 9 new journals: 5 receipt postings + 4 net allocation
postings, after the one allocation reversal). Exactly 5 `Receipt` records exist for the property
(no duplicate postings from any retried or malformed request). Every `LotLevyCharge.status`
transition matched its scenario exactly: LVC-UCHUKA → PAID, LVC-K56EJV → PART_PAID, LVC-YXU8RJ →
PAID, LVC-6QQDKS → PART_PAID, LVC-MUXCKD → ISSUED (reverted). All demo records were left in place
for manual review — no cleanup, no reset.

**Known limitations:** (1) cross-fund allocation is rejected, not implemented — a single payment
covering two funds must be recorded as two separate receipts (documented gap, ADR-026); (2) no
true bank reconciliation — `externalBankReference` is a stored reference only, never implying a
reconciled state (M16.7 scope); (3) UI click-through for the three new Stitch-designed screens was
NOT TESTED in a real browser this session (no browser automation tool available) — only the
underlying API calls and the React Testing Library suite were exercised; (4) the Financial Overview
Dashboard's "Unapplied Credits" KPI makes one extra `GET .../receipts` call property-wide — fine at
today's scale (the same bounded-per-lot argument ADR-025 makes does not directly apply here, since
this is property-wide rather than per-lot; worth revisiting if a scheme's receipt volume ever
becomes very large).

**M16.6 readiness:** Arrears Management (resequenced from M16.7, see the renumbering note above)
can now build on real `LotLevyCharge.status`/`PaymentAllocation` data instead of issued-but-possibly-
already-paid charges — ageing, reminders, and interest calculations have an honest "is this actually
still owed" signal to key off for the first time.

## M16.6 — Arrears Management (21 October 2026)

**Phase 0 — reconciliation finding, pre-implementation.** Investigated the trial-balance gap
described at the start of this milestone (claimed M16.4-confirmed 293,250.50 vs M16.5-demo-start
389,250.50, "96,000.00 difference"). Reconstructed the real journal-by-journal running total for
Harbour View Strata: Opening 161,250.50 → +Admin levy issuance 96,000 → +CW levy issuance 96,000 →
**305,250.50** (the real, previously-verified M16.4 figure — not 293,250.50) → +CW reversal incident
48,000 → +its 36,000 correction (reinstating instalments #1–3, intentionally leaving #4 cancelled)
→ **389,250.50** (the real M16.5-demo-start figure, confirmed to match). The actual gap between the
two real figures is 84,000.00 (two real journals, both independently narrated and dated — the
earlier levy-reversal-incident test and its scoped correction), not 96,000.00, and the net true
economic effect is −12,000 on the Capital Works Fund, confirmed by exactly 12 `CANCELLED` charges
(one per lot, all Capital Works, all due 2027-06-15 — Instalment #4) summing to exactly
12,000.00. No duplicate or incorrect postings found. The "293,250.50" figure in the task's own
framing does not correspond to any real point-in-time snapshot and appears to be a miscalculation
(305,250.50 minus the incident's net effect applied to the wrong baseline) — reported here with full
evidence rather than silently accepted.

**M16.5 invariant verification (Phase 0).** All four re-verified live against Harbour View Strata:
(1) an unapplied receipt reduces net owing without marking any charge paid — confirmed (Lot 4/5's
advance receipts); (2) an allocation settles a specific charge without double-reducing the overall
balance — confirmed via the Lot Ledger's debit=0/credit=0 `PAYMENT_ALLOCATION` row convention
(ADR-026); (3) reversing an allocation restores the charge balance without reversing the receipt —
confirmed (Lot 5: `LVC-MUXCKD` reverted PAID→ISSUED, receipt stayed `RECORDED`); (4) reversing a
receipt correctly reverses the cash impact — confirmed live (Lot 5's receipt reversal returned its
balance to the exact pre-receipt baseline, 11,115.79, with a `RECEIPT_REVERSAL` row and a balanced
trial balance throughout). No invariant failed — Phase 0 cleared with no blocker.

**ADR-027 decisions:** arrears figures are computed live, never persisted (same discipline as
ADR-025/026); only the collection workflow (`CollectionCase`/`CollectionNote`/`PaymentReminder`) is
new persisted state; `LotLevyCharge`'s reserved `OVERDUE` status stays permanently unused (a stored
status can't represent two independent, date-relative and payment-state facts in one slot); as-of
dates drive genuine effective-dated reconstruction (not a today-only approximation); M16.1 opening
balances are reported separately with `ageingBucket: "UNKNOWN"`, never fabricated into an aged
position; NSW interest/notice/recovery-cost rules are explicitly out of scope and unresolved,
recorded for a future milestone; reminders are drafted/previewed only, the `communications` module
(real SMTP path) is deliberately not reused.

**Database:** two new enums (`CollectionCaseStatus`, `PaymentReminderStatus`) and three new tables
(`CollectionCase`, `CollectionNote`, `PaymentReminder`) — migration
`20261021110246_m16_6_arrears_management`. No change to `LotLevyCharge`/`Receipt`/
`PaymentAllocation`/`LotOpeningPosition` schemas — arrears reads them, never extends them.

**Backend:** `src/modules/financials/arrears.{service,controller,schemas}.ts`, ten new routes under
`/:propertyId/financials/arrears/...`: `GET .../summary`, `GET .../register`,
`GET .../lots/:spaceId`, `POST .../lots/:spaceId/collection-cases`, `GET`/`PATCH
.../collection-cases/:caseId`, `POST .../collection-cases/:caseId/notes`,
`POST .../lots/:spaceId/reminders`, `GET .../reminders/:reminderId`,
`POST .../reminders/:reminderId/cancel`. Reads require `financials.view`; collection-workflow
writes require `financials.manage` (reversible, non-ledger data — deliberately not gated on
`financials.approve`, reserved for immutable-ledger actions). OpenAPI updated
(`financial-arrears.paths.ts`, new `ArrearsSummary`/`LotArrearsDetail`/`CollectionCase`/
`PaymentReminder` schemas); `openapi-route-coverage.test.ts` confirms all ten routes are documented.

**A real posting-direction bug was found and fixed during Phase 6 live validation** (not a M16.6
defect — in M16.5's `receipts.service.ts`, shipped uncommitted in the prior session):
`applyAllocationWithinTransaction`'s `PAYMENT_ALLOCATION` journal posted **Dr LOT_LEVY_RECEIVABLE /
Cr UNAPPLIED_CASH** for an applied payment — backwards. `LevyService.createAdjustment` already
establishes the correct convention for this account (debit increases what's owed, credit decreases
it — confirmed from the actual levy-issuance and adjustment journals), so a payment being *applied*
must **credit** the receivable (asset decreases) and **debit** unapplied cash (liability clears),
never the reverse. The bug was silent because (a) each journal still balanced internally (both
lines flipped together, so `LedgerPostingService`'s own balance check never caught it), and (b) the
Lot Ledger/arrears/receipt-view figures everywhere in the UI are computed from `PaymentAllocation.
amount`/`status` directly — never by summing GL journal lines — so every user-facing balance figure
in M16.4/M16.5/M16.6 was correct throughout and remains correct. Only the GL's own
`LOT_LEVY_RECEIVABLE` *account balance* was distorted, and only for a fund that had actually
received an applied payment (Capital Works Fund in this demo never had one, so it was unaffected).
**Fixed** in `receipts.service.ts` (lines swapped, comment added referencing the correct
convention); a new regression test (`financial-receipts.test.ts`, "full and partial allocation") now
asserts the allocation journal's exact debit/credit per account. The resulting historical distortion
on Harbour View Strata's Administration Fund `LOT_LEVY_RECEIVABLE` balance was corrected with an
explicit, client-approved correcting journal — see "M16.5 historical correction (21 October 2026)"
below for the full investigation, approval, posting, and post-correction reconciliation evidence.
All M16.6 arrears/ageing figures reported in this document and in the live demo below were
unaffected throughout, since they never read this GL balance.

**Frontend:** four new screens — Arrears Dashboard, Arrears Register, Lot Arrears Detail, and a
Reminder Preview modal — all designed in Stitch first (project `17365736688974073408`: "Wasl
Property — Arrears Dashboard (Desktop)", "— Arrears Register (Desktop)", "— Lot Arrears Detail (Lot
12 Olivia Bennett)", "— Reminder Preview (Lot 12 Olivia Bennett)"), inspected, then implemented
against the real API. The Stitch mocks' own fabricated "Dispatch Notice"/"Send" buttons and an NSW
statutory citation were deliberately **not** carried into the implementation (ADR-027: drafted/
previewed only; no NSW requirement invented). Financial Overview gained a 6th KPI card ("Overdue
Receivables", linking to the Arrears Dashboard) distinct from "Outstanding Levy Receivables" and
"Unapplied Credits" — three separate figures, never merged.

**Result:** backend — new `financial-arrears.test.ts`, 23/23 passing (not-yet-due vs overdue,
partial/full payment, multiple receipts to one charge, one receipt across multiple charges,
unapplied credit kept separate, cancelled-instalment exclusion, signed adjustments in both
directions, allocation reversal restoring arrears, receipt reversal clearing cash impact, opening
balances shown separately with unknown ageing, exact ageing-bucket day boundaries (30/31/60/61/90/
91), as-of-date day boundaries, historical pre-issuance exclusion, cross-fund aggregation, collection
notes + audit history, a closed case blocking further updates, reminder draft + cancel with no send
path, email-service-never-called, and cross-property/cross-org/permission isolation); full backend
suite 943/943 passing (65 files), `tsc --noEmit` clean, lint clean (2 pre-existing unrelated
warnings only). Frontend — `tsc -b --noEmit`/`npm run build` clean, full suite 259/259 passing (49
files, including the Financial Overview dashboard test extended with a mocked `arrears-api` and an
"Overdue Receivables" assertion), lint clean.

**Harbour View Strata live validation (21 October 2026, same day), read-only:** executed against
the real demo property, no reset/reseed, no new financial postings (trial balance identical
before/after every arrears read: 413,097.86 both sides). Property-level `totalOverdue` (29,368.42)
exactly equals the sum of all 12 lots' own `totalOverdue` from the register. `totalCurrentOutstanding
+ totalOverdue` (95,000.00 + 29,368.42 = 124,368.42) exactly equals the sum of all lots'
`totalOutstanding`. All overdue balances fall in the `DAYS_1_30` bucket (6 days overdue, matching
the 15 Oct 2026 due date and 21 Oct 2026 as-of date) — the dashboard's ageing distribution correctly
shows the other four buckets at exactly 0.00 rather than a fabricated spread. Overdue by fund:
Administration 17,368.42, Capital Works 12,000.00 — summing to the property total. Lot 1's reversed
Capital Works Instalment #4 charge (`LVC-P9HLW5`) confirmed excluded (outstanding 0.00, not overdue).
Historical reconstruction re-confirmed live: `?asOfDate=2026-10-20` (the day before the M16.5 demo
receipts) shows `LVC-UCHUKA` still outstanding 3,031.58 and overdue; `?asOfDate=2026-10-21` (today)
shows it paid in full — proving allocations genuinely created on a later real calendar day are
excluded from an earlier as-of read, not just a same-run approximation. `EMAIL_SEND_DISABLED=true`
reconfirmed in the running server's environment; no notification-triggering endpoint exists on any
arrears/collection-workflow route. A small number of safe, fictional collection-workflow demo
records (one `CollectionCase`, one `CollectionNote`, one `PaymentReminder`, all on Lot 1) were
created via the real API during backend smoke-testing, left in place for review, with full audit
metadata — no existing financial record was modified to produce any of the figures above. UI
click-through for the four new screens was **NOT TESTED** in a real browser this session (no
browser automation tool available) — only the underlying API calls and the component/page test
suites were exercised.

**Known limitations / unresolved NSW policy decisions (ADR-027):** (1) interest on arrears,
statutory notice requirements, and recovery-cost charge-backs under the NSW *Strata Schemes
Management Act 2015* are explicitly unresolved — no rate, period, or fee schedule has been invented;
(2) reminders have no dispatch path at all (by design this milestone) — M16.7+ would need an
explicit, separately-authorised decision before any owner-facing send is built; (3) the Financial
Overview's new "Overdue Receivables" KPI makes one extra property-wide arrears-summary call, fine at
today's scale, same bounded-size argument as every other property-wide read in this module. The
historical GL posting-direction distortion is no longer a limitation — see the correction entry
immediately below.

**M16.7 readiness:** Banking & Reconciliation (next in the resequenced roadmap) now has a corrected
payment-allocation posting direction to build on — both in code and in Harbour View's own posted
history — and a real arrears/ageing signal it can eventually cross-reference against bank statement
data.

## M16.5 historical correction (21 October 2026, same day) — approved and posted

**Investigation (read-only).** Reconstructed every `PAYMENT_ALLOCATION` journal ever posted against
Harbour View Strata from persisted records, not assumption. All 6 posted **Dr Lot Levy Receivable /
Cr Unapplied Cash** (confirmed from each journal's actual lines) — backwards, per ADR-026's
addendum. One (`JRN-X7BVPJ`, 2,021.05) was already fully reversed by `JRN-2SD3CT`, which mirrors
whatever direction its original posted and so cancels it exactly regardless of the defect — net
effect zero, correctly excluded from the correction. The other 5 remained active:

| Journal | Receipt → Charge | Amount |
|---|---|---:|
| JRN-JECTZM | RCT-NLJSLU → LVC-UCHUKA | 3,031.58 |
| JRN-4VDBV2 | RCT-RUAX99 → LVC-K56EJV | 1,000.00 |
| JRN-3545H6 | RCT-VTPU34 → LVC-YXU8RJ | 2,400.00 |
| JRN-DLXBG6 | RCT-VTPU34 → LVC-6QQDKS | 1,000.00 |
| JRN-EUVFYE | RCT-AVFX7Z → LVC-JVQWBU | 200.00 |
| **Total active (Administration Fund only)** | | **7,631.58** |

**Reconciliation, three independent derivations, all agreeing on AUD 15,263.16:**

1. *Per-journal*: 2 × 7,631.58 (each wrong-direction posting swings the account twice as far from
   target as a correct one would have, since it moved the wrong way instead of not moving at all).
2. *Receivable control total*: Admin Fund issued, non-cancelled charges (96,000.00) minus active
   allocations (7,631.58) = target 88,368.42; actual GL balance 103,631.58; difference 15,263.16.
3. *Unapplied Cash control total*: RECORDED receipts (8,131.58) minus correctly-applied allocations
   (7,631.58) = target liability 500.00 (exactly Lot 4's one genuine advance); actual GL balance
   15,763.16; difference 15,263.16.

Capital Works Fund required **no correction** — its GL receivable (36,000.00) already reconciled
exactly to its non-cancelled charges (36,000.00), since no M16.5 receipt was ever recorded against
it. Cash at Bank (50,631.58) and Term Deposit — Capital Works (118,750.50) both independently
reconciled to opening balance + receipts − reversals throughout, unaffected by the defect (it never
touched `FUND_CASH`). The pre-existing legacy Capital Works correction `JRN-CZTT3T` was confirmed to
appear exactly once, untouched.

**Approval and posting.** The client explicitly approved the exact two-line journal below, scoped to
the Harbour View Strata demo tenant only. All pre-flight checks were re-confirmed immediately before
posting (tenant identity, account/fund IDs, open accounting period, no equivalent correction already
present, trial balance unchanged since the proposal) — nothing had changed. Posted through the
existing `POST /financials/journals` controlled API (never direct SQL) as **`JRN-46PXXV`**,
`sourceType: MANUAL`, `sourceId: "M16.5-ADMIN-RECEIVABLE-POSTING-DIRECTION-CORRECTION"` (a stable,
descriptive idempotency key — verified live by an immediate retry with identical lines, which
returned the exact same journal, `testPrisma`-confirmed no duplicate row, and is now additionally
covered by a permanent regression test, `financial-ledger.test.ts`'s "idempotency and concurrency"
describe block):

| Account | Fund | Debit | Credit |
|---|---|---:|---:|
| 220000 — Unapplied Owner Cash | Administration | 15,263.16 | |
| 110000 — Lot Levy Receivable — Administrative Fund | Administration | | 15,263.16 |

Narration and both line-level narrations name the defect and all 5 source journal references
verbatim, so the correction is fully traceable from the journal itself without consulting this
document.

**Post-posting verification, all 9 checks passing exactly:**

| Check | Expected | Actual |
|---|---:|---:|
| Admin Fund GL receivable | 88,368.42 | **88,368.42** ✓ |
| Unapplied Cash liability | 500.00 | **500.00** ✓ |
| Capital Works GL receivable (unchanged) | 36,000.00 | **36,000.00** ✓ |
| Total GL levy receivables = lot subledger total outstanding | 124,368.42 | **124,368.42** ✓ |
| All 12 lots' arrears register unchanged | (pre-posting figures) | **identical** ✓ |
| Cash at Bank / Term Deposit unchanged | 50,631.58 / 118,750.50 | **unchanged** ✓ |
| Trial balance balanced | debit = credit | **428,361.02 = 428,361.02** ✓ |
| No duplicate correction | 1 new MANUAL journal | **exactly 1** (2 total MANUAL journals property-wide, the other being the pre-existing `JRN-CZTT3T`) ✓ |
| M16.6 arrears total overdue unchanged | 29,368.42 | **29,368.42** ✓ |

The trial balance's grand total rose from 413,097.86 to 428,361.02 — expected and correct, since a
correcting journal adds its own turnover (15,263.16 on each side) the same way every other posted
journal does; the *property-level net effect* of this entry is zero (it only moves the same amount
between two Administration Fund accounts), which is exactly why every arrears/lot-ledger figure
above is identical before and after.

## M16.7 — Banking & Manual Bank Reconciliation (21 October 2026)

Builds on M16.1 (fund/account structure), M16.2.2 (General Ledger/`LedgerPostingService`), and
M16.5 (`ReceiptsService`) — no parallel financial truth source, no second posting implementation.
Full decision record: **ADR-028**.

### Database / schema

New models: `BankAccount`, `BankStatementImport`, `BankTransaction`, `BankTransactionMatch`,
`BankReconciliation`. New enums: `BankAccountType`, `BankAccountStatus`,
`BankTransactionMatchStatus`, `BankTransactionReconciliationStatus`, `BankMatchType`,
`BankMatchStatus`, `BankReconciliationStatus`. 9 new `ActivityEventType` values. Migration
`20261021180000_m16_7_banking_reconciliation`, applied to both the dev and test databases.

### Backend services

- `bank-accounts.service.ts` — registration (masks the raw identifier, validates the GL cash
  account is ASSET-classified and fund-compatible), update, list/get.
- `bank-import.service.ts` — CSV normalization (reuses `parseCsv` from
  `account-import.service.ts`), strict date-format parsing (rejects ambiguous dates rather than
  guessing), exact-decimal amount parsing, `sourceRowHash`-based duplicate detection, preview (pure,
  unpersisted) / apply (atomic, idempotent on the file's own SHA-256 hash).
- `bank-matching.service.ts` — the six-rule deterministic matching engine, confirm/manual-match/
  reverse/ignore, and `createReceiptFromTransaction` (delegates to `ReceiptsService.recordReceipt`).
- `bank-transactions.service.ts` — read-side listing/detail with filters.
- `bank-reconciliation.service.ts` — draft creation (overlapping-period and opening-balance-
  continuity guards), `calculate` (the GL-vs-statement equation, re-run fresh every call),
  `complete` (requires an exact 0.00 difference and statement internal consistency), `reopen`.

### API

10 new routes under `/properties/:propertyId/financials/...` — bank account CRUD, statement
preview/apply/history, transaction listing/detail/suggest-match, match confirm/manual-match/
reverse/ignore, receipt-from-transaction, reconciliation draft/list/get/calculate/complete/reopen.
Authorization: `financials.view` (reads, including `suggest-match` — it changes nothing),
`financials.manage` (registration, import, match confirm/reverse/ignore, reconciliation draft/
calculate), `financials.approve` (new-receipt-from-transaction, reconciliation complete/reopen —
the same maker-checker bar as period-close/journal-reversal). No new capability introduced — see
ADR-028 D10 for the explicit rejection of a separate `financials.reconcile` capability.

OpenAPI: `src/openapi/paths/financial-banking.paths.ts` (22 registered paths), entity schemas
appended to `entities.schemas.ts`. `test/unit/openapi-route-coverage.test.ts` confirms 100% route
coverage (every registered Express route has a matching `registerPath` call, nothing extra).

### Tests

`test/integration/financial-banking.test.ts` — 21 tests covering: masked-identifier persistence,
non-ASSET GL account rejection, cross-organisation isolation, DD/MM/YYYY date parsing and
rejection of an invalid date, debit/credit normalization, invalid currency rejection, import
idempotency (exact file re-apply), cross-statement duplicate-row detection, all-or-nothing apply on
a malformed row, exact-reference matching with a verified zero-GL-posting-on-import/match
invariant, ambiguous-match non-suggestion, duplicate-receipt-allocation prevention, the
reconciliation balance equation (both the fully-matched 0.00 case and the legitimate-outstanding-
item 0.00 case), a genuine unbalanced-statement block, period-overlap rejection, opening-balance-
continuity rejection, reopen releasing linked transactions without touching the original snapshot,
and the authorization split (a `RESIDENT` role rejected from both a `financials.view`-gated list and
a `financials.approve`-gated receipt-creation action). All 21 pass; full backend suite (66 files /
965 tests) passes with no regressions.

### Frontend

Six screens, each with real API integration (TanStack Query hooks in `banking-hooks.ts`), loading/
empty/error states, and `financials.manage`/`financials.approve` gating consistent with the
backend: **Bank Accounts** (list + register modal), **Import Bank Statement** (upload → column
mapping → preview/validate → confirm), **Bank Transactions** (searchable register with inline
match-status badges), **Transaction Match Review** (a modal — consistent with this app's existing
convention of `RecordReceiptModal`/`AllocatePaymentModal`/`ReminderPreviewModal` all being modals,
not full pages), **Reconciliation History** (per-account list + start-new-reconciliation form), and
**Bank Reconciliation Workspace** (statement/GL/difference KPIs, outstanding-items cards, statement-
consistency check, recalculate/complete/reopen actions). Designed in Stitch (project
`17365736688974073408`): "Wasl Property — Bank Reconciliation Workspace (Desktop)", "... Bank
Accounts (Desktop)", "... Review Transaction Match Modal (Desktop)", "... Bank Reconciliation
History (Desktop)" — inspected before implementation, translated into the existing component
library (`Card`, `Badge`, `FormModal`, etc.) rather than copied verbatim, per the project's
permanent Stitch-first policy. The Financial Overview dashboard gained a "Banking &
Reconciliation" link card, replacing its prior "this system does not yet track [reconciliation]"
sentence.

`npm run typecheck`, `npm run lint`, and `npm run build` all pass clean on every new/modified
frontend file.

### Live validation (Harbour View Strata, read-and-write — see note below)

A real Playwright browser session against the live dev servers (backend :4100, frontend :5174,
signed in as the Harbour View Strata demo org owner) drove the complete workflow through the actual
UI: registered a bank account ("Operating Account — Administration Fund", Commonwealth Bank,
masked to `••••4321`, linked to GL `100000 — Cash at Bank — Administrative Fund`); recorded a
AUD 321.00 test receipt against Lot 1 (reference `SMOKE-TEST-321`); imported a one-line CSV
statement matching it; the matching engine correctly proposed `EXACT_AMOUNT_LOT` ("Exact amount
match and a lot reference identifiable in the description") with zero GL postings caused by either
the import or the match itself (independently verified against the journal-entry count before and
after); confirmed the match; started an October 2026 reconciliation draft; and completed it —
the workspace showed **AUD 0.00 difference**, `GL Closing Balance AUD 51,273.58`, and
`Outstanding Deposits`/`Unpresented Payments` correctly reflecting the demo property's pre-existing
unrelated GL activity, exactly as the reconciliation equation (ADR-028) predicts. Re-attempting the
identical CSV import a second time was correctly rejected as an exact-file duplicate, proving the
idempotency guard live. Note: unlike M16.1–M16.6's read-only Harbour View validation passes, this
one **did** create one real bank account, one real receipt, one imported transaction, and one
completed reconciliation on the demo property, all through the legitimate application workflow —
no direct database writes, no reset/reseed.

## M16.7 hardening pass (22 October 2026) — bank account eligibility and reconciliation chain-continuity

Follow-up to the M16.7 entry above. Two real defects found and fixed, both in existing services
(no new models, one new read endpoint). Full decision record: ADR-028 Addendum.

**Defect 1 — bank account GL eligibility was too broad.** `BankAccountsService.register` accepted
any ASSET-classified account (e.g. a lot levy receivable, GST receivable) as a bank account's GL
cash account — never actually validated it was a real cash account. Fixed to require the account
be assigned the `FUND_CASH` posting-profile role (the same role `ReceiptsService` resolves when
posting a receipt), plus a fund-compatibility check against that role's own fund, plus a
no-double-linking check (two bank accounts can never share one GL cash account). New endpoint `GET
.../bank-accounts/eligible-gl-accounts` surfaces the same eligibility set to the frontend picker.

**Defect 2 — reconciliation opening-balance continuity could silently break across a reopen.**
Reopening an earlier period while a later period was already `RECONCILED` left that later period's
own opening balance pointing at a now-stale closing figure, with nothing in the system flagging it.
Fixed with two new guards: `reopen` refuses to reopen a period while a later `RECONCILED` period
exists for the account (periods must be reopened newest-first); `createDraft` refuses to start a
new (non-superseding) period while an earlier period sits `REOPENED` and uncorrected. A superseding
draft must also now cover the identical period as what it corrects.

**Tests:** 8 new integration tests added to `test/integration/financial-banking.test.ts` — GL
eligibility (non-FUND_CASH rejection, already-linked rejection, fund-mismatch rejection, eligible-
list correctness) and chain-continuity (reopen-blocked-while-later-period-reconciled,
new-period-blocked-while-earlier-period-reopened, supersede-period-mismatch-rejection, and a full
successful 3-period chain proving a corrected/superseding reconciliation becomes the real
continuity anchor for the next period). Full suite: 29/29 passing in this file; full backend suite
and frontend suite both re-run clean with no regressions (see this entry's closing section).

**UI:** bank account cards now show a real reconciliation-status badge (`NEVER_RECONCILED` /
`UP_TO_DATE` / `DRAFT_IN_PROGRESS` / `REOPENED`) and last-reconciled date; the GL cash account
picker in Register Bank Account is now driven by the same eligible-accounts endpoint (never offers
an account the backend would reject) and auto-fills/locks the fund from the account's own posting-
profile mapping; the transaction register shows separate Debit/Credit columns instead of one signed
amount; every banking screen uses `formatAuDate`/`formatAuDateTime` instead of raw date strings; the
Bank Reconciliation Workspace gained an explicit bank-vs-GL-balance explanation card and symmetric
Outstanding Deposits/Unpresented Payments copy; the Financial Overview's Banking card shows a real
account count and needs-attention status.

**Live validation:** re-verified against the Harbour View Strata demo tenant (same bank account,
receipt and completed reconciliation from the original M16.7 validation pass, untouched) — the
account list now shows "Reconciled" / "Last reconciled through 31 October 2026"; the Register Bank
Account picker correctly offers only the still-unlinked Capital Works Fund cash account (excludes
the already-linked Administration Fund one); the transactions register shows AU-formatted dates and
a Credit(in) figure in the correct column; the reconciliation workspace shows the new explanation
card and AU-formatted period dates; the Financial Overview shows "1 account" / "All accounts up to
date". No financial data was reset, reseeded, or fabricated — all figures are the pre-existing,
real demo-tenant state.

**Incidental fix — M16.6 arrears test date-dependence.** The full-suite re-run during this hardening
pass surfaced 4 pre-existing failures in `financial-arrears.test.ts` (M16.6, otherwise untouched):
several tests hardcoded `TODAY = '2026-10-21'` and literal due dates computed relative to it, rather
than deriving them from the real clock — so when the environment's calendar date advanced to
2026-10-22 between sessions, "days overdue" assertions (and one as-of-date boundary case whose
charge fell out of the query window entirely) broke. Fixed by making `TODAY` dynamic
(`new Date().toISOString().slice(0, 10)`) and adding an `addDays` helper so every relative due
date/asOfDate in the 4 affected tests is computed from it instead of a frozen literal — the suite
is now correct regardless of which real day it runs on. Not an M16.7 regression; the fix is
test-only, touches no service code. All 23 tests in the file pass; full backend suite re-confirmed
green afterward.
