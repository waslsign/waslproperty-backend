// Renders index.html to the final client-facing PDF using Playwright.
// Run from waslproperty-frontend (to resolve the @playwright/test dependency):
//
//   node ../waslproperty-backend/docs/client-presentations/financial-management/source/render-pdf.mjs
//
import { chromium } from '@playwright/test';

// Absolute paths (not __dirname-relative): this script is copied into
// waslproperty-frontend/ to resolve @playwright/test (ESM resolves
// node_modules relative to the importing file's own location, not cwd),
// which would otherwise make a __dirname-derived path point at the
// wrong repo entirely.
const SOURCE_HTML =
  '/Users/hamza.tariq/wasl/waslproperty/waslproperty-backend/docs/client-presentations/financial-management/source/index.html';
const OUT_PDF =
  '/Users/hamza.tariq/wasl/waslproperty/waslproperty-backend/docs/client-presentations/financial-management/WaslProp Financial Management - Product Journeys.pdf';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${SOURCE_HTML}`);
  await page.waitForTimeout(300);

  // Each .page section is authored at a fixed 1600x1000px canvas — print
  // at that same pixel size (96dpi) so every element lands exactly where
  // it was laid out, with no browser-driven reflow or scaling.
  await page.pdf({
    path: OUT_PDF,
    width: 1600,
    height: 1000,
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });

  console.log('Rendered PDF to', OUT_PDF);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
