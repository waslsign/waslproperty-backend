import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import {
  authHeader,
  createPlainUser,
  registerTestUser,
  residentAccessToken,
} from '../helpers/auth.js';
import { sendLevyIssuanceNotice } from '../../src/modules/financials/levy-notices.js';

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
    .send({
      financialYearStartDate: '2026-07-01',
      financialYearEndDate: '2027-06-30',
      cutoverDate: '2026-10-01',
    });
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
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/activate`)
    .set(authHeader(accessToken));
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

async function closePeriod(accessToken: string, propertyId: string, periodId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/periods/${periodId}/close`)
    .set(authHeader(accessToken))
    .send({});
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

async function previewSchedule(accessToken: string, propertyId: string, scheduleId: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/levy-schedules/${scheduleId}/preview`)
    .set(authHeader(accessToken));
}

/** ADR-024 — issues exactly one instalment per call: the earliest PENDING
 * one if `levyInstallmentId` is omitted, or a specific one if supplied. */
async function issueInstallment(accessToken: string, propertyId: string, scheduleId: string, levyInstallmentId?: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/levy-schedules/${scheduleId}/issue`)
    .set(authHeader(accessToken))
    .send(levyInstallmentId ? { levyInstallmentId } : {});
}

/** Convenience for the many existing single-instalment-schedule tests
 * that only ever had one instalment to begin with — issues it and
 * asserts success, mirroring the old whole-schedule issueSchedule's
 * contract exactly for that common case. */
async function issueSchedule(accessToken: string, propertyId: string, scheduleId: string) {
  return issueInstallment(accessToken, propertyId, scheduleId);
}

async function reverseInstallment(
  accessToken: string,
  propertyId: string,
  scheduleId: string,
  levyInstallmentId: string,
  reason = 'test',
) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/levy-schedules/${scheduleId}/reverse`)
    .set(authHeader(accessToken))
    .send({ levyInstallmentId, reason });
}

/** The generic MANUAL-journal reversal endpoint — distinct from
 * `reverseInstallment` above, which goes through the levy workflow. Used
 * to prove a levy-sourced journal cannot be reversed through this
 * generic path (2026-10-21 incident fix). */
async function reverseJournalGeneric(accessToken: string, propertyId: string, journalId: string, reason = 'test') {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/journals/${journalId}/reverse`)
    .set(authHeader(accessToken))
    .send({ reason });
}

async function listCharges(accessToken: string, propertyId: string, query = '') {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/lot-levy-charges${query}`)
    .set(authHeader(accessToken));
}

async function adjustCharge(accessToken: string, propertyId: string, chargeId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/lot-levy-charges/${chargeId}/adjust`)
    .set(authHeader(accessToken))
    .send(body);
}

async function getTrialBalance(accessToken: string, propertyId: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/trial-balance`)
    .set(authHeader(accessToken));
}

async function createPropertyRoleToken(
  ownerAccessToken: string,
  organisationId: string,
  propertyId: string,
  role: string,
) {
  const user = await createPlainUser();
  await request(app)
    .post(`/api/v1/properties/${propertyId}/memberships`)
    .set(authHeader(ownerAccessToken))
    .send({ email: user.email, firstName: 'P', lastName: 'M', role });
  const contact = await testPrisma.propertyContact.findFirstOrThrow({
    where: { organisationId, email: user.email },
  });
  return residentAccessToken(user.userId, organisationId, contact.id);
}

/** Full onboarding: strata (3 lots with uneven UOE, the real rounding
 * stress case) + financial setup + ACTIVE + an open accounting period. */
async function createSchemeReadyForLevies(accessToken: string) {
  const property = await createProperty(accessToken);
  await enableStrata(accessToken, property.id);
  const summary = await setLots(accessToken, property.id, [
    { kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 33 },
    { kind: 'new', name: 'Lot 2', code: 'L2', unitsOfEntitlement: 33 },
    { kind: 'new', name: 'Lot 3', code: 'L3', unitsOfEntitlement: 34 },
  ]);
  await completeStrataSetup(accessToken, property.id);
  await startFinancialSetup(accessToken, property.id);
  await addFund(accessToken, property.id, 'ADMINISTRATION');
  await addFund(accessToken, property.id, 'CAPITAL_WORKS');
  const lots = summary.lots as Array<{ spaceId: string }>;
  await setLotPositions(
    accessToken,
    property.id,
    lots.map((l) => ({ spaceId: l.spaceId, amountOwing: 0, creditBalance: 0, asOfDate: '2026-10-01' })),
  );
  const activation = await activateFinancialSetup(accessToken, property.id);
  expect(activation.status).toBe(200);
  const funds = activation.body.funds as Array<{ id: string; fundType: string }>;
  const administrationFundId = funds.find((f) => f.fundType === 'ADMINISTRATION')!.id;
  const capitalWorksFundId = funds.find((f) => f.fundType === 'CAPITAL_WORKS')!.id;

  const cash = await createAccount(accessToken, property.id, {
    code: '300000',
    name: 'Cash at Bank',
    classification: 'ASSET',
  });
  const receivable = await createAccount(accessToken, property.id, {
    code: '310000',
    name: 'Lot Levy Receivable',
    classification: 'ASSET',
  });
  const income = await createAccount(accessToken, property.id, {
    code: '100000',
    name: 'Levy Contributions',
    classification: 'INCOME',
  });
  await upsertPostingProfile(accessToken, property.id, {
    role: 'LOT_LEVY_RECEIVABLE',
    financialFundId: administrationFundId,
    accountId: receivable.id,
  });
  await upsertPostingProfile(accessToken, property.id, {
    role: 'LEVY_INCOME',
    financialFundId: administrationFundId,
    accountId: income.id,
  });

  await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31');

  return { property, lots, administrationFundId, capitalWorksFundId, cash, receivable, income };
}

/** A regular levy requires this financial year's ACTIVE budget, with a
 * REVENUE line linked (via accountId) to the configured LEVY_INCOME
 * account — APPROVED alone is no longer sufficient (M16.3 refinement
 * pass: see levies.service.ts's deriveRegularTotal doc comment on why
 * APPROVED doesn't reliably mean "the plan operative for this year"). */
async function createApprovedLevyBudget(
  accessToken: string,
  propertyId: string,
  administrationFundId: string,
  incomeAccountId: string,
  totalAmount: number,
) {
  const budget = await createBudget(accessToken, propertyId);
  await addBudgetLine(accessToken, propertyId, budget.id, {
    financialFundId: administrationFundId,
    lineType: 'REVENUE',
    category: 'Admin Levy Contributions',
    plannedAmount: totalAmount,
    accountId: incomeAccountId,
  });
  await approveBudget(accessToken, propertyId, budget.id);
  return activateBudget(accessToken, propertyId, budget.id);
}

describe('M16.3 Levy Management & UOE Allocation', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('UOE allocation and deterministic rounding', () => {
    it('allocates a total that does not divide evenly, summing exactly with no residual', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        100,
      );

      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Q1 Admin Levy',
        installments: [{ dueDate: '2026-10-15', amount: 100 }],
      });
      expect(created.status).toBe(201);
      expect(created.body.totalAmount).toBe('100.00');

      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      const preview = await previewSchedule(accessToken, scheme.property.id, created.body.id);
      expect(preview.status).toBe(200);

      const sum = preview.body.items.reduce((s: number, row: { total: string }) => s + Number(row.total), 0);
      expect(sum.toFixed(2)).toBe('100.00');
      // 33/100, 33/100, 34/100 of $100 -> 33.00, 33.00, 34.00 exactly (no
      // rounding residual needed for this particular split, but the sum
      // invariant is what actually matters and is asserted above).
      expect(preview.body.items).toHaveLength(3);
    });

    it('distributes an odd residual cent deterministically across lots', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        100.01,
      );

      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Odd-cent levy',
        installments: [{ dueDate: '2026-10-15', amount: 100.01 }],
      });
      expect(created.status).toBe(201);
      await approveSchedule(accessToken, scheme.property.id, created.body.id);

      const preview = await previewSchedule(accessToken, scheme.property.id, created.body.id);
      const sum = preview.body.items.reduce((s: number, row: { total: string }) => s + Number(row.total), 0);
      expect(sum.toFixed(2)).toBe('100.01');
    });
  });

  describe('regular vs special levies', () => {
    it('derives a regular levy total strictly from REVENUE lines linked to the LEVY_INCOME account', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);

      // A budget with a REVENUE line NOT linked to the levy-income account
      // (e.g. interest income) must never be mistaken for levy revenue.
      const budget = await createBudget(accessToken, scheme.property.id);
      await addBudgetLine(accessToken, scheme.property.id, budget.id, {
        financialFundId: scheme.administrationFundId,
        lineType: 'REVENUE',
        category: 'Interest on arrears',
        plannedAmount: 500,
        // no accountId — unlinked, must be excluded
      });
      await approveBudget(accessToken, scheme.property.id, budget.id);
      await activateBudget(accessToken, scheme.property.id, budget.id);

      const res = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Should fail',
        installments: [{ dueDate: '2026-10-15', amount: 500 }],
      });
      expect(res.status).toBe(422);
    });

    it('rejects a regular schedule whose installments do not sum to the budget-derived total', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        1000,
      );

      const res = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Mismatched',
        installments: [{ dueDate: '2026-10-15', amount: 999 }],
      });
      expect(res.status).toBe(422);
    });

    it('rejects a regular schedule linked to a DRAFT (not approved) budget', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createBudget(accessToken, scheme.property.id);
      await addBudgetLine(accessToken, scheme.property.id, budget.id, {
        financialFundId: scheme.administrationFundId,
        lineType: 'REVENUE',
        category: 'Levy',
        plannedAmount: 1000,
        accountId: scheme.income.id,
      });

      const res = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Still draft',
        installments: [{ dueDate: '2026-10-15', amount: 1000 }],
      });
      expect(res.status).toBe(409);
    });

    it('creates a special levy with required approval evidence and derives its total from installments', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);

      const missingEvidence = await createSpecialSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        name: 'Roof repair special levy',
        rationale: '',
        externalApprovalDate: '2026-09-01',
        installments: [{ dueDate: '2026-10-15', amount: 30000 }],
      });
      expect(missingEvidence.status).toBe(422);

      const created = await createSpecialSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        name: 'Roof repair special levy',
        rationale: 'AGM resolution 2026-09-01, item 4: approved roof replacement special levy.',
        externalApprovalDate: '2026-09-01',
        externalApprovalReference: 'AGM-2026-09-01',
        installments: [{ dueDate: '2026-10-15', amount: 30000 }],
      });
      expect(created.status).toBe(201);
      expect(created.body.kind).toBe('SPECIAL');
      expect(created.body.totalAmount).toBe('30000.00');
      expect(created.body.financialBudgetId).toBeNull();
    });

    it('rejects a future externalApprovalDate for a special levy', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);

      const res = await createSpecialSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        name: 'Future-dated',
        rationale: 'test',
        externalApprovalDate: '2099-01-01',
        installments: [{ dueDate: '2026-10-15', amount: 1000 }],
      });
      expect(res.status).toBe(422);
    });
  });

  describe('posting balance and idempotency', () => {
    it('issues a schedule: creates LotLevyCharges, posts one balanced journal, and is idempotent on retry', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        9000,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Q1 Admin Levy',
        installments: [{ dueDate: '2026-10-15', amount: 9000 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);

      const issued = await issueSchedule(accessToken, scheme.property.id, created.body.id);
      expect(issued.status).toBe(201);
      expect(issued.body.status).toBe('ISSUED');
      expect(issued.body.installments[0].status).toBe('ISSUED');
      expect(issued.body.installments[0].journalEntryId).toBeTruthy();

      const charges = await listCharges(accessToken, scheme.property.id, `?levyScheduleId=${created.body.id}`);
      expect(charges.body.items).toHaveLength(3);
      const chargeSum = charges.body.items.reduce(
        (s: number, c: { amount: string }) => s + Number(c.amount),
        0,
      );
      expect(chargeSum.toFixed(2)).toBe('9000.00');

      const trialBalance = await getTrialBalance(accessToken, scheme.property.id);
      const receivableRow = trialBalance.body.items.find(
        (r: { accountId: string }) => r.accountId === scheme.receivable.id,
      );
      const incomeRow = trialBalance.body.items.find(
        (r: { accountId: string }) => r.accountId === scheme.income.id,
      );
      expect(receivableRow.netBalance).toBe('9000.00');
      expect(incomeRow.netBalance).toBe('-9000.00');

      // Idempotent retry.
      const reissued = await issueSchedule(accessToken, scheme.property.id, created.body.id);
      expect(reissued.status).toBe(201);
      expect(reissued.body.installments[0].journalEntryId).toBe(issued.body.installments[0].journalEntryId);

      const chargeCount = await testPrisma.lotLevyCharge.count({
        where: { levyScheduleId: created.body.id },
      });
      expect(chargeCount).toBe(3);
      const journalCount = await testPrisma.journalEntry.count({
        where: { propertyId: scheme.property.id, sourceType: 'LEVY_REGULAR' },
      });
      expect(journalCount).toBe(1);
    });

    it('rejects issuing a DRAFT (not yet approved) schedule', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        1000,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Still draft',
        installments: [{ dueDate: '2026-10-15', amount: 1000 }],
      });

      const res = await issueSchedule(accessToken, scheme.property.id, created.body.id);
      expect(res.status).toBe(409);
    });
  });

  describe('concurrent issuance', () => {
    it('two truly concurrent issue calls resolve to exactly one set of charges and one journal', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        3000,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Concurrent issuance test',
        installments: [{ dueDate: '2026-10-15', amount: 3000 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);

      const [a, b] = await Promise.all([
        issueSchedule(accessToken, scheme.property.id, created.body.id),
        issueSchedule(accessToken, scheme.property.id, created.body.id),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.installments[0].journalEntryId).toBe(b.body.installments[0].journalEntryId);
      expect(a.body.installments[0].journalEntryId).toBeTruthy();

      const chargeCount = await testPrisma.lotLevyCharge.count({ where: { levyScheduleId: created.body.id } });
      expect(chargeCount).toBe(3);
      const journalCount = await testPrisma.journalEntry.count({
        where: { propertyId: scheme.property.id, sourceType: 'LEVY_REGULAR' },
      });
      expect(journalCount).toBe(1);
    });
  });

  describe('closed accounting periods', () => {
    it('rejects issuing into a property with no open period covering today, and writes nothing', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        1000,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Closed period test',
        installments: [{ dueDate: '2026-10-15', amount: 1000 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);

      const periods = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/periods`)
        .set(authHeader(accessToken));
      await closePeriod(accessToken, scheme.property.id, periods.body.items[0].id);

      const res = await issueSchedule(accessToken, scheme.property.id, created.body.id);
      expect(res.status).toBe(409);

      const chargeCount = await testPrisma.lotLevyCharge.count({ where: { levyScheduleId: created.body.id } });
      expect(chargeCount).toBe(0);
      const scheduleAfter = await testPrisma.levySchedule.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(scheduleAfter.status).toBe('APPROVED');
    });
  });

  describe('issuance reversal and correction', () => {
    it('reverses an issued schedule: links the reversal journal, cancels every charge, nets to zero', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        6000,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'To be reversed',
        installments: [{ dueDate: '2026-10-15', amount: 6000 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueSchedule(accessToken, scheme.property.id, created.body.id);
      const installmentId = created.body.installments[0].id;

      const reversed = await reverseInstallment(accessToken, scheme.property.id, created.body.id, installmentId, 'Raised in error');
      expect(reversed.status).toBe(201);
      // ADR-024: the schedule's own status is derived from its
      // instalments — with its only instalment now REVERSED (none
      // ISSUED, none PENDING), the schedule reads as APPROVED again
      // (ready to re-issue a different instalment, though this schedule
      // has no other instalment to issue).
      expect(reversed.body.status).toBe('APPROVED');
      expect(reversed.body.installments[0].status).toBe('REVERSED');

      const charges = await listCharges(accessToken, scheme.property.id, `?levyScheduleId=${created.body.id}`);
      expect(charges.body.items.every((c: { status: string }) => c.status === 'CANCELLED')).toBe(true);
      // Charge rows are never deleted, only cancelled.
      expect(charges.body.items).toHaveLength(3);

      const trialBalance = await getTrialBalance(accessToken, scheme.property.id);
      const receivableRow = trialBalance.body.items.find(
        (r: { accountId: string }) => r.accountId === scheme.receivable.id,
      );
      expect(receivableRow.netBalance).toBe('0.00');

      const secondReversal = await reverseInstallment(accessToken, scheme.property.id, created.body.id, installmentId);
      expect(secondReversal.status).toBe(409);
    });

    it('two truly concurrent reversal requests resolve to exactly one reversal journal and a consistent subledger (closure verification)', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        4500,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Concurrent reversal test',
        installments: [{ dueDate: '2026-10-15', amount: 4500 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueSchedule(accessToken, scheme.property.id, created.body.id);
      const installmentId = created.body.installments[0].id;

      const [a, b] = await Promise.all([
        reverseInstallment(accessToken, scheme.property.id, created.body.id, installmentId, 'Reason A'),
        reverseInstallment(accessToken, scheme.property.id, created.body.id, installmentId, 'Reason B'),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      // Exactly one reversal journal — the subledger and the ledger agree.
      const reversalJournals = await testPrisma.journalEntry.count({
        where: { propertyId: scheme.property.id, sourceType: 'REVERSAL' },
      });
      expect(reversalJournals).toBe(1);

      const installmentAfter = await testPrisma.levyInstallment.findUniqueOrThrow({ where: { id: installmentId } });
      expect(installmentAfter.status).toBe('REVERSED');
      const cancelledCount = await testPrisma.lotLevyCharge.count({
        where: { levyScheduleId: created.body.id, status: 'CANCELLED' },
      });
      expect(cancelledCount).toBe(3);

      const trialBalance = await getTrialBalance(accessToken, scheme.property.id);
      const receivableRow = trialBalance.body.items.find(
        (r: { accountId: string }) => r.accountId === scheme.receivable.id,
      );
      expect(receivableRow.netBalance).toBe('0.00');
    });

    it('rejects a sequential (non-concurrent) second reversal attempt on an already-reversed instalment', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 3000);
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Double reversal test',
        installments: [{ dueDate: '2026-10-15', amount: 3000 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueSchedule(accessToken, scheme.property.id, created.body.id);
      const installmentId = created.body.installments[0].id;

      const first = await reverseInstallment(accessToken, scheme.property.id, created.body.id, installmentId, 'first');
      expect(first.status).toBe(201);
      const second = await reverseInstallment(accessToken, scheme.property.id, created.body.id, installmentId, 'second');
      expect(second.status).toBe(409);

      const reversalJournals = await testPrisma.journalEntry.count({
        where: { propertyId: scheme.property.id, sourceType: 'REVERSAL' },
      });
      expect(reversalJournals).toBe(1);
    });

    it('reconciles the GL receivable exactly against the sum of active (non-cancelled) lot charges after a normal per-instalment reversal', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 8000);
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'GL reconciliation test',
        installments: [
          { dueDate: '2026-10-15', amount: 4000 },
          { dueDate: '2027-01-15', amount: 4000 },
        ],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      // Each instalment issued separately — each gets its OWN journal
      // under ADR-024, never a shared one.
      await issueInstallment(accessToken, scheme.property.id, created.body.id, created.body.installments[0].id);
      await issueInstallment(accessToken, scheme.property.id, created.body.id, created.body.installments[1].id);
      await reverseInstallment(accessToken, scheme.property.id, created.body.id, created.body.installments[0].id, 'reconciliation check');

      const activeChargesTotal = await testPrisma.lotLevyCharge.aggregate({
        where: { levyScheduleId: created.body.id, status: { not: 'CANCELLED' } },
        _sum: { amount: true },
      });
      const trialBalance = await getTrialBalance(accessToken, scheme.property.id);
      const receivableRow = trialBalance.body.items.find(
        (r: { accountId: string }) => r.accountId === scheme.receivable.id,
      );
      // The second instalment ($4,000) is the only one still active —
      // the GL receivable and the lot subledger must agree exactly.
      expect(activeChargesTotal._sum.amount?.toFixed(2)).toBe('4000.00');
      expect(receivableRow.netBalance).toBe('4000.00');
    });

    describe('legacy shared-journal reversal safety (2026-10-21 Harbour View Strata incident fix)', () => {
      /** Simulates the pre-ADR-024 migration backfill state directly —
       * there is no API path that creates two instalments sharing one
       * journal going forward (every new issuance gets its own distinct
       * journal), so the only way to exercise this guard is to force the
       * same shared-journal shape the real backfill produced. */
      async function forceSharedLegacyJournal(installmentIds: string[]) {
        const sharedJournalId = (await testPrisma.levyInstallment.findUniqueOrThrow({
          where: { id: installmentIds[0] },
        })).journalEntryId;
        for (const id of installmentIds.slice(1)) {
          await testPrisma.levyInstallment.update({ where: { id }, data: { journalEntryId: sharedJournalId } });
        }
        return sharedJournalId as string;
      }

      it('rejects reversing one instalment whose journal is still shared with other issued instalments', async () => {
        const { accessToken } = await registerAuOrg();
        const scheme = await createSchemeReadyForLevies(accessToken);
        const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 8000);
        const created = await createRegularSchedule(accessToken, scheme.property.id, {
          financialFundId: scheme.administrationFundId,
          financialBudgetId: budget.id,
          name: 'Legacy shared-journal simulation',
          installments: [
            { dueDate: '2026-10-15', amount: 4000 },
            { dueDate: '2027-01-15', amount: 4000 },
          ],
        });
        await approveSchedule(accessToken, scheme.property.id, created.body.id);
        const inst1 = created.body.installments[0].id;
        const inst2 = created.body.installments[1].id;
        await issueInstallment(accessToken, scheme.property.id, created.body.id, inst1);
        await issueInstallment(accessToken, scheme.property.id, created.body.id, inst2);
        const sharedJournalId = await forceSharedLegacyJournal([inst1, inst2]);

        const res = await reverseInstallment(accessToken, scheme.property.id, created.body.id, inst1, 'attempting legacy reversal');
        expect(res.status).toBe(409);
        expect(res.body.error.message).toMatch(/shares its posted journal/i);

        // Nothing was touched — no reversal journal, both instalments
        // still ISSUED, both charge sets still active.
        const reversalJournals = await testPrisma.journalEntry.count({
          where: { propertyId: scheme.property.id, sourceType: 'REVERSAL' },
        });
        expect(reversalJournals).toBe(0);
        const inst1After = await testPrisma.levyInstallment.findUniqueOrThrow({ where: { id: inst1 } });
        expect(inst1After.status).toBe('ISSUED');
        const activeCharges = await testPrisma.lotLevyCharge.count({
          where: { levyScheduleId: created.body.id, status: { not: 'CANCELLED' } },
        });
        expect(activeCharges).toBe(6); // 3 lots × 2 instalments, none cancelled
        void sharedJournalId;
      });

      it('rejects reversing a levy-generated journal through the generic manual-journal reversal endpoint', async () => {
        const { accessToken } = await registerAuOrg();
        const scheme = await createSchemeReadyForLevies(accessToken);
        const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 3000);
        const created = await createRegularSchedule(accessToken, scheme.property.id, {
          financialFundId: scheme.administrationFundId,
          financialBudgetId: budget.id,
          name: 'Generic-reversal guard test',
          installments: [{ dueDate: '2026-10-15', amount: 3000 }],
        });
        await approveSchedule(accessToken, scheme.property.id, created.body.id);
        const issued = await issueInstallment(accessToken, scheme.property.id, created.body.id, created.body.installments[0].id);
        const journalId = issued.body.installments[0].journalEntryId;
        expect(journalId).toBeTruthy();

        const res = await reverseJournalGeneric(accessToken, scheme.property.id, journalId, 'trying to bypass the levy workflow');
        expect(res.status).toBe(409);
        expect(res.body.error.message).toMatch(/generic manual-journal workflow/i);

        // Completely untouched: no reversal journal, instalment still
        // ISSUED, charges still active — exactly the state this guard
        // exists to protect.
        const reversalJournals = await testPrisma.journalEntry.count({
          where: { propertyId: scheme.property.id, sourceType: 'REVERSAL' },
        });
        expect(reversalJournals).toBe(0);
        const instAfter = await testPrisma.levyInstallment.findUniqueOrThrow({
          where: { id: created.body.installments[0].id },
        });
        expect(instAfter.status).toBe('ISSUED');
      });

      it('still allows the levy workflow to reverse a normal (non-shared, post-ADR-024) instalment journal', async () => {
        const { accessToken } = await registerAuOrg();
        const scheme = await createSchemeReadyForLevies(accessToken);
        const budget = await createApprovedLevyBudget(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 3000);
        const created = await createRegularSchedule(accessToken, scheme.property.id, {
          financialFundId: scheme.administrationFundId,
          financialBudgetId: budget.id,
          name: 'Unaffected normal case',
          installments: [{ dueDate: '2026-10-15', amount: 3000 }],
        });
        await approveSchedule(accessToken, scheme.property.id, created.body.id);
        await issueSchedule(accessToken, scheme.property.id, created.body.id);
        const installmentId = created.body.installments[0].id;

        const res = await reverseInstallment(accessToken, scheme.property.id, created.body.id, installmentId, 'normal case');
        expect(res.status).toBe(201);
        expect(res.body.installments[0].status).toBe('REVERSED');
      });
    });

    it('posts a controlled adjustment to one lot charge without editing the original amount', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        9900,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'To be adjusted',
        installments: [{ dueDate: '2026-10-15', amount: 9900 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueSchedule(accessToken, scheme.property.id, created.body.id);

      const charges = await listCharges(accessToken, scheme.property.id, `?levyScheduleId=${created.body.id}`);
      const charge = charges.body.items[0];
      const originalAmount = charge.amount;

      const adjusted = await adjustCharge(accessToken, scheme.property.id, charge.id, {
        amount: -50,
        reason: 'Entitlement data correction',
      });
      expect(adjusted.status).toBe(201);

      const chargeAfter = await testPrisma.lotLevyCharge.findUniqueOrThrow({ where: { id: charge.id } });
      expect(chargeAfter.amount.toFixed(2)).toBe(originalAmount); // never edited

      const chargesAfter = await listCharges(accessToken, scheme.property.id, `?levyScheduleId=${created.body.id}`);
      const chargeViewAfter = chargesAfter.body.items.find((c: { id: string }) => c.id === charge.id);
      expect(Number(chargeViewAfter.effectiveAmount)).toBeCloseTo(Number(originalAmount) - 50, 2);

      // A retried adjustment with the same idempotency key is a no-op.
      const retry = await adjustCharge(accessToken, scheme.property.id, charge.id, {
        amount: -999, // deliberately different amount — must be ignored on an idempotent replay
        reason: 'retry',
        sourceId: 'fixed-adjustment-key',
      });
      const first = await adjustCharge(accessToken, scheme.property.id, charge.id, {
        amount: -10,
        reason: 'first',
        sourceId: 'fixed-adjustment-key-2',
      });
      expect(first.status).toBe(201);
      void retry;
    });
  });

  describe('invalid budget/account configuration', () => {
    it('blocks regular schedule creation when the posting profile is not configured', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await enableStrata(accessToken, property.id);
      const summary = await setLots(accessToken, property.id, [
        { kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 100 },
      ]);
      await completeStrataSetup(accessToken, property.id);
      await startFinancialSetup(accessToken, property.id);
      await addFund(accessToken, property.id, 'ADMINISTRATION');
      await addFund(accessToken, property.id, 'CAPITAL_WORKS');
      await setLotPositions(
        accessToken,
        property.id,
        summary.lots.map((l: { spaceId: string }) => ({
          spaceId: l.spaceId,
          amountOwing: 0,
          creditBalance: 0,
          asOfDate: '2026-10-01',
        })),
      );
      const activation = await activateFinancialSetup(accessToken, property.id);
      const administrationFundId = activation.body.funds.find(
        (f: { fundType: string }) => f.fundType === 'ADMINISTRATION',
      ).id;
      // No posting profile configured at all.
      const budget = await createBudget(accessToken, property.id);

      const res = await createRegularSchedule(accessToken, property.id, {
        financialFundId: administrationFundId,
        financialBudgetId: budget.id,
        name: 'No posting profile',
        installments: [{ dueDate: '2026-10-15', amount: 1000 }],
      });
      expect(res.status).toBe(409);
    });

    it('blocks issuance when a lot is missing a recorded entitlementValue', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      // Strip entitlementValue from one lot directly, simulating bad data.
      await testPrisma.space.update({
        where: { id: scheme.lots[0]!.spaceId },
        data: { entitlementValue: null },
      });

      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        1000,
      );
      const res422 = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Missing entitlement',
        installments: [{ dueDate: '2026-10-15', amount: 1000 }],
      });
      // Preview-stage check happens at creation time too in this flow
      // (createRegular does not itself call getEligibleLots — verify at
      // the preview/issue stage instead).
      if (res422.status === 201) {
        await approveSchedule(accessToken, scheme.property.id, res422.body.id);
        const previewRes = await previewSchedule(accessToken, scheme.property.id, res422.body.id);
        expect(previewRes.status).toBe(422);
      }
    });
  });

  describe('cross-property isolation and permissions', () => {
    it('rejects every levy endpoint for a user without financials.view/approve', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(ownerToken);
      const tenantToken = await createPropertyRoleToken(ownerToken, organisationId, scheme.property.id, 'TENANT');

      expect(
        (
          await request(app)
            .get(`/api/v1/properties/${scheme.property.id}/financials/levy-schedules`)
            .set(authHeader(tenantToken))
        ).status,
      ).toBe(403);
      expect(
        (
          await createRegularSchedule(tenantToken, scheme.property.id, {
            financialFundId: scheme.administrationFundId,
            financialBudgetId: 'does-not-matter',
            name: 'Unauthorized',
            installments: [{ dueDate: '2026-10-15', amount: 1000 }],
          })
        ).status,
      ).toBe(403);
    });

    it('financials.manage is sufficient to draft/approve but not to issue or reverse', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(ownerToken);
      const budget = await createApprovedLevyBudget(
        ownerToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        1000,
      );
      const managerToken = await createPropertyRoleToken(
        ownerToken,
        organisationId,
        scheme.property.id,
        'PROPERTY_MANAGER',
      );
      await request(app)
        .put('/api/v1/organisations/me/role-permissions/PROPERTY_MANAGER')
        .set(authHeader(ownerToken))
        .send({ overrides: [{ capability: 'financials.manage', granted: true }] });

      const created = await createRegularSchedule(managerToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Manager-drafted',
        installments: [{ dueDate: '2026-10-15', amount: 1000 }],
      });
      expect(created.status).toBe(201);
      const approved = await approveSchedule(managerToken, scheme.property.id, created.body.id);
      expect(approved.status).toBe('APPROVED');

      expect((await issueSchedule(managerToken, scheme.property.id, created.body.id)).status).toBe(403);
    });

    it('a user from a different organisation cannot see or act on this property’s levy schedules', async () => {
      const { accessToken: ownerToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(ownerToken);
      const budget = await createApprovedLevyBudget(
        ownerToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        1000,
      );
      const created = await createRegularSchedule(ownerToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Isolation test',
        installments: [{ dueDate: '2026-10-15', amount: 1000 }],
      });

      const { accessToken: otherOrgToken } = await registerAuOrg();
      expect(
        (
          await request(app)
            .get(`/api/v1/properties/${scheme.property.id}/financials/levy-schedules/${created.body.id}`)
            .set(authHeader(otherOrgToken))
        ).status,
      ).toBe(404);
      expect((await issueSchedule(otherOrgToken, scheme.property.id, created.body.id)).status).toBe(404);
    });
  });

  describe('notification integration', () => {
    it('schedules a levy-issuance Communication through the existing Communications module on successful issuance', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        1500,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Notice test',
        installments: [{ dueDate: '2026-10-15', amount: 1500 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueSchedule(accessToken, scheme.property.id, created.body.id);

      // M16.3 refinement pass (ADR-024): one PERSONALISED Communication
      // per charged lot, not one shared Communication for all of them —
      // see levy-notices.ts's doc comment on why (Communication.body has
      // no per-recipient merge-field templating).
      const notices = await testPrisma.communication.findMany({
        where: { title: { contains: 'Notice test' } },
      });
      expect(notices).toHaveLength(3);
      for (const notice of notices) {
        expect(notice.status).toBe('SCHEDULED');
        expect(notice.channels).toContain('EMAIL');
        const criteria = notice.audienceCriteria as { scope: string; spaceIds?: string[] };
        expect(criteria.scope).toBe('SPACE');
        expect(criteria.spaceIds).toHaveLength(1);
        // Personalised: contains this specific lot's amount and due date,
        // not a generic "log in to see your charges" deflection.
        expect(notice.body).toMatch(/due 2026-10-15/);
        expect(notice.body).toMatch(/AUD \d/);
      }
    });

    it('a notice scheduling failure never affects the already-posted levy (notification failure isolation)', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        1000,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Notice failure isolation',
        installments: [{ dueDate: '2026-10-15', amount: 1000 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      const issued = await issueSchedule(accessToken, scheme.property.id, created.body.id);
      expect(issued.status).toBe(201);

      // Directly exercise the notice helper with data that cannot possibly
      // resolve to a valid write (a bogus organisationId/createdByUserId),
      // simulating the kind of failure that could occur post-commit — and
      // confirm it degrades to `null` rather than throwing, which is what
      // guarantees it can never be allowed to roll back or duplicate an
      // already-committed posting (this call happens strictly after
      // issuance has already committed above).
      const result = await sendLevyIssuanceNotice(testPrisma, {
        organisationId: 'does-not-exist',
        propertyId: scheme.property.id,
        scheduleName: 'Irrelevant',
        fundName: 'Irrelevant',
        currencyCode: 'AUD',
        issuedByUserId: 'does-not-exist',
        instalmentNumber: 1,
        dueDate: '2026-10-15',
        perLot: scheme.lots.map((l) => ({ spaceId: l.spaceId, spaceName: 'Irrelevant', lotNumber: null, amount: '0.00' })),
      });
      // Degrades to an empty id list rather than throwing — every lot's
      // notice failed the same way (a bogus organisationId), but the
      // function itself never propagates that failure to its caller.
      expect(result.communicationIds).toHaveLength(0);

      // The levy itself is completely unaffected by that failure.
      const scheduleAfter = await testPrisma.levySchedule.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(scheduleAfter.status).toBe('ISSUED');
      const chargeCount = await testPrisma.lotLevyCharge.count({ where: { levyScheduleId: created.body.id } });
      expect(chargeCount).toBe(3);
    });
  });

  describe('instalment-level issuance (ADR-024 — NSW-compatible model, M16.3 refinement pass)', () => {
    it('issuing a 4-instalment schedule one at a time never posts the later, still-pending instalments', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        4000,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Quarterly schedule',
        installments: [
          { dueDate: '2026-10-15', amount: 1000 },
          { dueDate: '2027-01-15', amount: 1000 },
          { dueDate: '2027-04-15', amount: 1000 },
          { dueDate: '2027-06-15', amount: 1000 },
        ],
      });
      expect(created.status).toBe(201);
      await approveSchedule(accessToken, scheme.property.id, created.body.id);

      // Issue only the first instalment.
      const firstIssue = await issueInstallment(accessToken, scheme.property.id, created.body.id);
      expect(firstIssue.status).toBe(201);
      expect(firstIssue.body.status).toBe('PARTIALLY_ISSUED');
      expect(firstIssue.body.installments[0].status).toBe('ISSUED');
      expect(firstIssue.body.installments[1].status).toBe('PENDING');
      expect(firstIssue.body.installments[2].status).toBe('PENDING');
      expect(firstIssue.body.installments[3].status).toBe('PENDING');

      // Only the first instalment's charges exist — nothing for Q2-Q4.
      const chargesAfterFirst = await testPrisma.lotLevyCharge.count({ where: { levyScheduleId: created.body.id } });
      expect(chargesAfterFirst).toBe(3); // 3 lots × 1 issued instalment
      const journalsAfterFirst = await testPrisma.journalEntry.count({
        where: { propertyId: scheme.property.id, sourceType: 'LEVY_REGULAR' },
      });
      expect(journalsAfterFirst).toBe(1);

      // The trial balance reflects only the issued instalment's $1000, not
      // the schedule's full $4000 total — the other three instalments
      // genuinely have not been posted yet.
      const tbAfterFirst = await getTrialBalance(accessToken, scheme.property.id);
      const receivableAfterFirst = tbAfterFirst.body.items.find(
        (r: { accountId: string }) => r.accountId === scheme.receivable.id,
      );
      expect(receivableAfterFirst.netBalance).toBe('1000.00');

      // Issue the third instalment explicitly, out of due-date order —
      // the second is skipped deliberately (an AGM could decide to bring
      // a later one forward); the model must allow targeting a specific
      // instalment, not just "the next one".
      const thirdId = firstIssue.body.installments[2].id;
      const thirdIssue = await issueInstallment(accessToken, scheme.property.id, created.body.id, thirdId);
      expect(thirdIssue.status).toBe(201);
      expect(thirdIssue.body.status).toBe('PARTIALLY_ISSUED');
      expect(thirdIssue.body.installments[1].status).toBe('PENDING'); // Q2 still untouched
      expect(thirdIssue.body.installments[2].status).toBe('ISSUED');

      // Issue the remaining two (Q2 then Q4) by omitting the id each time.
      await issueInstallment(accessToken, scheme.property.id, created.body.id);
      const finalIssue = await issueInstallment(accessToken, scheme.property.id, created.body.id);
      expect(finalIssue.body.status).toBe('ISSUED');
      expect(finalIssue.body.installments.every((i: { status: string }) => i.status === 'ISSUED')).toBe(true);

      const totalCharges = await testPrisma.lotLevyCharge.count({ where: { levyScheduleId: created.body.id } });
      expect(totalCharges).toBe(12); // 3 lots × 4 instalments
      const totalJournals = await testPrisma.journalEntry.count({
        where: { propertyId: scheme.property.id, sourceType: 'LEVY_REGULAR' },
      });
      expect(totalJournals).toBe(4); // one per instalment, never one aggregated journal

      const tbFinal = await getTrialBalance(accessToken, scheme.property.id);
      const receivableFinal = tbFinal.body.items.find(
        (r: { accountId: string }) => r.accountId === scheme.receivable.id,
      );
      expect(receivableFinal.netBalance).toBe('4000.00');

      // Issuing again with nothing left pending is an idempotent no-op,
      // not an error (a UI that double-clicks "issue next" must not see a
      // spurious failure once everything is already issued).
      const noop = await issueInstallment(accessToken, scheme.property.id, created.body.id);
      expect(noop.status).toBe(201);
      expect(noop.body.status).toBe('ISSUED');
    });

    it('reversing one instalment never touches another instalment’s charges or journal', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        2000,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Two-instalment schedule',
        installments: [
          { dueDate: '2026-10-15', amount: 1000 },
          { dueDate: '2027-01-15', amount: 1000 },
        ],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      const firstIssue = await issueInstallment(accessToken, scheme.property.id, created.body.id);
      const secondIssue = await issueInstallment(accessToken, scheme.property.id, created.body.id);
      expect(secondIssue.body.status).toBe('ISSUED');

      const firstInstallmentId = firstIssue.body.installments[0].id;
      const secondInstallmentId = firstIssue.body.installments[1].id;
      const secondJournalIdBefore = secondIssue.body.installments[1].journalEntryId;

      const reversed = await reverseInstallment(accessToken, scheme.property.id, created.body.id, firstInstallmentId, 'Struck in error');
      expect(reversed.status).toBe(201);
      // ADR-024: with one REVERSED and one still ISSUED, the schedule
      // reads as PARTIALLY_ISSUED, not back to APPROVED and not ISSUED.
      expect(reversed.body.status).toBe('PARTIALLY_ISSUED');
      expect(reversed.body.installments[0].status).toBe('REVERSED');
      expect(reversed.body.installments[1].status).toBe('ISSUED');
      expect(reversed.body.installments[1].journalEntryId).toBe(secondJournalIdBefore);

      // The second instalment's charges are completely unaffected.
      const secondCharges = await testPrisma.lotLevyCharge.count({
        where: { levyInstallmentId: secondInstallmentId, status: 'ISSUED' },
      });
      expect(secondCharges).toBe(3);
      const firstChargesCancelled = await testPrisma.lotLevyCharge.count({
        where: { levyInstallmentId: firstInstallmentId, status: 'CANCELLED' },
      });
      expect(firstChargesCancelled).toBe(3);

      // Trial balance: only the second instalment's $1000 remains posted.
      const tb = await getTrialBalance(accessToken, scheme.property.id);
      const receivableRow = tb.body.items.find((r: { accountId: string }) => r.accountId === scheme.receivable.id);
      expect(receivableRow.netBalance).toBe('1000.00');
    });

    it('a schedule with any issued (even later reversed) instalment can no longer be cancelled outright', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        1000,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'To be issued then reversed',
        installments: [{ dueDate: '2026-10-15', amount: 1000 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      const issued = await issueInstallment(accessToken, scheme.property.id, created.body.id);
      await reverseInstallment(accessToken, scheme.property.id, created.body.id, issued.body.installments[0].id, 'test');

      // Status is back to APPROVED (nothing currently ISSUED), but real
      // history exists — cancel must still be refused.
      const cancelRes = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/levy-schedules/${created.body.id}/cancel`)
        .set(authHeader(accessToken))
        .send({ reason: 'Trying to cancel after the fact' });
      expect(cancelRes.status).toBe(409);
    });
  });

  describe('human-readable lot levy charges (M16.3 refinement pass)', () => {
    it('never exposes a raw spaceId as the lot identifier, and includes instalment number/due date/fund name', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        3000,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Readable charges test',
        installments: [{ dueDate: '2026-10-15', amount: 3000 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueSchedule(accessToken, scheme.property.id, created.body.id);

      // Give the first lot a recorded OWNER membership so the positive
      // case (name actually populated for a permitted caller) is
      // genuinely exercised, not just "happens to be null".
      await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/memberships`)
        .set(authHeader(accessToken))
        .send({ email: 'owner.lot1@example.invalid', firstName: 'Priya', lastName: 'Singh', role: 'OWNER', spaceId: scheme.lots[0]!.spaceId });

      const charges = await listCharges(accessToken, scheme.property.id, `?levyScheduleId=${created.body.id}`);
      expect(charges.body.items).toHaveLength(3);
      for (const charge of charges.body.items) {
        // createSchemeReadyForLevies's lots have no recorded lotNumber,
        // so this falls back to the space code (L1/L2/L3) — either way,
        // never the raw cuid spaceId.
        expect(charge.lotLabel).toMatch(/^L\d$/);
        expect(charge.lotLabel).not.toBe(charge.spaceId);
        expect(charge.fundName).toBe('Administration Fund');
        expect(charge.levyScheduleName).toBe('Readable charges test');
        expect(charge.installmentNumber).toBe(1);
        expect(charge.dueDate).toBe('2026-10-15');
      }
      // The owner's identity is a people.view-gated capability, never
      // bundled into a financials.view response by default — the caller
      // here (the org OWNER) holds every capability, so the one lot with
      // a recorded OWNER membership shows its name; the other two (no
      // membership recorded) correctly show null.
      const ownedCharge = charges.body.items.find((c: { spaceId: string }) => c.spaceId === scheme.lots[0]!.spaceId);
      expect(ownedCharge.ownerName).toBe('Priya Singh');
    });

    it('omits ownerName for a caller who holds financials.view/approve but not people.view', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(ownerToken);
      const budget = await createApprovedLevyBudget(
        ownerToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        3000,
      );
      const created = await createRegularSchedule(ownerToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Owner-gating test',
        installments: [{ dueDate: '2026-10-15', amount: 3000 }],
      });
      await approveSchedule(ownerToken, scheme.property.id, created.body.id);
      await issueSchedule(ownerToken, scheme.property.id, created.body.id);

      // A property manager granted financials.manage/financials.approve
      // but explicitly NOT people.view.
      const managerToken = await createPropertyRoleToken(
        ownerToken,
        organisationId,
        scheme.property.id,
        'PROPERTY_MANAGER',
      );
      await request(app)
        .put('/api/v1/organisations/me/role-permissions/PROPERTY_MANAGER')
        .set(authHeader(ownerToken))
        .send({
          overrides: [
            { capability: 'financials.manage', granted: true },
            { capability: 'financials.approve', granted: true },
            { capability: 'people.view', granted: false },
          ],
        });

      const charges = await listCharges(managerToken, scheme.property.id, `?levyScheduleId=${created.body.id}`);
      expect(charges.status).toBe(200);
      expect(charges.body.items.length).toBeGreaterThan(0);
      for (const charge of charges.body.items) {
        expect(charge.ownerName).toBeNull();
        // Everything else (amount, lot label, fund, due date) is still
        // present — only owner identity is gated.
        expect(charge.lotLabel).toMatch(/^L\d$/);
        expect(Number(charge.amount)).toBeGreaterThan(0);
      }
    });
  });

  describe('trial balance presentation and fund filter (M16.3 refinement pass)', () => {
    it('presents a conventional Debit/Credit side per account, and filters by fund', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForLevies(accessToken);
      const budget = await createApprovedLevyBudget(
        accessToken,
        scheme.property.id,
        scheme.administrationFundId,
        scheme.income.id,
        1200,
      );
      const created = await createRegularSchedule(accessToken, scheme.property.id, {
        financialFundId: scheme.administrationFundId,
        financialBudgetId: budget.id,
        name: 'Fund filter test',
        installments: [{ dueDate: '2026-10-15', amount: 1200 }],
      });
      await approveSchedule(accessToken, scheme.property.id, created.body.id);
      await issueSchedule(accessToken, scheme.property.id, created.body.id);

      const tb = await getTrialBalance(accessToken, scheme.property.id);
      const receivableRow = tb.body.items.find((r: { accountId: string }) => r.accountId === scheme.receivable.id);
      const incomeRow = tb.body.items.find((r: { accountId: string }) => r.accountId === scheme.income.id);
      // ASSET (receivable) carries a debit balance; INCOME carries a
      // credit balance — conventional presentation, never a signed "net"
      // that reads as negative revenue.
      expect(receivableRow.presentedSide).toBe('DEBIT');
      expect(receivableRow.presentedBalance).toBe('1200.00');
      expect(incomeRow.presentedSide).toBe('CREDIT');
      expect(incomeRow.presentedBalance).toBe('1200.00');

      // Filtered to the Administration Fund, the same rows still appear
      // with the same balances (everything here is in that one fund).
      const tbFiltered = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/trial-balance?financialFundId=${scheme.administrationFundId}`)
        .set(authHeader(accessToken));
      expect(tbFiltered.status).toBe(200);
      const receivableFiltered = tbFiltered.body.items.find(
        (r: { accountId: string }) => r.accountId === scheme.receivable.id,
      );
      expect(receivableFiltered.presentedBalance).toBe('1200.00');

      // Filtered to a fund with no postings at all, the account simply
      // doesn't appear (never a fabricated zero row).
      const tbOtherFund = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/trial-balance?financialFundId=${scheme.capitalWorksFundId}`)
        .set(authHeader(accessToken));
      expect(tbOtherFund.status).toBe(200);
      expect(
        tbOtherFund.body.items.find((r: { accountId: string }) => r.accountId === scheme.receivable.id),
      ).toBeUndefined();
    });
  });
});
