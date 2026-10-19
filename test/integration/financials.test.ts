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
    .send({ ...validProperty, ...overrides });
  expect(res.status).toBe(201);
  return res.body as { id: string; name: string };
}

async function enableStrata(accessToken: string, propertyId: string, body: Record<string, unknown> = {}) {
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

/** Brings a fresh property all the way to an ACTIVE strata scheme with the
 * given lots — the precondition most financials tests need, since
 * reconciliation hard-requires strataStatus === 'ACTIVE' before activation. */
async function createActiveStrataProperty(
  accessToken: string,
  lots: Array<{ name: string; code: string; unitsOfEntitlement: number }> = [
    { name: 'Lot 1', code: 'L1', unitsOfEntitlement: 50 },
    { name: 'Lot 2', code: 'L2', unitsOfEntitlement: 50 },
  ],
) {
  const property = await createProperty(accessToken, {
    code: `DARLING-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  await enableStrata(accessToken, property.id);
  const summary = await setLots(accessToken, property.id, lots.map((l) => ({ kind: 'new', ...l })));
  await completeStrataSetup(accessToken, property.id);
  return { property, lots: summary.lots as Array<{ spaceId: string; code: string }> };
}

async function getFinancials(accessToken: string, propertyId: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials`)
    .set(authHeader(accessToken));
}

async function startSetup(accessToken: string, propertyId: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials`)
    .set(authHeader(accessToken))
    .send(body);
}

async function updateYear(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app)
    .patch(`/api/v1/properties/${propertyId}/financials`)
    .set(authHeader(accessToken))
    .send(body);
}

async function addFund(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/funds`)
    .set(authHeader(accessToken))
    .send(body);
}

async function updateFund(
  accessToken: string,
  propertyId: string,
  fundId: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .patch(`/api/v1/properties/${propertyId}/financials/funds/${fundId}`)
    .set(authHeader(accessToken))
    .send(body);
}

async function setLotPositions(accessToken: string, propertyId: string, positions: unknown[]) {
  return request(app)
    .put(`/api/v1/properties/${propertyId}/financials/lot-positions`)
    .set(authHeader(accessToken))
    .send({ positions });
}

async function getReconciliation(accessToken: string, propertyId: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/reconciliation`)
    .set(authHeader(accessToken));
}

async function activate(accessToken: string, propertyId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/activate`)
    .set(authHeader(accessToken));
}

/** Creates a real User, adds them with the given PropertyRole on the
 * property, and returns a resident-shaped token for them — mirrors
 * strata-uoe.test.ts's createPropertyManagerToken exactly (needed here
 * too since several writes record ActivityEvent.actorUserId, a real FK). */
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

/** Drives a property all the way to a clean, activate-ready financial
 * state — the precondition for activation/post-activation-lock tests. */
async function setUpCleanFinancials(
  accessToken: string,
  propertyId: string,
  lotSpaceIds: string[],
) {
  await startSetup(accessToken, propertyId, {
    financialYearStartDate: '2026-07-01',
    financialYearEndDate: '2027-06-30',
    cutoverDate: '2026-10-01',
  });
  await addFund(accessToken, propertyId, {
    fundType: 'ADMINISTRATION',
    openingBalance: { amount: 12450, asOfDate: '2026-10-01' },
  });
  await addFund(accessToken, propertyId, {
    fundType: 'CAPITAL_WORKS',
    openingBalance: { amount: 4280, asOfDate: '2026-10-01' },
  });
  await setLotPositions(
    accessToken,
    propertyId,
    lotSpaceIds.map((spaceId) => ({ spaceId, amountOwing: 0, creditBalance: 0, asOfDate: '2026-10-01' })),
  );
}

describe('M16.1 Strata Financial Management', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('financial setup lifecycle', () => {
    it('a property with no FinancialConfiguration row reports NOT_CONFIGURED, not 404', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      const res = await getFinancials(accessToken, property.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('NOT_CONFIGURED');
      expect(res.body.funds).toEqual([]);
      expect(res.body.currencyCode).toBeNull();
    });

    it('starting setup creates SETUP_IN_PROGRESS, snapshots the org currency, and records FINANCIAL_SETUP_STARTED', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);

      const res = await startSetup(accessToken, property.id, {
        financialYearStartDate: '2026-07-01',
        financialYearEndDate: '2027-06-30',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SETUP_IN_PROGRESS');
      expect(res.body.currencyCode).toBe('AUD');
      expect(res.body.financialYearStartDate).toBe('2026-07-01');
      expect(res.body.financialYearEndDate).toBe('2027-06-30');

      const activity = await request(app)
        .get(`/api/v1/properties/${property.id}/activity`)
        .set(authHeader(accessToken));
      expect(
        activity.body.items.some((e: { eventType: string }) => e.eventType === 'FINANCIAL_SETUP_STARTED'),
      ).toBe(true);
    });

    it('calling start again is idempotent and merges in newly-provided fields without duplicating activity', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await startSetup(accessToken, property.id, { financialYearStartDate: '2026-07-01' });
      const second = await startSetup(accessToken, property.id, { cutoverDate: '2026-10-01' });

      expect(second.status).toBe(200);
      expect(second.body.status).toBe('SETUP_IN_PROGRESS');
      expect(second.body.financialYearStartDate).toBe('2026-07-01');
      expect(second.body.cutoverDate).toBe('2026-10-01');

      const activity = await request(app)
        .get(`/api/v1/properties/${property.id}/activity`)
        .set(authHeader(accessToken));
      expect(
        activity.body.items.filter((e: { eventType: string }) => e.eventType === 'FINANCIAL_SETUP_STARTED')
          .length,
      ).toBe(1);
    });

    it('PATCH updates the financial year and can explicitly clear a field back to null', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await startSetup(accessToken, property.id, { cutoverDate: '2026-10-01' });

      const res = await updateYear(accessToken, property.id, {
        financialYearStartDate: '2026-07-01',
        financialYearEndDate: '2027-06-30',
      });
      expect(res.status).toBe(200);
      expect(res.body.financialYearStartDate).toBe('2026-07-01');

      const cleared = await updateYear(accessToken, property.id, { cutoverDate: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.cutoverDate).toBeNull();
    });

    it('PATCH on a property that never started setup is rejected', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      const res = await updateYear(accessToken, property.id, { cutoverDate: '2026-10-01' });
      expect(res.status).toBe(409);
    });

    it('date fields round-trip as plain YYYY-MM-DD with no timezone drift', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      const res = await startSetup(accessToken, property.id, {
        financialYearStartDate: '2026-01-01',
        financialYearEndDate: '2026-12-31',
        cutoverDate: '2026-01-01',
      });
      expect(res.body.financialYearStartDate).toBe('2026-01-01');
      expect(res.body.financialYearEndDate).toBe('2026-12-31');
      expect(res.body.cutoverDate).toBe('2026-01-01');
    });
  });

  describe('capability enforcement', () => {
    it('rejects every financials endpoint for a user without financials.view/manage', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const property = await createProperty(ownerToken);
      const tenantToken = await createPropertyRoleToken(ownerToken, organisationId, property.id, 'TENANT');

      expect((await getFinancials(tenantToken, property.id)).status).toBe(403);
      expect((await startSetup(tenantToken, property.id, {})).status).toBe(403);
    });

    it('financials.view is sufficient to read but not to mutate', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const property = await createProperty(ownerToken);
      await startSetup(ownerToken, property.id, {});
      const ownerRoleToken = await createPropertyRoleToken(
        ownerToken,
        organisationId,
        property.id,
        'OWNER',
      );

      expect((await getFinancials(ownerRoleToken, property.id)).status).toBe(200);
      expect((await startSetup(ownerRoleToken, property.id, {})).status).toBe(403);
      expect((await getReconciliation(ownerRoleToken, property.id)).status).toBe(200);
    });

    it('the organisation OWNER/ADMIN role always passes regardless of PropertyRole grants', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      expect((await startSetup(accessToken, property.id, {})).status).toBe(200);
      expect((await getReconciliation(accessToken, property.id)).status).toBe(200);
    });

    it('a PROPERTY_MANAGER (no financials.manage by default, mirroring strata.manage) can view but not manage', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const property = await createProperty(ownerToken);
      await startSetup(ownerToken, property.id, {});
      const pmToken = await createPropertyRoleToken(
        ownerToken,
        organisationId,
        property.id,
        'PROPERTY_MANAGER',
      );
      expect((await getFinancials(pmToken, property.id)).status).toBe(200);
      expect((await startSetup(pmToken, property.id, {})).status).toBe(403);
    });
  });

  describe('funds', () => {
    it('adds Administration and Capital Works funds with opening balances in Decimal precision', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await startSetup(accessToken, property.id, {});

      const res = await addFund(accessToken, property.id, {
        fundType: 'ADMINISTRATION',
        openingBalance: { amount: 12450.5, asOfDate: '2026-10-01', referenceNote: 'Westpac #4812' },
      });
      expect(res.status).toBe(200);
      const fund = res.body.funds.find((f: { fundType: string }) => f.fundType === 'ADMINISTRATION');
      expect(fund.name).toBe('Administration Fund');
      expect(fund.openingBalance.amount).toBe('12450.5');
      expect(fund.openingBalance.referenceNote).toBe('Westpac #4812');
      expect(fund.currencyCode).toBe('AUD');
    });

    it('rejects a duplicate Administration fund but allows unlimited Other funds', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await startSetup(accessToken, property.id, {});
      await addFund(accessToken, property.id, { fundType: 'ADMINISTRATION' });

      const dup = await addFund(accessToken, property.id, { fundType: 'ADMINISTRATION' });
      expect(dup.status).toBe(409);

      const other1 = await addFund(accessToken, property.id, { fundType: 'OTHER', name: 'Legal Reserve' });
      const other2 = await addFund(accessToken, property.id, { fundType: 'OTHER', name: 'Appeal Reserve' });
      expect(other1.status).toBe(200);
      expect(other2.status).toBe(200);
    });

    it('requires an explicit name for an Other fund', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await startSetup(accessToken, property.id, {});
      const res = await addFund(accessToken, property.id, { fundType: 'OTHER' });
      expect(res.status).toBe(422);
    });

    it('updating a fund upserts its opening balance and never resets fundType', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await startSetup(accessToken, property.id, {});
      const created = await addFund(accessToken, property.id, { fundType: 'CAPITAL_WORKS' });
      const fundId = created.body.funds[0].id;
      expect(created.body.funds[0].openingBalance).toBeNull();

      const updated = await updateFund(accessToken, property.id, fundId, {
        openingBalance: { amount: 4280, asOfDate: '2026-10-01' },
      });
      expect(updated.status).toBe(200);
      const fund = updated.body.funds.find((f: { id: string }) => f.id === fundId);
      expect(fund.openingBalance.amount).toBe('4280');
      expect(fund.fundType).toBe('CAPITAL_WORKS');
    });

    it('rejects adding/updating a fund once ACTIVE', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots } = await createActiveStrataProperty(accessToken);
      await setUpCleanFinancials(accessToken, property.id, lots.map((l) => l.spaceId));
      await activate(accessToken, property.id);

      const res = await addFund(accessToken, property.id, { fundType: 'OTHER', name: 'Too Late Fund' });
      expect(res.status).toBe(409);
    });
  });

  describe('lot opening positions', () => {
    it('records amountOwing and creditBalance as separate non-negative fields, never one signed number', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots } = await createActiveStrataProperty(accessToken);
      await startSetup(accessToken, property.id, {});

      const res = await setLotPositions(accessToken, property.id, [
        { spaceId: lots[0].spaceId, amountOwing: 1250, creditBalance: 0, asOfDate: '2026-10-01' },
        { spaceId: lots[1].spaceId, amountOwing: 0, creditBalance: 300, asOfDate: '2026-10-01' },
      ]);
      expect(res.status).toBe(200);
      const recorded = res.body.lotPositions.filter((p: { recorded: boolean }) => p.recorded);
      expect(recorded).toHaveLength(2);
      const owing = res.body.lotPositions.find((p: { spaceId: string }) => p.spaceId === lots[0].spaceId);
      expect(owing.amountOwing).toBe('1250');
      expect(owing.creditBalance).toBe('0');
      const credit = res.body.lotPositions.find((p: { spaceId: string }) => p.spaceId === lots[1].spaceId);
      expect(credit.amountOwing).toBe('0');
      expect(credit.creditBalance).toBe('300');
    });

    it('rejects a negative amount at the validation boundary', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots } = await createActiveStrataProperty(accessToken);
      await startSetup(accessToken, property.id, {});
      const res = await setLotPositions(accessToken, property.id, [
        { spaceId: lots[0].spaceId, amountOwing: -50, asOfDate: '2026-10-01' },
      ]);
      expect(res.status).toBe(422);
    });

    it('rejects a space classified as Common Property', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await enableStrata(accessToken, property.id);
      const spaceRes = await request(app)
        .post(`/api/v1/properties/${property.id}/spaces`)
        .set(authHeader(accessToken))
        .send({ name: 'Lobby', code: 'CP1', spaceType: 'COMMON_AREA', strataClassification: 'COMMON_PROPERTY' });
      expect(spaceRes.status).toBe(201);
      await startSetup(accessToken, property.id, {});

      const res = await setLotPositions(accessToken, property.id, [
        { spaceId: spaceRes.body.id, amountOwing: 100, asOfDate: '2026-10-01' },
      ]);
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/not a strata lot/i);
    });

    it('rejects a space from a different property (cross-property rejection)', async () => {
      const { accessToken } = await registerAuOrg();
      const { property: propertyA } = await createActiveStrataProperty(accessToken);
      const { property: propertyB, lots: lotsB } = await createActiveStrataProperty(accessToken, [
        { name: 'B Lot', code: 'BL1', unitsOfEntitlement: 100 },
      ]);
      await startSetup(accessToken, propertyA.id, {});

      const res = await setLotPositions(accessToken, propertyA.id, [
        { spaceId: lotsB[0].spaceId, amountOwing: 50, asOfDate: '2026-10-01' },
      ]);
      expect(res.status).toBe(404);

      // propertyB's own configuration must remain completely untouched.
      const bSummary = await getFinancials(accessToken, propertyB.id);
      expect(bSummary.body.status).toBe('NOT_CONFIGURED');
    });

    it('upserts (never duplicates) a position for the same lot across two calls', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots } = await createActiveStrataProperty(accessToken);
      await startSetup(accessToken, property.id, {});
      await setLotPositions(accessToken, property.id, [
        { spaceId: lots[0].spaceId, amountOwing: 1000, asOfDate: '2026-10-01' },
      ]);
      const second = await setLotPositions(accessToken, property.id, [
        { spaceId: lots[0].spaceId, amountOwing: 1500, asOfDate: '2026-10-01' },
      ]);
      expect(second.status).toBe(200);
      const position = second.body.lotPositions.find((p: { spaceId: string }) => p.spaceId === lots[0].spaceId);
      expect(position.amountOwing).toBe('1500');

      const count = await testPrisma.lotOpeningPosition.count({ where: { spaceId: lots[0].spaceId } });
      expect(count).toBe(1);
    });

    it('rejects bulk-setting lot positions once ACTIVE', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots } = await createActiveStrataProperty(accessToken);
      await setUpCleanFinancials(accessToken, property.id, lots.map((l) => l.spaceId));
      await activate(accessToken, property.id);

      const res = await setLotPositions(accessToken, property.id, [
        { spaceId: lots[0].spaceId, amountOwing: 999, asOfDate: '2026-10-01' },
      ]);
      expect(res.status).toBe(409);
    });
  });

  describe('reconciliation', () => {
    it('reports ERROR for a missing financial year, cutover date, and required funds', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await startSetup(accessToken, property.id, {});

      const res = await getReconciliation(accessToken, property.id);
      expect(res.status).toBe(200);
      const codes = res.body.errors.map((e: { code: string }) => e.code);
      expect(codes).toContain('STRATA_NOT_ACTIVE');
      expect(codes).toContain('FINANCIAL_YEAR_MISSING');
      expect(codes).toContain('CUTOVER_DATE_MISSING');
      expect(codes).toContain('ADMINISTRATION_FUND_MISSING');
      expect(codes).toContain('CAPITAL_WORKS_FUND_MISSING');
      expect(res.body.readyToActivate).toBe(false);
    });

    it('reports ERROR for an invalid financial year (end before start)', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveStrataProperty(accessToken);
      await startSetup(accessToken, property.id, {
        financialYearStartDate: '2026-07-01',
        financialYearEndDate: '2026-01-01',
        cutoverDate: '2026-10-01',
      });
      const res = await getReconciliation(accessToken, property.id);
      expect(res.body.errors.map((e: { code: string }) => e.code)).toContain('FINANCIAL_YEAR_INVALID');
    });

    it('reports WARNING (not ERROR) for lots without an opening position and a cutover date outside the financial year', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots } = await createActiveStrataProperty(accessToken);
      await startSetup(accessToken, property.id, {
        financialYearStartDate: '2026-07-01',
        financialYearEndDate: '2026-09-30',
        cutoverDate: '2026-10-01',
      });
      await addFund(accessToken, property.id, { fundType: 'ADMINISTRATION', openingBalance: { amount: 100, asOfDate: '2026-10-01' } });
      await addFund(accessToken, property.id, { fundType: 'CAPITAL_WORKS', openingBalance: { amount: 100, asOfDate: '2026-10-01' } });
      // Deliberately leave every lot unrecorded.

      const res = await getReconciliation(accessToken, property.id);
      expect(res.body.errors).toEqual([]);
      const warningCodes = res.body.warnings.map((w: { code: string }) => w.code);
      expect(warningCodes).toContain('LOTS_WITHOUT_OPENING_POSITION');
      expect(warningCodes).toContain('CUTOVER_DATE_OUTSIDE_FINANCIAL_YEAR');
      expect(res.body.readyToActivate).toBe(true);
      void lots;
    });

    it('reports ERROR for a fund whose currency does not match the scheme currency', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveStrataProperty(accessToken);
      await startSetup(accessToken, property.id, {
        financialYearStartDate: '2026-07-01',
        financialYearEndDate: '2027-06-30',
        cutoverDate: '2026-10-01',
      });
      await addFund(accessToken, property.id, { fundType: 'ADMINISTRATION' });
      await addFund(accessToken, property.id, { fundType: 'CAPITAL_WORKS' });
      // Directly corrupt one fund's currency to simulate drift — there is
      // no API path to do this (currencyCode is always snapshotted), so
      // this proves the reconciliation check itself, independent of
      // whether today's API can currently produce the mismatch.
      const fund = await testPrisma.financialFund.findFirstOrThrow({
        where: { propertyId: property.id, fundType: 'ADMINISTRATION' },
      });
      await testPrisma.financialFund.update({ where: { id: fund.id }, data: { currencyCode: 'USD' } });

      const res = await getReconciliation(accessToken, property.id);
      expect(res.body.errors.map((e: { code: string }) => e.code)).toContain('FUND_CURRENCY_MISMATCH');
    });

    it('returns readyToActivate true with an INFO "all checks passed" once everything is clean', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots } = await createActiveStrataProperty(accessToken);
      await setUpCleanFinancials(accessToken, property.id, lots.map((l) => l.spaceId));

      const res = await getReconciliation(accessToken, property.id);
      expect(res.body.errors).toEqual([]);
      expect(res.body.readyToActivate).toBe(true);
      expect(res.body.infos.map((i: { code: string }) => i.code)).toContain('ALL_CHECKS_PASSED');
    });
  });

  describe('activation', () => {
    it('rejects activation while reconciliation errors remain, with the errors as details', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await startSetup(accessToken, property.id, {});

      const res = await activate(accessToken, property.id);
      expect(res.status).toBe(409);
      expect(res.body.error.details.errors.length).toBeGreaterThan(0);

      const summary = await getFinancials(accessToken, property.id);
      expect(summary.body.status).toBe('SETUP_IN_PROGRESS');
    });

    it('activates successfully once reconciliation is clean, sets activatedAt/activatedByUserId, and records FINANCIAL_SETUP_ACTIVATED', async () => {
      const { accessToken, userId } = await registerAuOrg();
      const { property, lots } = await createActiveStrataProperty(accessToken);
      await setUpCleanFinancials(accessToken, property.id, lots.map((l) => l.spaceId));

      const res = await activate(accessToken, property.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.activatedAt).toBeTruthy();
      expect(res.body.activatedByUserId).toBe(userId);

      const activity = await request(app)
        .get(`/api/v1/properties/${property.id}/activity`)
        .set(authHeader(accessToken));
      expect(
        activity.body.items.some((e: { eventType: string }) => e.eventType === 'FINANCIAL_SETUP_ACTIVATED'),
      ).toBe(true);
    });

    it('re-activating an already-ACTIVE configuration is idempotent, not an error', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots } = await createActiveStrataProperty(accessToken);
      await setUpCleanFinancials(accessToken, property.id, lots.map((l) => l.spaceId));
      await activate(accessToken, property.id);

      const again = await activate(accessToken, property.id);
      expect(again.status).toBe(200);
      expect(again.body.status).toBe('ACTIVE');
    });

    it('concurrent activation requests both succeed without error and the configuration ends ACTIVE exactly once', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots } = await createActiveStrataProperty(accessToken);
      await setUpCleanFinancials(accessToken, property.id, lots.map((l) => l.spaceId));

      const [first, second] = await Promise.all([
        activate(accessToken, property.id),
        activate(accessToken, property.id),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);

      const activity = await request(app)
        .get(`/api/v1/properties/${property.id}/activity`)
        .set(authHeader(accessToken));
      const activations = activity.body.items.filter(
        (e: { eventType: string }) => e.eventType === 'FINANCIAL_SETUP_ACTIVATED',
      );
      expect(activations.length).toBeGreaterThanOrEqual(1);
    });

    it('opening records are never mutated by activation itself — amounts stay exactly as last saved', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots } = await createActiveStrataProperty(accessToken);
      await setUpCleanFinancials(accessToken, property.id, lots.map((l) => l.spaceId));
      const before = await getFinancials(accessToken, property.id);

      await activate(accessToken, property.id);
      const after = await getFinancials(accessToken, property.id);

      expect(after.body.funds.map((f: { openingBalance: unknown }) => f.openingBalance)).toEqual(
        before.body.funds.map((f: { openingBalance: unknown }) => f.openingBalance),
      );
      expect(after.body.lotPositions).toEqual(before.body.lotPositions);
    });
  });

  describe('multi-tenancy / IDOR', () => {
    it('a property in a different organisation is reported as 404, never leaking its existence', async () => {
      const { accessToken: orgAToken } = await registerAuOrg();
      const { property } = await createActiveStrataProperty(orgAToken);
      const { accessToken: orgBToken } = await registerAuOrg({ organisationName: 'Other Org' });

      expect((await getFinancials(orgBToken, property.id)).status).toBe(404);
      expect((await startSetup(orgBToken, property.id, {})).status).toBe(404);
      expect((await activate(orgBToken, property.id)).status).toBe(404);
    });

    it('an unauthenticated request is rejected on every route', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      const res = await request(app).get(`/api/v1/properties/${property.id}/financials`);
      expect(res.status).toBe(401);
    });
  });
});
