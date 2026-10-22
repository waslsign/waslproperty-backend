# ADR-030: FIN-021 scope decision — Financial Statements & Reporting (limited)

**Status:** Proposed — specification drafted (see
`docs/architecture/financial-statements-reporting-spec.md`), pending implementation approval.
**Date:** 23 October 2026

## Context

The implementation plan's roadmap had, at various points, referred to a "M16.9 (Financial
Statements & Reporting)" milestone. It was never a confirmed, implemented milestone: the 21
October 2026 resequencing folded FIN-021 (financial statements and owner statements) into an
open-ended "M16.8+" forward bucket alongside GST/BAS (FIN-020), year-end close (FIN-022), external
adapters (FIN-024) and AI assistance (FIN-025) — explicitly *not* broken back into individual
milestone numbers, and the plan's own header stated plainly that this placeholder "remains a
proposal pending architecture/client confirmation."

On 23 October 2026, the client authorized a **new, narrower, explicitly-scoped** feature — not a
resurrection of the old placeholder — covering property/building financial summaries, income and
expense reporting, owner financial statements, date-range filtering, downloadable PDF reports, and
transaction traceability. GST/BAS, year-end close, external integrations, AI-generated advice, and
any new accounting policy requiring sign-off were explicitly excluded by the same authorization.

## Decision

Implement the scope in `financial-statements-reporting-spec.md` only. Specifically:

- Reuse `LedgerPostingService.trialBalance` and `LotLedgerService.getStatement` as the data
  sources for every report — no new ledger query logic, no schema change.
- Add PDF rendering (via the existing `pdf-lib` pattern already used for quote/variation acceptance
  documents) and a new direct-download HTTP response pattern (the first in this codebase to serve
  a PDF straight to the caller rather than into a WaslSign upload).
- Gate every new endpoint on `financials.view` only — these are read-only reports, so no new
  capability is introduced.
- Scope the Owner Financial Statement to strata lots (`Space.strataClassification === 'LOT'`) —
  the only existing per-unit financial subledger. A non-strata equivalent does not exist and is not
  invented here (see spec §4.1).

## This explicitly does NOT resolve ADR-018

ADR-018's D6 (GST treatment) and D9 (year-end close / "Finalise Book") remain **open,
unconfirmed recommendations**, exactly as ADR-018 left them. Nothing in this ADR or its
accompanying spec implements, assumes, or narrows either decision. Any future milestone that
actually builds GST/BAS or year-end close must still resolve D6/D9 through the same
client/accountant validation ADR-018 already calls for — this scoping decision changes nothing
about that requirement; it simply declines to touch either area.

## Consequences

- FIN-021's traceability row moves from "Planned, M16.8+" to "Planned, this spec (limited scope)" —
  see `financial-requirements-traceability.md`.
- FIN-020/022/024/025 remain exactly as they were ("M16.8+", Planned/Deferred) — this decision does
  not resequence or reinterpret any of them.
- The old "M16.9" label is retired. There is no milestone numbered M16.9 in the current roadmap;
  this work, once approved, is tracked as "Financial Statements & Reporting (limited scope)"
  against FIN-021 directly.
