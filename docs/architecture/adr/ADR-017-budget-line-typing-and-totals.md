# ADR-017: Budget line typing and the totalBudget rename

**Status:** Accepted · **Date:** 20 October 2026 · **Milestone:** M16.2.1

## Context

`FinancialBudgetLine` had no revenue/expense distinction, and `FinancialBudgetsService.toView`
summed every line into one `totalBudget` figure. The client's screenshots show revenue codes
(`142500`, `142800`, `143000`) budgeted inside the Administrative Fund alongside expenses.
Continuing to sum everything into one figure would silently misrepresent any budget that includes
revenue lines.

WaslProp has no external API consumers yet (confirmed), so the client direction was to take the
breaking rename cleanly rather than add a deprecated alias.

## Decision

- Add `FinancialBudgetLine.lineType`: `REVENUE | EXPENDITURE | TRANSFER | RESERVE_CONTRIBUTION |
  OTHER`, **non-null, defaulting to `EXPENDITURE`**. Every pre-existing row backfills to
  `EXPENDITURE` automatically (Prisma default on an added non-null column), so historical
  expenditure totals are numerically unchanged by the migration — verified by an integration test
  that reads a seeded APPROVED/ACTIVE budget before and after.
- Replace `BudgetView.totalBudget` with three fields: `totalBudgetedRevenue` (REVENUE lines only),
  `totalBudgetedExpenditure` (EXPENDITURE lines only), and `budgetedSurplusDeficit`
  (`totalBudgetedRevenue - totalBudgetedExpenditure`). **No deprecated alias** — `totalBudget` is
  removed outright, and every caller (backend tests, OpenAPI schema, frontend types/pages) is
  updated in the same change.
- `totalsByFund` entries carry `totalRevenue`/`totalExpenditure` per fund instead of one `total`.
- `TRANSFER`/`RESERVE_CONTRIBUTION`/`OTHER` lines are **excluded** from the headline
  `budgetedSurplusDeficit` — they are reported per-line and per-fund but not folded into a real
  funding bridge yet. A funding bridge (opening balance, transfers, reserve provisioning) is
  explicitly out of scope for M16.2.1; see FIN-007 in the traceability matrix.
- Add `FinancialBudgetLine.accountId` (nullable, additive) — an optional reference into the new
  chart of accounts (ADR-016). `category` is kept unchanged as the historical free-text label.

## Consequences

- Every consumer of `BudgetView`/`Budget` (frontend types, API client, pages, tests) had to be
  updated in this one change — done; verified by the full backend (790 tests) and frontend (222
  tests) suites passing.
- A later milestone (M16.2.2+) can build a real funding bridge (surplus/deficit covered by opening
  balance, transfers, reserve contributions) as an additive field without another breaking rename,
  since `lineType` already distinguishes the inputs it would need.

## Alternatives considered

- **Keep `totalBudget` as a deprecated alias equal to total expenditure** — rejected per explicit
  direction: no external consumers exist to protect, and an alias that quietly means "expenditure
  only" is more confusing than a clean break.
- **Infer `lineType` from the referenced account's classification** — rejected: a line can exist
  with no account reference (every pre-M16.2.1 line, and any new line added before the CoA is
  built out), so `lineType` must be able to stand alone.
