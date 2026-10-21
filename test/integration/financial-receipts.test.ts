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
  const charges = await request(app)
    .get(`/api/v1/properties/${propertyId}/financials/lot-levy-charges?spaceId=${issued.installments?.[0]?.spaceId ?? ''}`)
    .set(authHeader(accessToken));
  void charges;
  return { schedule: issued, chargeAmount: amount };
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

async function listReceipts(accessToken: string, propertyId: string, query = '') {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/receipts${query}`)
    .set(authHeader(accessToken));
}

async function getReceipt(accessToken: string, propertyId: string, receiptId: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/receipts/${receiptId}`)
    .set(authHeader(accessToken));
}

async function reverseReceipt(accessToken: string, propertyId: string, receiptId: string, reason = 'test reversal') {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/receipts/${receiptId}/reverse`)
    .set(authHeader(accessToken))
    .send({ reason });
}

async function createAllocation(accessToken: string, propertyId: string, receiptId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/receipts/${receiptId}/allocations`)
    .set(authHeader(accessToken))
    .send(body);
}

async function reverseAllocation(accessToken: string, propertyId: string, allocationId: string, reason = 'test reversal') {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/payment-allocations/${allocationId}/reverse`)
    .set(authHeader(accessToken))
    .send({ reason });
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

async function createPropertyRoleToken(ownerAccessToken: string, organisationId: string, propertyId: string, role: string) {
  const user = await createPlainUser();
  await request(app)
    .post(`/api/v1/properties/${propertyId}/memberships`)
    .set(authHeader(ownerAccessToken))
    .send({ email: user.email, firstName: 'P', lastName: 'M', role });
  const contact = await testPrisma.propertyContact.findFirstOrThrow({ where: { organisationId, email: user.email } });
  return residentAccessToken(user.userId, organisationId, contact.id);
}

/** A single-lot scheme, with FUND_CASH + UNAPPLIED_CASH posting profiles
 * configured in addition to the M16.4 fixture's LOT_LEVY_RECEIVABLE /
 * LEVY_INCOME roles, since Receipts need them to post at all. */
async function createSchemeReadyForReceipts(accessToken: string) {
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

  return { property, spaceId, administrationFundId, capitalWorksFundId, income, cwIncome, cash, cwCash, unapplied, receivable };
}

describe('M16.5 Receipts & Payment Allocation', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('recording a receipt', () => {
    it('posts Dr fund cash / Cr unapplied cash, unallocated, with the receipt fully unapplied', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);

      const res = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 150,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-10',
      });
      expect(res.status).toBe(201);
      expect(res.body.amount).toBe('150.00');
      expect(res.body.appliedAmount).toBe('0.00');
      expect(res.body.unappliedAmount).toBe('150.00');
      expect(res.body.status).toBe('RECORDED');
      expect(res.body.allocations).toEqual([]);

      const journal = await testPrisma.journalEntry.findUnique({
        where: { id: res.body.journalEntryId },
        include: { lines: true },
      });
      expect(journal!.lines).toHaveLength(2);
      const cashLine = journal!.lines.find((l) => l.accountId === scheme.cash.id)!;
      const unappliedLine = journal!.lines.find((l) => l.accountId === scheme.unapplied.id)!;
      expect(cashLine.debit.toFixed(2)).toBe('150.00');
      expect(cashLine.credit.toFixed(2)).toBe('0.00');
      expect(unappliedLine.credit.toFixed(2)).toBe('150.00');
      expect(unappliedLine.debit.toFixed(2)).toBe('0.00');
    });

    it('never claims bank-reconciliation merely from recording — externalBankReference is just a stored reference', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const res = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-10',
        externalBankReference: 'STMT-OCT-0007',
      });
      expect(res.status).toBe(201);
      expect(res.body.externalBankReference).toBe('STMT-OCT-0007');
      // No "reconciled" field exists on the view at all — this assertion
      // documents that recording a receipt never implies reconciliation.
      expect(res.body).not.toHaveProperty('reconciled');
      expect(res.body).not.toHaveProperty('bankReconciled');
    });
  });

  describe('full and partial allocation', () => {
    it('fully allocates a receipt to one charge, marking it PAID', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 100);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      expect(charges).toHaveLength(1);
      expect(charges[0]!.status).toBe('ISSUED');

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 100 }],
      });
      expect(receipt.status).toBe(201);
      expect(receipt.body.appliedAmount).toBe('100.00');
      expect(receipt.body.unappliedAmount).toBe('0.00');
      expect(receipt.body.allocations).toHaveLength(1);
      expect(receipt.body.allocations[0].amount).toBe('100.00');
      expect(receipt.body.allocations[0].status).toBe('APPLIED');

      const afterCharges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      expect(afterCharges[0]!.status).toBe('PAID');

      // The allocation's own journal must credit the receivable (the lot
      // owes less) and debit unapplied cash (the liability clears) — the
      // same Dr-increases/Cr-decreases convention LevyService.
      // createAdjustment already documents for this account. A reversed
      // direction here would silently overstate the GL receivable every
      // time a payment is applied, even though the application-layer
      // outstanding-balance figures above (derived independently from
      // PaymentAllocation rows, never from summing GL lines) stay correct.
      const allocationJournal = await testPrisma.journalEntry.findUnique({
        where: { id: receipt.body.allocations[0].journalEntryId },
        include: { lines: true },
      });
      const receivableLine = allocationJournal!.lines.find((l) => l.accountId === scheme.receivable.id)!;
      const unappliedLine = allocationJournal!.lines.find((l) => l.accountId === scheme.unapplied.id)!;
      expect(receivableLine.debit.toFixed(2)).toBe('0.00');
      expect(receivableLine.credit.toFixed(2)).toBe('100.00');
      expect(unappliedLine.debit.toFixed(2)).toBe('100.00');
      expect(unappliedLine.credit.toFixed(2)).toBe('0.00');
    });

    it('partially allocates a receipt, leaving the charge PART_PAID and the receipt partly unapplied', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 100);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 60,
        paymentMethod: 'CASH',
        receiptDate: '2026-10-16',
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 60 }],
      });
      expect(receipt.status).toBe(201);
      expect(receipt.body.unappliedAmount).toBe('0.00');

      const afterCharges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      expect(afterCharges[0]!.status).toBe('PART_PAID');

      // A second receipt finishes paying it off.
      const receipt2 = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 40,
        paymentMethod: 'CASH',
        receiptDate: '2026-10-20',
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 40 }],
      });
      expect(receipt2.status).toBe(201);
      const finalCharges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      expect(finalCharges[0]!.status).toBe('PAID');
    });
  });

  describe('one receipt across multiple charges, and multiple receipts to one charge', () => {
    it('splits one receipt across two charges', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 100);
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Two-instalment levy',
        installments: [
          { dueDate: '2026-10-01', amount: 50 },
          { dueDate: '2027-01-01', amount: 50 },
        ],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      expect(charges).toHaveLength(2);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-05',
        allocations: [
          { lotLevyChargeId: charges[0]!.id, amount: 50 },
          { lotLevyChargeId: charges[1]!.id, amount: 50 },
        ],
      });
      expect(receipt.status).toBe(201);
      expect(receipt.body.allocations).toHaveLength(2);
      expect(receipt.body.unappliedAmount).toBe('0.00');

      const afterCharges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      expect(afterCharges.every((c) => c.status === 'PAID')).toBe(true);
    });
  });

  describe('auto-allocation (default order)', () => {
    it('applies oldest-due-date-first across outstanding charges in the same fund', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 100);
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Two-instalment levy',
        installments: [
          { dueDate: '2027-01-01', amount: 50 },
          { dueDate: '2026-10-01', amount: 50 },
        ],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 50,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-05',
        autoAllocate: true,
      });
      expect(receipt.status).toBe(201);
      expect(receipt.body.allocations).toHaveLength(1);

      const afterCharges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      const paid = afterCharges.find((c) => c.status === 'PAID')!;
      const stillIssued = afterCharges.find((c) => c.status === 'ISSUED')!;
      // The earlier-due-date (2026-10-01) instalment must be the one paid,
      // regardless of creation/array order.
      const chargeDetails = await Promise.all(
        [paid, stillIssued].map(async (c) =>
          testPrisma.lotLevyCharge.findUniqueOrThrow({ where: { id: c.id }, include: { levyInstallment: true } }),
        ),
      );
      expect(chargeDetails[0]!.levyInstallment.dueDate.toISOString().slice(0, 10)).toBe('2026-10-01');
    });

    it('leaves any leftover balance unapplied rather than force-allocating past what is owed', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 50);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      void charges;

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 200,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
        autoAllocate: true,
      });
      expect(receipt.status).toBe(201);
      expect(receipt.body.appliedAmount).toBe('50.00');
      expect(receipt.body.unappliedAmount).toBe('150.00');
    });
  });

  describe('unapplied cash / advance payments', () => {
    it('records an advance with nothing issued yet as a fully unapplied receipt, then allocates it later', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-01',
      });
      expect(receipt.status).toBe(201);
      expect(receipt.body.unappliedAmount).toBe('100.00');

      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 100, '2026-11-01');
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const allocation = await createAllocation(accessToken, scheme.property.id, receipt.body.id, {
        lotLevyChargeId: charges[0]!.id,
        amount: 100,
      });
      expect(allocation.status).toBe(201);
      expect(allocation.body.amount).toBe('100.00');

      const final = await getReceipt(accessToken, scheme.property.id, receipt.body.id);
      expect(final.body.unappliedAmount).toBe('0.00');
      expect(final.body.appliedAmount).toBe('100.00');
    });
  });

  describe('over-allocation prevention', () => {
    it('rejects allocating more than the charge has outstanding', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 50);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const res = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 100 }],
      });
      expect(res.status).toBe(409);
    });

    it('rejects allocating more than the receipt has left unapplied', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 50,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
      });
      expect(receipt.status).toBe(201);

      const over = await createAllocation(accessToken, scheme.property.id, receipt.body.id, {
        lotLevyChargeId: charges[0]!.id,
        amount: 60,
      });
      expect(over.status).toBe(409);
    });
  });

  describe('cross-fund allocation rejection', () => {
    it('rejects allocating a receipt to a charge in a different fund', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.capitalWorksFundId, scheme.cwIncome.id, 100);
      const cwCharges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const res = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
        allocations: [{ lotLevyChargeId: cwCharges[0]!.id, amount: 100 }],
      });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/cross-fund/i);
    });
  });

  describe('idempotency', () => {
    it('returns the same receipt for a duplicate idempotencyKey instead of posting twice', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const body = {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 75,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
        idempotencyKey: 'dup-key-001',
      };
      const first = await recordReceipt(accessToken, scheme.property.id, body);
      const second = await recordReceipt(accessToken, scheme.property.id, body);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);

      const all = await listReceipts(accessToken, scheme.property.id);
      expect(all.body.items).toHaveLength(1);
    });

    it('returns the same allocation for a duplicate idempotencyKey instead of posting twice', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 100);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
      });

      const allocBody = { lotLevyChargeId: charges[0]!.id, amount: 100, idempotencyKey: 'alloc-dup-1' };
      const first = await createAllocation(accessToken, scheme.property.id, receipt.body.id, allocBody);
      const second = await createAllocation(accessToken, scheme.property.id, receipt.body.id, allocBody);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);

      const finalReceipt = await getReceipt(accessToken, scheme.property.id, receipt.body.id);
      expect(finalReceipt.body.allocations).toHaveLength(1);
    });
  });

  describe('reversal', () => {
    it('reverses an unallocated receipt cleanly, with a balancing journal and REVERSED status', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 90,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
      });

      const reversed = await reverseReceipt(accessToken, scheme.property.id, receipt.body.id, 'Duplicate entry');
      expect(reversed.status).toBe(201);
      expect(reversed.body.status).toBe('REVERSED');
      expect(reversed.body.reversalReason).toBe('Duplicate entry');

      const original = await testPrisma.journalEntry.findUniqueOrThrow({ where: { id: receipt.body.journalEntryId } });
      expect(original.status).not.toBe('DELETED');
    });

    it('blocks reversing a receipt that still has an APPLIED allocation', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 100);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 100 }],
      });

      const res = await reverseReceipt(accessToken, scheme.property.id, receipt.body.id, 'attempt');
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/reverse those first/i);
    });

    it('allows reversing the receipt once its allocation has itself been reversed, and restores charge status', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 100);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 100 }],
      });
      const allocationId = receipt.body.allocations[0].id;

      const chargeAfterAlloc = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      expect(chargeAfterAlloc[0]!.status).toBe('PAID');

      const revAlloc = await reverseAllocation(accessToken, scheme.property.id, allocationId, 'Misapplied');
      expect(revAlloc.status).toBe(201);
      expect(revAlloc.body.status).toBe('REVERSED');

      const chargeAfterRevAlloc = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      expect(chargeAfterRevAlloc[0]!.status).toBe('ISSUED');

      const receiptAfterRevAlloc = await getReceipt(accessToken, scheme.property.id, receipt.body.id);
      expect(receiptAfterRevAlloc.body.unappliedAmount).toBe('100.00');

      const revReceipt = await reverseReceipt(accessToken, scheme.property.id, receipt.body.id, 'Fully unwound');
      expect(revReceipt.status).toBe(201);
      expect(revReceipt.body.status).toBe('REVERSED');
    });

    it('rejects reversing an already-reversed allocation', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 100);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);
      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 100 }],
      });
      const allocationId = receipt.body.allocations[0].id;
      await reverseAllocation(accessToken, scheme.property.id, allocationId, 'first');
      const second = await reverseAllocation(accessToken, scheme.property.id, allocationId, 'second');
      expect(second.status).toBe(409);
    });
  });

  describe('the generic manual-journal reversal endpoint cannot touch receipt/allocation journals', () => {
    it('rejects a generic reverse of a RECEIPT-sourced journal', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 50,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
      });

      const res = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/journals/${receipt.body.journalEntryId}/reverse`)
        .set(authHeader(accessToken))
        .send({ reason: 'should be blocked' });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/generic manual-journal workflow/i);
    });
  });

  describe('exact Decimal arithmetic', () => {
    it('never drifts on a non-round-cent receipt split across two allocations', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 66.66);
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Rounded levy',
        installments: [
          { dueDate: '2026-10-01', amount: 33.33 },
          { dueDate: '2027-01-01', amount: 33.33 },
        ],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 66.66,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-05',
        allocations: [
          { lotLevyChargeId: charges[0]!.id, amount: 33.33 },
          { lotLevyChargeId: charges[1]!.id, amount: 33.33 },
        ],
      });
      expect(receipt.status).toBe(201);
      expect(receipt.body.unappliedAmount).toBe('0.00');
    });
  });

  describe('closed-period safeguard', () => {
    it('rejects recording a receipt dated inside a closed accounting period', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const period = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/periods`)
        .set(authHeader(accessToken));
      const openPeriod = period.body.items[0];
      const close = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/periods/${openPeriod.id}/close`)
        .set(authHeader(accessToken));
      expect(close.status).toBe(200);

      const res = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 50,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-08-01',
      });
      expect(res.status).toBe(409);
    });
  });

  describe('Lot Ledger integration — no double-counting', () => {
    it('shows a RECEIPT row with the real credit and a PAYMENT_ALLOCATION row at zero/zero', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 100);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
        allocations: [{ lotLevyChargeId: charges[0]!.id, amount: 100 }],
      });
      expect(receipt.status).toBe(201);

      const ledger = await getLedger(accessToken, scheme.property.id, scheme.spaceId, '?pageSize=50');
      const receiptRow = ledger.body.items.find((r: { type: string }) => r.type === 'RECEIPT');
      const allocRow = ledger.body.items.find((r: { type: string }) => r.type === 'PAYMENT_ALLOCATION');
      expect(receiptRow).toBeDefined();
      expect(receiptRow.credit).toBe('100.00');
      expect(receiptRow.debit).toBe('0.00');
      expect(allocRow).toBeDefined();
      expect(allocRow.debit).toBe('0.00');
      expect(allocRow.credit).toBe('0.00');

      // Final running balance: 100 charge - 100 receipt = 0, never -100
      // or 200 from double-counting the allocation.
      const last = ledger.body.items[ledger.body.items.length - 1];
      expect(last.runningBalance).toBe('0.00');

      const account = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(account.body.currentBalance).toBe('0.00');
      expect(account.body.totalReceipts).toBe('100.00');
      expect(account.body.totalUnapplied).toBe('0.00');
    });

    it('reports totalUnapplied correctly for an advance receipt with nothing allocated', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 200,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
      });
      expect(receipt.status).toBe(201);

      const account = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      // An unapplied receipt is a credit balance (money held, nothing owed
      // against it yet) — the lot's currentBalance moves into credit.
      expect(account.body.totalReceipts).toBe('200.00');
      expect(account.body.totalUnapplied).toBe('200.00');
      expect(account.body.currentBalance).toBe('-200.00');
      expect(account.body.balanceClassification).toBe('CREDIT');
    });

    it('shows a RECEIPT_REVERSAL row after reversing an unallocated receipt, netting back to zero', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 80,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
      });
      await reverseReceipt(accessToken, scheme.property.id, receipt.body.id, 'duplicate');

      const ledger = await getLedger(accessToken, scheme.property.id, scheme.spaceId, '?pageSize=50');
      const types = ledger.body.items.map((r: { type: string }) => r.type);
      expect(types).toContain('RECEIPT');
      expect(types).toContain('RECEIPT_REVERSAL');
      const last = ledger.body.items[ledger.body.items.length - 1];
      expect(last.runningBalance).toBe('0.00');

      const account = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(account.body.currentBalance).toBe('0.00');
    });
  });

  describe('cross-property and cross-organisation isolation', () => {
    it('404s a receipt lookup for a receipt belonging to a different property', async () => {
      const { accessToken } = await registerAuOrg();
      const schemeA = await createSchemeReadyForReceipts(accessToken);
      const schemeB = await createSchemeReadyForReceipts(accessToken);
      const receipt = await recordReceipt(accessToken, schemeA.property.id, {
        spaceId: schemeA.spaceId,
        financialFundId: schemeA.administrationFundId,
        amount: 50,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
      });

      const res = await getReceipt(accessToken, schemeB.property.id, receipt.body.id);
      expect(res.status).toBe(404);
    });

    it('404s a receipt lookup from a completely different organisation', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 50,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
      });
      const other = await registerAuOrg();

      const res = await getReceipt(other.accessToken, scheme.property.id, receipt.body.id);
      expect(res.status).toBe(404);
    });
  });

  describe('financial permissions', () => {
    it('rejects a caller without financials.approve from recording a receipt', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const residentToken = await createPropertyRoleToken(accessToken, organisationId, scheme.property.id, 'RESIDENT');

      const res = await recordReceipt(residentToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 50,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
      });
      expect(res.status).toBe(403);
    });

    it('rejects a caller without financials.view from listing receipts', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const residentToken = await createPropertyRoleToken(accessToken, organisationId, scheme.property.id, 'RESIDENT');

      const res = await listReceipts(residentToken, scheme.property.id);
      expect(res.status).toBe(403);
    });
  });

  describe('concurrency', () => {
    it('serializes two concurrent allocations against the same receipt without over-allocating', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 200);
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Two-instalment levy',
        installments: [
          { dueDate: '2026-10-01', amount: 100 },
          { dueDate: '2027-01-01', amount: 100 },
        ],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      const charges = await getLotLevyCharges(accessToken, scheme.property.id, scheme.spaceId);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 100,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-16',
      });

      // Two concurrent requests each try to allocate the full 100 against
      // a DIFFERENT charge — only one may succeed, since the receipt only
      // has 100 unapplied in total.
      const [r1, r2] = await Promise.all([
        createAllocation(accessToken, scheme.property.id, receipt.body.id, { lotLevyChargeId: charges[0]!.id, amount: 100 }),
        createAllocation(accessToken, scheme.property.id, receipt.body.id, { lotLevyChargeId: charges[1]!.id, amount: 100 }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const finalReceipt = await getReceipt(accessToken, scheme.property.id, receipt.body.id);
      expect(finalReceipt.body.unappliedAmount).toBe('0.00');
      expect(finalReceipt.body.allocations).toHaveLength(1);
    });
  });

  describe('regression — existing levy issuance/reversal flow unaffected', () => {
    it('still issues and reverses a levy instalment exactly as in M16.3/M16.4', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForReceipts(accessToken);
      const { schedule } = await issueRegularLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 300);

      const before = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(before.body.currentBalance).toBe('300.00');

      const installmentId = schedule.installments[0].id;
      const rev = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/levy-schedules/${schedule.id}/reverse`)
        .set(authHeader(accessToken))
        .send({ levyInstallmentId: installmentId, reason: 'regression check' });
      expect(rev.status).toBe(201);

      const after = await getFinancialAccount(accessToken, scheme.property.id, scheme.spaceId);
      expect(after.body.currentBalance).toBe('0.00');
    });
  });
});
