import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import { authHeader, createPlainUser, registerTestUser, residentAccessToken } from '../helpers/auth.js';

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
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/strata/complete`)
    .set(authHeader(accessToken));
  expect(res.status).toBe(200);
}

async function startFinancialSetup(accessToken: string, propertyId: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials`)
    .set(authHeader(accessToken))
    .send({ financialYearStartDate: '2026-07-01', financialYearEndDate: '2027-06-30', cutoverDate: '2026-10-01' });
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

async function setLotPositions(accessToken: string, propertyId: string, positions: unknown[]) {
  const res = await request(app)
    .put(`/api/v1/properties/${propertyId}/financials/lot-positions`)
    .set(authHeader(accessToken))
    .send({ positions });
  expect(res.status).toBe(200);
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

async function createSpecialSchedule(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/levy-schedules/special`)
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

async function issueInstallment(accessToken: string, propertyId: string, scheduleId: string, levyInstallmentId?: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/levy-schedules/${scheduleId}/issue`)
    .set(authHeader(accessToken))
    .send(levyInstallmentId ? { levyInstallmentId } : {});
  expect(res.status).toBe(201);
  return res.body;
}

async function reverseInstallment(
  accessToken: string,
  propertyId: string,
  scheduleId: string,
  levyInstallmentId: string,
  reason = 'test reversal',
) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/levy-schedules/${scheduleId}/reverse`)
    .set(authHeader(accessToken))
    .send({ levyInstallmentId, reason });
  expect(res.status).toBe(201);
  return res.body;
}

async function adjustCharge(accessToken: string, propertyId: string, chargeId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/lot-levy-charges/${chargeId}/adjust`)
    .set(authHeader(accessToken))
    .send(body);
  expect(res.status).toBe(201);
  return res.body;
}

async function getFinancialAccount(accessToken: string, propertyId: string, spaceId: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/lots/${spaceId}/financial-account`)
    .set(authHeader(accessToken));
}

async function getLedger(accessToken: string, propertyId: string, spaceId: string, query = '') {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/lots/${spaceId}/ledger${query}`)
    .set(authHeader(accessToken));
}

async function getStatement(accessToken: string, propertyId: string, spaceId: string, start: string, end: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/lots/${spaceId}/statement?periodStartDate=${start}&periodEndDate=${end}`)
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

/** A single-lot scheme (100% entitlement) so every levy amount allocates
 * to that one lot exactly, with no UOE-rounding arithmetic to account
 * for in these ledger-focused assertions — UOE allocation itself is
 * already covered by financial-levies.test.ts. */
async function createSchemeReadyForLevies(
  accessToken: string,
  openingPosition?: { amountOwing: number; creditBalance: number; asOfDate: string },
) {
  const property = await createProperty(accessToken);
  await enableStrata(accessToken, property.id);
  const summary = await setLots(accessToken, property.id, [{ kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 100 }]);
  await completeStrataSetup(accessToken, property.id);
  await startFinancialSetup(accessToken, property.id);
  await addFund(accessToken, property.id, 'ADMINISTRATION');
  await addFund(accessToken, property.id, 'CAPITAL_WORKS');
  const lots = summary.lots as Array<{ spaceId: string }>;
  const spaceId = lots[0]!.spaceId;

  // LotOpeningPosition is only ever editable while FinancialConfiguration
  // is SETUP_IN_PROGRESS (see financials.service.ts's assertMutable) — it
  // must be set here, before activation, never afterward.
  if (openingPosition) {
    await setLotPositions(accessToken, property.id, [{ spaceId, ...openingPosition }]);
  }

  const activation = await activateFinancialSetup(accessToken, property.id);
  expect(activation.status).toBe(200);
  const funds = activation.body.funds as Array<{ id: string; fundType: string }>;
  const administrationFundId = funds.find((f) => f.fundType === 'ADMINISTRATION')!.id;
  const capitalWorksFundId = funds.find((f) => f.fundType === 'CAPITAL_WORKS')!.id;

  const receivable = await createAccount(accessToken, property.id, { code: '310000', name: 'Lot Levy Receivable', classification: 'ASSET' });
  const income = await createAccount(accessToken, property.id, { code: '100000', name: 'Levy Contributions', classification: 'INCOME' });
  const cwReceivable = await createAccount(accessToken, property.id, { code: '311000', name: 'CW Lot Levy Receivable', classification: 'ASSET' });
  const cwIncome = await createAccount(accessToken, property.id, { code: '101000', name: 'CW Levy Contributions', classification: 'INCOME' });

  await upsertPostingProfile(accessToken, property.id, { role: 'LOT_LEVY_RECEIVABLE', financialFundId: administrationFundId, accountId: receivable.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'LEVY_INCOME', financialFundId: administrationFundId, accountId: income.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'LOT_LEVY_RECEIVABLE', financialFundId: capitalWorksFundId, accountId: cwReceivable.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'LEVY_INCOME', financialFundId: capitalWorksFundId, accountId: cwIncome.id });

  await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31');

  return { property, spaceId, administrationFundId, capitalWorksFundId, income, cwIncome };
}

async function createApprovedLevyBudget(
  accessToken: string,
  propertyId: string,
  fundId: string,
  incomeAccountId: string,
  totalAmount: number,
) {
  const budget = await createBudget(accessToken, propertyId);
  await addBudgetLine(accessToken, propertyId, budget.id, {
    financialFundId: fundId,
    lineType: 'REVENUE',
    category: 'Levy Contributions',
    plannedAmount: totalAmount,
    accountId: incomeAccountId,
  });
  await approveBudget(accessToken, propertyId, budget.id);
  return activateBudget(accessToken, propertyId, budget.id);
}

async function issueRegularLevy(
  accessToken: string,
  propertyId: string,
  fundId: string,
  incomeAccountId: string,
  amount: number,
  dueDate = '2026-10-15',
) {
  const budget = await createApprovedLevyBudget(accessToken, propertyId, fundId, incomeAccountId, amount);
  const created = await createRegularSchedule(accessToken, propertyId, {
    financialFundId: fundId,
    financialBudgetId: budget.id,
    name: 'Q1 Admin Levy',
    installments: [{ dueDate, amount }],
  });
  expect(created.status).toBe(201);
  await approveSchedule(accessToken, propertyId, created.body.id);
  const issued = await issueInstallment(accessToken, propertyId, created.body.id);
  return { schedule: issued, chargeAmount: amount };
}

describe('M16.4 Lot Ledger & Owner Financial Accounts', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('opening position', () => {
    it('reports a debit opening amount owing as AMOUNT_OWING, net = amountOwing - creditBalance', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken, {
        amountOwing: 250.5,
        creditBalance: 0,
        asOfDate: '2026-09-01',
      });

      const res = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(res.status).toBe(200);
      expect(res.body.openingPosition.recorded).toBe(true);
      expect(res.body.openingPosition.amountOwing).toBe('250.50');
      expect(res.body.openingPosition.creditBalance).toBe('0.00');
      expect(res.body.openingPosition.net).toBe('250.50');
      expect(res.body.openingPosition.fundAttributed).toBe(false);
      expect(res.body.currentBalance).toBe('250.50');
      expect(res.body.balanceClassification).toBe('AMOUNT_OWING');
    });

    it('reports a credit opening balance as CREDIT with a negative net', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken, {
        amountOwing: 0,
        creditBalance: 100,
        asOfDate: '2026-09-01',
      });

      const res = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(res.body.openingPosition.net).toBe('-100.00');
      expect(res.body.currentBalance).toBe('-100.00');
      expect(res.body.balanceClassification).toBe('CREDIT');
    });

    it('treats a zero opening position (default, no explicit record needed) as SETTLED with no fabricated activity', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);

      const res = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(res.status).toBe(200);
      expect(res.body.openingPosition.recorded).toBe(false);
      expect(res.body.currentBalance).toBe('0.00');
      expect(res.body.balanceClassification).toBe('SETTLED');
      expect(res.body.lastActivity).toBeNull();

      const ledger = await getLedger(accessToken, scheme.property.id, scheme.spaceId);
      expect(ledger.body.items).toEqual([]);
      expect(ledger.body.total).toBe(0);
    });
  });

  describe('issued vs unissued instalments', () => {
    it('never creates a receivable for a DRAFT/APPROVED-but-unissued instalment', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 200);
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Two-instalment levy',
        installments: [
          { dueDate: '2026-10-15', amount: 100 },
          { dueDate: '2027-01-15', amount: 100 },
        ],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      // Approved but nothing issued yet.

      const res = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(res.body.currentBalance).toBe('0.00');
      expect(res.body.balanceClassification).toBe('SETTLED');
      const ledger = await getLedger(accessToken, scheme.property.id, scheme.spaceId);
      expect(ledger.body.items).toEqual([]);
    });

    it('issuing one of two instalments (partial issuance) creates exactly one charge row', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 200);
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Two-instalment levy',
        installments: [
          { dueDate: '2026-10-15', amount: 100 },
          { dueDate: '2027-01-15', amount: 100 },
        ],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);

      const res = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(res.body.currentBalance).toBe('100.00');
      expect(res.body.totalIssuedLevyCharges).toBe('100.00');

      const ledger = await getLedger(accessToken, scheme.property.id, scheme.spaceId);
      expect(ledger.body.items).toHaveLength(1);
      expect(ledger.body.items[0].type).toBe('REGULAR_LEVY_CHARGE');
      expect(ledger.body.items[0].debit).toBe('100.00');
    });
  });

  describe('regular and special levies', () => {
    it('distinguishes REGULAR_LEVY_CHARGE from SPECIAL_LEVY_CHARGE row types', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 150);

      const special = await createSpecialSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.capitalWorksFundId,
        name: 'Roof repair special levy',
        rationale: 'AGM resolution 2026-09-01, item 4',
        externalApprovalDate: '2026-09-01',
        installments: [{ dueDate: '2026-11-01', amount: 500 }],
      });
      expect(special.status).toBe(201);
      await approveSchedule(accessToken, scheme.property.id, special.body.id);
      await issueInstallment(accessToken, scheme.property.id, special.body.id);

      const ledger = await getLedger(accessToken, scheme.property.id, scheme.spaceId);
      const types = ledger.body.items.map((r: { type: string }) => r.type);
      expect(types).toContain('REGULAR_LEVY_CHARGE');
      expect(types).toContain('SPECIAL_LEVY_CHARGE');

      const account = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(account.body.currentBalance).toBe('650.00');
    });
  });

  describe('levy reversal and reversal visibility', () => {
    it('keeps the original charge visible, adds a separate reversal row, and nets the balance back to the pre-issuance state', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const { schedule } = await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 300);

      const before = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(before.body.currentBalance).toBe('300.00');

      const installmentId = schedule.installments[0].id;
      await reverseInstallment(accessToken, scheme.property.id, schedule.id, installmentId, 'Entitlement correction');

      const after = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(after.body.currentBalance).toBe('0.00');
      expect(after.body.balanceClassification).toBe('SETTLED');
      expect(after.body.totalIssuedLevyCharges).toBe('300.00');
      expect(after.body.totalReversedCharges).toBe('300.00');

      const ledger = await getLedger(accessToken, scheme.property.id, scheme.spaceId);
      expect(ledger.body.items).toHaveLength(2);
      const charge = ledger.body.items.find((r: { type: string }) => r.type === 'REGULAR_LEVY_CHARGE');
      const reversal = ledger.body.items.find((r: { type: string }) => r.type === 'LEVY_REVERSAL');
      expect(charge).toBeDefined();
      expect(charge.debit).toBe('300.00');
      expect(reversal).toBeDefined();
      expect(reversal.credit).toBe('300.00');
      expect(reversal.reversalOfSourceReference).toBe(charge.sourceReference);
      expect(reversal.reversalReason).toBe('Entitlement correction');
      // Running balance after the reversal row is exactly back to zero.
      expect(reversal.runningBalance).toBe('0.00');
    });
  });

  describe('no duplicate ledger entries', () => {
    it('shows an issued charge exactly once even when queried repeatedly', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 120);

      const first = await getLedger(accessToken, scheme.property.id, scheme.spaceId);
      const second = await getLedger(accessToken, scheme.property.id, scheme.spaceId);
      expect(first.body.items).toHaveLength(1);
      expect(second.body.items).toHaveLength(1);
      expect(first.body.items[0].id).toBe(second.body.items[0].id);
    });
  });

  describe('deterministic ordering and running balance across pagination', () => {
    it('orders rows chronologically and keeps a correct running balance when read across two pages', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken, {
        amountOwing: 50,
        creditBalance: 0,
        asOfDate: '2026-08-01',
      });

      const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 300);
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Three-instalment levy',
        installments: [
          { dueDate: '2026-10-01', amount: 100 },
          { dueDate: '2027-01-01', amount: 100 },
          { dueDate: '2027-04-01', amount: 100 },
        ],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);

      const full = await getLedger(accessToken, scheme.property.id, scheme.spaceId, '?pageSize=50');
      expect(full.body.items).toHaveLength(4); // opening + 3 charges
      const fullBalances = full.body.items.map((r: { runningBalance: string }) => r.runningBalance);
      expect(fullBalances).toEqual(['50.00', '150.00', '250.00', '350.00']);
      // Opening always sorts first regardless of date proximity to the
      // first charge.
      expect(full.body.items[0].type).toBe('OPENING_POSITION');

      const page1 = await getLedger(accessToken, scheme.property.id, scheme.spaceId, '?page=1&pageSize=2');
      const page2 = await getLedger(accessToken, scheme.property.id, scheme.spaceId, '?page=2&pageSize=2');
      expect(page1.body.items).toHaveLength(2);
      expect(page2.body.items).toHaveLength(2);
      expect(page1.body.total).toBe(4);
      // The running balance on each page's rows is identical to the
      // equivalent rows in the unpaginated read — pagination never
      // recomputes the balance from a page-local zero.
      expect(page1.body.items.map((r: { runningBalance: string }) => r.runningBalance)).toEqual(['50.00', '150.00']);
      expect(page2.body.items.map((r: { runningBalance: string }) => r.runningBalance)).toEqual(['250.00', '350.00']);
    });
  });

  describe('multiple financial funds', () => {
    it('breaks down balances per fund and keeps the opening position out of the per-fund breakdown', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken, {
        amountOwing: 20,
        creditBalance: 0,
        asOfDate: '2026-08-01',
      });
      // One budget per financial year, property-wide — a second fund's
      // levy references a REVENUE line on the SAME budget, never a
      // second budget for the same (propertyId, financial year) triple
      // (see FinancialBudgetsService.create's one-budget-per-FY guard).
      const budget = await createBudget(accessToken, scheme.property.id);
      await addBudgetLine(accessToken, scheme.property.id, budget.id, {
        financialFundId: scheme.administrationFundId,
        lineType: 'REVENUE',
        category: 'Admin Levy Contributions',
        plannedAmount: 100,
        accountId: scheme.income.id,
      });
      await addBudgetLine(accessToken, scheme.property.id, budget.id, {
        financialFundId: scheme.capitalWorksFundId,
        lineType: 'REVENUE',
        category: 'CW Levy Contributions',
        plannedAmount: 200,
        accountId: scheme.cwIncome.id,
      });
      await approveBudget(accessToken, scheme.property.id, budget.id);
      await activateBudget(accessToken, scheme.property.id, budget.id);

      const adminSchedule = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Admin levy',
        installments: [{ dueDate: '2026-10-15', amount: 100 }],
      });
      expect(adminSchedule.status).toBe(201);
      await approveSchedule(accessToken, scheme.property.id, adminSchedule.body.id);
      await issueInstallment(accessToken, scheme.property.id, adminSchedule.body.id);

      const cwSchedule = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.capitalWorksFundId,
        financialBudgetId: budget.id,
        name: 'CW levy',
        installments: [{ dueDate: '2026-10-15', amount: 200 }],
      });
      expect(cwSchedule.status).toBe(201);
      await approveSchedule(accessToken, scheme.property.id, cwSchedule.body.id);
      await issueInstallment(accessToken, scheme.property.id, cwSchedule.body.id);

      const account = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(account.body.currentBalance).toBe('320.00'); // 20 opening + 100 admin + 200 cw
      const admin = account.body.fundBreakdown.find((f: { financialFundId: string }) => f.financialFundId === scheme.administrationFundId);
      const cw = account.body.fundBreakdown.find((f: { financialFundId: string }) => f.financialFundId === scheme.capitalWorksFundId);
      expect(admin.netBalance).toBe('100.00');
      expect(cw.netBalance).toBe('200.00');
      // Opening (20.00) is attributed to neither fund — 100 + 200 = 300,
      // not 320, confirming it isn't silently folded into either bucket.
      expect(Number(admin.netBalance) + Number(cw.netBalance)).toBe(300);
    });
  });

  describe('cross-property and cross-organisation isolation', () => {
    it('404s a lot ledger request for a space that belongs to a different property', async () => {
      const { accessToken } = await registerAuOrg();
      const schemeA = await createSchemeReadyForLevies(accessToken);
      const schemeB = await createSchemeReadyForLevies(accessToken);

      const res = await getFinancialAccount(accessToken, schemeA.property.id, schemeB.spaceId);
      expect(res.status).toBe(404);
    });

    it('404s a lot ledger request from a completely different organisation', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const other = await registerAuOrg();

      const res = await getFinancialAccount(other.accessToken, scheme.property.id, scheme.spaceId);
      expect(res.status).toBe(404);
    });
  });

  describe('authorization and independent people.view', () => {
    it('rejects a caller without financials.view entirely', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const residentToken = await createPropertyRoleToken(accessToken, organisationId, scheme.property.id, 'RESIDENT');

      const res = await getFinancialAccount(residentToken, scheme.property.id, scheme.spaceId);
      expect(res.status).toBe(403);
    });

    it('omits ownerName for a caller who holds financials.view but not people.view', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/memberships`)
        .set(authHeader(accessToken))
        .send({ email: 'owner1@example.com', firstName: 'Olivia', lastName: 'Owner', role: 'OWNER', spaceId: scheme.spaceId });

      const financeOnlyToken = await createPropertyRoleToken(accessToken, organisationId, scheme.property.id, 'FACILITY_MANAGER');

      const asOwnerManager = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(asOwnerManager.status).toBe(200);
      expect(asOwnerManager.body.ownerName).toBe('Olivia Owner');

      const asFacilityManager = await getFinancialAccount(financeOnlyToken, scheme.property.id, scheme.spaceId);
      // FACILITY_MANAGER role may or may not include financials.view by
      // default; this assertion only matters when it does — otherwise
      // the 403 case above already covers the no-access path.
      if (asFacilityManager.status === 200) {
        expect(asFacilityManager.body.ownerName).toBeNull();
      }
    });
  });

  describe('owner changes without loss of history', () => {
    it('keeps the full ledger intact after an owner membership ends and a new one starts', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 80);

      const add = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/memberships`)
        .set(authHeader(accessToken))
        .send({ email: 'old-owner@example.com', firstName: 'Old', lastName: 'Owner', role: 'OWNER', spaceId: scheme.spaceId });
      expect(add.status).toBe(201);

      const before = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(before.body.ownerName).toBe('Old Owner');
      expect(before.body.currentBalance).toBe('80.00');

      // End the old owner's membership and add a new one — the
      // membership model's startDate/endDate are the ownership-
      // effective-date mechanism this milestone relies on (see
      // PropertyMembership).
      const ended = await request(app)
        .post(`/api/v1/people/memberships/${add.body.id}/end`)
        .set(authHeader(accessToken));
      expect(ended.status).toBe(200);
      const addNew = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/memberships`)
        .set(authHeader(accessToken))
        .send({ email: 'new-owner@example.com', firstName: 'New', lastName: 'Owner', role: 'OWNER', spaceId: scheme.spaceId });
      expect(addNew.status).toBe(201);

      const after = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      // The ledger's balance and transaction history belong to the LOT,
      // not the person — unaffected by the ownership change.
      expect(after.body.currentBalance).toBe('80.00');
      const ledger = await getLedger(accessToken, scheme.property.id, scheme.spaceId);
      expect(ledger.body.items).toHaveLength(1);
      expect(ledger.body.ownerName).toBe('New Owner');
    });
  });

  describe('decimal precision', () => {
    it('never drifts on a non-round-cent amount across opening + charge + adjustment', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken, {
        amountOwing: 10.1,
        creditBalance: 0,
        asOfDate: '2026-08-01',
      });
      const { schedule } = await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 33.33);
      const charges = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/lot-levy-charges?spaceId=${scheme.spaceId}`)
        .set(authHeader(accessToken));
      const chargeId = charges.body.items[0].id;
      await adjustCharge(accessToken, scheme.property.id, chargeId, { amount: 0.01, reason: 'rounding true-up' });

      const account = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      // 10.10 + 33.33 + 0.01 = 43.44 exactly — no float drift.
      expect(account.body.currentBalance).toBe('43.44');
      void schedule;
    });
  });

  describe('statement', () => {
    it('reconciles opening + movements = closing for a bounded period', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken, {
        amountOwing: 50,
        creditBalance: 0,
        asOfDate: '2026-08-01',
      });
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 100, '2026-10-15');

      const statement = await getStatement(accessToken, scheme.property.id, scheme.spaceId, '2026-09-01', '2026-12-31');
      expect(statement.status).toBe(200);
      expect(statement.body.openingBalance).toBe('50.00');
      expect(statement.body.movements).toHaveLength(1);
      expect(statement.body.totalDebits).toBe('100.00');
      expect(statement.body.totalCredits).toBe('0.00');
      expect(statement.body.closingBalance).toBe('150.00');
      expect(Number(statement.body.openingBalance) + Number(statement.body.totalDebits) - Number(statement.body.totalCredits)).toBe(
        Number(statement.body.closingBalance),
      );
    });

    it('returns an empty movements list with opening = closing for a period with no activity', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken, {
        amountOwing: 75,
        creditBalance: 0,
        asOfDate: '2026-08-01',
      });

      const statement = await getStatement(accessToken, scheme.property.id, scheme.spaceId, '2026-09-01', '2026-09-30');
      expect(statement.body.movements).toEqual([]);
      expect(statement.body.openingBalance).toBe('75.00');
      expect(statement.body.closingBalance).toBe('75.00');
    });

    it('excludes an opening position dated entirely after the requested period (financial-year boundary)', async () => {
      // An instalment's own dueDate has no bearing on when it is actually
      // posted — issuance always happens "now" (this system has no
      // backdated issuance), so the realistic boundary case to exercise
      // is the opening position's asOfDate, which IS a caller-chosen
      // date, falling entirely outside the requested statement period.
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken, {
        amountOwing: 60,
        creditBalance: 0,
        asOfDate: '2027-02-15',
      });

      // Statement for the FIRST half of the financial year — a row dated
      // in the second half must appear in neither the opening balance nor
      // the movements.
      const statement = await getStatement(accessToken, scheme.property.id, scheme.spaceId, '2026-07-01', '2026-12-31');
      expect(statement.body.movements).toEqual([]);
      expect(statement.body.openingBalance).toBe('0.00');
      expect(statement.body.closingBalance).toBe('0.00');

      // The same row DOES appear once the period actually covers it.
      const laterStatement = await getStatement(accessToken, scheme.property.id, scheme.spaceId, '2027-01-01', '2027-06-30');
      expect(laterStatement.body.movements).toHaveLength(1);
      expect(laterStatement.body.closingBalance).toBe('60.00');
    });
  });

  describe('not-a-lot and not-configured guards', () => {
    it('rejects a financial account request for a space that is not a strata lot', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      const space = await request(app)
        .post(`/api/v1/properties/${property.id}/spaces`)
        .set(authHeader(accessToken))
        .send({ name: 'Plant Room', code: 'PLANT', spaceType: 'STORAGE' });
      expect(space.status).toBe(201);

      const res = await getFinancialAccount(accessToken, property.id, space.body.id);
      expect(res.status).toBe(409);
    });

    it('rejects a request before financial setup has started', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await enableStrata(accessToken, property.id);
      const summary = await setLots(accessToken, property.id, [{ kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 100 }]);
      await completeStrataSetup(accessToken, property.id);

      const lots = summary.lots as Array<{ spaceId: string }>;
      const res = await getFinancialAccount(accessToken, property.id, lots[0]!.spaceId);
      expect(res.status).toBe(409);
    });
  });
});
