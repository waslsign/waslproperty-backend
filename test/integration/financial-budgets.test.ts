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

async function registerAuOrg(overrides: Parameters<typeof registerTestUser>[1] = {}) {
  const session = await registerTestUser(app, overrides);
  const patchRes = await request(app)
    .patch('/api/v1/organisations/me')
    .set(authHeader(session.accessToken))
    .send({ countryCode: 'AU' });
  expect(patchRes.status).toBe(200);
  return session;
}

async function createProperty(accessToken: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(accessToken))
    .send({
      ...validProperty,
      ...overrides,
      code: `DARLING-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  expect(res.status).toBe(201);
  return res.body as { id: string; name: string };
}

async function enableStrata(
  accessToken: string,
  propertyId: string,
  body: Record<string, unknown> = {},
) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/strata/enable`)
    .set(authHeader(accessToken))
    .send({ strataPlanNumber: 'SP90001', ...body });
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
  return res.body;
}

async function createActiveStrataProperty(accessToken: string) {
  const property = await createProperty(accessToken);
  await enableStrata(accessToken, property.id);
  const summary = await setLots(accessToken, property.id, [
    { kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 50 },
    { kind: 'new', name: 'Lot 2', code: 'L2', unitsOfEntitlement: 50 },
  ]);
  await completeStrataSetup(accessToken, property.id);
  return { property, lots: summary.lots as Array<{ spaceId: string; code: string }> };
}

async function startFinancialSetup(
  accessToken: string,
  propertyId: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials`)
    .set(authHeader(accessToken))
    .send(body);
}

async function addFund(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/funds`)
    .set(authHeader(accessToken))
    .send(body);
}

async function setLotPositions(accessToken: string, propertyId: string, positions: unknown[]) {
  return request(app)
    .put(`/api/v1/properties/${propertyId}/financials/lot-positions`)
    .set(authHeader(accessToken))
    .send({ positions });
}

async function activateFinancialSetup(accessToken: string, propertyId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/activate`)
    .set(authHeader(accessToken));
}

/** Drives a property all the way through strata + financial onboarding to
 * ACTIVE financial management — the precondition every budget test needs,
 * since a budget can only be created once financial setup is ACTIVE. */
async function createActiveFinancialProperty(accessToken: string) {
  const { property, lots } = await createActiveStrataProperty(accessToken);
  await startFinancialSetup(accessToken, property.id, {
    financialYearStartDate: '2026-07-01',
    financialYearEndDate: '2027-06-30',
    cutoverDate: '2026-10-01',
  });
  await addFund(accessToken, property.id, { fundType: 'ADMINISTRATION' });
  await addFund(accessToken, property.id, { fundType: 'CAPITAL_WORKS' });
  await setLotPositions(
    accessToken,
    property.id,
    lots.map((l) => ({
      spaceId: l.spaceId,
      amountOwing: 0,
      creditBalance: 0,
      asOfDate: '2026-10-01',
    })),
  );
  const activation = await activateFinancialSetup(accessToken, property.id);
  expect(activation.status).toBe(200);
  const funds = activation.body.funds as Array<{ id: string; fundType: string }>;
  return {
    property,
    administrationFundId: funds.find((f) => f.fundType === 'ADMINISTRATION')!.id,
    capitalWorksFundId: funds.find((f) => f.fundType === 'CAPITAL_WORKS')!.id,
  };
}

async function createBudget(
  accessToken: string,
  propertyId: string,
  body: Record<string, unknown> = {},
) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/budgets`)
    .set(authHeader(accessToken))
    .send({
      financialYearStartDate: '2026-07-01',
      financialYearEndDate: '2027-06-30',
      ...body,
    });
}

async function addLine(
  accessToken: string,
  propertyId: string,
  budgetId: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/lines`)
    .set(authHeader(accessToken))
    .send(body);
}

async function updateLine(
  accessToken: string,
  propertyId: string,
  budgetId: string,
  lineId: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .patch(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/lines/${lineId}`)
    .set(authHeader(accessToken))
    .send(body);
}

async function deleteLine(
  accessToken: string,
  propertyId: string,
  budgetId: string,
  lineId: string,
) {
  return request(app)
    .delete(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/lines/${lineId}`)
    .set(authHeader(accessToken));
}

async function approveBudget(
  accessToken: string,
  propertyId: string,
  budgetId: string,
  body: Record<string, unknown> = {},
) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/approve`)
    .set(authHeader(accessToken))
    .send(body);
}

async function activateBudget(accessToken: string, propertyId: string, budgetId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/activate`)
    .set(authHeader(accessToken));
}

async function reviseBudget(
  accessToken: string,
  propertyId: string,
  budgetId: string,
  body: Record<string, unknown> = {},
) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/revise`)
    .set(authHeader(accessToken))
    .send(body);
}

async function getBudget(accessToken: string, propertyId: string, budgetId: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}`)
    .set(authHeader(accessToken));
}

async function listBudgets(accessToken: string, propertyId: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/budgets`)
    .set(authHeader(accessToken));
}

/** Creates a DRAFT budget with one Administration line and one Capital
 * Works line — the common starting point for approve/activate tests. */
async function createDraftBudgetWithLines(
  accessToken: string,
  propertyId: string,
  administrationFundId: string,
  capitalWorksFundId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await createBudget(accessToken, propertyId, overrides);
  expect(res.status).toBe(201);
  const budgetId = res.body.id as string;
  await addLine(accessToken, propertyId, budgetId, {
    financialFundId: administrationFundId,
    category: 'Insurance',
    plannedAmount: 8500,
  });
  await addLine(accessToken, propertyId, budgetId, {
    financialFundId: capitalWorksFundId,
    category: 'Lift replacement reserve',
    plannedAmount: 15000,
  });
  return budgetId;
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

describe('M16.2 Budget Management', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('creation', () => {
    it('rejects creating a budget before financial management is ACTIVE', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveStrataProperty(accessToken);
      const res = await createBudget(accessToken, property.id);
      expect(res.status).toBe(409);
    });

    it('creates a DRAFT v1 budget once financial management is ACTIVE, snapshotting currency', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);

      const res = await createBudget(accessToken, property.id);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.version).toBe(1);
      expect(res.body.source).toBe('CREATED');
      expect(res.body.currencyCode).toBe('AUD');
      expect(res.body.totalBudget).toBe('0.00');
      expect(res.body.publicReference).toMatch(/^BUD-/);
    });

    it('rejects a second create for a financial year that already has a budget', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);
      await createBudget(accessToken, property.id);

      const second = await createBudget(accessToken, property.id);
      expect(second.status).toBe(409);
    });

    it('rejects a period whose length does not match the established financial year cadence', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);

      const res = await createBudget(accessToken, property.id, {
        financialYearStartDate: '2026-07-01',
        financialYearEndDate: '2026-08-01',
      });
      expect(res.status).toBe(422);
    });

    it('rejects a period that overlaps an existing budget financial year', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);
      await createBudget(accessToken, property.id, {
        financialYearStartDate: '2026-07-01',
        financialYearEndDate: '2027-06-30',
      });

      const overlapping = await createBudget(accessToken, property.id, {
        financialYearStartDate: '2027-01-01',
        financialYearEndDate: '2027-12-31',
      });
      expect(overlapping.status).toBe(409);
    });

    it('allows a successive, non-overlapping financial year for the same property', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);
      await createBudget(accessToken, property.id, {
        financialYearStartDate: '2026-07-01',
        financialYearEndDate: '2027-06-30',
      });

      const nextYear = await createBudget(accessToken, property.id, {
        financialYearStartDate: '2027-07-01',
        financialYearEndDate: '2028-06-30',
      });
      expect(nextYear.status).toBe(201);
    });

    it('creates an IMPORTED budget for recording an existing scheme budget during migration', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);

      const res = await createBudget(accessToken, property.id, { source: 'IMPORTED' });
      expect(res.status).toBe(201);
      expect(res.body.source).toBe('IMPORTED');
      expect(res.body.status).toBe('DRAFT');
    });

    it('rejects a property in a different organisation (404, never a 403 leak)', async () => {
      const { accessToken: orgAToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(orgAToken);
      const { accessToken: orgBToken } = await registerAuOrg({ organisationName: 'Other Org' });

      expect((await createBudget(orgBToken, property.id)).status).toBe(404);
      expect((await listBudgets(orgBToken, property.id)).status).toBe(404);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/properties/does-not-matter/financials/budgets');
      expect(res.status).toBe(401);
    });
  });

  describe('capability enforcement', () => {
    it('rejects every budget endpoint for a user without financials.view/manage', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(ownerToken);
      const tenantToken = await createPropertyRoleToken(
        ownerToken,
        organisationId,
        property.id,
        'TENANT',
      );

      expect((await listBudgets(tenantToken, property.id)).status).toBe(403);
      expect((await createBudget(tenantToken, property.id)).status).toBe(403);
    });

    it('financials.view is sufficient to list/read but not to create', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(ownerToken);
      const budgetRes = await createBudget(ownerToken, property.id);
      const ownerRoleToken = await createPropertyRoleToken(
        ownerToken,
        organisationId,
        property.id,
        'OWNER',
      );

      expect((await listBudgets(ownerRoleToken, property.id)).status).toBe(200);
      expect((await getBudget(ownerRoleToken, property.id, budgetRes.body.id)).status).toBe(200);
      expect((await createBudget(ownerRoleToken, property.id)).status).toBe(403);
    });

    it('a PROPERTY_MANAGER (no financials.manage by default) can view but not manage budgets', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(ownerToken);
      const pmToken = await createPropertyRoleToken(
        ownerToken,
        organisationId,
        property.id,
        'PROPERTY_MANAGER',
      );

      expect((await listBudgets(pmToken, property.id)).status).toBe(200);
      expect((await createBudget(pmToken, property.id)).status).toBe(403);
    });
  });

  describe('lines', () => {
    it('adds, updates, and deletes a line on a DRAFT budget, with Decimal-correct totals', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const created = await createBudget(accessToken, property.id);
      const budgetId = created.body.id as string;

      const added = await addLine(accessToken, property.id, budgetId, {
        financialFundId: administrationFundId,
        category: 'Insurance',
        plannedAmount: 1250.33,
      });
      expect(added.status).toBe(201);
      expect(added.body.totalBudget).toBe('1250.33');
      const lineId = added.body.lines[0].id as string;

      const updated = await updateLine(accessToken, property.id, budgetId, lineId, {
        plannedAmount: 1300.67,
      });
      expect(updated.status).toBe(200);
      expect(updated.body.totalBudget).toBe('1300.67');

      const deleted = await deleteLine(accessToken, property.id, budgetId, lineId);
      expect(deleted.status).toBe(200);
      expect(deleted.body.totalBudget).toBe('0.00');
      expect(deleted.body.lines).toHaveLength(0);
    });

    it('sums Decimal-exact totals across many lines, avoiding float drift', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const created = await createBudget(accessToken, property.id);
      const budgetId = created.body.id as string;

      let last;
      for (let i = 0; i < 10; i++) {
        last = await addLine(accessToken, property.id, budgetId, {
          financialFundId: administrationFundId,
          category: `Category ${i}`,
          plannedAmount: 0.1,
        });
      }
      expect(last!.body.totalBudget).toBe('1.00');
    });

    it('allows a $0 line', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const created = await createBudget(accessToken, property.id);

      const res = await addLine(accessToken, property.id, created.body.id, {
        financialFundId: administrationFundId,
        category: 'Legal Fees',
        plannedAmount: 0,
      });
      expect(res.status).toBe(201);
    });

    it('rejects a negative plannedAmount', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const created = await createBudget(accessToken, property.id);

      const res = await addLine(accessToken, property.id, created.body.id, {
        financialFundId: administrationFundId,
        category: 'Insurance',
        plannedAmount: -5,
      });
      expect(res.status).toBe(422);
    });

    it('rejects a fund belonging to a different property (cross-property injection)', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);
      const other = await createActiveFinancialProperty(accessToken);
      const created = await createBudget(accessToken, property.id);

      const res = await addLine(accessToken, property.id, created.body.id, {
        financialFundId: other.administrationFundId,
        category: 'Insurance',
        plannedAmount: 100,
      });
      expect(res.status).toBe(404);
    });

    it('computes totals by fund, grouping lines correctly', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const created = await createBudget(accessToken, property.id);
      const budgetId = created.body.id as string;

      await addLine(accessToken, property.id, budgetId, {
        financialFundId: administrationFundId,
        category: 'Insurance',
        plannedAmount: 8000,
      });
      await addLine(accessToken, property.id, budgetId, {
        financialFundId: administrationFundId,
        category: 'Cleaning',
        plannedAmount: 2000,
      });
      const res = await addLine(accessToken, property.id, budgetId, {
        financialFundId: capitalWorksFundId,
        category: 'Lift reserve',
        plannedAmount: 15000,
      });

      expect(res.body.totalBudget).toBe('25000.00');
      const adminTotal = res.body.totalsByFund.find(
        (t: { financialFundId: string }) => t.financialFundId === administrationFundId,
      );
      const capitalTotal = res.body.totalsByFund.find(
        (t: { financialFundId: string }) => t.financialFundId === capitalWorksFundId,
      );
      expect(adminTotal.total).toBe('10000.00');
      expect(capitalTotal.total).toBe('15000.00');
    });
  });

  describe('approval', () => {
    it('rejects approving a budget with zero lines', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);
      const created = await createBudget(accessToken, property.id);

      const res = await approveBudget(accessToken, property.id, created.body.id);
      expect(res.status).toBe(422);
    });

    it('approves a CREATED budget, recording approvedByUserId/approvedAt and firing FINANCIAL_BUDGET_APPROVED', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const budgetId = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );

      const res = await approveBudget(accessToken, property.id, budgetId);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.approvedByUserId).toBeTruthy();
      expect(res.body.approvedAt).toBeTruthy();

      const activity = await request(app)
        .get(`/api/v1/properties/${property.id}/activity`)
        .set(authHeader(accessToken));
      expect(
        activity.body.items.some(
          (e: { eventType: string }) => e.eventType === 'FINANCIAL_BUDGET_APPROVED',
        ),
      ).toBe(true);
    });

    it('rejects a CREATED budget approval that supplies externalApprovalDate', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const budgetId = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );

      const res = await approveBudget(accessToken, property.id, budgetId, {
        externalApprovalDate: '2026-05-01',
      });
      expect(res.status).toBe(422);
    });

    it('requires externalApprovalDate for an IMPORTED budget and records it without fabricating approvedAt', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const budgetId = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
        { source: 'IMPORTED' },
      );

      const missingDate = await approveBudget(accessToken, property.id, budgetId);
      expect(missingDate.status).toBe(422);

      const res = await approveBudget(accessToken, property.id, budgetId, {
        externalApprovalDate: '2026-05-01',
        externalApprovalReference: 'Approved at AGM, 1 May 2026',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.externalApprovalDate).toBe('2026-05-01');
      expect(res.body.externalApprovalReference).toBe('Approved at AGM, 1 May 2026');
      // approvedAt still gets set — it's WaslProp's own "recorded at" timestamp,
      // distinct from the externally-supplied approval date.
      expect(res.body.approvedAt).toBeTruthy();

      const activity = await request(app)
        .get(`/api/v1/properties/${property.id}/activity`)
        .set(authHeader(accessToken));
      expect(
        activity.body.items.some(
          (e: { eventType: string }) => e.eventType === 'FINANCIAL_BUDGET_IMPORT_RECORDED',
        ),
      ).toBe(true);
    });

    it('rejects editing a line after approval', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const budgetId = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );
      const approved = await approveBudget(accessToken, property.id, budgetId);
      const lineId = approved.body.lines[0].id as string;

      expect(
        (await updateLine(accessToken, property.id, budgetId, lineId, { plannedAmount: 1 })).status,
      ).toBe(409);
      expect((await deleteLine(accessToken, property.id, budgetId, lineId)).status).toBe(409);
      expect(
        (
          await addLine(accessToken, property.id, budgetId, {
            financialFundId: administrationFundId,
            category: 'New',
            plannedAmount: 1,
          })
        ).status,
      ).toBe(409);
    });

    it('rejects approving an already-approved budget', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const budgetId = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );
      await approveBudget(accessToken, property.id, budgetId);
      const second = await approveBudget(accessToken, property.id, budgetId);
      expect(second.status).toBe(409);
    });
  });

  describe('activation', () => {
    it('rejects activating a DRAFT budget (must be APPROVED first)', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const budgetId = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );
      const res = await activateBudget(accessToken, property.id, budgetId);
      expect(res.status).toBe(409);
    });

    it('activates an APPROVED budget and is idempotent when called again', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const budgetId = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );
      await approveBudget(accessToken, property.id, budgetId);

      const res = await activateBudget(accessToken, property.id, budgetId);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.activatedAt).toBeTruthy();

      const again = await activateBudget(accessToken, property.id, budgetId);
      expect(again.status).toBe(200);
      expect(again.body.status).toBe('ACTIVE');

      const activity = await request(app)
        .get(`/api/v1/properties/${property.id}/activity`)
        .set(authHeader(accessToken));
      expect(
        activity.body.items.filter(
          (e: { eventType: string }) => e.eventType === 'FINANCIAL_BUDGET_ACTIVATED',
        ).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('activating a revision supersedes the previously-ACTIVE version — never two ACTIVE at once', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const v1Id = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );
      await approveBudget(accessToken, property.id, v1Id);
      await activateBudget(accessToken, property.id, v1Id);

      const revised = await reviseBudget(accessToken, property.id, v1Id);
      expect(revised.status).toBe(201);
      const v2Id = revised.body.id as string;
      expect(revised.body.version).toBe(2);
      // Lines copied forward from v1.
      expect(revised.body.lines).toHaveLength(2);

      await approveBudget(accessToken, property.id, v2Id);
      const activateV2 = await activateBudget(accessToken, property.id, v2Id);
      expect(activateV2.status).toBe(200);
      expect(activateV2.body.status).toBe('ACTIVE');

      const v1After = await getBudget(accessToken, property.id, v1Id);
      expect(v1After.body.status).toBe('SUPERSEDED');
      expect(v1After.body.supersededAt).toBeTruthy();

      const list = await listBudgets(accessToken, property.id);
      const activeBudgets = list.body.items.filter(
        (b: { status: string }) => b.status === 'ACTIVE',
      );
      expect(activeBudgets).toHaveLength(1);
      expect(activeBudgets[0].id).toBe(v2Id);
    });

    it('concurrent activation of two approved versions for the same financial year ends with exactly one ACTIVE', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const v1Id = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );
      await approveBudget(accessToken, property.id, v1Id);
      const revised = await reviseBudget(accessToken, property.id, v1Id);
      const v2Id = revised.body.id as string;
      await approveBudget(accessToken, property.id, v2Id);

      const [first, second] = await Promise.all([
        activateBudget(accessToken, property.id, v1Id),
        activateBudget(accessToken, property.id, v2Id),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);

      const list = await listBudgets(accessToken, property.id);
      const activeBudgets = list.body.items.filter(
        (b: { status: string }) => b.status === 'ACTIVE',
      );
      expect(activeBudgets).toHaveLength(1);

      const dbActiveCount = await testPrisma.financialBudget.count({
        where: { propertyId: property.id, status: 'ACTIVE' },
      });
      expect(dbActiveCount).toBe(1);
    });

    it('concurrent double-activation of the same budget stays safe and ends ACTIVE exactly once', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const budgetId = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );
      await approveBudget(accessToken, property.id, budgetId);

      const [first, second] = await Promise.all([
        activateBudget(accessToken, property.id, budgetId),
        activateBudget(accessToken, property.id, budgetId),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);

      const dbActiveCount = await testPrisma.financialBudget.count({
        where: { propertyId: property.id, status: 'ACTIVE' },
      });
      expect(dbActiveCount).toBe(1);
    });
  });

  describe('revision / versioning', () => {
    it('rejects revising a DRAFT budget', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);
      const created = await createBudget(accessToken, property.id);

      const res = await reviseBudget(accessToken, property.id, created.body.id);
      expect(res.status).toBe(409);
    });

    it('rejects revising a SUPERSEDED budget', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const v1Id = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );
      await approveBudget(accessToken, property.id, v1Id);
      await activateBudget(accessToken, property.id, v1Id);
      const v2 = await reviseBudget(accessToken, property.id, v1Id);
      await approveBudget(accessToken, property.id, v2.body.id);
      await activateBudget(accessToken, property.id, v2.body.id);

      const res = await reviseBudget(accessToken, property.id, v1Id);
      expect(res.status).toBe(409);
    });

    it('never mutates the source budget when a revision is created', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const v1Id = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );
      await approveBudget(accessToken, property.id, v1Id);
      const before = await getBudget(accessToken, property.id, v1Id);

      await reviseBudget(accessToken, property.id, v1Id);

      const after = await getBudget(accessToken, property.id, v1Id);
      expect(after.body).toEqual(before.body);
    });

    it('deterministic version numbering under concurrent revise calls — no duplicate versions', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const v1Id = await createDraftBudgetWithLines(
        accessToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );
      await approveBudget(accessToken, property.id, v1Id);
      await activateBudget(accessToken, property.id, v1Id);

      const [first, second] = await Promise.all([
        reviseBudget(accessToken, property.id, v1Id),
        reviseBudget(accessToken, property.id, v1Id),
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);
      const versions = [first.body.version, second.body.version].sort();
      expect(versions).toEqual([2, 3]);

      const list = await listBudgets(accessToken, property.id);
      const allVersions = list.body.items.map((b: { version: number }) => b.version).sort();
      expect(allVersions).toEqual([1, 2, 3]);
    });
  });

  describe('multi-tenancy / IDOR', () => {
    it('a budget in a different organisation is reported as 404', async () => {
      const { accessToken: orgAToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(orgAToken);
      const budgetId = await createDraftBudgetWithLines(
        orgAToken,
        property.id,
        administrationFundId,
        capitalWorksFundId,
      );
      const { accessToken: orgBToken } = await registerAuOrg({ organisationName: 'Other Org' });

      expect((await getBudget(orgBToken, property.id, budgetId)).status).toBe(404);
      expect((await approveBudget(orgBToken, property.id, budgetId)).status).toBe(404);
      expect((await activateBudget(orgBToken, property.id, budgetId)).status).toBe(404);
    });
  });
});
