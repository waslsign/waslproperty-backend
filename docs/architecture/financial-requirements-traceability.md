# Financial Requirements Traceability Matrix

**Updated:** 20 October 2026 (M16.2.1 verified and closed; M16.2.2 implemented) · Source: `WaslProp_Complete_Financial_Requirements_Option_B.md`

Maintained as part of every financial milestone, not as a separate pass (see CLAUDE.md). Status:
**Done** (implemented and tested this milestone), **Partial** (some of the requirement ships this
milestone), **Planned** (scoped to a named future milestone), **Deferred** (explicitly out of
scope, reason given).

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
| FIN-013 | Lot financial subledger | **M16.3 partial** | **Partial** | `LotLevyCharge` — issuance only; receipts/running position are M16.4 | `financial-levies.test.ts` (charges reconcile exactly to the aggregate journal) | ADR-023 |
| FIN-014 | Owner receipts and allocations | M16.4 | Planned | — | — | ADR-018 (D5 recommendation) |
| FIN-015 | PO commitments and budget reservations | M16.5 | Planned | — | — | ADR-018 (D4 recommendation) |
| FIN-016 | Supplier invoices and AP | M16.5 | Planned | — | — | — |
| FIN-017 | Budget actual/committed/available dashboard | M16.5 | Planned | — | — | ADR-018 (D4) |
| FIN-018 | Bank accounts and statement import | M16.6 | Planned | — | — | — |
| FIN-019 | Bank reconciliation | M16.6 | Planned | — | — | — |
| FIN-020 | GST and tax treatment | M16.8 | Planned | — | — | ADR-018 (D6 recommendation, mandatory validation flagged) |
| FIN-021 | Financial statements and owner statements | M16.8 | Planned | — | — | — |
| FIN-022 | Year-end close and rollover | M16.8 | Planned | — | — | ADR-018 (D9 recommendation) |
| FIN-023 | Arrears, interest and collections | M16.7 | Planned | — | — | — |
| FIN-024 | External payment/bank/accounting adapters | M16.9 | Planned | — | — | — |
| FIN-025 | Financial AI assistance | M16.9 | Deferred | — | — | AI must not auto-post; no change this milestone |
| FIN-026 | Multi-jurisdiction financial policy | Architecture (ongoing) | Partial | `AccountClassification` is jurisdiction-neutral; no AU-specific rule hard-coded in CoA/import | `financial-accounts.test.ts` | ADR-018 (D6 notes AU-specific GST threshold explicitly, not globalized) |

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
