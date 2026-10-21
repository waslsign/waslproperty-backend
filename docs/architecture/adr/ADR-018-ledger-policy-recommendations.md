# ADR-018: Ledger and levy policy recommendations (D4, D5, D8, D6, D9)

**Status:** Proposed — recommendations for M16.2.2+, **not implemented in M16.2.1**
**Date:** 20 October 2026

## Context

The architecture blueprint (D1–D12) and client validation questions leave several accounting
rules unconfirmed by the client. Direction received 20 October 2026: do not block development
waiting for client confirmation — use established double-entry accounting principles, Australian
strata legislation, and ATO guidance to choose a defensible, documented default; flag what needs
professional/legal validation before production use.

**None of the decisions below are implemented in M16.2.1** — M16.2.1 ships the chart of accounts
and typed budget lines only, with no posting engine. They are recorded now so M16.2.2 (General
Ledger) has an agreed starting point instead of relitigating them mid-milestone.

## D4 — Budget Remaining / Actual / Committed formula

**Recommendation:** `Remaining = Proposed − Actual − Committed`, where `Actual` is the sum of
posted GL movements mapped to the budget line's account (never a budget-side running total — see
the blueprint's "no mutable running balance" principle), and `Committed` is the sum of open
`PurchaseCommitment` amounts net of consumed/cancelled portions. This is consistent with standard
budget-vs-actual accounting practice and with the one client screenshot showing `500.00 − 1.00 =
499.00` remaining with `0.00` committed.
**Needs validation:** whether a part-fulfilled PO's remaining commitment reduces `Committed`
immediately on partial invoice or only on full reconciliation.

## D5 — Advance owner payments and credit balances

**Recommendation:** An unallocated/advance receipt is credited to a **liability** account
(`UNAPPLIED_CASH`), never recorded as a negative receivable. This preserves the existing M16.1
design decision that `LotOpeningPosition.amountOwing` and `.creditBalance` are separate
non-negative columns, never one signed number (see that model's doc comment) — the same
discipline must carry into the ledger. On later allocation, the liability is debited and the
specific lot receivable is credited. This is standard trust-accounting practice for bodies
corporate holding owner funds in advance of levy due dates.
**Needs validation:** interest treatment on advance payments (not currently a stated requirement).

## D8 — Opening receivables and fund allocation at cutover

**Recommendation:** `LotOpeningPosition` (M16.1) has no fund dimension and must **never be
rewritten** (immutable per its own doc comment). The future opening-journal generator
(M16.2.2) takes an **explicit, operator-supplied fund split** of each lot's opening
`amountOwing`/`creditBalance` at the point the opening journal is generated — a new field on the
journal-generation input, not a retrofit onto the M16.1 snapshot. Debits/credits must balance per
fund before the opening journal can be posted.
**Needs validation:** accountant sign-off on the specific opening account mapping (receivable vs.
suspense) per fund.

## D6 — GST

**Current scheme evidence:** the client's own scheme-summary screenshot shows `GST: NO` at the
property level, yet the reference CSV distinguishes GST at the **code** level (`151407
Admin--Bank Charges--With GST`, `152500 GST on expenses --Tax Adjustment`). This confirms the
blueprint's own warning: GST must never be inferred from one scheme-level boolean alone.

**Recommendation (regulatory basis):**
- An owners corporation/body corporate registers for GST only once turnover (including levies)
  meets the registration threshold. Because the ATO treats a non-profit strata company's
  threshold as **$150,000** (double the standard $75,000, so long as there is no intention to
  distribute profits to owners) rather than the standard non-strata threshold, `TaxCode` must be
  **scheme-specific and versioned** (`effectiveFrom`/`effectiveTo`), never a single org-wide flag.
  [ATO property and construction guidance](https://www.ato.gov.au/law/view/document?LocID=%22GIR%2Fproperty-construction-ch1%22&PiT=99991231235958);
  see also the plain-language summaries at
  [Strata Plus](https://www.strataplus.com.au/resource/gst-requirements-for-owners-corporations/)
  and [PBL Legal](https://pbl.legal/insights/is-there-gst-on-strata-levies/).
- Tax is computed and stored **per transaction line**, never assumed from the scheme flag —
  matches the architecture blueprint's `TaxLine` model.
**Needs validation (mandatory before production):** exact BAS cycle (monthly/quarterly),
registered/non-registered transition handling mid-financial-year, and whether any WaslProp scheme
is GST-registered today (current evidence: none are, per the screenshot).

## D9 — Year-end close ("Finalise Book")

**Recommendation:** Standard double-entry year-close practice — a close checklist (unreconciled
cash, unposted invoices, open periods) must pass before `AccountingPeriod.status` moves to
`CLOSED`; closing books a journal carrying forward asset/liability/equity balances only (never
income/expense, which zero into retained surplus/deficit per fund); reopening is a separate,
audited, maker-checker action, never a silent undo. This mirrors the blueprint's existing
`FinancialClose` model (§5) and NSW's own annual AGM-budget cadence under the Strata Schemes
Management Act 2015 s.79 (admin fund) / s.80 (capital works fund), which assumes a clean annual
boundary.
[NSW SSMA 2015 s.79](https://www.austlii.edu.au/cgi-bin/viewdoc/au/legis/nsw/consol_act/ssma2015242/s79.html),
[capital works fund overview](https://www.lookupstrata.com.au/nsw-capital-works-fund/).
**Needs validation:** exactly what "Finalise Book" currently does in the reference product (client
question #11, still unconfirmed) and whether WaslProp's close semantics need to match it for
import compatibility, or may diverge as a deliberate improvement.

## Scheme-level financial controls (summary)

Every control above already follows the nonfunctional requirements in the requirements
specification: Decimal-only money, unique source-event keys for exactly-once posting, maker-
checker on close/reversal/write-off, and append-only history with linked reversals. No new control
is introduced by this ADR beyond what the blueprint already specifies; this ADR only resolves
*which* account/fund/tax rule those controls apply to.

## M16.2.2 closure verification addendum (20 October 2026)

D8's opening-journal fund-split validation, as first implemented, summed each lot's allocation
amounts with plain JS floating-point addition and compared against the recorded M16.1 snapshot
using an arbitrary `±0.001` tolerance band — a violation, in spirit, of the nonfunctional
requirement "no arbitrary floating-point monetary calculations," even though it was validation
logic rather than the posting itself. Fixed during M16.2.2 closure verification:
`OpeningJournalService` now sums allocations as `Prisma.Decimal` and requires exact equality to
the recorded `Decimal` snapshot value, with no tolerance band at all. This matches how the posting
engine itself already validates balance (`totalDebit.equals(totalCredit)`), and is strictly more
correct with no loss of legitimate functionality.

## Status and next step

This ADR is a **documented recommendation**, not an implementation. M16.2.2 (General Ledger)
should treat D4/D5/D8/D9 as its working assumptions and flag D6 (GST) for mandatory accountant
sign-off before any scheme is allowed to register for GST in WaslProp.
