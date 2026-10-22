// One-off screenshot capture script for the client-facing Financial
// Management journey document. Run from waslproperty-frontend with the
// dev server already running on :5174 and the backend on :4100:
//
//   node ../waslproperty-backend/docs/client-presentations/financial-management/source/capture-screenshots.mjs
//
// Logs in as the Harbour View Strata demo org owner, navigates through
// every screen the document needs, and saves a PNG per screen/state into
// ../screenshots. Read-only except for one harmless, already-precedented
// action (drafting is skipped in favour of previewing an EXISTING draft
// reminder, so this script creates no new records at all).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = 'http://localhost:5174';
const PROPERTY_ID = 'cmvgq0llv0007upo8zgf4xbmv';
const LOT1_SPACE_ID = 'cmvgq105s000fupo85x2hx5c3'; // Lot 1 — has a fully-paid charge, an open collection case, and a draft reminder already on file
const LOT4_SPACE_ID = 'cmvgq1063000rupo89kqqt9y5'; // Lot 4 — has an unapplied advance receipt, good for the Allocate Payment screen
const BUDGET_ID = 'cmvgq6hq000elupo8xfpuyqnq'; // BUD-3H6WLC, ACTIVE
const LEVY_SCHEDULE_ID = 'cmvgq49h9009wupo8pquv863n'; // LEVY-WHZ2D5, ISSUED (Administrative Fund)
const RECEIPT_FULL_ID = 'cmvht2lxl000mup51y13lqkrf'; // RCT-NLJSLU, Lot 1, fully applied
const RECEIPT_UNAPPLIED_ID = 'cmvht3988002rup5114vp12bm'; // RCT-YPPGQS, Lot 4, fully unapplied

const EMAIL = 'hello@amaltventures.com';
const PASSWORD = 'Test@1234';

async function waitSettled(page) {
  // Every financial page uses the same `animate-pulse` skeleton while its
  // query is in flight — wait for it to be gone rather than racing a
  // fixed timeout.
  await page.waitForSelector('.animate-pulse', { state: 'detached', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function shoot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('captured', name);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await context.newPage();

  console.log('logging in...');
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
  console.log('logged in.');

  const goto = async (p) => {
    await page.goto(`${BASE_URL}${p}`);
    await waitSettled(page);
  };

  // 1. Financial Overview
  await goto(`/properties/${PROPERTY_ID}/financials/overview`);
  await shoot(page, '01-financial-overview');

  // 2. Financial setup/configuration (already active — shows the summary state)
  await goto(`/properties/${PROPERTY_ID}/financials/setup`);
  await waitSettled(page);
  await shoot(page, '02-financial-setup');

  // 3. Chart of accounts / posting profile (fund + account configuration)
  await goto(`/properties/${PROPERTY_ID}/financials/accounts`);
  await shoot(page, '03-accounts-posting-profile');

  // 4-5. General Ledger — Journals, then Trial Balance tab
  await goto(`/properties/${PROPERTY_ID}/financials/ledger`);
  await shoot(page, '04-general-ledger-journals');
  const trialBalanceTab = page.getByRole('tab', { name: /trial balance/i }).or(page.getByText('Trial Balance', { exact: true }));
  await trialBalanceTab.first().click();
  await waitSettled(page);
  await shoot(page, '05-general-ledger-trial-balance');

  // 6-7. Budgets
  await goto(`/properties/${PROPERTY_ID}/financials/budgets`);
  await shoot(page, '06-budgets-list');
  await goto(`/properties/${PROPERTY_ID}/financials/budgets/${BUDGET_ID}`);
  await shoot(page, '07-budget-detail');

  // 8-9. Levy schedules
  await goto(`/properties/${PROPERTY_ID}/financials/levy-schedules`);
  await shoot(page, '08-levy-schedules-list');
  await goto(`/properties/${PROPERTY_ID}/financials/levy-schedules/${LEVY_SCHEDULE_ID}`);
  await shoot(page, '09-levy-schedule-detail');

  // 10. Lot Financial Account (Lot 1)
  await goto(`/properties/${PROPERTY_ID}/financials/lots/${LOT1_SPACE_ID}/financial-account`);
  await shoot(page, '10-lot-financial-account');

  // 11. Record Receipt modal, opened from the Lot Financial Account page
  const recordReceiptBtn = page.getByRole('button', { name: 'Record Receipt' });
  if (await recordReceiptBtn.count()) {
    await recordReceiptBtn.click();
    await page.waitForSelector('[role="dialog"]');
    await page.waitForTimeout(300);
    await shoot(page, '11-record-receipt-modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  } else {
    console.warn('Record Receipt button not found/visible — skipped 11-record-receipt-modal');
  }

  // 12. Lot Ledger (Lot 1)
  await goto(`/properties/${PROPERTY_ID}/financials/lots/${LOT1_SPACE_ID}/ledger`);
  await shoot(page, '12-lot-ledger');

  // 13. Lot Statement (Lot 1)
  await goto(`/properties/${PROPERTY_ID}/financials/lots/${LOT1_SPACE_ID}/statement`);
  await shoot(page, '13-lot-statement');

  // 14. Receipt Detail — fully applied
  await goto(`/properties/${PROPERTY_ID}/financials/receipts/${RECEIPT_FULL_ID}`);
  await shoot(page, '14-receipt-detail-full-payment');

  // 15. Receipt Detail — unapplied, plus the Allocate Payment modal
  await goto(`/properties/${PROPERTY_ID}/financials/receipts/${RECEIPT_UNAPPLIED_ID}`);
  await shoot(page, '15-receipt-detail-unapplied-credit');
  const allocateBtn = page.getByRole('button', { name: 'Allocate' });
  if (await allocateBtn.count()) {
    await allocateBtn.click();
    await page.waitForSelector('[role="dialog"]');
    await page.waitForTimeout(300);
    await shoot(page, '16-allocate-payment-modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  } else {
    console.warn('Allocate button not found/visible — skipped 16-allocate-payment-modal');
  }

  // 17. Arrears Dashboard
  await goto(`/properties/${PROPERTY_ID}/financials/arrears`);
  await shoot(page, '17-arrears-dashboard');

  // 18. Arrears Register
  await goto(`/properties/${PROPERTY_ID}/financials/arrears/register`);
  await shoot(page, '18-arrears-register');

  // 19. Lot Arrears Detail (Lot 1 — has an open collection case + a draft reminder already on file)
  await goto(`/properties/${PROPERTY_ID}/financials/arrears/lots/${LOT1_SPACE_ID}`);
  await shoot(page, '19-lot-arrears-detail');

  // 20. Reminder Preview — click Preview on the EXISTING draft reminder
  // (never drafts a new one, so this script creates no new records at all).
  const previewBtn = page.getByRole('button', { name: 'Preview' }).first();
  if (await previewBtn.count()) {
    await previewBtn.click();
    await page.waitForSelector('[role="dialog"]');
    await page.waitForTimeout(300);
    await shoot(page, '20-reminder-preview-modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  } else {
    console.warn('Preview button not found — skipped 20-reminder-preview-modal');
  }

  // 21. A second lot's arrears detail, for variety/contrast (Lot 4 — unapplied credit + overdue charges)
  await goto(`/properties/${PROPERTY_ID}/financials/arrears/lots/${LOT4_SPACE_ID}`);
  await shoot(page, '21-lot4-arrears-detail-unapplied-credit');

  await browser.close();
  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
