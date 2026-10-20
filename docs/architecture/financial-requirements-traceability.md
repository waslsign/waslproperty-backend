# Financial Requirements Traceability Matrix

**Updated:** 20 October 2026 (M16.2.1 — verified and closed) · Source: `WaslProp_Complete_Financial_Requirements_Option_B.md`

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
| FIN-008 | GL, periods, journals, posting engine | M16.2.2 | Planned | — | — | ADR-018 (D8, D9 recommendations) |
| FIN-009 | Fund-specific accounting controls | M16.2.2 | Planned | — | — | ADR-016 (D2 groundwork) |
| FIN-010 | Opening journal migration | M16.2.2 | Planned | — | — | ADR-018 (D8) |
| FIN-011 | Regular levy schedules and allocations | M16.3 | Planned | — | — | — |
| FIN-012 | Special levies and adjustments | M16.3 | Planned | — | — | — |
| FIN-013 | Lot financial subledger | M16.4 | Planned | — | — | — |
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

## Decisions still requiring explicit client/accountant confirmation before production

Carried from the architecture blueprint (D1–D12) and this milestone's ADRs — not blocking further
development, but blocking a production accounting go-live:

- D1/D2/D3 (CoA ownership, fund flexibility, code-range meaning) — ADR-016, recommendation applied, confirmation still requested.
- D4 (exact Remaining/Actual/Committed formula) — ADR-018, recommendation only.
- D5 (advance payment posting) — ADR-018, recommendation only.
- D6 (GST registration/BAS cycle per scheme) — ADR-018, **mandatory accountant validation before any scheme is GST-enabled**.
- D8 (opening receivable fund split) — ADR-018, recommendation only.
- D9 (Finalise Book semantics match or diverge from the reference product) — ADR-018, open question #11 from the requirements doc.
