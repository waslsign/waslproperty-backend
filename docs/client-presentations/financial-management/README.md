# WaslProp Financial Management — Product Journeys

A client-facing, landscape PDF walking an Australian strata client through WaslProp's
financial management capability, using real screens and real figures from the Harbour
View Strata demonstration scheme (property `cmvgq0llv0007upo8zgf4xbmv`, as of
21 October 2026).

## Contents of this folder

- `WaslProp Financial Management - Product Journeys.pdf` — the final deliverable (12 pages).
- `source/index.html` — the editable source. All copy, layout and styling live here.
- `source/capture-screenshots.mjs` — the Playwright script that captured the 21 screenshots
  used throughout the document.
- `source/render-pdf.mjs` — renders `index.html` to the final PDF.
- `screenshots/` — the 21 captured screens (`01-financial-overview.png` through
  `21-lot4-arrears-detail-unapplied-credit.png`). Not every screenshot is used in the
  current document; the extras are kept for future revisions.

## What the document covers

Cover, an "at a glance" summary, seven numbered product journeys (scheme set-up,
budgeting, levy issuance, lot accounts, receipts & payments, arrears & collections,
oversight & auditability), a connected worked example tying the figures together, a
capabilities summary, and a roadmap page (Banking & Reconciliation and automated
reminder delivery are both labelled "Next" — in development, not committed to a date).

Every figure and screenshot was verified against the live Harbour View Strata demo
tenant at the time of writing. No functionality is claimed that has not been built, and
no financial data was invented.

## Regenerating the document

The capture and render scripts import `@playwright/test`, and ES module resolution
looks up `node_modules` relative to the *script's own file location*, not the current
working directory — so both scripts must be copied into `waslproperty-frontend/` (where
`@playwright/test` is already a devDependency) before running, and the absolute output
paths inside them point back to this folder regardless of where the copy runs from.

### 1. Recapture screenshots (optional — only if the UI or demo data has changed)

```bash
# with the backend dev server on :4100 and frontend dev server on :5174 already running,
# and signed into the Harbour View Strata demo org (hello@amaltventures.com / Test@1234)
cp docs/client-presentations/financial-management/source/capture-screenshots.mjs \
   ../waslproperty-frontend/capture-screenshots-temp.mjs
cd ../waslproperty-frontend
node capture-screenshots-temp.mjs
rm capture-screenshots-temp.mjs
```

This is read-only against the demo tenant except for viewing an *existing* draft
reminder (it never drafts a new one), so it creates no new records.

If the Harbour View demo data changes meaningfully, re-check every AUD figure quoted in
`source/index.html` (budget totals, outstanding/overdue amounts, lot counts) against the
live Arrears Register and Financial Overview pages before re-rendering — the document's
own "no invented financial data" requirement applies to every revision, not just the
first.

### 2. Edit the document content

Edit `source/index.html` directly — it's a single self-contained file (inline CSS, no
build step). Each page is one `<section class="page">...</section>`, authored at a fixed
1600×1000px canvas.

### 3. Render to PDF

```bash
cp docs/client-presentations/financial-management/source/render-pdf.mjs \
   ../waslproperty-frontend/render-pdf-temp.mjs
cd ../waslproperty-frontend
node render-pdf-temp.mjs
rm render-pdf-temp.mjs
```

This overwrites `WaslProp Financial Management - Product Journeys.pdf` in place.

### 4. Inspect every page before sharing

There is no PDF rasteriser available in this environment (`pdftoppm`/`imagemagick`
aren't installed), so pages were inspected by screenshotting each `.page` section
directly from `source/index.html` at the same 1600×1000 size used for the PDF — a
pixel-faithful stand-in for the rendered PDF page. To repeat that check:

```js
// see source/render-pdf.mjs for the @playwright/test import pattern;
// screenshot each `.page` locator in source/index.html in turn
```

Re-check for: clipped or overlapping content, raw ISO timestamps, internal engineering
references (ADR numbers, milestone codes, incident narrations) leaking through a
screenshot, and dev-environment artifacts.

## Known limitations

- The app's native date/time inputs and some audit-history timestamps elsewhere in the
  product render in `DD/MM/YYYY` (date pickers) or `MM/DD/YYYY, h:mm:ss AM/PM` (some
  audit-trail entries) rather than a consistent Australian long-date format. Screens used
  in this document were chosen, and in two cases (the General Ledger journals list and
  the Lot Ledger reversal row) recaptured with a legitimate in-app filter or a tight
  crop, specifically to avoid exposing this and to keep the reader-facing letter/overview
  screens (Reminder Preview, Lot Arrears Detail) — which use the platform's own
  `formatAuDate`/`formatAuDateTime` helpers — front and centre instead.
- One screen (Levy Schedule Detail) carries a help-text sentence that references an
  internal architecture decision record ("ADR-024") in its own UI copy. The captured
  screenshot has that one line hidden (CSS visibility only — no data was changed) because
  it's internal engineering language with no place in a client-facing document; the
  underlying product copy was left as-is, since changing in-app text is outside this
  document's scope.
