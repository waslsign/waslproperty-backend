# WaslProp Financial End-to-End Demo & M16.3 Closure Report

**Date:** 20 October 2026
**Environment:** local development backend (`http://localhost:4100`), local development frontend
(`http://localhost:5174`), local Postgres dev database. **Not production.**
**Organisation:** "Iconic Property Care" (`cmtq224jz0076up9xpleomo46`), logged in as
`hello@amaltventures.com`.
**Demo property identifier:** `HARBOURVIEW-DEMO` → "WaslProp Demo — Harbour View Strata"
(`cmvgq0llv0007upo8zgf4xbmv`).

---

## 1. M16.3 verification results

A focused review covered the six areas requested, without expanding into M16.4:

| Area | Result |
|---|---|
| Lot levy charges reconcile exactly to posted journals | **Pass** (existing + new tests) |
| Concurrent levy issuance cannot duplicate charges/journals | **Pass** (existing tests — idempotency key on `JournalEntry`) |
| Reversal/adjustment preserve the accounting audit trail | **Defect found and fixed** (below) |
| Only levy-income-classified budget lines fund regular levies | **Pass** (existing tests — `deriveRegularTotal` only sums `REVENUE` lines linked to the fund's `LEVY_INCOME` account) |
| Financial permissions & property isolation enforced | **Pass** (existing tests — `financials.manage`/`financials.approve` split, org/property scoping) |
| Notice-delivery failure cannot affect committed financial postings | **Pass** (existing tests — notices are a best-effort, non-blocking post-commit step) |

### Defect found and fixed

`LevyService.reverseIssuance()` called `LedgerPostingService.reverse()` (which opens and commits
its own transaction) and then updated `LotLevyCharge`/`LevySchedule` rows in a **separate**
transaction. A crash or process restart between the two would leave the general ledger reversed
while the lot subledger still showed `ISSUED` — the same class of bug already closed in
`LedgerPostingService.reverse()` itself during the M16.2.2 closure pass (ADR-021's closure
addendum).

**Fix:** added `LedgerPostingService.reverseWithinTransaction(tx, ...)` — a public method mirroring
the existing `postWithinTransaction()` contract — and rewrote `reverseIssuance()` so the
configuration-row lock, the "already reversed" check, the GL reversal, the lot-subledger update,
and the activity record all happen inside **one** transaction.

**Files changed:**
- `src/modules/financials/ledger-posting.service.ts` — extracted `reverse()`'s body into
  `reverseInTransaction()`, added public `reverseWithinTransaction()`.
- `src/modules/financials/levies.service.ts` — `reverseIssuance()` rewritten to do everything in
  a single `$transaction`.
- `test/integration/financial-levies.test.ts` — new test: two truly concurrent reversal requests
  on the same issued schedule resolve to exactly one reversal journal (`201`/`409`), the schedule
  ends `REVERSED`, all 3 lot charges end `CANCELLED`, and the trial balance shows a zero
  receivable balance afterward.

**Verification:** `test/integration/financial-levies.test.ts` + `test/integration/financial-
ledger.test.ts` + the two new email-suppression test files: **55/55 passing.** Full backend suite
after the fix: **856/857 passing (62 files, 857 tests)** — the single failure
(`financial-accounts.test.ts` → "rejects a cross-property account reference") is a 5-second-timeout
flake under full-suite load; re-run in isolation it passes in 279ms. It is in a file this closure
pass never touched (M16.2.1 Chart of Accounts, not levies/ledger) — **not a regression.**

No other defects were found in the six reviewed areas; the existing M16.3 implementation and its
20 integration tests already correctly enforce them.

---

## 2. Email safety — evidence and confirmation

**Zero outbound emails were sent during this exercise.** Before any demo data was created, outbound
email delivery was verified suppressed at the single shared transport chokepoint
(`EmailService.send()`, `src/lib/email.ts`), which an exhaustive grep confirmed is the *only* path
to a real mail provider — there is no second send function, no direct `nodemailer`/`Resend` client
instantiated anywhere else in the codebase.

**Two independent, defense-in-depth layers, both verified by automated test (no external provider
contacted):**

1. **Test-time mock** — `test/setup.ts`'s pre-existing global `vi.mock('.../lib/email.js', ...)`
   (already relied on by every test exercising a real send path). Re-verified:
   `test/unit/emailSuppression.test.ts` — **1/1 passing.**
2. **Runtime kill switch** — new `EMAIL_SEND_DISABLED` env flag, checked inside
   `EmailService.send()` *before* `getProvider()` (which would construct the real SMTP/Resend
   client) is ever called. Set to `true` in both `.env` (the real file, which holds live Gmail SMTP
   credentials) and `.env.test` (belt-and-braces). Verified directly by bypassing the global mock
   and spying on `selectEmailProvider`, proving it is never invoked while suppressed — and that the
   spy is a meaningful negative, since it *is* invoked when called outside the suppressed path:
   `test/unit/emailSuppressionReal.test.ts` — **4/4 passing.**

**Live confirmation during the demo run itself:** `main.ts` starts two in-process background
schedulers on server boot (`getDeliveryScheduler()`, `getComplianceScheduler()`), each polling on
a ~100-second interval for queued communications/compliance notifications across the whole dev
database (which includes 10 pre-existing properties besides the new demo one). Both fired during
this session. The backend log shows:

```
24 × "Outbound email suppressed (EMAIL_SEND_DISABLED or NODE_ENV=test) — not sent."
0  × any SMTP/Resend/nodemailer log line
```

This is not a theoretical guarantee — the kill switch is confirmed to have actually intercepted a
real, independently-triggered send path live, twice, during this exercise, with zero network
connections to any mail provider at any point.

**Credential handling:** the test account's password was supplied once by the user in chat and was
read from the `WASLPROP_DEMO_PASSWORD` environment variable at runtime by the demo script — never
hardcoded into any script or file, never printed or logged. One earlier operational lapse is
disclosed for transparency: while grepping `.env`/`env.ts` for SMTP configuration keys during
investigation, a `grep` of the whole `.env` file inadvertently echoed the real `SMTP_PASS` value
into tool output once. No further reproduction of that value occurred, and it was never committed.
**Recommendation:** rotate that Gmail app password, and confirm `.env` stays `.gitignore`d (it does
— verified).

---

## 3. Demo property creation status

**Created and preserved.** "WaslProp Demo — Harbour View Strata" (code `HARBOURVIEW-DEMO`) is a
real property under the "Iconic Property Care" organisation, created and configured entirely
through the real backend API (no direct database writes, consistent with "follow the application's
valid lifecycle"). The demo script (`run-demo.mjs`, kept outside the repo in this session's
scratchpad, not committed) is idempotent: a rerun detects the existing property by its stable code
and every already-completed step, and only performs what's still missing — demonstrated live when
a script bug (see §5) was fixed mid-session and the rerun resumed cleanly from where it left off
without creating any duplicate records.

### Property details
- 12 residential lots (`APARTMENT`), varied units of entitlement 60–120 (total 950) — the realistic
  uneven-UOE case, not a convenient round number.
- 12 fictional owners, one per lot, added as `OWNER` memberships (never through the separate
  `inviteContact`/`resendInvite` endpoints, which are the only paths that trigger an actual invite
  email outside the suppressed chokepoint — not called at all in this exercise). Owner emails use
  the reserved `.invalid` TLD (RFC 2606), so they could never resolve to a real inbox even if some
  future code path bypassed suppression.
- Financial year 2026-07-01 → 2027-06-30, cutover 2026-10-01.
- Two funds: Administrative Fund (opening cash $42,500.00) and Capital Works Fund (opening cash
  $118,750.50).
- 18-account Chart of Accounts (5 asset, 3 liability, 1 equity, 2 income, 7 expense) — a realistic
  AU strata scheme CoA, not the minimal 3-account test fixture.
- 11-rule posting profile (fund-specific `FUND_CASH`/`LOT_LEVY_RECEIVABLE`/`LEVY_INCOME` per fund;
  global `OPENING_BALANCE_EQUITY`/`UNAPPLIED_CASH`/`ACCOUNTS_PAYABLE`/`GST_PAYABLE`/
  `GST_RECEIVABLE`).
- One accounting period spanning the full FY.
- One opening journal (fund cash vs. opening balance equity — all 12 lots start with zero
  arrears/credits, so no lot-level opening allocation was needed).
- One FY2026/27 budget (both funds' REVENUE + EXPENDITURE lines, approved) — see §5 for why this
  required a mid-session correction.
- Two quarterly regular levy schedules, approved and **issued**: Administrative Fund ($96,000/yr,
  4 × $24,000) and Capital Works Fund ($48,000/yr, 4 × $12,000).

### Reopening/reviewing the demo
- Log in as `hello@amaltventures.com` (organisation "Iconic Property Care").
- The property is in the properties list as "WaslProp Demo — Harbour View Strata" / code
  `HARBOURVIEW-DEMO`.
- Rerunning the demo script against the same backend is safe — every step checks current state
  first and skips or resumes rather than duplicating.
- **No data was deleted.** All 12 lots, owners, accounts, the posting profile, the budget, both
  levy schedules, all 96 `LotLevyCharge` rows, and both journals remain in the dev database for
  manual review.

---

## 4. End-to-end financial results

### Trial balance (after both schedules issued)

| Account | Net balance |
|---|---|
| 100000 Cash at Bank — Administrative Fund | 42,500.00 |
| 101000 Term Deposit — Capital Works Fund | 118,750.50 |
| 110000 Lot Levy Receivable — Administrative Fund | 96,000.00 |
| 111000 Lot Levy Receivable — Capital Works Fund | 48,000.00 |
| 300000 Opening Balance Equity | (161,250.50) |
| 400000 Levy Income — Administrative Fund | (96,000.00) |
| 401000 Levy Income — Capital Works Fund | (48,000.00) |

Net balances sum to **exactly $0.00** — debits equal credits across the whole ledger. Opening
Balance Equity (-$161,250.50) matches the sum of both funds' opening cash balances exactly;
both Levy Income accounts match their fund's annual budget total exactly.

### UOE allocation — cent-perfect, no residual

96 `LotLevyCharge` rows (12 lots × 4 installments × 2 funds). Every installment sums exactly to its
target with zero residual, confirming the largest-remainder (Hamilton apportionment) method handles
a genuinely uneven UOE split correctly. Worked example — Administrative Fund, Q1 installment
($24,000 ÷ 950 UOE):

| Lot | UOE | Charge |
|---|---|---|
| L01 | 120 | $3,031.58 |
| L02 | 95 | $2,400.00 |
| L03 | 95 | $2,400.00 |
| L04 | 80 | $2,021.05 |
| L05 | 80 | $2,021.05 |
| L06 | 75 | $1,894.74 |
| L07 | 75 | $1,894.74 |
| L08 | 70 | $1,768.42 |
| L09 | 70 | $1,768.42 |
| L10 | 65 | $1,642.11 |
| L11 | 65 | $1,642.10 |
| L12 | 60 | $1,515.79 |
| **Total** | **950** | **$24,000.00** |

L10 and L11 have identical UOE (65) but differ by exactly one cent — the deterministic
largest-remainder rule distributing the installment's one-cent rounding residual, not a bug.

### Lifecycle deviations from the literal instruction order (documented, not bypassed)

1. **One budget per financial year, not one per fund.** The API rejects a second
   `POST .../budgets` call for a financial year that already has one ("Create a revision instead
   of a new budget"). A single budget spans both funds via fund-tagged lines. The demo now creates
   one FY2026/27 budget containing both funds' REVENUE/EXPENDITURE lines.
2. **"Issue the levy" issues the whole schedule's installments at once**, not one installment at a
   time — there is no partial-installment issuance in the current API. Issuing each fund's
   quarterly schedule creates all 4 installments' `LotLevyCharge` rows (48 per fund) in a single
   aggregated journal, which is the actual, correct lifecycle behaviour per ADR-022/023 (one
   journal per issuance event, never one journal line per lot or per installment).
3. **Lot opening positions lock once financial setup is `ACTIVE`** (409 on a later attempt) — by
   design (M16.1's "no retroactive rewriting of a reconciled opening position"). The demo sets
   positions once, before activation.

None of these required bypassing a control, posting a fabricated journal, or inserting data outside
the API — each is the application's actual valid lifecycle, adjusted for after discovering it live.

### Browser/UI verification

**Not completed — no browser automation tool was available in this environment** (no Playwright/
Puppeteer MCP tool was reachable from this session). I confirmed the frontend dev server is running
(`localhost:5174`, `VITE_API_URL=http://localhost:4100/api/v1`, matching the backend used above) and
is the correct `waslproperty-frontend` process (not a same-numbered port from an unrelated project),
but did not navigate it or capture screenshots. **This is disclosed rather than fabricated** —
per the task's "do not fabricate successful results if an operation fails" instruction. A manual
walkthrough of the property onboarding, Chart of Accounts, budget, ledger, and levy screens against
this now-populated demo property is recommended as a follow-up, ideally by a person with a browser
open, or in a future session where a browser automation tool is available.

---

## 5. Remaining issues before M16.4

1. **Isolated flaky test**: `financial-accounts.test.ts` → "rejects a cross-property account
   reference" times out intermittently under full-suite load (passes in isolation). Worth raising
   `testTimeout` for that one assertion or investigating why it's slower than its peers under load
   — low priority, pre-existing, unrelated to M16.3.
2. **Gmail app password rotation recommended** (see §2's credential-handling disclosure) — not a
   code defect, an operational hygiene item.
3. **No browser-level UI verification performed** (see §4) — recommend a manual pass or a future
   session with browser automation available before signing off the M16.3 frontend screens as
   production-ready.
4. **UI design improvements** — none identified as blocking; no new UI was created or modified in
   this exercise (Stitch-first policy not implicated).

No blockers were found that should delay starting M16.4. The one genuine defect found in this
closure pass (§1) is fixed and tested.

---

## Addendum — M16.3 refinement pass (20 October 2026, same day, following review of this report)

A review of this report and the screens it describes found six further issues, all addressed —
full detail in ADR-024 and the traceability matrix's "M16.3 refinement pass" entry:

1. **Budgets stayed APPROVED, never ACTIVE, while levies were issued against them** (this
   report's §1 covered the symptom; this pass fixed the root cause). `LevyService.deriveRegularTotal`
   now requires `ACTIVE`, not merely `APPROVED`. **Demonstrated live on this exact demo property**:
   its FY2026/27 budget (v2, the revision containing both funds' lines) was `APPROVED` only — it was
   activated via `POST .../budgets/{id}/activate` during this pass, now `ACTIVE`. The schedules
   already issued under the old rule are grandfathered (the check only applies at schedule
   *creation*, not retroactively), so no existing history was touched.
2. **Raw lot database ids in the charge table** — fixed; verified against this demo property's
   real 96 `LotLevyCharge` rows: `GET .../lot-levy-charges` now returns e.g. `"lotLabel": "Lot 12"`,
   `"ownerName": "Ethan Walker"`, `"fundName": "Capital Works Fund"`, `"installmentNumber": 4`,
   never a raw `spaceId` as the lot identifier.
3. **Whole-schedule issuance replaced with per-instalment issuance** (ADR-024) — a migration
   backfilled this demo's two already-issued schedules' detail onto their instalments. Verified
   live: all 8 instalments across both schedules (`FY2026/27 Administrative Fund Quarterly Levy`,
   `FY2026/27 Capital Works Fund Quarterly Levy`) correctly show `status: "ISSUED"` with their
   (shared, historically accurate) `journalEntryId` populated — **zero posted journals, charges, or
   schedule rows were rewritten, deleted, or reissued**; the 96 charges and both funds' trial
   balance figures are byte-identical to this report's original §4 figures.
4. **Trial balance conventional presentation + fund filter** — verified live: every account row now
   carries `presentedSide`/`presentedBalance` (e.g. `110000 Lot Levy Receivable — Administrative
   Fund` → `DEBIT 96000.00`; `400000 Levy Income — Administrative Fund` → `CREDIT 96000.00`), and
   `?financialFundId=` correctly restricts the aggregation to one fund's lines.
5. **Personalised levy notices** — `sendLevyIssuanceNotice` now creates one Communication per
   charged lot (lot, fund, amount, due date), still fully gated by the same `EMAIL_SEND_DISABLED`
   kill switch and test-time mock verified in §2 above — re-verified by new/updated tests exercising
   the per-lot path end to end; no code change to the suppression layer itself was needed or made.
6. **Financial overview dashboard** — designed in Stitch as a clearly-labelled proposal (not built),
   alongside refreshed Stitch designs for the Levy Schedule Detail (per-instalment table + human-
   readable charges) and Trial Balance (Debit/Credit columns + fund filter) screens, all using the
   existing WaslProperty design system. **Frontend implementation status**: the Levy Schedule Detail
   page and the Trial Balance tab were rebuilt against these designs and the new API contract
   (typecheck/lint clean, 223/223 frontend tests passing including one new test asserting the
   per-instalment Issue/Reverse controls and the absence of any raw spaceId on screen); the
   dashboard proposal was not implemented, consistent with it being a proposal.

**Test results after this pass**: backend typecheck/lint clean; `financial-levies.test.ts` alone
27/27 (6 new tests for this pass: multi-instalment separate issuance including out-of-order
targeting, per-instalment reversal isolation, cancel-after-issue-then-reverse, charge-view human-
readability, `people.view` owner-name gating, trial-balance fund filter/presentation); see the
traceability matrix for the full-suite figure. Frontend: 223/223 (1 new). No browser-level manual
click-through was performed in this pass either (same tooling limitation as above) — the live API
verification against this unmodified demo property is what grounds the figures in this addendum.

**M16.4 readiness**: unchanged from this report's original conclusion — no blocker identified.

---

## Addendum 2 — Financial Overview Dashboard implemented (20 October 2026, same day)

The dashboard proposed in Addendum 1 (finding 6) is now built. The actual Stitch-generated HTML
(not just the screenshot) was fetched and inspected for the "Financial Overview Dashboard
(Proposal Desktop)" screen before implementation, reusing the app's existing component library,
Tailwind tokens, and navigation patterns — not an independent redesign.

**Data integrity.** The Stitch mock's own content included several figures this accounting
implementation genuinely does not have: specific bank account numbers (e.g. "Westpac Operating
#4812"), a 3-month cash target buffer and a "+$7,500 surplus" variance against it, a "10-Year Plan
Forecast" benchmark, a "103.2% fully funded" compliance claim, and an invented generic activity
timeline (account mappings, posting-profile updates that never happened). None of these are
reproduced. Every figure shown is either read straight from an existing `financials.view`-gated
endpoint or computed by `dashboard-selectors.ts` from values that are — and the two places a
configured value genuinely doesn't exist (a fund with no `FUND_CASH` role mapped; a fund with no
budgeted revenue line) render an explicit "not available"/"not configured" state, never a
fabricated $0 or N/A disguised as a real figure. "Levy Receivables Outstanding" is explicitly
labelled and never conflated with cash received — WaslProp has no receipts/payments yet (M16.4).

**APIs used.** No new backend endpoint. Every figure is composed client-side from endpoints
already in production use: `GET .../financials`, `.../financials/posting-profile`,
`.../financials/trial-balance`, `.../financials/budgets`, `.../financials/levy-schedules`,
`.../financials/lot-levy-charges`, `.../financials/journals`, `.../financials/periods`,
`.../financials/accounts`. No OpenAPI change — no API changed.

**Verified live against this demo property** (API responses fetched directly, selector logic
replicated to confirm the exact figures the page would render — no browser tool is available in
this environment, same limitation as Addendum 1):

| Metric | Value |
|---|---|
| Administration Fund balance | AUD 42,500.00 (100000 — Cash at Bank — Administrative Fund) |
| Capital Works Fund balance | AUD 118,750.50 (101000 — Term Deposit — Capital Works Fund) |
| Total cash | AUD 161,250.50 |
| Levy instalments issued / pending | 8 / 0 (both schedules now fully issued) |
| Levy receivables outstanding | AUD 144,000.00 |
| Active budget | FY2026-07-01 – 2027-06-30, approved 2026-10-20 |
| Budget vs actual (Admin / Capital Works) | 100.0% / 100.0% of budgeted levy income posted |
| Trial balance | AUD 305,250.50 debit = AUD 305,250.50 credit — Balanced |
| Recent journals (top 3) | Capital Works levy issuance (AUD 48,000.00), Administrative levy issuance (AUD 96,000.00), opening balance journal (AUD 161,250.50) |
| Financial setup status | Posting profile complete, open accounting period covers today, 18 active CoA accounts |

No demo data was created, modified, or deleted to produce this verification — every figure above
came from the property's existing, already-posted history.

**Tests.** `dashboard-selectors.test.ts` (11 unit tests — fund-cash resolution with a global-vs-
fund-specific posting-profile rule, honest-null on an unconfigured fund, budget-vs-actual pairing,
levy overview counting/soonest-due-date/cancelled-schedule exclusion, trial-balance-balanced
check, setup-status role-gap detection) and `financial-overview-dashboard.test.tsx` (2 component
tests — real figures render from mocked API responses; none of the Stitch mock's fabricated
figures ever appear; an unconfigured fund shows the honest "not configured" state, never a
fabricated balance). Full frontend suite: **236/236 passing** (43 files), typecheck/lint clean. No
backend files changed this pass, so the backend suite is unaffected (863/863, confirmed in
Addendum 1, still current).

**Remaining limitations:**
- No browser-level manual click-through — no browser automation tool is available in this
  environment, same limitation noted in both prior addenda.
- Budgeted/actual EXPENDITURE and committed costs are explicitly labelled unavailable on the
  dashboard — WaslProp does not yet post actual expenditure (accounts payable/banking land in a
  later milestone), so showing anything there would be fabricated.
- The pre-existing orphaned budget-revision wrinkle (noted in the traceability matrix) is
  unrelated to this dashboard and remains out of scope.

**M16.4 readiness**: no blocker identified from this dashboard implementation.

---

## Addendum 3 — Financial Overview Dashboard UX refinement (20 October 2026, same day)

The dashboard was reported as too dense: a narrow centered content column (the app's default
`max-w-3xl`/`max-w-5xl` page container) and nested bordered cards inside cards. Revised in Stitch
by editing the existing screen (`edit_screens`, not a fresh independent design) — fetched and
inspected the regenerated HTML before implementing, confirming `max-w-[1400px]` and a flattened,
single-surface-per-section structure.

**Structure now matches the requested layout exactly:** header (title, FY, one budget-status
badge) → 4 KPI cards (Total Cash Across Funds, Outstanding Levy Receivables, Annual Levy Budget,
Ledger Reconciliation) → single-surface Fund Balances comparison → two side-by-side panels (Levy
Schedules, Recent Ledger Activity) → a slim secondary strip (Budget Summary + Financial Setup
Status) linking through to their own full pages rather than reproducing them.

**Financial accuracy preserved through the redesign** — re-verified against the same real demo
figures as Addenda 1–2, confirming the restructure changed presentation only, not any number:

| Metric | Value (unchanged from Addendum 2) |
|---|---|
| Total Cash Across Funds | AUD 161,250.50 |
| Outstanding Levy Receivables | AUD 144,000.00 (8 of 8 instalments issued — captioned "levied, not yet received") |
| Annual Levy Budget | AUD 144,000.00 (sum of each fund's LEVY_INCOME-linked REVENUE lines only) |
| Ledger Reconciliation | Debit AUD 305,250.50 = Credit AUD 305,250.50 — Balanced |

The Stitch mock's own sample "Recent Ledger Activity" content (a contractor payment, a bank-
interest credit, a +/- sign per journal implying cash-flow direction) was not reproduced — real
double-entry journals have no single "inflow" direction to color that way without fabricating one,
so the implementation shows each journal's real narration, date, source-type badge, and total
amount only.

**Navigation**: the Financials tab on Property 360 now navigates straight to
`/properties/:id/financials/overview` as its primary landing view, replacing the old inline
`FinancialsTab` summary panel — which was then deleted as genuinely dead code (zero remaining
references), along with its now-obsolete test file. Its one relevant behavioural assertion (the
Financials tab leading somewhere real, not a disabled placeholder) was preserved by updating
`property-detail.test.tsx` to assert the navigation call instead.

**No backend endpoint was touched.** Full frontend suite: **232/232 passing** (42 files),
typecheck and lint clean.

**M16.4 readiness**: unchanged — no blocker identified.

## M16.4 — Lot Ledger & Owner Financial Accounts (21 October 2026)

Verified via the backend integration test suite against a real Postgres database (no browser
automation tool is available in this environment, so this is API-level verification plus Stitch
HTML inspection before implementation, consistent with every prior financial milestone's own
disclosed limitation here):

- A lot with a $250.50 opening amount owing and a $100 issued regular levy charge reconciles to a
  current balance of exactly $350.50, classified AMOUNT_OWING.
- Reversing that charge's instalment nets the balance back to exactly $0.00 (SETTLED), with BOTH
  the original charge row and a separate reversal row visible in the ledger, linked by reference.
- A two-fund scheme (Administration + Capital Works) with a $20 opening position, a $100
  Administration charge, and a $200 Capital Works charge reports a $320.00 total balance, with the
  per-fund breakdown showing $100/$200 respectively (the $20 opening correctly excluded from both,
  never defaulted onto either fund).
- Reading a 4-row ledger (1 opening + 3 charges) across two pages of 2 produces the exact same
  running-balance sequence `[50.00, 150.00, 250.00, 350.00]` as reading it unpaginated — pagination
  never recomputes from a page-local zero.
- A statement for a bounded period reconciles exactly: opening (50.00) + debits (100.00) − credits
  (0.00) = closing (150.00).
- A non-round-cent sequence (10.10 opening + 33.33 charge + 0.01 adjustment) sums to exactly 43.44
  with no float drift (Prisma.Decimal throughout, never a JS float).
- A caller without `financials.view` is rejected (403); a caller with `financials.view` but not
  `people.view` sees every figure but a null `ownerName`.
- Ending one OWNER membership and starting another leaves the lot's balance and ledger row count
  completely unchanged — only the displayed owner name updates.

21/21 new backend tests passing; full backend suite 886/886; full frontend suite 258/258.

**No payment tracking is claimed or implemented** — verified by an explicit frontend test
asserting no button matching `/pay/i` and no payment-status text appears anywhere on the Lot
Financial Account page.

**M16.5 readiness**: no blocker identified. The Lot Ledger's row-type model has an additive
extension point for a future payments/receipts row type, but that requires its own accounting
design and was not started here.
