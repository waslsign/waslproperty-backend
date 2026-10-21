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

async function getLotLevyCharges(accessToken: string, propertyId: string, spaceId: string) {
  const res = await request(app)
    .get(`/api/v1/properties/${propertyId}/financials/lot-levy-charges?spaceId=${spaceId}`)
    .set(authHeader(accessToken));
  expect(res.status).toBe(200);
  return res.body.items as Array<{ id: string; amount: string; status: string; publicReference: string }>;
}

async function recordReceipt(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/receipts`)
    .set(authHeader(accessToken))
    .send(body);
}

async function reverseAllocation(accessToken: string, propertyId: string, allocationId: string, reason = 'test reversal') {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/payment-allocations/${allocationId}/reverse`)
    .set(authHeader(accessToken))
    .send({ reason });
}

async function reverseReceipt(accessToken: string, propertyId: string, receiptId: string, reason = 'test reversal') {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/receipts/${receiptId}/reverse`)
    .set(authHeader(accessToken))
    .send({ reason });
}

async function getArrearsSummary(accessToken: string, propertyId: string, query = '') {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/arrears/summary${query}`)
    .set(authHeader(accessToken));
}

async function getArrearsRegister(accessToken: string, propertyId: string, query = '') {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/arrears/register${query}`)
    .set(authHeader(accessToken));
}

async function getLotArrearsDetail(accessToken: string, propertyId: string, spaceId: string, query = '') {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/arrears/lots/${spaceId}${query}`)
    .set(authHeader(accessToken));
}

async function createCollectionCase(accessToken: string, propertyId: string, spaceId: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/arrears/lots/${spaceId}/collection-cases`)
    .set(authHeader(accessToken))
    .send(body);
}

async function addCollectionNote(accessToken: string, propertyId: string, caseId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/arrears/collection-cases/${caseId}/notes`)
    .set(authHeader(accessToken))
    .send(body);
}

async function draftReminder(accessToken: string, propertyId: string, spaceId: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/arrears/lots/${spaceId}/reminders`)
    .set(authHeader(accessToken))
    .send(body);
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

/** A single-lot scheme with FUND_CASH/UNAPPLIED_CASH configured (M16.5
 * fixture, reused verbatim) so receipts/allocations — and therefore
 * arrears — can be exercised end to end. */
async function createSchemeReadyForArrears(accessToken: string) {
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
  const capitalWorksFundId = funds.find((f) => f.fundType === 'CAPITAL_WORKS')!.id;

  const receivable = await createAccount(accessToken, property.id, { code: '310000', name: 'Lot Levy Receivable', classification: 'ASSET' });
  const income = await createAccount(accessToken, property.id, { code: '100000', name: 'Levy Contributions', classification: 'INCOME' });
  const cwReceivable = await createAccount(accessToken, property.id, { code: '311000', name: 'CW Lot Levy Receivable', classification: 'ASSET' });
  const cwIncome = await createAccount(accessToken, property.id, { code: '101000', name: 'CW Levy Contributions', classification: 'INCOME' });
  const cash = await createAccount(accessToken, property.id, { code: '110000', name: 'Admin Bank Account', classification: 'ASSET' });
  const cwCash = await createAccount(accessToken, property.id, { code: '111000', name: 'CW Bank Account', classification: 'ASSET' });
  const unapplied = await createAccount(accessToken, property.id, { code: '210000', name: 'Unapplied Cash', classification: 'LIABILITY' });

  await upsertPostingProfile(accessToken, property.id, { role: 'LOT_LEVY_RECEIVABLE', financialFundId: administrationFundId, accountId: receivable.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'LEVY_INCOME', financialFundId: administrationFundId, accountId: income.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'LOT_LEVY_RECEIVABLE', financialFundId: capitalWorksFundId, accountId: cwReceivable.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'LEVY_INCOME', financialFundId: capitalWorksFundId, accountId: cwIncome.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'FUND_CASH', financialFundId: administrationFundId, accountId: cash.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'FUND_CASH', financialFundId: capitalWorksFundId, accountId: cwCash.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'UNAPPLIED_CASH', accountId: unapplied.id });

  await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31');

  return { property, spaceId, administrationFundId, capitalWorksFundId, income, cwIncome, cash, cwCash, unapplied };
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

/** Today is fixed at 2026-10-21 throughout this suite (matches the real
 * server clock used by `new Date()` in arrears.controller.ts) — every
 * test below chooses due dates relative to that fixed point so "overdue"
 * assertions are deterministic. */
const TODAY = '2026-10-21';

describe('M16.6 Arrears Management', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('overdue vs not-yet-due', () => {
    it('1. an unpaid levy before its due date is CURRENT, never overdue', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2027-01-15');

      const detail = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(detail.status).toBe(200);
      expect(detail.body.totalOverdue).toBe('0.00');
      expect(detail.body.charges[0].isOverdue).toBe(false);
      expect(detail.body.charges[0].ageingBucket).toBe('CURRENT');
    });

    it('2. an unpaid levy after its due date is overdue, in the 1-30 bucket', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');

      const detail = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(detail.body.totalOverdue).toBe('500.00');
      expect(detail.body.charges[0].isOverdue).toBe(true);
      expect(detail.body.charges[0].daysOverdue).toBe(6); // 2026-10-21 - 2026-10-15
      expect(detail.body.charges[0].ageingBucket).toBe('DAYS_1_30');
    });
  });

  describe('payment states', () => {
    it('3. a partial payment leaves the remainder overdue', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 200,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: TODAY,
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 200 }],
      });
      expect(receipt.status).toBe(201);

      const detail = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(detail.body.totalOverdue).toBe('300.00');
      expect(detail.body.charges[0].outstandingAmount).toBe('300.00');
      expect(detail.body.charges[0].isOverdue).toBe(true);
    });

    it('4. a full payment removes the charge from overdue entirely', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 500,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: TODAY,
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 500 }],
      });
      expect(receipt.status).toBe(201);

      const detail = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(detail.body.totalOverdue).toBe('0.00');
      expect(detail.body.charges[0].outstandingAmount).toBe('0.00');
      expect(detail.body.charges[0].isOverdue).toBe(false);
    });

    it('5. multiple receipts allocated to one charge combine correctly', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 150,
        paymentMethod: 'CASH',
        receiptDate: TODAY,
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 150 }],
      });
      await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 150,
        paymentMethod: 'CASH',
        receiptDate: TODAY,
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 150 }],
      });

      const detail = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(detail.body.charges[0].outstandingAmount).toBe('200.00');
      expect(detail.body.totalOverdue).toBe('200.00');
    });

    it('6. one receipt allocated across multiple charges reduces both', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 1000);
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Two-instalment levy',
        installments: [
          { dueDate: '2026-10-15', amount: 500 },
          { dueDate: '2026-10-16', amount: 500 },
        ],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 600,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: TODAY,
        allocations: [
          { lotLevyChargeId: charges[0]!.id, amount: 300 },
          { lotLevyChargeId: charges[1]!.id, amount: 300 },
        ],
      });
      expect(receipt.status).toBe(201);

      const detail = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(detail.body.totalOverdue).toBe('400.00'); // 200 + 200 remaining
    });

    it('7. an unapplied owner credit is reported separately, never reducing a specific charge', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 300,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: TODAY,
      });
      expect(receipt.status).toBe(201);

      const detail = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      // The charge is untouched — the credit was never force-allocated.
      expect(detail.body.totalOverdue).toBe('500.00');
      expect(detail.body.charges[0].outstandingAmount).toBe('500.00');
      expect(detail.body.unappliedCredits).toBe('300.00');
    });
  });

  describe('cancellations and adjustments', () => {
    it('8. a cancelled (reversed) instalment is excluded from arrears entirely', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      const { schedule } = await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');
      const installmentId = schedule.installments[0].id;
      await reverseInstallment(accessToken, scheme.property.id, schedule.id, installmentId, 'cancelled for test');

      const detail = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(detail.body.totalOverdue).toBe('0.00');
      expect(detail.body.charges[0].outstandingAmount).toBe('0.00');
      expect(detail.body.charges[0].isOverdue).toBe(false);
    });

    it('9. signed levy adjustments move the outstanding balance in either direction', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      await adjustCharge(accessToken, scheme.property.id, charges[0]!.id, { amount: 50, reason: 'late fee' });
      const afterPositive = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(afterPositive.body.totalOverdue).toBe('550.00');

      await adjustCharge(accessToken, scheme.property.id, charges[0]!.id, { amount: -80, reason: 'goodwill credit' });
      const afterNegative = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(afterNegative.body.totalOverdue).toBe('470.00'); // 500 + 50 - 80
    });
  });

  describe('reversals', () => {
    it('10. reversing an allocation restores the charge balance, including putting it back into arrears', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 500,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: TODAY,
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 500 }],
      });
      const paidOff = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(paidOff.body.totalOverdue).toBe('0.00');

      const allocationId = receipt.body.allocations[0].id;
      const rev = await reverseAllocation(accessToken, scheme.property.id, allocationId, 'misapplied');
      expect(rev.status).toBe(201);

      const detail = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(detail.body.totalOverdue).toBe('500.00');
      expect(detail.body.charges[0].isOverdue).toBe(true);
    });

    it('11. reversing a receipt removes its cash impact and its unapplied credit from the lot', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 200,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: TODAY,
      });
      const before = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(before.body.unappliedCredits).toBe('200.00');

      const rev = await reverseReceipt(accessToken, scheme.property.id, receipt.body.id, 'duplicate entry');
      expect(rev.status).toBe(201);

      const after = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(after.body.unappliedCredits).toBe('0.00');
      expect(after.body.totalOverdue).toBe('500.00'); // the charge itself is untouched
    });
  });

  describe('opening balances', () => {
    it('12. an opening balance is shown separately, never classified as overdue or ageing-bucketed', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await enableStrata(accessToken, property.id);
      const summary = await setLots(accessToken, property.id, [{ kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 100 }]);
      await completeStrataSetup(accessToken, property.id);
      await startFinancialSetup(accessToken, property.id);
      await addFund(accessToken, property.id, 'ADMINISTRATION');
      await addFund(accessToken, property.id, 'CAPITAL_WORKS');
      const spaceId = (summary.lots as Array<{ spaceId: string }>)[0]!.spaceId;
      await setLotPositions(accessToken, property.id, [{ spaceId, amountOwing: 250, creditBalance: 0, asOfDate: '2026-09-01' }]);
      const activation = await activateFinancialSetup(accessToken, property.id);
      expect(activation.status).toBe(200);
      await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31');

      const detail = await getLotArrearsDetail(accessToken, property.id, spaceId);
      expect(detail.status).toBe(200);
      expect(detail.body.totalOverdue).toBe('0.00'); // no issued charges, so no overdue
      expect(detail.body.openingPosition).toEqual({
        amountOwing: '250.00',
        creditBalance: '0.00',
        asOfDate: '2026-09-01',
        ageingBucket: 'UNKNOWN',
      });
    });
  });

  describe('ageing bucket boundaries', () => {
    it('13. buckets fall exactly at 30/31/60/61/90/91 day boundaries', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      // TODAY = 2026-10-21. Due dates chosen so daysOverdue lands exactly
      // on each boundary: 30 (1-30), 31 (31-60), 60 (31-60), 61 (61-90),
      // 90 (61-90), 91 (90+).
      const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 600);
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Boundary levy',
        installments: [
          { dueDate: '2026-09-21', amount: 100 }, // 30 days overdue
          { dueDate: '2026-09-20', amount: 100 }, // 31 days overdue
          { dueDate: '2026-08-22', amount: 100 }, // 60 days overdue
          { dueDate: '2026-08-21', amount: 100 }, // 61 days overdue
          { dueDate: '2026-07-23', amount: 100 }, // 90 days overdue
          { dueDate: '2026-07-22', amount: 100 }, // 91 days overdue
        ],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      for (let i = 0; i < 6; i += 1) await issueInstallment(accessToken, scheme.property.id, created.body.id);

      const detail = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      const byDays = new Map(detail.body.charges.map((c: { daysOverdue: number; ageingBucket: string }) => [c.daysOverdue, c.ageingBucket]));
      expect(byDays.get(30)).toBe('DAYS_1_30');
      expect(byDays.get(31)).toBe('DAYS_31_60');
      expect(byDays.get(60)).toBe('DAYS_31_60');
      expect(byDays.get(61)).toBe('DAYS_61_90');
      expect(byDays.get(90)).toBe('DAYS_61_90');
      expect(byDays.get(91)).toBe('DAYS_90_PLUS');
    });
  });

  describe('as-of date boundaries', () => {
    it('14. a charge due exactly on the as-of date is CURRENT, not overdue; one day later it is overdue', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-21');

      const sameDay = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId, '?asOfDate=2026-10-21');
      expect(sameDay.body.charges[0].isOverdue).toBe(false);
      expect(sameDay.body.charges[0].ageingBucket).toBe('CURRENT');

      const nextDay = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId, '?asOfDate=2026-10-22');
      expect(nextDay.body.charges[0].isOverdue).toBe(true);
      expect(nextDay.body.charges[0].daysOverdue).toBe(1);
    });
  });

  describe('historical ageing correctness', () => {
    it('15. a charge never retroactively exists before its own instalment was issued — no fabricated pre-issuance position', async () => {
      // Issuance always happens "now" (this system has no backdated
      // issuance — see financial-lot-ledger.test.ts's own note on this),
      // so within a single test run every instalment's issuedAt is today
      // regardless of its dueDate. That makes "today" the only day this
      // harness can genuinely issue+pay on, which is exactly what this
      // test exercises: a charge due weeks ago, issued and paid off
      // today, must still not appear at all when queried as of a real
      // historical date that predates its actual issuance — never
      // fabricating a pre-issuance overdue position.
      //
      // The complementary case — an allocation created on a LATER real
      // calendar day correctly excluded when querying an EARLIER as-of
      // date, with the charge still correctly outstanding at that earlier
      // date — was verified live against genuinely multi-day Harbour View
      // Strata data in Phase 6 (seeded 2026-10-20, receipt recorded
      // 2026-10-21): asOf 2026-10-20 showed the charge still outstanding
      // at 3,031.58; asOf 2026-10-21 showed it paid in full. That sub-case
      // cannot be constructed within one same-day test run (createdAt is
      // always "now" and cannot be backdated through any API), so it is
      // not duplicated here.
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-01');
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 500,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: TODAY,
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 500 }],
      });

      const todayView = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId, `?asOfDate=${TODAY}`);
      expect(todayView.body.charges[0].outstandingAmount).toBe('0.00');
      expect(todayView.body.charges[0].isOverdue).toBe(false);

      // A real historical date before today (before this instalment was
      // actually issued) — the charge must not appear at all, never shown
      // as a fabricated "500.00 overdue" position that never truly existed.
      const beforeIssuance = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId, '?asOfDate=2026-10-20');
      expect(beforeIssuance.body.charges).toEqual([]);
      expect(beforeIssuance.body.totalOverdue).toBe('0.00');
    });
  });

  describe('cross-fund aggregation', () => {
    it('16. the property summary aggregates overdue amounts correctly across both funds', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);

      // One budget per (property, financial year) — both funds' REVENUE
      // lines live on the SAME budget (same constraint financial-lot-
      // ledger.test.ts's "multiple financial funds" test documents).
      const budget = await createBudget(accessToken, scheme.property.id);
      await addBudgetLine(accessToken, scheme.property.id, budget.id, {
        financialFundId: scheme.administrationFundId,
        lineType: 'REVENUE',
        category: 'Admin Levy Contributions',
        plannedAmount: 300,
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
        installments: [{ dueDate: '2026-10-15', amount: 300 }],
      });
      await approveSchedule(accessToken, scheme.property.id, adminSchedule.body.id);
      await issueInstallment(accessToken, scheme.property.id, adminSchedule.body.id);

      const cwSchedule = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.capitalWorksFundId,
        financialBudgetId: budget.id,
        name: 'CW levy',
        installments: [{ dueDate: '2026-10-15', amount: 200 }],
      });
      await approveSchedule(accessToken, scheme.property.id, cwSchedule.body.id);
      await issueInstallment(accessToken, scheme.property.id, cwSchedule.body.id);

      const summary = await getArrearsSummary(accessToken, scheme.property.id);
      expect(summary.status).toBe(200);
      expect(summary.body.totalOverdue).toBe('500.00');
      const admin = summary.body.overdueByFund.find((f: { financialFundId: string }) => f.financialFundId === scheme.administrationFundId);
      const cw = summary.body.overdueByFund.find((f: { financialFundId: string }) => f.financialFundId === scheme.capitalWorksFundId);
      expect(admin.totalOverdue).toBe('300.00');
      expect(cw.totalOverdue).toBe('200.00');

      const filtered = await getArrearsSummary(accessToken, scheme.property.id, `?financialFundId=${scheme.administrationFundId}`);
      expect(filtered.body.totalOverdue).toBe('300.00');
    });
  });

  describe('collection notes and audit history', () => {
    it('17. opening a case and adding a note is reflected in the lot detail and the audit log', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');

      const kase = await createCollectionCase(accessToken, scheme.property.id, scheme.spaceId, { nextFollowUpDate: '2026-10-28' });
      expect(kase.status).toBe(201);
      expect(kase.body.status).toBe('OPEN');

      const note = await addCollectionNote(accessToken, scheme.property.id, kase.body.id, {
        body: 'Spoke to owner, agreed a payment plan.',
        contactAttempted: true,
        contactMethod: 'PHONE',
      });
      expect(note.status).toBe(201);

      const detail = await getLotArrearsDetail(accessToken, scheme.property.id, scheme.spaceId);
      expect(detail.body.collectionCases).toHaveLength(1);
      expect(detail.body.collectionCases[0].notes).toHaveLength(1);
      expect(detail.body.collectionCases[0].notes[0].body).toMatch(/payment plan/);

      const activity = await testPrisma.activityEvent.findMany({
        where: { organisationId, propertyId: scheme.property.id, eventType: { in: ['COLLECTION_CASE_OPENED', 'COLLECTION_NOTE_ADDED'] } },
      });
      expect(activity).toHaveLength(2);
    });

    it('a closed case cannot be updated further — a new case must be opened', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      const kase = await createCollectionCase(accessToken, scheme.property.id, scheme.spaceId);

      const close = await request(app)
        .patch(`/api/v1/properties/${scheme.property.id}/financials/arrears/collection-cases/${kase.body.id}`)
        .set(authHeader(accessToken))
        .send({ status: 'CLOSED', closeReason: 'Paid in full' });
      expect(close.status).toBe(200);
      expect(close.body.status).toBe('CLOSED');

      const reopenAttempt = await request(app)
        .patch(`/api/v1/properties/${scheme.property.id}/financials/arrears/collection-cases/${kase.body.id}`)
        .set(authHeader(accessToken))
        .send({ status: 'OPEN' });
      expect(reopenAttempt.status).toBe(409);
    });
  });

  describe('reminder drafting', () => {
    it('18. a drafted reminder snapshots the current overdue charges and never auto-sends', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');

      const reminder = await draftReminder(accessToken, scheme.property.id, scheme.spaceId);
      expect(reminder.status).toBe(201);
      expect(reminder.body.status).toBe('DRAFT');
      expect(reminder.body.totalAmountOwing).toBe('500.00');
      expect(reminder.body.content.charges).toHaveLength(1);

      const cancel = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/arrears/reminders/${reminder.body.id}/cancel`)
        .set(authHeader(accessToken));
      expect(cancel.status).toBe(200);
      expect(cancel.body.status).toBe('CANCELLED');

      const recancel = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/arrears/reminders/${reminder.body.id}/cancel`)
        .set(authHeader(accessToken));
      expect(recancel.status).toBe(409);
    });
  });

  describe('email suppression', () => {
    it('19. drafting a reminder never calls the email service', async () => {
      const { emailService } = await import('../../src/lib/email.js');
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, '2026-10-15');

      const callsBefore = (emailService.send as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      const reminder = await draftReminder(accessToken, scheme.property.id, scheme.spaceId);
      expect(reminder.status).toBe(201);
      const callsAfter = (emailService.send as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      expect(callsAfter).toBe(callsBefore);
    });
  });

  describe('cross-property and cross-organisation isolation', () => {
    it('20a. 404s a lot arrears detail request for a lot belonging to a different property', async () => {
      const { accessToken } = await registerAuOrg();
      const schemeA = await createSchemeReadyForArrears(accessToken);
      const schemeB = await createSchemeReadyForArrears(accessToken);

      const res = await getLotArrearsDetail(accessToken, schemeA.property.id, schemeB.spaceId);
      expect(res.status).toBe(404);
    });

    it('20b. 404s an arrears summary request from a completely different organisation', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      const other = await registerAuOrg();

      const res = await getArrearsSummary(other.accessToken, scheme.property.id);
      expect(res.status).toBe(404);
    });

    it('20c. rejects a caller without financials.view from the register, and without financials.manage from opening a case', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForArrears(accessToken);
      const residentToken = await createPropertyRoleToken(accessToken, organisationId, scheme.property.id, 'RESIDENT');

      const register = await getArrearsRegister(residentToken, scheme.property.id);
      expect(register.status).toBe(403);

      const kase = await createCollectionCase(residentToken, scheme.property.id, scheme.spaceId);
      expect(kase.status).toBe(403);
    });
  });
});
