import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type {
  BalanceSheetView,
  IncomeExpenseStatementView,
  PropertyFinancialSummaryView,
  ReportAccountLine,
} from '../modules/financials/financial-reports.service.js';
import type { LotStatementView } from '../modules/financials/lot-ledger.service.js';

/**
 * PDF rendering for FIN-021's four reports (see
 * docs/architecture/financial-statements-reporting-spec.md §7). Reuses
 * the exact pdf-lib pattern already proven in quoteAcceptanceDocument.ts
 * — PDFDocument.create(), US Letter pages, StandardFonts only, a manual
 * y-cursor instead of a layout engine. Deliberately plain, same as that
 * document — no branding system, no new dependency.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 56;
const RIGHT = PAGE_WIDTH - 56;
const TOP = 740;
const BOTTOM_MARGIN = 60;

interface Cursor {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
}

async function newCursor(doc: PDFDocument): Promise<Cursor> {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, page, font, bold, y: TOP };
}

function ensureSpace(c: Cursor, neededHeight: number): Cursor {
  if (c.y - neededHeight < BOTTOM_MARGIN) {
    const page = c.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    return { ...c, page, y: TOP };
  }
  return c;
}

function drawTitle(c: Cursor, text: string): Cursor {
  c = ensureSpace(c, 32);
  c.page.drawText(text, { x: LEFT, y: c.y, size: 18, font: c.bold, color: rgb(0.15, 0.1, 0.2) });
  return { ...c, y: c.y - 28 };
}

function drawSubtitle(c: Cursor, text: string): Cursor {
  c = ensureSpace(c, 18);
  c.page.drawText(text, { x: LEFT, y: c.y, size: 10, font: c.font, color: rgb(0.35, 0.35, 0.35) });
  return { ...c, y: c.y - 16 };
}

function drawNotice(c: Cursor, text: string): Cursor {
  c = ensureSpace(c, 20);
  c.page.drawText(text, { x: LEFT, y: c.y, size: 9, font: c.bold, color: rgb(0.55, 0.35, 0.05) });
  return { ...c, y: c.y - 18 };
}

function drawSectionHeading(c: Cursor, text: string): Cursor {
  c = ensureSpace(c, 24);
  c.page.drawText(text, { x: LEFT, y: c.y, size: 12, font: c.bold, color: rgb(0.1, 0.1, 0.1) });
  return { ...c, y: c.y - 18 };
}

/** One account line: code/name on the left, right-aligned amount. */
function drawAccountLine(c: Cursor, line: ReportAccountLine): Cursor {
  c = ensureSpace(c, 15);
  c.page.drawText(`${line.accountCode}  ${line.accountName}`, {
    x: LEFT + 8,
    y: c.y,
    size: 9.5,
    font: c.font,
    color: rgb(0, 0, 0),
  });
  const amountText = line.amount;
  const width = c.font.widthOfTextAtSize(amountText, 9.5);
  c.page.drawText(amountText, { x: RIGHT - width, y: c.y, size: 9.5, font: c.font, color: rgb(0, 0, 0) });
  return { ...c, y: c.y - 14 };
}

function drawTotalLine(c: Cursor, label: string, amount: string): Cursor {
  c = ensureSpace(c, 18);
  c.page.drawText(label, { x: LEFT + 8, y: c.y, size: 10, font: c.bold, color: rgb(0, 0, 0) });
  const width = c.bold.widthOfTextAtSize(amount, 10);
  c.page.drawText(amount, { x: RIGHT - width, y: c.y, size: 10, font: c.bold, color: rgb(0, 0, 0) });
  return { ...c, y: c.y - 20 };
}

function drawHeader(
  c: Cursor,
  opts: {
    reportTitle: string;
    propertyName: string;
    strataPlanNumber: string | null;
    windowLabel: string;
    accountingBasis: string;
    currencyCode: string;
    generatedAt: string;
  },
): Cursor {
  c = drawTitle(c, opts.reportTitle);
  c = drawSubtitle(
    c,
    opts.propertyName + (opts.strataPlanNumber ? ` · Strata Plan ${opts.strataPlanNumber}` : ''),
  );
  c = drawSubtitle(c, `${opts.windowLabel} · ${opts.accountingBasis} basis · ${opts.currencyCode}`);
  c = drawSubtitle(c, `Generated ${new Date(opts.generatedAt).toLocaleString('en-AU')}`);
  c = { ...c, y: c.y - 6 };
  return c;
}

function periodNotices(c: Cursor, disclosure: { periodOpen: boolean; noCoveringPeriod: boolean }): Cursor {
  if (disclosure.periodOpen) {
    c = drawNotice(
      c,
      'PROVISIONAL: this report covers a period that is still open — figures reflect postings as of ' +
        'generation time and may change if further entries are posted. This is not a closed, final report.',
    );
  }
  if (disclosure.noCoveringPeriod) {
    c = drawNotice(
      c,
      'No accounting period is recorded for all of the dates in this report — figures are shown as ' +
        'posted, unconfirmed against a defined period.',
    );
  }
  if (disclosure.periodOpen || disclosure.noCoveringPeriod) {
    c = { ...c, y: c.y - 6 };
  }
  return c;
}

export async function generateIncomeExpenseStatementPdf(view: IncomeExpenseStatementView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let c = await newCursor(doc);
  c = drawHeader(c, {
    reportTitle: 'Income & Expense Statement',
    propertyName: view.propertyName,
    strataPlanNumber: view.strataPlanNumber,
    windowLabel: `${view.startDate} to ${view.endDate}`,
    accountingBasis: view.accountingBasis,
    currencyCode: view.currencyCode,
    generatedAt: view.generatedAt,
  });
  c = periodNotices(c, view.periodDisclosure);

  for (const fund of view.funds) {
    c = drawSectionHeading(c, fund.fundName);
    c = drawSubtitle(c, 'Income');
    for (const line of fund.income) c = drawAccountLine(c, line);
    c = drawTotalLine(c, 'Total income', fund.totalIncome);
    c = drawSubtitle(c, 'Expense');
    for (const line of fund.expense) c = drawAccountLine(c, line);
    c = drawTotalLine(c, 'Total expense', fund.totalExpense);
    c = drawTotalLine(c, 'Net surplus / (deficit)', fund.netSurplusOrDeficit);
    c = { ...c, y: c.y - 8 };
  }

  if (view.combined) {
    c = drawSectionHeading(c, 'All funds combined');
    c = drawTotalLine(c, 'Total income', view.combined.totalIncome);
    c = drawTotalLine(c, 'Total expense', view.combined.totalExpense);
    c = drawTotalLine(c, 'Net surplus / (deficit)', view.combined.netSurplusOrDeficit);
  }

  return doc.save();
}

export async function generateBalanceSheetPdf(view: BalanceSheetView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let c = await newCursor(doc);
  c = drawHeader(c, {
    reportTitle: 'Balance Sheet',
    propertyName: view.propertyName,
    strataPlanNumber: view.strataPlanNumber,
    windowLabel: `As at ${view.asOfDate}`,
    accountingBasis: view.accountingBasis,
    currencyCode: view.currencyCode,
    generatedAt: view.generatedAt,
  });
  c = periodNotices(c, view.periodDisclosure);

  c = drawSectionHeading(c, 'Assets');
  for (const line of view.assets) c = drawAccountLine(c, line);
  c = drawTotalLine(c, 'Total assets', view.totalAssets);

  c = drawSectionHeading(c, 'Liabilities');
  for (const line of view.liabilities) c = drawAccountLine(c, line);

  c = drawSectionHeading(c, 'Equity');
  for (const line of view.equity) c = drawAccountLine(c, line);
  c = drawAccountLine(c, {
    accountId: '',
    accountCode: '—',
    accountName: 'Current surplus/(deficit), unclosed',
    amount: view.currentEarningsUnclosed,
  });

  c = drawTotalLine(c, 'Total liabilities & equity', view.totalLiabilitiesAndEquity);
  c = drawTotalLine(c, 'Balance check (assets - liabilities & equity)', view.balanceCheckDifference);

  return doc.save();
}

export async function generatePropertyFinancialSummaryPdf(view: PropertyFinancialSummaryView): Promise<Uint8Array> {
  // Two independently-generated documents, merged into one file — simpler
  // and less error-prone than threading one shared cursor across two very
  // differently-shaped reports.
  const [incomeExpenseBytes, balanceSheetBytes] = await Promise.all([
    generateIncomeExpenseStatementPdf(view.incomeExpenseStatement),
    generateBalanceSheetPdf(view.balanceSheet),
  ]);
  const merged = await PDFDocument.create();
  for (const bytes of [incomeExpenseBytes, balanceSheetBytes]) {
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save();
}

export async function generateLotOwnerStatementPdf(view: LotStatementView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let c = await newCursor(doc);
  c = drawTitle(c, 'Lot Owner Statement');
  c = drawSubtitle(c, view.propertyName + (view.strataPlanNumber ? ` · Strata Plan ${view.strataPlanNumber}` : ''));
  c = drawSubtitle(c, view.lotLabel);
  if (view.ownerName) c = drawSubtitle(c, `Owner: ${view.ownerName}`);
  c = drawSubtitle(c, `Period ${view.periodStartDate} to ${view.periodEndDate} · ACCRUAL basis · ${view.currencyCode}`);
  c = drawSubtitle(c, `Generated ${new Date(view.generatedAt).toLocaleString('en-AU')}`);
  c = { ...c, y: c.y - 6 };

  c = drawTotalLine(c, 'Opening balance', view.openingBalance);

  if (view.movements.length === 0) {
    c = drawSubtitle(c, 'No movements were posted during this period.');
  } else {
    c = drawSectionHeading(c, 'Movements');
    for (const row of view.movements) {
      c = ensureSpace(c, 15);
      const label = `${row.date}  ${row.description}${row.fundName ? ` (${row.fundName})` : ''}`;
      c.page.drawText(label, { x: LEFT + 8, y: c.y, size: 9, font: c.font, color: rgb(0, 0, 0) });
      const balanceText = row.runningBalance;
      const width = c.font.widthOfTextAtSize(balanceText, 9);
      c.page.drawText(balanceText, { x: RIGHT - width, y: c.y, size: 9, font: c.font, color: rgb(0, 0, 0) });
      c = { ...c, y: c.y - 13 };
    }
  }

  c = drawTotalLine(c, 'Total debits', view.totalDebits);
  c = drawTotalLine(c, 'Total credits', view.totalCredits);
  c = drawTotalLine(c, 'Closing balance', view.closingBalance);

  return doc.save();
}
