import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import { authHeader, createPlainUser, registerTestUser, residentAccessToken } from '../helpers/auth.js';

/**
 * FIN-021 (limited scope) — Financial Statements & Reporting. See
 * docs/architecture/financial-statements-reporting-spec.md and ADR-030
 * for the specification these tests verify against; test names reference
 * the spec's numbered acceptance criteria (§9) where applicable.
 *
 * Fixture-building helpers below intentionally mirror
 * financial-lot-ledger.test.ts's own local helpers rather than importing
 * them — same convention as every other financial test file in this
 * repo (each test file owns its own fixture helpers).
 */

const app = createApp();

const validProperty = {
  name: 'Darling Harbour Towers',
  code: 'DARLING-01',
  addressLine1: '88 Harbour Street',
  city: 'Sydney',
  state: 'NSW',
  country: 'Australia',
  propertyType: 'RESIDENTIAL',
};

async function registerAuOrg() {
  const session = await registerTestUser(app, {});
  const patchRes = await request(app)
    .patch('/api/v1/organisations/me')
    .set(authHeader(session.accessToken))
    .send({ countryCode: 'AU' });
  expect(patchRes.status).toBe(200);
  return session;
}

async function createProperty(accessToken: string) {
  const res = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(accessToken))
    .send({ ...validProperty, code: `DARLING-${Date.now()}-${Math.random().toString(36).slice(2)}` });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function enableStrata(accessToken: string, propertyId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/strata/enable`)
    .set(authHeader(accessToken))
    .send({ strataPlanNumber: 'SP90001' });
}

async function setLots(accessToken: string, propertyId: string, lots: unknown[]) {
  const res = await request(app)
    .put(`/api/v1/properties/${propertyId}/strata/lots`)
    .set(authHeader(accessToken))
    .send({ lots });
  expect(res.status).toBe(200);
  return res.body;
}

async function completeStrataSetup(accessToken: string, propertyId: string) {
  const res = await request(app).post(`/api/v1/properties/${propertyId}/strata/complete`).set(authHeader(accessToken));
  expect(res.status).toBe(200);
}

async function startFinancialSetup(accessToken: string, propertyId: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials`)
    .set(authHeader(accessToken))
    .send({ financialYearStartDate: '2026-07-01', financialYearEndDate: '2027-06-30', cutoverDate: '2026-07-01' });
  expect(res.status).toBe(200);
}

async function addFund(accessToken: string, propertyId: string, fundType: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/funds`)
    .set(authHeader(accessToken))
    .send({ fundType });
  expect(res.status).toBe(200);
  return res.body;
}

async function activateFinancialSetup(accessToken: string, propertyId: string) {
  return request(app).post(`/api/v1/properties/${propertyId}/financials/activate`).set(authHeader(accessToken));
}

async function createAccount(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/accounts`)
    .set(authHeader(accessToken))
    .send(body);
  expect(res.status).toBe(201);
  return res.body as { id: string; code: string };
}

async function createPeriod(accessToken: string, propertyId: string, startDate: string, endDate: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/periods`)
    .set(authHeader(accessToken))
    .send({ startDate, endDate });
  expect(res.status).toBe(201);
  return res.body as { id: string; status: string };
}

async function closePeriod(accessToken: string, propertyId: string, periodId: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/periods/${periodId}/close`)
    .set(authHeader(accessToken))
    .send({});
  expect(res.status).toBe(200);
  return res.body;
}

async function upsertPostingProfile(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .put(`/api/v1/properties/${propertyId}/financials/posting-profile`)
    .set(authHeader(accessToken))
    .send(body);
  expect(res.status).toBe(201);
  return res.body;
}

async function createBudget(accessToken: string, propertyId: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/budgets`)
    .set(authHeader(accessToken))
    .send({ financialYearStartDate: '2026-07-01', financialYearEndDate: '2027-06-30', ...body });
  expect(res.status).toBe(201);
  return res.body;
}

async function addBudgetLine(accessToken: string, propertyId: string, budgetId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/lines`)
    .set(authHeader(accessToken))
    .send(body);
  expect(res.status).toBe(201);
  return res.body;
}

async function approveBudget(accessToken: string, propertyId: string, budgetId: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/approve`)
    .set(authHeader(accessToken))
    .send({});
  expect(res.status).toBe(200);
  return res.body;
}

async function activateBudget(accessToken: string, propertyId: string, budgetId: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/activate`)
    .set(authHeader(accessToken))
    .send({});
  expect(res.status).toBe(200);
  return res.body;
}

async function createRegularSchedule(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/levy-schedules/regular`)
    .set(authHeader(accessToken))
    .send(body);
}

async function approveSchedule(accessToken: string, propertyId: string, scheduleId: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/levy-schedules/${scheduleId}/approve`)
    .set(authHeader(accessToken))
    .send({});
  expect(res.status).toBe(200);
  return res.body;
}

async function issueInstallment(accessToken: string, propertyId: string, scheduleId: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/levy-schedules/${scheduleId}/issue`)
    .set(authHeader(accessToken))
    .send({});
  expect(res.status).toBe(201);
  return res.body;
}

async function reverseInstallment(
  accessToken: string,
  propertyId: string,
  scheduleId: string,
  levyInstallmentId: string,
) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/levy-schedules/${scheduleId}/reverse`)
    .set(authHeader(accessToken))
    .send({ levyInstallmentId, reason: 'test reversal' });
  expect(res.status).toBe(201);
  return res.body;
}

async function createSchemeReadyForLevies(accessToken: string) {
  const property = await createProperty(accessToken);
  await enableStrata(accessToken, property.id);
  const summary = await setLots(accessToken, property.id, [{ kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 100 }]);
  await completeStrataSetup(accessToken, property.id);
  await startFinancialSetup(accessToken, property.id);
  await addFund(accessToken, property.id, 'ADMINISTRATION');
  await addFund(accessToken, property.id, 'CAPITAL_WORKS');
  const lots = summary.lots as Array<{ spaceId: string }>;
  const spaceId = lots[0]!.spaceId;

  const activation = await activateFinancialSetup(accessToken, property.id);
  expect(activation.status).toBe(200);
  const funds = activation.body.funds as Array<{ id: string; fundType: string }>;
  const administrationFundId = funds.find((f) => f.fundType === 'ADMINISTRATION')!.id;

  const receivable = await createAccount(accessToken, property.id, { code: '310000', name: 'Lot Levy Receivable', classification: 'ASSET' });
  const income = await createAccount(accessToken, property.id, { code: '100000', name: 'Levy Contributions', classification: 'INCOME' });

  await upsertPostingProfile(accessToken, property.id, { role: 'LOT_LEVY_RECEIVABLE', financialFundId: administrationFundId, accountId: receivable.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'LEVY_INCOME', financialFundId: administrationFundId, accountId: income.id });

  const period = await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31');

  return { property, spaceId, administrationFundId, income, receivable, period };
}

async function issueRegularLevy(
  accessToken: string,
  propertyId: string,
  fundId: string,
  incomeAccountId: string,
  amount: number,
  dueDate = '2026-10-15',
) {
  const budget = await createBudget(accessToken, propertyId);
  await addBudgetLine(accessToken, propertyId, budget.id, {
    financialFundId: fundId,
    lineType: 'REVENUE',
    category: 'Levy Contributions',
    plannedAmount: amount,
    accountId: incomeAccountId,
  });
  await approveBudget(accessToken, propertyId, budget.id);
  await activateBudget(accessToken, propertyId, budget.id);

  const created = await createRegularSchedule(accessToken, propertyId, {
    financialFundId: fundId,
    financialBudgetId: budget.id,
    name: 'Q1 Admin Levy',
    installments: [{ dueDate, amount }],
  });
  expect(created.status).toBe(201);
  await approveSchedule(accessToken, propertyId, created.body.id);
  const issued = await issueInstallment(accessToken, propertyId, created.body.id);
  return { scheduleId: created.body.id as string, installmentId: issued.installments?.[0]?.id ?? issued.id };
}

function getIncomeExpense(accessToken: string, propertyId: string, start: string, end: string, fundId?: string) {
  const q = fundId ? `&financialFundId=${fundId}` : '';
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/reports/income-expense?startDate=${start}&endDate=${end}${q}`)
    .set(authHeader(accessToken));
}

function getIncomeExpensePdf(accessToken: string, propertyId: string, start: string, end: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/reports/income-expense/pdf?startDate=${start}&endDate=${end}`)
    .set(authHeader(accessToken));
}

function getBalanceSheet(accessToken: string, propertyId: string, asOfDate: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/reports/balance-sheet?asOfDate=${asOfDate}`)
    .set(authHeader(accessToken));
}

function getBalanceSheetPdf(accessToken: string, propertyId: string, asOfDate: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/reports/balance-sheet/pdf?asOfDate=${asOfDate}`)
    .set(authHeader(accessToken));
}

function getSummary(accessToken: string, propertyId: string, start: string, end: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/reports/summary?startDate=${start}&endDate=${end}`)
    .set(authHeader(accessToken));
}

function getSummaryPdf(accessToken: string, propertyId: string, start: string, end: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/reports/summary/pdf?startDate=${start}&endDate=${end}`)
    .set(authHeader(accessToken));
}

async function createPropertyRoleToken(ownerAccessToken: string, organisationId: string, propertyId: string, role: string) {
  const user = await createPlainUser();
  await request(app)
    .post(`/api/v1/properties/${propertyId}/memberships`)
    .set(authHeader(ownerAccessToken))
    .send({ email: user.email, firstName: 'P', lastName: 'M', role });
  const contact = await testPrisma.propertyContact.findFirstOrThrow({ where: { organisationId, email: user.email } });
  return residentAccessToken(user.userId, organisationId, contact.id);
}

/** pdf-lib compresses content/object streams (FlateDecode) by default, so
 * drawn text is never literally present in the raw bytes. Decompresses
 * every `stream`..`endstream` block found (ignoring ones that aren't
 * actually Flate-compressed) and concatenates the result — using only
 * Node's built-in zlib, no new dependency — so AC12's "contains literal
 * text" requirement can be checked against what a PDF reader would
 * actually render. */
function decodedPdfText(bytes: Buffer): string {
  const STREAM_START = Buffer.from('stream');
  const STREAM_END = Buffer.from('endstream');
  let offset = 0;
  const chunks: string[] = [];
  for (;;) {
    const start = bytes.indexOf(STREAM_START, offset);
    if (start === -1) break;
    // Skip the EOL right after the "stream" keyword (either \r\n or \n).
    let dataStart = start + STREAM_START.length;
    if (bytes[dataStart] === 0x0d) dataStart += 1;
    if (bytes[dataStart] === 0x0a) dataStart += 1;
    const end = bytes.indexOf(STREAM_END, dataStart);
    if (end === -1) break;
    const raw = bytes.subarray(dataStart, end);
    try {
      chunks.push(inflateSync(raw).toString('latin1'));
    } catch {
      chunks.push(raw.toString('latin1'));
    }
    offset = end + STREAM_END.length;
  }
  const streamText = chunks.join('\n');

  // pdf-lib's Tj/TJ text-showing operators use PDF hex-string literals
  // (`<4C6F74...>`), not parenthesized literal strings — decode every
  // hex-string token found so the actual shown characters are
  // substring-searchable, same as a real PDF reader would render them.
  const hexDecoded = streamText.replace(/<([0-9A-Fa-f]{4,})>/g, (_match, hex: string) => {
    let out = '';
    for (let i = 0; i + 1 < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
  });
  return `${streamText}\n${hexDecoded}`;
}

function getOwnerStatementPdf(accessToken: string, propertyId: string, spaceId: string, start: string, end: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/lots/${spaceId}/statement/pdf?periodStartDate=${start}&periodEndDate=${end}`)
    .set(authHeader(accessToken));
}

describe('FIN-021 Financial Statements & Reporting (limited scope)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('Income & Expense Statement', () => {
    it('AC1: computes totalIncome/totalExpense/netSurplusOrDeficit matching a hand-computed expectation', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 1000);

      const res = await getIncomeExpense(accessToken, scheme.property.id, '2026-07-01', '2026-12-31');
      expect(res.status).toBe(200);
      const fund = res.body.funds.find((f: { financialFundId: string }) => f.financialFundId === scheme.administrationFundId);
      expect(fund.totalIncome).toBe('1000.00');
      expect(fund.totalExpense).toBe('0.00');
      expect(fund.netSurplusOrDeficit).toBe('1000.00');
      expect(res.body.accountingBasis).toBe('ACCRUAL');
    });

    it('AC8: reports an honest zero/empty state when nothing has been posted', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const res = await getIncomeExpense(accessToken, scheme.property.id, '2026-07-01', '2026-12-31');
      expect(res.status).toBe(200);
      for (const fund of res.body.funds) {
        expect(fund.totalIncome).toBe('0.00');
        expect(fund.totalExpense).toBe('0.00');
        expect(fund.income).toEqual([]);
        expect(fund.expense).toEqual([]);
      }
    });

    it('AC11: a reversed journal nets back to zero within the same window', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const { scheduleId, installmentId } = await issueRegularLevy(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        1000,
      );
      await reverseInstallment(accessToken, scheme.property.id, scheduleId, installmentId);

      const res = await getIncomeExpense(accessToken, scheme.property.id, '2026-07-01', '2026-12-31');
      expect(res.status).toBe(200);
      const fund = res.body.funds.find((f: { financialFundId: string }) => f.financialFundId === scheme.administrationFundId);
      expect(fund.totalIncome).toBe('0.00');
    });

    it('AC9: flags a still-OPEN covering period without claiming it is closed', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const res = await getIncomeExpense(accessToken, scheme.property.id, '2026-07-01', '2026-12-31');
      expect(res.body.periodDisclosure.periodOpen).toBe(true);
    });

    it('AC9: does not flag a period that has been closed', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await closePeriod(accessToken, scheme.property.id, scheme.period.id);
      const res = await getIncomeExpense(accessToken, scheme.property.id, '2026-07-01', '2026-12-31');
      expect(res.body.periodDisclosure.periodOpen).toBe(false);
    });

    it('AC10: flags a window with no covering accounting period at all', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      // 2027-07-01 is outside the single period created (2026-07-01..2026-12-31).
      const res = await getIncomeExpense(accessToken, scheme.property.id, '2027-07-01', '2027-07-31');
      expect(res.status).toBe(200);
      expect(res.body.periodDisclosure.noCoveringPeriod).toBe(true);
    });

    it('AC13: never includes a Committed, GST, or close/lock term', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 1000);
      const res = await getIncomeExpense(accessToken, scheme.property.id, '2026-07-01', '2026-12-31');
      const text = JSON.stringify(res.body).toLowerCase();
      expect(text).not.toContain('committed');
      expect(text).not.toContain('gst');
      expect(text).not.toContain('finalis');
      expect(text).not.toContain('finaliz');
    });

    it('AC5: returns 404 for a property outside the caller’s organisation', async () => {
      const { accessToken: accessTokenA } = await registerAuOrg();
      const schemeA = await createSchemeReadyForLevies(accessTokenA);
      const { accessToken: accessTokenB } = await registerAuOrg();
      const res = await getIncomeExpense(accessTokenB, schemeA.property.id, '2026-07-01', '2026-12-31');
      expect(res.status).toBe(404);
    });

    it('rejects startDate after endDate before running any query', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const res = await getIncomeExpense(accessToken, scheme.property.id, '2026-12-31', '2026-07-01');
      // This repo's errorHandler maps every Zod validation failure to 422
      // (see src/middlewares/errorHandler.ts), not 400 — matching every
      // other validation-rejection test in this codebase.
      expect(res.status).toBe(422);
    });
  });

  describe('Balance Sheet', () => {
    it('AC2/AC3: totalAssets equals totalLiabilitiesAndEquity (balanceCheckDifference is 0.00)', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 1000);

      const res = await getBalanceSheet(accessToken, scheme.property.id, '2026-12-31');
      expect(res.status).toBe(200);
      expect(res.body.balanceCheckDifference).toBe('0.00');
      expect(res.body.totalAssets).toBe(res.body.totalLiabilitiesAndEquity);
      expect(res.body.totalAssets).toBe('1000.00');
      // Unclosed current-period earnings carry the levy income since no
      // year-end close exists (spec §2.2 / ADR-030) — this is what makes
      // the balance check land on exactly 0.00 rather than drifting by
      // the un-swept income.
      expect(res.body.currentEarningsUnclosed).toBe('1000.00');
    });

    it('AC8: balances at zero with no postings', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const res = await getBalanceSheet(accessToken, scheme.property.id, '2026-12-31');
      expect(res.status).toBe(200);
      expect(res.body.totalAssets).toBe('0.00');
      expect(res.body.totalLiabilitiesAndEquity).toBe('0.00');
      expect(res.body.balanceCheckDifference).toBe('0.00');
    });

    it('reports as-at a selected date, cumulative since cutover (not period-bound)', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 1000, '2026-07-15');
      const before = await getBalanceSheet(accessToken, scheme.property.id, '2026-07-01');
      const after = await getBalanceSheet(accessToken, scheme.property.id, '2026-12-31');
      expect(before.body.totalAssets).toBe('0.00');
      expect(after.body.totalAssets).toBe('1000.00');
    });
  });

  describe('Property Financial Summary', () => {
    it('composes the Income & Expense Statement and Balance Sheet for the same window', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 1000);

      const res = await getSummary(accessToken, scheme.property.id, '2026-07-01', '2026-12-31');
      expect(res.status).toBe(200);
      expect(res.body.incomeExpenseStatement.endDate).toBe('2026-12-31');
      expect(res.body.balanceSheet.asOfDate).toBe('2026-12-31');
      expect(res.body.balanceSheet.totalAssets).toBe('1000.00');
    });
  });

  describe('Access control & organisation isolation', () => {
    it('AC6: returns 403 for a caller without financials.view (TENANT role)', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(ownerToken);
      // DEFAULT_ROLE_CAPABILITIES grants financials.view to
      // PROPERTY_MANAGER/COMMITTEE_MEMBER/OWNER(lot), never TENANT.
      const tenantToken = await createPropertyRoleToken(ownerToken, organisationId, scheme.property.id, 'TENANT');
      const res = await getIncomeExpense(tenantToken, scheme.property.id, '2026-07-01', '2026-12-31');
      expect(res.status).toBe(403);
    });

    it('AC5 (balance sheet): returns 404 for a property outside the caller’s organisation', async () => {
      const { accessToken: accessTokenA } = await registerAuOrg();
      const schemeA = await createSchemeReadyForLevies(accessTokenA);
      const { accessToken: accessTokenB } = await registerAuOrg();
      const res = await getBalanceSheet(accessTokenB, schemeA.property.id, '2026-12-31');
      expect(res.status).toBe(404);
    });

    it('returns 409 when financial management has not been set up for the property', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      const res = await getIncomeExpense(accessToken, property.id, '2026-07-01', '2026-12-31');
      expect(res.status).toBe(409);
    });
  });

  describe('Lot Owner Statement PDF', () => {
    it('AC4/AC12: renders a structurally valid PDF whose raw content includes the property name and report title', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 1000);

      const res = await getOwnerStatementPdf(accessToken, scheme.property.id, scheme.spaceId, '2026-07-01', '2026-12-31');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      const bytes = res.body as Buffer;
      expect(bytes.length).toBeGreaterThan(0);

      // Structurally valid PDF.
      const loaded = await PDFDocument.load(bytes);
      expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);

      // Traceable, literal content (spec §7/§9 AC12).
      const text = decodedPdfText(bytes);
      expect(text).toContain('Lot Owner Statement');
      expect(text).toContain('Darling Harbour Towers');
    });

    it('AC7: returns a clear error for a non-strata-lot space, not a 500', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const commonAreaRes = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/spaces`)
        .set(authHeader(accessToken))
        .send({ name: 'Lobby', code: 'LOBBY', spaceType: 'COMMON_AREA', strataClassification: 'COMMON_PROPERTY' });
      expect(commonAreaRes.status).toBe(201);

      const res = await getOwnerStatementPdf(
        accessToken,
        scheme.property.id,
        commonAreaRes.body.id,
        '2026-07-01',
        '2026-12-31',
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('Fund segregation', () => {
    it('keeps a fund filter scoped to that fund only, never blending totals silently', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 1000);

      const res = await getIncomeExpense(
        accessToken,
        scheme.property.id,
        '2026-07-01',
        '2026-12-31',
        scheme.administrationFundId,
      );
      expect(res.status).toBe(200);
      expect(res.body.funds).toHaveLength(1);
      expect(res.body.combined).toBeNull();
    });
  });

  describe('PDF downloads for the three property-level reports', () => {
    it('all three PDF endpoints return valid, non-empty PDFs', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 1000);

      for (const res of await Promise.all([
        getIncomeExpensePdf(accessToken, scheme.property.id, '2026-07-01', '2026-12-31'),
        getBalanceSheetPdf(accessToken, scheme.property.id, '2026-12-31'),
        getSummaryPdf(accessToken, scheme.property.id, '2026-07-01', '2026-12-31'),
      ])) {
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        const loaded = await PDFDocument.load(res.body as Buffer);
        expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
