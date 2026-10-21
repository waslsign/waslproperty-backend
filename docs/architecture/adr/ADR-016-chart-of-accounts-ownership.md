# ADR-016: Chart of Accounts ownership and fund flexibility

**Status:** Accepted · **Date:** 20 October 2026 · **Milestone:** M16.2.1

## Context

M16.1/M16.2 had no chart of accounts — `FinancialBudgetLine.category` was free text. The client's
reference CSV (`expense_codes_336684074.csv`, 483 rows) and screenshots show account codes
appearing identically under what looks like parallel `15xxxx`/`25xxxx` ranges, suggesting a
fund/nature encoding, but this is not confirmed by the client. D1/D2/D3 from the architecture
blueprint needed resolving before M16.2.1 could ship.

## Decision

**D1 — scope:** Accounts are **scheme-specific** (`AccountingAccount` is property-scoped, unique
`code` per property). An organisation-level `AccountTemplate` exists purely as a **copy-on-
provision** starting point — its lines are copied into independent `AccountingAccount` rows and
never read live again. No live shared catalog.

**D2 — fund association:** An account may serve **more than one fund**. The fund dimension lives
on the consuming record (`FinancialBudgetLine.financialFundId` today; the future
`JournalLine.financialFundId`), not on the account. `AccountingAccount.restrictedToFundId` is an
optional, narrow exception for an account that genuinely belongs to exactly one fund (e.g. that
fund's own cash account) — null (the default) means usable against any fund.

**D3 — code-range inference:** The CSV's `15xxxx`/`25xxxx` pattern is treated as a **non-
authoritative suggestion only**. `AccountImportService` never classifies from a code range; it
only classifies from an explicit `Code type` cell in the file, a caller-supplied override, or a
weak name-keyword heuristic that is always surfaced to the user as "suggested" and must be
confirmed before `apply`.

**Deactivate, never delete.** `AccountingAccount.isActive` toggles off; the row and every
historical reference (budget lines, and future journal lines) are preserved permanently.

**Inactive accounts cannot be newly assigned.** `FinancialBudgetsService.assertAccountAssignable`
rejects (409) writing an inactive account into `FinancialBudgetLine.accountId`, whether on a new
line or an edit to an existing one. This is a prospective-only check — a line's existing reference
to an account deactivated after assignment is left exactly as-is on every read and on every edit
that doesn't itself touch `accountId`. Confirmed by the M16.2.1 closure verification (20 October
2026); see the traceability matrix's closure-verification section.

## Consequences

- Reusing a code across schemes is possible and expected (confirmed by the real CSV having the
  same `150900`/`150901` style duplication within one file already).
- The future GL's `PostingProfile` (M16.2.2) resolves semantic roles (levy receivable, levy
  income, etc.) to an account *and* a fund together — this ADR is what makes that two-dimensional
  resolution necessary rather than redundant.
- D1–D3 remain open for explicit client/accountant confirmation before any code-range-based
  automation is introduced; see the traceability matrix's "needs validation" column.

## Alternatives considered

- **Organisation-wide shared accounts** — rejected: a live-shared catalog means one scheme's edit
  silently reinterprets another scheme's historical postings; copy-on-provision avoids this while
  still giving organisations a consistent starting point.
- **Fund as a required field on the account** — rejected: would force either duplicate accounts
  per fund (matching the CSV's apparent pattern, but unconfirmed) or an artificial "shared" fund
  value; keeping fund on the line is strictly more flexible and reversible.
