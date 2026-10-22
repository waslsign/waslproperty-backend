# Financial Statements & Reporting — Specification (FIN-021, limited scope)

**Status:** Proposed — awaiting approval. Not implemented.
**Date:** 23 October 2026
**Authorizes:** A narrowly-scoped replacement for the never-confirmed "M16.9" placeholder (see
`financial-management-implementation-plan.md` history). This spec is the authorization — there is
no external blueprint section to reconcile against for this scope.
**Supersedes:** The FIN-021 "Planned, M16.8+" row in `financial-requirements-traceability.md`.
**Does NOT resolve:** ADR-018 D6 (GST) or D9 (year-end close) — both remain open, unconfirmed
recommendations. Nothing in this spec implements, assumes, or depends on either.

## 0. Authorized scope (verbatim from client direction, 22 October 2026)

**In scope:**
- Property/building financial summaries
- Income and expense reporting based on existing recorded transactions
- Owner financial statements based on existing supported financial records
- Date-range and reporting-period filtering
- Downloadable PDF reports
- Traceability to underlying financial transactions
- Role-based access and organisation isolation

**Explicitly excluded** (no code, no schema, no UI for any of these):
- GST/BAS calculation or filing
- Year-end close and accounting-period locking
- External accounting integrations
- AI-generated financial advice
- Any new accounting policy requiring client/accountant sign-off

## 1. What already exists — reuse, don't rebuild

| Capability | Existing service/method | Reused as |
|---|---|---|
| Account-level GL aggregation (debit/credit sums by account, as-of a date, optional fund filter) | `LedgerPostingService.trialBalance(organisationId, propertyId, asOfDate?, financialFundId?)` | Direct data source for the Balance Sheet (filter rows to `ASSET`/`LIABILITY`/`EQUITY`) |
| Per-lot opening balance → itemised movements → closing balance for an explicit period | `LotLedgerService.getStatement(organisationId, propertyId, spaceId, periodStartDate, periodEndDate, includeOwnerNames)` | Direct data source for the Owner Financial Statement — **no new query logic**, only a PDF renderer around the existing `LotStatementView` |
| Owner name resolution (joint ownership, vacant lot) | `LotLedgerService.getOwnerName` → `PropertyMembership` (role `OWNER`, status `ACTIVE`) → `PropertyContact` | Reused as-is |
| Org/property scoping guard | `getOwnedProperty` pattern (`property.findFirst({ where: { id, organisationId } })`) used identically across every financial service | Reused as-is in the new report service |
| Capability model | `financials.view` / `financials.manage` / `financials.approve` | New reports are **read-only** → gated on `financials.view` only (see §5) |
| PDF byte generation | `generateQuoteAcceptanceDocument`/`generateVariationAcceptanceDocument` (`pdf-lib`, `PDFDocument.create()`, `StandardFonts.Helvetica`/`HelveticaBold`, manual `drawTitle`/`drawLabelValue`/`drawParagraph` cursor helpers) | Pattern reused for new report PDFs — same library, same font set, same manual-layout approach. **No new dependency.** |
| File-download HTTP response | `accounts.controller.ts`'s CSV export (`Content-Type` + `Content-Disposition: attachment` + direct `res.send`) | Pattern reused for PDF responses — this repo has never served a PDF directly over HTTP before (every existing PDF goes straight into a WaslSign upload), so this is the first controller to combine the two proven patterns, not a new one |

**Nothing above requires a schema change.** Every number this milestone reports is already derivable
from `JournalLine`/`JournalEntry`/`AccountingAccount` (property-level reports) or already computed by
`LotLedgerService` (owner statements).

## 2. Report definitions

### 2.1 Income & Expense Statement
**Purpose:** What came in and went out, for a chosen period, per fund.

**Data source:** `JournalLine` → `JournalEntry` (for `effectiveDate`) → `AccountingAccount` (for
`classification`), filtered to `classification IN (INCOME, EXPENSE)`, `JournalEntry.effectiveDate`
between `periodStart` and `periodEnd` inclusive, scoped by `organisationId`/`propertyId`.

**Calculation** (per account, matching the sign convention already established in
`LedgerPostingService.trialBalance`):
- `INCOME` accounts are credit-normal: `net = SUM(credit) − SUM(debit)`.
- `EXPENSE` accounts are debit-normal: `net = SUM(debit) − SUM(credit)`.
- `totalIncome = Σ(INCOME account nets)`, `totalExpense = Σ(EXPENSE account nets)`.
- `netSurplusOrDeficit = totalIncome − totalExpense`.

**Fund scoping:** Reported **per fund**, not blended. WaslProp's ledger is deliberately
fund-segregated (ADR-016 D2); a single combined total across funds (e.g. Admin + Capital Works)
would obscure a genuine surplus in one fund and a deficit in another. The report accepts an
optional `financialFundId` (one fund) or omits it (every fund, each shown as its own section, plus
a clearly-labelled "All funds combined" total at the bottom for the reader who wants it — never
presented as the only number).

**Not included (see §4):** no budget-vs-actual comparison column. "Income and expense reporting
based on existing recorded transactions" is read literally — a budget figure is a *plan*, not a
recorded transaction, and prorating an annual budget line across an arbitrary custom date range
would be a new, unconfirmed assumption this spec does not make.

### 2.2 Balance Sheet
**Purpose:** What the property owns, owes, and its net equity, as at a specific date.

**Data source:** The same `trialBalance(organisationId, propertyId, asOfDate, financialFundId?)`
call already used for the existing trial balance screen, filtered to `classification IN (ASSET,
LIABILITY, EQUITY)`.

**Calculation:** Uses `trialBalance`'s existing `presentedSide`/`presentedBalance` fields directly
— `ASSET` accounts are debit-normal, `LIABILITY`/`EQUITY` are credit-normal (already computed by
the existing service, not re-derived). `totalAssets`, `totalLiabilitiesAndEquity`, and their
difference are displayed; because every journal is balanced by construction
(`LedgerPostingService` rejects unbalanced postings), the difference should always be zero — the
report surfaces it anyway as an explicit reconciliation line, never hidden, so a genuine data
anomaly is visible rather than silently netted away.

**This is cumulative since the property's financial cutover date, not period-bound** — a balance
sheet is always "as at," unlike the Income & Expense Statement which is "for the period." This
distinction is stated on the report itself, not just in this spec.

### 2.3 Property Financial Summary
**Purpose:** The single "property/building financial summary" view the client asked for —
packages 2.1 and 2.2 together for one property/period into one document: Income & Expense
Statement for the chosen period, followed by the Balance Sheet as at the period's end date. Not a
new calculation — a presentation composite of the two reports above.

### 2.4 Owner Financial Statement
**Purpose:** A statement for one lot's owner(s): opening balance, itemised movements (levy
charges, adjustments, receipts, allocations), closing balance, for a chosen period.

**Data source:** `LotLedgerService.getStatement(...)` — **unchanged, zero new query logic.** This
report is purely a new presentation (PDF) of an existing, already-tested JSON shape
(`LotStatementView`).

**Scope limitation — stated explicitly, not silently assumed (see §4.1):** this report is only
producible for a `Space` where `strataClassification === 'LOT'`, because `LotLedgerService` (and
the levy/receipt subledger underneath it) only exists for strata lots. A non-strata property has
no equivalent per-unit financial subledger today. This is an existing, pre-this-milestone
limitation of the data model, not something this spec introduces — see §4.1 for why it cannot be
worked around without inventing a new financial record type.

## 3. Date-range and reporting-period filtering

Every report accepts explicit `startDate`/`endDate` (ISO date, `YYYY-MM-DD`) — **not** required to
align with an `AccountingPeriod` row. Separately, the request may optionally pass an
`accountingPeriodId` instead, in which case the server resolves that period's own
`startDate`/`endDate` and uses them (a convenience for "report on Q3", not a new filtering
mechanism). The Balance Sheet takes a single `asOfDate` instead of a range.

**Validation:** `startDate <= endDate`; both must be valid dates; `accountingPeriodId` (if given)
must belong to the same `propertyId`/`organisationId` — reuse the existing `getOwnedProperty`-style
guard, returning `NotFoundError` on a cross-org/cross-property id, never a 403 that would leak
existence.

**Open-period transparency (new, and important):** today, **nothing in this codebase blocks or
flags a report run against a still-`OPEN` accounting period** (confirmed: `trialBalance` and
`LotLedgerService`'s projections read every posted entry up to the cutoff date with no
period-status filter at all). Year-end close/locking is explicitly out of scope for this milestone
— so this spec does not attempt to fix that gap, but it must not silently hide it either. Every
report whose date range or as-of date falls within a period that is still `OPEN` (or for which no
`AccountingPeriod` row covers the end date at all — see §4.3) **must display a visible notice**:
*"This period is still open — figures reflect postings as of the time this report was generated,
and may change if further entries are posted."* This is a presentation requirement, not a new
accounting rule.

## 4. Reports/figures that cannot be produced accurately without new assumptions

Stated explicitly, per the task's instruction not to silently treat incomplete data as complete.

### 4.1 Owner statements for non-strata properties — not producible this milestone
As above (§2.4): there is no per-unit billing/receivable subledger for a non-strata `Space`. This
is not an "exclude GST"-style policy exclusion — it is a genuine data-model gap. Building one would
mean inventing a new financial record (e.g., a generic tenancy charge/invoice model) that no ADR,
requirement, or existing code anticipates. **Recommendation:** ship Owner Financial Statement
scoped to strata lots only, label the feature accordingly in the UI ("Lot owner statement," not a
generic "owner statement" claiming universal applicability), and record the non-strata gap as a
new, separately-prioritized requirement if the client wants it — not something this milestone
guesses at.

### 4.2 Budget-vs-Actual comparison — deliberately excluded, not silently omitted
Already noted in §2.1. Flagging again here because it's the single most likely thing a
stakeholder will expect in an "income and expense report" and not find. The underlying reason is
concrete, not a vague caution: ADR-018 D4 ("Committed") depends on a purchase-commitment model
(FIN-015) that does not exist (`Planned`, `M16.8+`) — a Budget vs Actual report could show Actual
only, no Committed, but even that requires deciding how to prorate an annual budget figure across
an arbitrary custom date range (daily pro-rata? Equal monthly? NSW's own instalment cadence?) —
exactly the kind of unconfirmed accounting policy this milestone is scoped to avoid inventing.

### 4.3 Reports for a date range with no covering `AccountingPeriod` at all
`AccountingPeriodsService` only enforces non-overlap at period-creation time; nothing guarantees
every date since a property's cutover is actually covered by a period row. If a report's date range
includes dates with no covering period, the report must still render (using whatever `JournalLine`
data actually exists for those dates — the GL itself is the source of truth, not the period
calendar), but must additionally surface: *"No accounting period is recorded for all of the dates in
this report — figures are shown as posted, unconfirmed against a defined period."* This is a
distinct notice from the open-period one in §3 and both can appear together.

### 4.4 `LotLevyCharge.status = OVERDUE` must never be trusted
Confirmed via the backend research: `OVERDUE` is a reserved-but-unused enum value — arrears are
computed live by `ArrearsService`'s ageing logic, never read from the stored `status` column. Any
report surfacing "amounts owing" or an arrears figure on an owner statement or property summary
**must** call the existing `ArrearsService` computation, never filter `LotLevyCharge` by
`status: 'OVERDUE'`. Stated here explicitly so the implementation doesn't silently introduce a wrong
number by taking the obvious-looking shortcut.

### 4.5 Accrual basis, stated not assumed
The GL posts on `effectiveDate` (an accounting date, not a cash-received date) — levies post as
income when *issued*, not when paid. Every report in this spec is therefore accrual-basis by
construction, because that is what the underlying ledger already is. WaslProp has no cash-basis
toggle and this spec does not add one; reports should label themselves "accrual basis" so a reader
comparing against a cash-basis expectation (e.g. a bank balance) isn't misled into thinking the two
should match.

### 4.6 Multi-currency aggregation — not attempted
Every financial record snapshots a `currencyCode` at creation (never re-derived live from
`Organisation.currencyCode`). This spec assumes — and does not verify — that every journal line
within one property shares one `currencyCode` (true for every property that exists today, since a
`FinancialConfiguration` is created once per property with one snapshotted code). If that is ever
untrue, totals here would silently add mismatched currencies. No FX conversion capability exists
anywhere in the codebase; this spec does not add one. The report simply displays the
`FinancialConfiguration`'s `currencyCode` and assumes (as every other financial feature already
does) that it's the only one in play for that property.

## 5. Access control & organisation isolation

- **Capability:** `financials.view` only. Every report defined here is read-only — no new
  capability (e.g. `financials.report`) is introduced; that would be new policy surface for a
  purely read-only feature.
- **Guard pattern** (identical to every existing financial route):
  ```ts
  router.get(
    '/:propertyId/financials/reports/income-expense',
    resolvePropertyReference('propertyId'),
    requireCapability('financials.view', fromParam('propertyId')),
    asyncHandler(getIncomeExpenseReport),
  );
  ```
- **Organisation isolation:** every query filters explicitly by `{ organisationId, propertyId }` —
  never `propertyId` alone — matching `getOwnedProperty`. A request for a property outside the
  caller's organisation returns `NotFoundError` (never a 403 that would confirm the property's
  existence to an unauthorized caller).
- **Owner statement, additional scoping:** uses `getOwnedLot` (existing), which additionally
  verifies `space.strataClassification === 'LOT'` — a report request against a non-lot space
  returns a clear "not a strata lot" error, not a crash, consistent with §4.1.
- **Who can see what:** `PropertyRole.OWNER`/`COMMITTEE_MEMBER`/`PROPERTY_MANAGER` hold
  `financials.view` by default (existing `DEFAULT_ROLE_CAPABILITIES`) — meaning a lot owner can
  already view *their own* lot's financial position via the existing lot-ledger endpoints this
  report reuses. **Open question for approval, not assumed:** should a lot `OWNER`'s
  `financials.view` be scoped so they can only request a statement for *their own* lot, not every
  lot on the property? The existing `LotLedgerService` endpoints appear to allow any caller holding
  `financials.view` on the property to query any `spaceId` on it (property-manager-facing, not
  self-service). This spec does not change that existing behaviour, but flags it: if self-service
  "my statement" access for residents/owners is wanted, that's a new access-control decision (not
  an accounting one) requiring explicit sign-off, analogous to ADR-018's accounting items —
  recommend a resident-facing endpoint that implicitly scopes `spaceId` to the caller's own active
  membership, added only if confirmed wanted.

## 6. Edge cases

| Case | Behaviour |
|---|---|
| No journals posted at all in the selected range/as-of date | Report renders with all-zero figures and an explicit "No financial activity recorded for this period" message — never a blank page, never a fabricated figure |
| `FinancialConfiguration.status` not yet `ACTIVE` (setup wizard incomplete) | Report request returns a clear `ConflictError`-style message ("Financial management has not been set up for this property yet"), matching the guard every other financial write-path already applies before touching the ledger |
| Lot with no active owner (vacant) | Owner Financial Statement renders with "No registered owner" in the owner field — reuses existing `getOwnerName` behaviour (already handles zero results) |
| Lot with multiple active owners (joint ownership) | Statement addresses all of them, comma-joined — reuses existing `getOwnerName` behaviour unchanged |
| `startDate > endDate`, or either an invalid date | `400`-equivalent validation error before any query runs |
| `accountingPeriodId` belongs to a different property/organisation | `NotFoundError` (never leaks existence) |
| Property/lot not found, or caller lacks `financials.view` | `NotFoundError` for a bad id; `ForbiddenError` for a real id without capability — identical to every existing financial route |
| Report spans a reversed journal | Reversal is itself a posted journal with swapped debit/credit — it is included like any other posted entry; the report does not special-case it (the reversal's own lines net the original back to zero, which is the correct accounting treatment, not an edge case needing special handling) |
| Requested as-of/period-end date is in the future | Allowed — the report simply reflects whatever has been posted as of generation time, which may be little or nothing; no forecasting is implied or attempted |

## 7. PDF layout

Reuses the exact `pdf-lib` pattern from `quoteAcceptanceDocument.ts` — `PDFDocument.create()`, US
Letter (`[612, 792]`), `StandardFonts.Helvetica`/`HelveticaBold` only (no new font embedding), the
same manual cursor-based `drawTitle`/`drawLabelValue`/`drawParagraph`-style helpers. New helper
needed (none exists yet): a simple table-row drawer (date/description/debit/credit/balance columns)
for the Income & Expense/Balance Sheet line items and the Owner Statement's movement rows —
multi-page via `doc.addPage()` again whenever the cursor runs off the bottom margin, same page size
repeated, no per-page template/branding system (matching the existing document's own "deliberately
plain — no branding system" convention).

**Header (every report):** organisation name, property name (+ strata plan number if the property
has one), report title, period or as-of date, "Generated [timestamp] by [user]" for traceability,
currency code, and — when applicable — the open-period/no-covering-period notices from §3/§4.3.

**Income & Expense Statement body:** one section per fund (or the single requested fund), each
listing every INCOME account with its net, then every EXPENSE account with its net, then that
fund's total income/expense/surplus-deficit; a final "All funds combined" section if multiple funds
were included.

**Balance Sheet body:** Assets section (each ASSET account, total), Liabilities section, Equity
section, then Total Liabilities + Equity, then the explicit balance-check line from §2.2.

**Owner Financial Statement body:** identical structure to the existing `LotStatementPage.tsx`
print view (opening balance; itemised movements table with date/description/fund/debit/credit/
running balance; closing balance) — this spec's PDF is a direct, deliberate visual port of that
existing screen, not a new design.

**Traceability (every report, every line item):** each line traces back to a real
`JournalEntry.publicReference` ("JRN-..."). The PDF does not print every journal reference inline
(that would be unreadably dense for an income/expense summary), but the underlying API response
backing the PDF includes `journalEntryId`/`publicReference` per line, and the existing Journals
list/detail screens remain the way to drill from a report figure back to its source postings — this
spec does not duplicate that drill-down UI, it relies on what already exists.

## 8. Frontend

New routes under `src/routes/properties/financials/` (matching the existing module's own
file-per-page convention — no new routing pattern):
- `IncomeExpenseReportPage.tsx`
- `BalanceSheetPage.tsx`
- `PropertyFinancialSummaryPage.tsx` (composite of the two above)
- Owner statement: **extend** the existing `LotStatementPage.tsx` with a "Download PDF" button
  calling the new PDF endpoint, rather than a new page — the existing print-view JSON rendering
  stays as-is; only a download action is added. (Its code comment claiming "no existing PDF
  pattern" is corrected by this spec — see §1.)

Each new report page: a date-range (or as-of-date) picker defaulting to the property's current
open `AccountingPeriod` if one exists, a fund selector (Income & Expense Statement only), a
"Download PDF" button, and the same loading/empty/error states already established by every other
financials page in this module (skeleton while loading, explicit empty-state copy, no silent
blank screen on error).

## 9. Acceptance criteria (testable)

1. Income & Expense Statement for a period with known fixture postings returns `totalIncome`,
   `totalExpense`, and `netSurplusOrDeficit` that match a hand-computed expectation from the fixture
   data, per fund and combined.
2. Balance Sheet as-of a date matches `trialBalance`'s own output for the same inputs, filtered to
   `ASSET`/`LIABILITY`/`EQUITY` — i.e., this report introduces no new aggregation bug independent of
   the already-tested `trialBalance` method.
3. `totalAssets === totalLiabilitiesAndEquity` for every fixture (ledger is always balanced by
   construction) — and the report's own displayed difference line reads exactly `0.00`.
4. Owner Financial Statement PDF for a lot with known levy/receipt history renders opening balance,
   every movement, and closing balance identical to the existing (already-tested)
   `LotLedgerService.getStatement` JSON for the same inputs.
5. A report requested for a property outside the caller's organisation returns `404`, not `403` and
   not the data.
6. A report requested by a caller without `financials.view` on that property returns `403`.
7. A report requested against a non-`LOT` space returns a clear, specific error, not a 500 and not a
   statement for the wrong kind of space.
8. A report for a date range with zero posted journals renders the explicit empty-state message,
   with every total at `0.00` — not an error, not an omitted section.
9. A report whose range/as-of date falls inside a still-`OPEN` `AccountingPeriod` includes the
   open-period notice text verbatim; a report fully inside a `CLOSED` period does not show it.
10. A report whose range includes dates with no covering `AccountingPeriod` row includes the
    no-covering-period notice from §4.3.
11. A reversed journal's lines are included in report totals exactly as posted (net effect zero
    from the original + reversal pair) — no special-case filtering excludes either journal.
12. PDF byte output opens as a valid PDF (smoke-tested by parsing the returned bytes back with
    `pdf-lib`'s own `PDFDocument.load`, matching how the existing quote-acceptance document is
    already verified) and its header section contains the organisation name, property name, and
    report period/as-of date as literal text.
13. No report anywhere computes or displays a "Committed" figure, a GST amount, or a close/lock
    action — their total absence from the UI and API response shapes is itself an acceptance
    criterion for staying within the authorized scope.

## 10. Explicitly NOT part of this spec

GST/BAS, year-end close/period locking, external accounting adapters, AI-generated commentary, any
new approval/maker-checker policy, any schema change, any new npm dependency, any change to
`LedgerPostingService`'s posting/reversal logic, any change to `LotLedgerService`'s existing
calculation (only a new PDF renderer around its existing output), and the `/overview` marketing
page.
