# Financial Management — Architecture Validation & Implementation Plan

**Version:** 1.3 | **Date:** 20 October 2026 | **Status:** M16.2.1 and M16.2.2 implemented and verified; M16.3+ remain proposed
**Scope:** Validates `WaslProp_Financial_Architecture_Blueprint_Option_B.md` and `WaslProp_Complete_Financial_Requirements_Option_B.md` against the repository, and defines the roadmap from M16.2.1 onward.
**Authority:** Sections 6 (M16.2.1) and 7 (M16.2.2) are now implemented — see each section's own Implementation Report. M16.3+ remain a proposal pending architecture/client confirmation per ADR-018.

---

## 0. M16.2.1 Implementation Report (20 October 2026)

**Decisions finalized** (independent, research-driven, per client direction not to block on
confirmation): D1–D3 (chart-of-accounts ownership, fund flexibility, code-range suggestions only)
— see ADR-016; budget line typing and the `totalBudget` → `totalBudgetedRevenue`/
`totalBudgetedExpenditure`/`budgetedSurplusDeficit` breaking rename — see ADR-017; CSV import
architecture (unpersisted preview, atomic apply) — see ADR-019; forward-looking recommendations
for D4/D5/D6/D8/D9 (ledger formulas, advance payments, GST, opening fund split, year close),
grounded in the NSW Strata Schemes Management Act 2015 and ATO GST guidance — see ADR-018.

**Implemented:**
- Schema (additive migration `20261020081955_m16_2_1_chart_of_accounts`): `AccountingAccount`,
  `AccountTemplate`/`AccountTemplateLine`, `AccountImportBatch`, `FinancialBudgetLine.lineType`/
  `.accountId`.
- Services: `AccountsService` (CRUD, deactivate-not-delete), `AccountImportService` (CSV parse/
  validate/preview/apply, RFC4180-ish parser handling the real file's embedded newline and
  trailing-whitespace rows), `AccountTemplateService` (versioned templates, copy-on-provision).
  `FinancialBudgetsService` extended for `lineType`/`accountId` and the rewritten totals.
- APIs: 8 new account endpoints under `/properties/:propertyId/financials/accounts/*`, 2 new
  organisation-level template endpoints under `/organisations/me/account-templates`. No new
  capability — reuses `financials.view`/`financials.manage`.
- Frontend: Chart of Accounts page (list/filter/create/deactivate/reactivate, CSV export, and the
  Upload → Preview & Validate → Apply import wizard), Budget Detail/List pages updated for typed
  lines and the renamed totals — all designed in Stitch (project `17365736688974073408`) before
  implementation; see the three generated screens ("Chart of Accounts (Desktop)", "... CSV Import
  Preview & Validation (Desktop)", "Budget Detail, Administrative Fund (Desktop)").
- Tests: 19 new backend integration tests (including a full round-trip against the real 483-row
  `expense_codes_336684074.csv` fixture) + existing suites updated for the rename. **Backend: 790/
  790 tests pass (58 files). Frontend: 222/222 tests pass (40 files).** Both typecheck and lint
  clean.
- Documentation: this plan, `docs/architecture/adr/ADR-016` through `ADR-019`,
  `docs/architecture/financial-requirements-traceability.md`, OpenAPI (`financial-accounts.paths.ts`,
  updated `entities.schemas.ts`/`financial-budgets.paths.ts`), and a permanent Stitch-first UI
  policy added to `CLAUDE.md`.

**Not implemented in M16.2.1 (by design):** the general ledger, posting engine, and accounting
periods — explicitly deferred to M16.2.2 so the extension points stay open; see ADR-018 for the
policy groundwork already agreed for that milestone.

**Closure verification (20 October 2026):** a focused pass found and fixed two real defects —
inactive accounts could be newly assigned to a budget line (now blocked, historical references
still preserved), and a concurrent CSV-import code collision surfaced as an unhandled 500 instead
of a clean 409 (data was never at risk — the DB unique constraint already prevented the duplicate
write — but the response wasn't safe). Both fixed and covered by new tests. Final state: 802/802
backend tests, 222/222 frontend tests, clean typecheck/lint. See
`docs/architecture/financial-requirements-traceability.md` for the full verification note.
**M16.2.1 is closed.**

**Confluence:** no Confluence access in this environment — business/technical documentation is
prepared in-repo (this plan + the ADRs) for later publication, per the client's own fallback
instruction.

---

## 1. Architecture validation summary

**Option B is endorsed.** WaslProp owns the ledger; Xero/MYOB/bank feeds are channels. Nothing in the current codebase conflicts with that, and the M16.1/M16.2 schema was deliberately built to accept a ledger later — `FinancialBudgetLine`'s own doc comment already anticipates "an optional categoryId FK added alongside it."

Three blueprint positions are **confirmed by code inspection**:

- **No mutable running balances anywhere.** No stored totals on any financial model; `FinancialBudgetsService.toView` sums `plannedAmount` fresh via `Prisma.Decimal`. The ledger can become the sole source of balances without unwinding a competing one.
- **Date-only accounting discipline exists.** `@db.Date` columns plus `src/lib/dateOnly.ts` (explicit UTC, `YYYY-MM-DD` at the API boundary). Reusable as-is for journals and periods.
- **Immutable-history pattern is established.** `FinancialBudget` DRAFT→APPROVED→ACTIVE→SUPERSEDED with revision chaining, never an in-place edit of an approved row. Journal reversal is the same pattern.

Three blueprint positions need **correction or sharpening**:

- **§9's "Vitest `resetDb()` concurrency flake" is already mitigated.** `vitest.config.ts` sets `fileParallelism: false` precisely because integration tests share one Postgres database. This is not an open correctness flake; it is a *throughput* constraint that will bite as ledger fixtures grow. Treat per-worker schema isolation as scheduled test-infrastructure work, not a correctness blocker.
- **"`Decimal(12,2)` may remain suitable" should be decided now, not evaluated later.** Mixed scales already exist: budgets and opening balances are `Decimal(12,2)`; `WorkOrder.estimatedCost` and `ContractorQuote.amount` are `Decimal(10,2)`. Journal lines must use **one** declared scale. Recommend `Decimal(14,2)` for ledger tables — AUD cents, headroom for scheme-level capital works totals, no tax-fraction storage (tax is computed then stored rounded, per line).
- **"PO encumbrance" needs a home that does not exist.** `WorkOrder` and `ContractorQuote` carry an amount and their own `currencyCode` but have **no fund, no account, and no property-financial link**. Commitments require a new association entity, not columns bolted onto `WorkOrder`.

### Architectural conflicts found

| # | Conflict | Impact | Resolution |
|---|---|---|---|
| C1 | `FinancialBudgetLine` has no revenue/expense nature; `plannedAmount` must be ≥ 0; `toView.totalBudget` sums **every** line. Client screenshots show revenue codes (142500, 142800, 143000) budgeted inside the Administrative Fund. | Adding revenue rows to the existing table silently redefines `totalBudget` and `totalsByFund` for every historical budget and every existing API consumer. | Add a non-null `lineType` with a backfill of `EXPENDITURE` for all existing rows, and **rename the derived outputs** — `totalBudget` becomes `totalExpenditure`, with `totalRevenue` and `netFundingRequirement` added alongside. Breaking response change, done once, in M16.2.1. |
| C2 | `category` is free text; there is no chart of accounts anywhere in the repo (verified: zero matches for chart-of-accounts/journal/general-ledger in backend or frontend). | Budget lines cannot be reconciled to actuals without a stable account key. | Additive `accountId` FK alongside `category`; `category` retained as the historical label on pre-existing rows, never backfilled by guesswork. |
| C3 | `FinancialConfiguration` holds exactly **one** financial year, and budgets already carry their own FY dates independently. Screenshots show "Start New Year" / "Finalise Book". | There is no calendar of periods to post into or close. | New `AccountingPeriod` keyed on property, non-overlapping, `OPEN/SOFT_CLOSED/CLOSED`. `FinancialConfiguration`'s FY fields become the *current* year pointer only — not the period calendar. |
| C4 | `LotOpeningPosition` records `amountOwing`/`creditBalance` per lot with **no fund attribution**. | The opening journal cannot split opening receivables between Administration and Capital Works. | Do **not** retro-fit fund columns onto the immutable snapshot. The opening journal generator takes an explicit, operator-supplied fund split at cutover and records it on the journal, leaving M16.1 snapshots untouched. |
| C5 | No `financials.approve` capability — `capabilities.ts` documents its absence as intentional for M16.1. | Maker-checker on close, reversal, and write-off has nothing to check against. | Add `financials.approve` in M16.2.2, granted to no `PropertyRole` by default, mirroring how `financials.manage` was introduced. |

---

## 2. Recommended domain & data architecture

**Principle: one posting service, one write path.** Only `LedgerPostingService` may insert `journal_entries`/`journal_lines`. Levies, AP, receipts, and reconciliation call it with a typed command; they never touch ledger tables. This is the single most important boundary in the design — everything else is replaceable.

### New models (M16.2.1 → M16.2.2)

- **`AccountingAccount`** — property-scoped. `code` unique per property, `name`, `classification` (`ASSET|LIABILITY|EQUITY|INCOME|EXPENSE`), `normalSide`, `parentAccountId?`, `isActive`, `externalCode?`, `sourceTemplateId?`. Deactivate, never delete. `publicReference` prefix `ACC`.
- **`AccountTemplate` / `AccountTemplateLine`** — organisation-scoped, versioned, used to *provision* a scheme's accounts. A template is copied at provisioning time; schemes never read it live.
- **`PostingProfile`** — per property, versioned mapping of semantic roles (`LEVY_RECEIVABLE`, `LEVY_INCOME`, `FUND_CASH`, `ACCOUNTS_PAYABLE`, `GST_PAYABLE`, `GST_RECEIVABLE`, `UNAPPLIED_CASH`, `SUSPENSE`, `INTER_FUND_TRANSFER`) → account, optionally per fund. The posting service resolves roles through this; no module hard-codes an account code.
- **`AccountingPeriod`** — property, start/end `@db.Date`, status, `closedByUserId/At`, `reopenedByUserId/At`. Non-overlap enforced by a hand-written exclusion constraint (the `financial_budgets` partial-index migration is the precedent for DSL-inexpressible constraints).
- **`JournalEntry`** — property, `publicReference` (`JRN`), `organisationId`, `financialConfigurationId`, `accountingPeriodId`, `effectiveDate` `@db.Date`, `postedAt`, `currencyCode`, `sourceType`, `sourceId`, `sourceEventVersion`, `narration`, `postedByUserId`, `reversalOfJournalId?`, `reversedByJournalId?`. **No `DRAFT`** — a row's existence *is* posted state. Correction is a linked reversal.
- **`JournalLine`** — `journalEntryId`, `accountId`, `financialFundId`, `debit`/`credit` `Decimal(14,2)` (exactly one non-zero), `spaceId?`, `contractorId?`, `taxCodeId?`, `lineNarration?`.
- **`PurchaseCommitment`** — resolves C5: `propertyId`, `financialFundId`, `accountId`, `workOrderId?`, `contractorQuoteId?`, `committedAmount`, `consumedAmount`, `cancelledAmount`, `status`, `currencyCode`. An encumbrance only — **never posted to the GL**.

### Invariants, enforced in code *and* in the database

1. `SUM(debit) = SUM(credit)` per journal, per currency — checked in the service and by a deferred `CHECK`/trigger.
2. `@@unique([propertyId, sourceType, sourceId, sourceEventVersion])` on `JournalEntry` — exactly-once financial effect. This mirrors the proven `WaslSignWebhookEvent.eventId` idempotency ledger; a duplicate command is a no-op returning the original `journalReference`, never a second posting.
3. Posting resolves `effectiveDate` → `AccountingPeriod`; a missing or non-`OPEN` period is rejected, never auto-created.
4. Every `accountId`, `financialFundId`, and `spaceId` on a line is re-validated as belonging to the same `propertyId` — no cross-scheme leakage.
5. Posting runs inside one `$transaction`, taking `SELECT ... FOR UPDATE` on `financial_configurations` for the property — the exact lock discipline `FinancialBudgetsService.activate` already uses.

### GST and jurisdiction

Model `TaxCode` (property-scoped, versioned, `effectiveFrom/To`) and a per-line tax amount from M16.2.2 so the columns exist early, but **ship no computation rules** until accountant sign-off. Note the CSV's own evidence that GST is not a scheme-level boolean: `151407 Admin--Bank Charges--With GST` and `152500 GST on expenses --Tax Adjustment` are code-level distinctions, while the client's scheme summary screenshot shows `GST: NO`. Jurisdiction stays a single `jurisdictionCode` on `FinancialConfiguration` plus a `JurisdictionPolicy` lookup consulted only by levy/notice/interest logic — **not** a strategy abstraction threaded through the ledger. Australia-only rules until a second jurisdiction is actually funded.

### CSV findings (revalidated programmatically, 20 Oct)

483 rows, **483 unique codes, zero duplicates** — the prior review is confirmed. But: **480 of 483 rows have an empty `Code type`**; one row (`154804 Admin--Levy Contributions`) is typed **`Income`** inside a file named *expense_codes*; 49 names are duplicated case-insensitively (e.g. `150900`/`150901` both "Admin--Auditors--Taxation Services"); 39 names carry trailing whitespace; one (`160750`) contains an embedded newline; 47 names read as non-expense (transfers, levies, interest, recoveries, refunds).

Codes cluster strictly as `15–19xxxx` (287 rows) and `25–29xxxx` (137 rows). Combined with the screenshots — `150901` appearing under *Administrative Fund*, revenue codes at `142500`/`143000` — the leading digits appear to encode **fund and nature**, not merely sequence. This is a strong hypothesis and the natural basis for import mapping, but it is **not confirmed** and must not be hard-coded (see D3). Import classifies nothing from the filename; `Code type` is a *suggestion* surfaced for human confirmation in the dry run.

---

## 3. Gap analysis

| Requirement | Existing | Missing | Priority | Milestone |
|---|---|---|---|---|
| Fiscal setup, funds, cutover (FIN-001/002) | `FinancialConfiguration`, `FinancialFund`, `FinancialOpeningBalance`, `LotOpeningPosition`, reconciliation + activation | Multi-year period calendar; fund split on opening receivables | P0 | M16.2.2 |
| Chart of accounts (FIN-003/004) | Nothing — free-text `category` only | `AccountingAccount`, templates, CSV import/export with dry run | P0 | **M16.2.1** |
| Typed budget lines (FIN-005) | `FinancialBudgetLine` + fund attribution + Decimal totals | `lineType`, `accountId`, revenue/net-funding totals (C1) | P0 | **M16.2.1** |
| Budget versioning & approval (FIN-006) | Complete — lifecycle, revisions, triple-enforced one-active invariant | Nothing | — | Reuse as-is |
| Funding requirement (FIN-007) | Raw expenditure sum | Explicit funding bridge (revenue, transfers, reserve, opening surplus) | P0 | M16.2.1 |
| GL, periods, posting, reversal, idempotency (FIN-008/009/010) | Nothing | Entire ledger + opening journal | P0 | **M16.2.2** |
| Levies & lot subledger (FIN-011/012/013) | Entitlements (`Space.entitlementValue`), opening positions | Schedules, allocation, issuance, per-lot ledger | P0 | M16.3 |
| Receipts & allocations (FIN-014) | Nothing | Receipts, allocation, unapplied cash, refunds | P0 | M16.4 |
| PO commitments (FIN-015) | Work orders, quotes, approval policy, variations | `PurchaseCommitment` with fund/account; release on invoice/cancel | P1 | M16.5 |
| Supplier invoices / AP (FIN-016) | Contractor records, quote approval, WaslSign | Invoices, AP posting, payments, aging | P1 | M16.5 |
| Actual/committed dashboard (FIN-017) | Budget totals only | Actuals from posted GL; committed from open commitments | P1 | M16.5 |
| Banking & reconciliation (FIN-018/019) | Nothing | Bank accounts, statement import + fingerprint, matching, sign-off | P1 | M16.6 |
| Arrears & interest (FIN-023) | Nothing | Jurisdiction rules, notices, waiver/reversal | P1 | M16.7 |
| GST/BAS, statements, year close (FIN-020/021/022) | Nothing | Tax codes, reports, close/rollover | P1 | M16.8 |
| Adapters, AI assistance (FIN-024/025) | AI module, document intelligence | Posting-safe adapters; suggestion-only AI | P2 | M16.9 |
| Approval capability for financial ops | `financials.view/manage`, `ApprovalPolicyService` (amount-banded, reusable) | `financials.approve`; maker-checker on close/reversal/write-off (C5) | P0 | M16.2.2 |

---

## 4. Milestone roadmap

### M16.2.1 — Chart of Accounts & typed budget lines
**Scope.** `AccountingAccount` + organisation templates; CSV import/export with preview → validation → dry run → atomic apply; `FinancialBudgetLine.lineType` and `accountId`; funding-bridge totals replacing the undifferentiated `totalBudget`.
**Models/services.** `AccountingAccount`, `AccountTemplate(+Line)`; `AccountsService`, `AccountImportService`; extend `FinancialBudgetsService`.
**Dependencies.** D1, D2, D3 answered. No ledger dependency — deliberately shippable alone.
**Acceptance.** Code unique per property; referenced accounts deactivate but never delete. Import is atomic, re-runnable, and classifies nothing from filename. Every pre-existing budget line backfills to `EXPENDITURE` with byte-identical expenditure totals. Approved/active/superseded budgets are provably unmodified by the migration.
**Docs.** ADR-CoA-ownership; ADR-budget-line-typing (records the `totalBudget` rename as a deliberate breaking change); OpenAPI accounts paths + amended budget schemas; business page for CoA setup and import.

### M16.2.2 — General ledger, periods & opening journal
**Scope.** `AccountingPeriod`, `JournalEntry`, `JournalLine`, `PostingProfile`, `LedgerPostingService`, reversal, idempotency, opening-journal generation from M16.1 snapshots, `financials.approve`, trial balance.
**Dependencies.** M16.2.1; D4, D5, D8 answered; accountant sign-off on the posting profile.
**Acceptance.** Every posted journal balances. Closed periods reject posting. Duplicate source key is a no-op returning the original reference. Reversal is a linked opposite entry; nothing is ever updated in place. Opening journal balances and reconciles to M16.1 snapshots, which remain byte-identical. Cross-property account/fund/lot references rejected. Concurrency and retry tests included.
**Docs.** ADR-posting-engine; ADR-idempotency-key; migration/backfill + rollback; golden ledger fixtures; technical page on the posting contract.

### M16.3 — Levies & receivables → **M16.4** — Lot ledger, receipts & allocations → **M16.5** — Commitments & AP → **M16.6** — Banking & reconciliation → **M16.7** — Arrears → **M16.8** — Statements, GST/BAS, year close → **M16.9** — AI assistance.
Each consumes the frozen posting contract and adds no ledger tables. Deliberately not fragmented further; M16.3–M16.9 are scoped in detail once M16.2.2 ships, because their designs depend on decisions the posting profile will have settled.

**Parallelism.** Frontend accounts/budget UI may start with M16.2.1. Nothing downstream of M16.3 starts before the posting contract is frozen.

---

## 5. Critical decisions

Accounting rules (client/accountant **must** confirm):

| | Decision | Recommendation | Reason | Confirmation |
|---|---|---|---|---|
| D1 | Are account codes global, organisation templates, or scheme-specific? | **Scheme-specific accounts, provisioned by copy from a versioned organisation template.** | Schemes legitimately diverge; a live shared catalog would let one scheme's edit silently reinterpret another's postings. Copy-on-provision gives both consistency and independence. | **Mandatory** |
| D2 | May one account serve multiple funds? | **Yes, with the fund on the journal line, not the account.** Optional per-account fund restriction. | The CSV's parallel `15xxxx`/`25xxxx` ranges suggest the client duplicates codes per fund. Supporting both avoids forcing a migration either way. | **Mandatory** |
| D3 | Does the code's leading digit range define fund and nature? | **Surface as a dry-run suggestion; never hard-code.** | Strong but unconfirmed pattern; a wrong inference misclassifies 483 accounts silently. | **Mandatory** |
| D4 | Exact Remaining / Actual / Committed formulas. | **Remaining = Proposed − Actual − Committed**, Actual from posted GL, Committed from open commitments net of consumed/cancelled; formula shown inline with drill-down. | Matches the screenshot arithmetic (500.00 − 1.00 = 499.00, committed 0.00) but is inferred from one row. | **Mandatory** |
| D5 | How do prepayments and unapplied cash post? | Credit a **liability** (`UNAPPLIED_CASH`), not a negative receivable. | Preserves M16.1's deliberate separation of `amountOwing` from `creditBalance`. | **Mandatory** |
| D8 | How are opening receivables split across funds at cutover? | **Operator-supplied split recorded on the opening journal**; M16.1 snapshots untouched. | The snapshot has no fund dimension (C4) and must not be rewritten. | **Mandatory** |
| D6/D9 | GST treatment; what "Finalise Book" does and what may change after. | Defer; build columns, not rules. | Inventing tax or close semantics is the highest-consequence failure mode here. | **Mandatory** |

Product design (our call, recorded for transparency):

- **No `DRAFT` journal state.** Unposted work lives in source documents. Fewer states, fewer invariants.
- **Ledger scale `Decimal(14,2)`,** resolving the existing 10,2 / 12,2 mix.
- **`PurchaseCommitment` is never posted to the GL** unless D4's answer demands it — an encumbrance is a budget-monitoring fact, not an accounting event.
- **Jurisdiction as a policy lookup, not a strategy layer,** until a second jurisdiction is funded.
- **Per-worker test schema isolation** scheduled as explicit infrastructure work before the ledger suite grows (correcting blueprint §9).

---

## 6. M16.2.1 implementation checklist — **Status: Implemented, 20 October 2026** (see Section 0)

**Schema (additive; one migration).**
1. `accounting_accounts` — property-scoped; `@@unique([propertyId, code])`; `publicReference` `ACC`; self-FK parent; `isActive`; `externalCode?`; `sourceTemplateId?`; indexes on `propertyId`, `organisationId`.
2. `account_templates` / `account_template_lines` — organisation-scoped, versioned.
3. `financial_budget_lines`: add `lineType` (`REVENUE|EXPENDITURE|TRANSFER|RESERVE_CONTRIBUTION|OTHER`) **non-null, defaulting to `EXPENDITURE`** so existing rows backfill without a data script; add nullable `accountId` FK; keep `category` untouched.
4. `account_import_batches` / `account_import_rows` — dry-run results, per-row validation status, applied-at.
5. New `ActivityEventType` members: `FINANCIAL_ACCOUNT_CREATED`, `FINANCIAL_ACCOUNT_DEACTIVATED`, `FINANCIAL_ACCOUNTS_IMPORTED`.

**Services.**
6. `AccountsService` — CRUD, deactivate-not-delete (reject delete once any budget line or future journal line references the account), `getOwnedProperty` guard copied from `FinancialsService`, `withPublicReference`, `recordActivity` inside the transaction.
7. `AccountImportService` — parse → normalise (**trim trailing whitespace on 39 names, strip the embedded newline in `160750`**) → validate (numeric code, length, per-property uniqueness, parent resolvable, classification present) → persist dry-run batch → atomic apply in one `$transaction`. Duplicate codes in-file reported, never silently last-wins. Name collisions (49 of them) are warnings, not errors.
8. `AccountTemplateService` — provision a scheme by copying a template version.
9. `FinancialBudgetsService.toView` — emit `totalRevenue`, `totalExpenditure`, `netFundingRequirement`, and per-fund equivalents; **remove `totalBudget`** rather than leaving an ambiguous alias. Validate `accountId` belongs to the same property and that its classification agrees with `lineType`.

**API & permissions.**
10. Routes under `/properties/:propertyId/financials/accounts` and `/accounts/import`, nested in `properties.routes.ts` beside the existing financial routes, using `resolvePropertyReference` + `requireCapability('financials.view'|'financials.manage')`. No new capability this milestone.

**Tests.**
11. Code uniqueness per property; same code permitted in a different property; deactivate-not-delete; referenced-account deletion rejected.
12. Import: dry run mutates nothing; apply is atomic (one bad row ⇒ zero rows written); re-apply is a no-op; in-file duplicates rejected; **a fixture built from the real 483-row CSV** asserting 483 accepted, 480 flagged for missing type, 1 `Income` row *not* classified as an expense.
13. Migration safety: a seeded APPROVED and an ACTIVE budget are byte-identical before and after; expenditure totals unchanged; all existing lines read back as `EXPENDITURE`.
14. Cross-property: an `accountId` from another property on a budget line is rejected.

**Documentation.**
15. ADR-CoA-ownership (D1/D2) and ADR-budget-line-typing (records the `totalBudget` removal).
16. OpenAPI: accounts + import paths, amended budget line/total schemas.
17. Confluence business page (CoA setup, import walkthrough, dry-run review) and technical page (ownership, validation, provisioning); milestone mapping table preserving original references.
18. FIN-ID traceability rows for FIN-003, FIN-004, FIN-005, FIN-007.

**Out of scope for M16.2.1:** journals, periods, posting, tax computation, actuals. Deliberately — this milestone must be shippable and reversible without a ledger.

---

## 7. M16.2.2 implementation checklist — General Ledger & Posting Engine

**Status: Implemented and verified-closed, 20 October 2026.** Closure verification found and
fixed two real defects (a reversal-concurrency race and a float-tolerance validation gap — see
`docs/architecture/financial-requirements-traceability.md`'s closure-verification section and
ADR-018/ADR-021's addenda). Final: 831/831 backend tests, 222/222 frontend tests. Built against
ADR-018's working assumptions (D4/D5/D8/D9)
and the frozen domain boundaries in the architecture blueprint §4–§9, following the checklist
below (each item's disposition is unchanged from the original preparation — nothing here was
descoped). See the **M16.2.2 Implementation Report** immediately below for what was actually
delivered, and ADR-020/ADR-021 for the architecture decisions made while building it.

### 7.0 M16.2.2 Implementation Report (20 October 2026)

**Schema** (additive migration `20261020091338_m16_2_2_general_ledger`): `AccountingPeriod`,
`PostingProfileRule` (+ `PostingRole` enum), `JournalEntry`, `JournalLine`. New capability
`financials.approve` (gates every write that touches posted history, period status, or the
posting profile — never `financials.manage` alone).

**Services:** `AccountingPeriodsService` (open/close/reopen, non-overlap validated under the
`FinancialConfiguration` row lock), `PostingProfileService` (role→account resolution, never a
hard-coded account identity), `LedgerPostingService` (`post()`/`reverse()`/`get()`/`list()`/
`trialBalance()` — the sole writer of `journal_entries`/`journal_lines`), `OpeningJournalService`
(M16.1 → ledger transition with mandatory, exact, per-lot fund-split input — never fabricated).

**APIs:** 10 new endpoints under `/properties/:propertyId/financials/{periods,posting-profile,
journals,trial-balance,opening-journal}`. OpenAPI (`financial-ledger.paths.ts` + 7 new entity
schemas) verified by `openapi-route-coverage.test.ts` and a live document-build check.

**Frontend:** General Ledger Settings (accounting periods + posting profile) and Journals & Trial
Balance pages — both designed in Stitch (project `17365736688974073408`: "Wasl Property — General
Ledger Settings (Desktop)" and "... Journals & Trial Balance (Desktop)") before implementation,
reusing existing shared components (`Tabs`, `Badge`, `Select`) and the established modal/form
pattern from the M16.2.1 pages.

**Accounting invariants enforced** (all integration-tested): balanced debit=credit per journal;
per-fund balance unless explicitly flagged a transfer (never exposed on the public manual-journal
endpoint); exactly-once posting via `(propertyId, sourceType, sourceId, sourceEventVersion)`;
concurrency-safe via a `FinancialConfiguration` row lock (true `Promise.all` race test passes);
no posting into a missing or `CLOSED` period; reversal is an exact sign-swapped linked entry,
blocked a second time; no update/delete route exists for a posted journal; cross-org/property
references rejected (404); `Decimal(14,2)` throughout, verified with a fractional-cent accumulation
test (`0.1 × 3 = 0.30` exactly).

**Tests:** 21 new backend integration tests (`financial-ledger.test.ts`). **Backend: 823/823
tests pass (59 files). Frontend: 222/222 tests pass (40 files).** Typecheck and lint clean on
both. One real defect was caught and fixed during implementation, before any test ran against it:
`reverse()` originally called the public `post()` and then linked `reversalOfJournalId` in a
*separate* transaction — fixed by factoring a shared `postInTransaction()` core so posting +
linking + the audit record are atomic (see ADR-020).

**Not implemented (explicitly out of scope, per the original checklist):** levies, AP, banking,
GST computation — all M16.3+, consuming this milestone's frozen posting contract.

### 7.1 Schema (additive; one migration)

1. `accounting_periods` — `propertyId`, `startDate`/`endDate` (`@db.Date`, same discipline as
   `FinancialConfiguration`'s own date fields), `status` (`OPEN|SOFT_CLOSED|CLOSED`),
   `closedByUserId/At`, `reopenedByUserId/At`. Non-overlap enforced by a hand-written exclusion
   constraint in raw SQL within the migration (Prisma's DSL can't express it — same precedent as
   the `financial_budgets` one-active-per-FY partial index).
2. `posting_profiles` / `posting_profile_rules` — property-scoped, versioned; maps semantic roles
   (`LEVY_RECEIVABLE`, `LEVY_INCOME`, `FUND_CASH`, `ACCOUNTS_PAYABLE`, `GST_PAYABLE`,
   `GST_RECEIVABLE`, `UNAPPLIED_CASH`, `SUSPENSE`, `INTER_FUND_TRANSFER`) to an `AccountingAccount`
   id, optionally scoped to one `FinancialFund`. Resolved only by the posting service, never read
   directly by a business module.
3. `journal_entries` — `propertyId`, `organisationId`, `financialConfigurationId`,
   `accountingPeriodId`, `publicReference` (`JRN`), `effectiveDate` (`@db.Date`), `postedAt`,
   `currencyCode`, `sourceType`, `sourceId`, `sourceEventVersion`, `narration`, `postedByUserId`,
   `reversalOfJournalId?`, `reversedByJournalId?`. **No `DRAFT` status** — a row's existence is
   posted state; correction is always a linked reversal (per ADR-018 and the blueprint's
   immutable-history principle).
4. `journal_lines` — `journalEntryId`, `accountId`, `financialFundId`, `debit`/`credit`
   `Decimal(14,2)` (resolves the existing 10,2/12,2 mix — see §7.6), exactly one side non-zero per
   row, optional `spaceId`/`contractorId`/`taxCodeId`/`lineNarration`.
5. `@@unique([propertyId, sourceType, sourceId, sourceEventVersion])` on `journal_entries` —
   exactly-once posting, mirroring the proven `WaslSignWebhookEvent.eventId` idempotency pattern
   already in this codebase (`integrations/waslsign/waslsign.controller.ts`).
6. New `ActivityEventType` members: `FINANCIAL_PERIOD_OPENED/CLOSED/REOPENED`,
   `FINANCIAL_JOURNAL_POSTED`, `FINANCIAL_JOURNAL_REVERSED`, `FINANCIAL_POSTING_PROFILE_UPDATED`.
7. New capability: `financials.approve` (granted to no `PropertyRole` by default, same as
   `financials.manage`'s introduction) — gates period close/reopen, reversal, and posting-profile
   changes as maker-checker actions.

### 7.2 Double-entry structure, balancing, Decimal precision

8. `LedgerPostingService.post(command)` is the **only** code path permitted to insert
   `journal_entries`/`journal_lines` — every other module (future levies/AP/banking) calls it with
   a typed command, never writes ledger tables directly. Enforce via code review + a lint-level
   check (e.g. a dependency-boundary ESLint rule) if practical, documented as a hard rule otherwise.
9. Balance invariant `SUM(debit) = SUM(credit)` per journal, per currency: checked in the service
   **and** by a deferred DB `CHECK`/trigger as the backstop (same "two independent layers" pattern
   already used for the one-active-budget invariant — see `budgets.service.ts`'s own doc comment).
10. All money `Prisma.Decimal` only, `Decimal(14,2)` on ledger tables — never a raw JS number
    through monetary arithmetic (`.toFixed(2)` only at the API boundary, exactly as
    `budgets.service.ts`/`accounts.service.ts` already do).

### 7.3 Scheme and fund segregation

11. Every `accountId`/`financialFundId`/`spaceId` on a line is re-validated as belonging to the
    same `propertyId` at posting time — never trusted from the caller. Reuse the
    `getOwnedAccount`/`assertAccountAssignable` pattern from `budgets.service.ts` and
    `accounts.service.ts`.
12. Cross-property and cross-organisation posting attempts are integration-tested explicitly (IDOR
    style, matching `financial-budgets.test.ts`'s existing `multi-tenancy / IDOR` describe block).

### 7.4 Accounting periods and posting-date validation

13. Posting resolves `effectiveDate` → `AccountingPeriod`; missing or non-`OPEN` period → rejected
    (409), never auto-created. Late entries require an explicit, `financials.approve`-gated
    adjustment path (out of scope to design in full this milestone — stub the rejection only).
14. Period close/reopen: `financials.approve`-only; close runs a pre-close checklist (open
    sub-ledger items — none exist yet in M16.2.2 alone, so this is largely a placeholder hook for
    M16.4/M16.5 to extend) before flipping status; reopen is a separate, audited action, never a
    silent undo.

### 7.5 Transactional posting engine, idempotency, concurrency

15. One `$transaction` per post: lock the property's `financial_configurations` row
    (`SELECT ... FOR UPDATE`) for the duration — identical lock discipline to
    `FinancialBudgetsService.activate`'s own already-proven pattern — before resolving the period
    and inserting lines.
16. Idempotency: a duplicate `(propertyId, sourceType, sourceId, sourceEventVersion)` is a
    guaranteed no-op that returns the original `journalReference`, never a second posting, never an
    error. Integration-tested with a literal duplicate-request retry.
17. Concurrency test: two simultaneous posts for the same source key resolve to exactly one
    journal (mirrors the existing `financial-budgets.test.ts` "concurrent activation" test
    structure).

### 7.6 Reversals and corrections

18. Reversal is a new `JournalEntry` with every line's debit/credit swapped, linked via
    `reversalOfJournalId`/`reversedByJournalId`, carrying a required reason and actor. The original
    is never updated in place. `financials.approve` required.
19. A reversal into a `CLOSED` period is rejected — must go through the period-adjustment path
    (stubbed per 7.4.13) or wait for reopen.

### 7.7 Audit history and authorization

20. Every posting, reversal, period close/reopen, and posting-profile change is recorded via
    `recordActivity` inside the same transaction (same convention as every other financial
    service). `financials.view`/`financials.manage`/`financials.approve` cover read/manage/approve
    respectively — no new role is introduced.

### 7.8 Opening balance transition from M16.1

21. `OpeningJournalService.generate(propertyId, fundSplit)` — takes the **existing, immutable**
    `FinancialOpeningBalance`/`LotOpeningPosition` rows (M16.1) plus an **explicit, operator-
    supplied fund split** for lot receivables (per ADR-018 D8 — M16.1 snapshots have no fund
    dimension and are never rewritten) and produces one balanced opening `JournalEntry`.
22. Validate opening debits = credits, and that fund-level opening balances reconcile to
    `FinancialOpeningBalance.amount` per fund, before allowing the journal to post. Idempotent:
    re-running for an already-posted opening journal is a no-op (same source-key mechanism as 7.5).
23. `FinancialConfiguration.status` gains no new value — opening-journal generation is a distinct,
    later action, not folded into M16.1's own `activate()`.

### 7.9 API / OpenAPI contracts

24. New routes under `/properties/:propertyId/financials/periods`, `/journals`,
    `/journals/:id/reverse`, `/posting-profile`, `/opening-journal`, following the exact
    `resolvePropertyReference` + `requireCapability` pattern every existing financial route uses.
25. `src/openapi/paths/financial-ledger.paths.ts` (new file, following `financial-accounts.paths.ts`'s
    structure) + corresponding `entities.schemas.ts` additions (`JournalEntry`, `JournalLine`,
    `AccountingPeriod`, `PostingProfile`). Verify with the existing
    `test/unit/openapi-route-coverage.test.ts` (already proved it fails loudly on an undocumented
    route — keep relying on it).

### 7.10 Integration contracts for future consumers (levies, procurement, banking, payments)

26. Define `PostingCommand` as a plain TypeScript type (not yet a real producer) with
    `organisationId`, `propertyId`, `sourceType`, `sourceId`, `sourceEventVersion`, `effectiveDate`,
    `currencyCode`, `actor`, and semantic role references (not raw account IDs — resolved via the
    posting profile) — this is the contract M16.3 (levies) and M16.5 (AP) build against. Document it
    explicitly so those milestones don't each invent a slightly different shape.
27. `PurchaseCommitment` (encumbrance, M16.5) is explicitly **not** posted through this engine
    unless a later decision changes that — document this boundary now so M16.5 doesn't assume
    otherwise.

### 7.11 Automated accounting-invariant tests

28. Golden ledger fixtures: a handful of hand-verified posting scenarios (issued levy, receipt,
    supplier invoice, reversal) with expected balances, run as snapshot-style assertions.
29. Negative/edge cases: unbalanced journal rejected; posting into a closed period rejected;
    duplicate source key no-ops; cross-property reference rejected; reversal of a reversal
    (should reverse the original's effect, not double-reverse); concurrent posting race.
30. Per-worker test schema isolation — scheduled now rather than deferred again (ADR corrects
    blueprint §9's claim that this was already an open concurrency *correctness* flake; it is a
    throughput constraint — `vitest.config.ts`'s `fileParallelism: false` already handles
    correctness). Needed before the ledger suite grows large enough to make sequential runs slow.

### 7.12 Documentation required for M16.2.2

31. ADR-020 (posting engine architecture: no `DRAFT` state, role-based posting profile resolution,
    lock discipline) and ADR-021 (idempotency key shape and retry semantics).
32. Update `docs/architecture/financial-requirements-traceability.md`: FIN-008/009/010 move from
    Planned to Done; FIN-007 moves from Partial to Done once the opening-balance-aware funding
    bridge is possible.
33. Business Confluence (or in-repo equivalent, per the same fallback as M16.2.1): what a journal
    is, how periods close, how a reversal looks to a property manager. Technical Confluence: the
    posting contract, lock discipline, idempotency guarantee, and extension points for M16.3+.
34. OpenAPI regenerated and route-coverage test passing before the milestone is called done (same
    bar as M16.2.1).

### 7.13 UI

35. If M16.2.2 needs any UI (a trial balance view, an accounting-periods settings screen, a journal
    detail/reversal view) it must be **designed in Stitch first** (project `17365736688974073408`),
    per the permanent policy now in `CLAUDE.md` — not designed independently. No UI has been
    designed for M16.2.2 yet; this is a reminder for when implementation starts, not a deliverable
    of this preparation pass.

### 7.14 Explicit non-goals for M16.2.2

Everything in M16.3–M16.9 (levies, lot ledger, AP, banking, arrears, statements/GST/close, AI) —
these consume the frozen posting contract but are out of scope here. GST computation rules (ADR-018
D6) remain unimplemented pending mandatory accountant validation.
