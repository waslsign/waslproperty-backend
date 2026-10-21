# ADR-019: CSV import — unpersisted preview, atomic apply, no multipart pipeline

**Status:** Accepted · **Date:** 20 October 2026 · **Milestone:** M16.2.1

## Context

The requirements call for "preview, mapping, validation, duplicate handling, dry run, atomic
apply, export" for chart-of-accounts CSV import, validated against the real
`expense_codes_336684074.csv` (483 rows; 0 duplicate codes; 480/483 rows with no `Code type`; one
row explicitly typed `Income`; 49 case-insensitive duplicate names; one row with an embedded
newline; 39 names with trailing whitespace).

## Decision

1. **Preview is a pure, unpersisted computation.** No `AccountImportRow`/batch-of-rows table
   exists. A preview call parses and validates the submitted CSV text fresh, returns a report, and
   writes nothing. This avoids a staleness problem entirely: there is no persisted dry-run state
   that could drift from the scheme's actual accounts between a preview and a later apply.
2. **Apply always re-validates from scratch**, including re-checking for codes added since the
   preview (covered by an integration test: an account is added by hand between preview and apply,
   and apply correctly rejects the now-stale collision). One `AccountImportBatch` audit row is
   written per *applied* import (never per preview), inside the same transaction as the accounts
   it creates.
3. **No separate multipart upload endpoint.** The frontend reads the selected `File` client-side
   (`FileReader`) and sends its text as a JSON string field (`csvContent`). WaslProp has no
   existing CSV/file-upload-specific infrastructure in this module to reuse, and a JSON-text body
   keeps the preview/apply contract simple and directly testable.
4. **Classification resolution order:** explicit `Code type` cell (real scheme data) → caller
   `rowClassifications` override → non-authoritative name-keyword heuristic, always labeled
   `suggestionConfidence: 'heuristic'` and never silently applied without being shown. A row with
   none of the three is `ERROR` and blocks the whole apply — `AccountClassification` is a required
   field, there is no "unclassified" account. **Nothing is ever classified from the filename** —
   verified by a dedicated test asserting a file named `expense_codes.csv` does not bias an
   otherwise-unclassifiable row toward `EXPENSE`.
5. **One bad row blocks the whole batch** (all-or-nothing apply) — same discipline as
   `FinancialsService.bulkSetLotOpeningPositions`.

## Consequences

- Import history beyond the one summary row (`AccountImportBatch`: counts, filename, actor, time)
  is not queryable row-by-row after the fact — only via the `ActivityEvent` audit trail and the
  created accounts' own `sourceImportBatchId`. If per-row import history becomes a real product
  requirement (e.g. "show me exactly what row 214 looked like when imported"), a follow-up
  migration adding `AccountImportRow` is additive and does not conflict with this design.
- Validated end-to-end against the actual 483-row reference file in
  `test/integration/financial-accounts.test.ts`, not synthetic fixtures only.

## Alternatives considered

- **Persist every previewed row with a dry-run status** — rejected for M16.2.1: adds a table and a
  staleness-reconciliation problem for a benefit (re-displaying a stale preview) the product does
  not yet need, given apply already re-validates from scratch regardless.
- **Infer classification from the CSV's numeric code ranges** (e.g. `15xxxx`/`25xxxx`) — rejected;
  see ADR-016 D3. The ranges are a real but unconfirmed pattern; treating them as authoritative
  risks silently misclassifying hundreds of accounts.
