import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { waslSignServiceMock } = vi.hoisted(() => ({
  waslSignServiceMock: {
    isConfigured: vi.fn(() => true),
    provisionOrganisation: vi.fn(async () => '999'),
    createAgreementWorkflow: vi.fn(async () => ({
      agreementId: 'agr_1',
      status: 'in_progress',
      created: true,
    })),
    getWorkflowStatus: vi.fn(),
    cancelWorkflow: vi.fn(),
  },
}));

vi.mock('../../src/lib/waslSign.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/waslSign.js')>();
  return { ...actual, waslSignService: waslSignServiceMock };
});

import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import {
  authHeader,
  createPlainUser,
  registerTestUser,
  residentAccessToken,
} from '../helpers/auth.js';

const app = createApp();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const validProperty = {
  name: 'Marina Heights',
  addressLine1: '1 Marina Blvd',
  city: 'Dubai',
  country: 'UAE',
  propertyType: 'MIXED_USE',
};
const validSpace = { name: 'Apartment 1204', spaceType: 'APARTMENT' };

let propertyCodeCounter = 0;

async function setupPropertyAndSpace(accessToken: string) {
  const code = `MARINA-${++propertyCodeCounter}`;
  const propertyRes = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(accessToken))
    .send({ ...validProperty, code });
  const spaceRes = await request(app)
    .post(`/api/v1/properties/${propertyRes.body.id}/spaces`)
    .set(authHeader(accessToken))
    .send({ ...validSpace, code: '1204' });
  return { propertyId: propertyRes.body.id as string, spaceId: spaceRes.body.id as string };
}

async function createRequest(
  accessToken: string,
  propertyId: string,
  spaceId: string,
  overrides: Partial<{ category: string; priority: string }> = {},
) {
  const res = await request(app)
    .post('/api/v1/maintenance-requests')
    .set(authHeader(accessToken))
    .send({
      title: 'Bedroom AC leaking',
      description: 'Leaking and not cooling.',
      category: overrides.category ?? 'HVAC',
      priority: overrides.priority ?? 'HIGH',
      propertyId,
      spaceId,
    });
  return res.body.id as string;
}

async function createWorkOrderFor(accessToken: string, maintenanceRequestId: string) {
  const res = await request(app).post('/api/v1/work-orders').set(authHeader(accessToken)).send({
    maintenanceRequestId,
    title: 'Repair leaking AC unit',
    description: 'Replace the drain pan and re-seal the unit.',
    priority: 'HIGH',
  });
  return res.body.id as string;
}

async function createQuoteFor(
  accessToken: string,
  workOrderId: string,
  amount = 7500,
  contractorEmail = `ops+${Date.now()}-${Math.random().toString(36).slice(2)}@acmehvac.com`,
) {
  const contractorRes = await request(app)
    .post('/api/v1/contractors')
    .set(authHeader(accessToken))
    .send({ name: 'Acme HVAC', email: contractorEmail, tradeTypes: ['HVAC'] });
  const quoteRes = await request(app)
    .post('/api/v1/quotes')
    .set(authHeader(accessToken))
    .send({ workOrderId, contractorId: contractorRes.body.id, amount, description: 'HVAC repair' });
  return quoteRes.body.id as string;
}

async function fullFixture(accessToken: string) {
  const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);
  const maintenanceRequestId = await createRequest(accessToken, propertyId, spaceId);
  const workOrderId = await createWorkOrderFor(accessToken, maintenanceRequestId);
  return { propertyId, spaceId, maintenanceRequestId, workOrderId };
}

describe('dashboard', () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    waslSignServiceMock.isConfigured.mockReturnValue(true);
    waslSignServiceMock.provisionOrganisation.mockResolvedValue('999');
    waslSignServiceMock.createAgreementWorkflow.mockResolvedValue({
      agreementId: 'agr_1',
      status: 'in_progress',
      created: true,
    });
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('auth / authz', () => {
    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/dashboard');
      expect(res.status).toBe(401);
    });

    it('denies resident access', async () => {
      const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
      const resident = await createPlainUser();
      await request(app)
        .post(`/api/v1/properties/${propertyId}/memberships`)
        .set(authHeader(ownerToken))
        .send({
          email: resident.email,
          firstName: 'Resi',
          lastName: 'Dent',
          role: 'TENANT',
          spaceId,
        });
      const contact = await testPrisma.propertyContact.findFirst({
        where: { email: resident.email },
      });
      const residentToken = residentAccessToken(resident.userId, organisationId, contact!.id);

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(residentToken));
      expect(res.status).toBe(403);
    });

    it('allows an OWNER (and, identically, an ADMIN) to fetch the dashboard', async () => {
      const { accessToken } = await registerTestUser(app);
      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      expect(res.status).toBe(200);
    });
  });

  describe('validation', () => {
    it('rejects an invalid period', async () => {
      const { accessToken } = await registerTestUser(app);
      const res = await request(app)
        .get('/api/v1/dashboard?period=90d')
        .set(authHeader(accessToken));
      expect(res.status).toBe(422);
    });

    it('defaults to a 30-day period when none is given', async () => {
      const { accessToken } = await registerTestUser(app);
      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.period).toBe('30d');
    });

    it('accepts an explicit 7-day period', async () => {
      const { accessToken } = await registerTestUser(app);
      const res = await request(app)
        .get('/api/v1/dashboard?period=7d')
        .set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.period).toBe('7d');
      expect(res.body.trend.points).toHaveLength(7);
    });
  });

  describe('empty organisation', () => {
    it('returns real zeros/nulls/empty arrays, never fake data or NaN', async () => {
      const { accessToken } = await registerTestUser(app);
      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.metrics).toEqual({
        openRequests: 0,
        activeWorkOrders: 0,
        completedThisPeriod: 0,
        pendingSignature: 0,
      });
      expect(res.body.portfolio).toEqual({
        totalProperties: 0,
        totalSpaces: 0,
        occupiedSpaces: 0,
        vacantSpaces: 0,
        occupancyRatePct: 0,
      });
      expect(res.body.attention.items).toEqual([]);
      expect(res.body.attention.totalCount).toBe(0);
      expect(res.body.recentActivity).toEqual([]);
      expect(res.body.averageResolutionHours).toBeNull();
      expect(res.body.trend.points).toHaveLength(30);
      expect(
        res.body.trend.points.every(
          (p: { created: number; completed: number }) => p.created === 0 && p.completed === 0,
        ),
      ).toBe(true);
      // Every status enum value is present, at zero — not just the ones seen.
      expect(res.body.requestsSnapshot.byStatus).toHaveLength(6);
      expect(
        res.body.requestsSnapshot.byStatus.every((s: { count: number }) => s.count === 0),
      ).toBe(true);
    });
  });

  describe('organisation isolation', () => {
    it('never leaks another organisation’s data into any part of the response', async () => {
      const orgA = await registerTestUser(app);
      const orgB = await registerTestUser(app);

      // Org A: one open urgent request, one active work order, one pending-signature quote, some activity.
      const fixtureA = await fullFixture(orgA.accessToken);
      await createRequest(orgA.accessToken, fixtureA.propertyId, fixtureA.spaceId, {
        priority: 'URGENT',
      });
      const quoteIdA = await createQuoteFor(orgA.accessToken, fixtureA.workOrderId);
      await request(app)
        .patch(`/api/v1/quotes/${quoteIdA}/workflow-mode`)
        .set(authHeader(orgA.accessToken))
        .send({ workflowMode: 'SIGNATURE_ONLY' });

      // Org B: distinct data.
      const fixtureB = await fullFixture(orgB.accessToken);
      await createRequest(orgB.accessToken, fixtureB.propertyId, fixtureB.spaceId);

      const resA = await request(app).get('/api/v1/dashboard').set(authHeader(orgA.accessToken));
      const resB = await request(app).get('/api/v1/dashboard').set(authHeader(orgB.accessToken));

      expect(resA.body.organisation.id).toBe(orgA.organisationId);
      expect(resB.body.organisation.id).toBe(orgB.organisationId);

      // Org A sees its own urgent request + pending signature; org B sees none of it.
      expect(resA.body.metrics.pendingSignature).toBe(1);
      expect(resB.body.metrics.pendingSignature).toBe(0);
      expect(resA.body.metrics.openRequests).toBe(2); // the fixture request + the urgent one
      expect(resB.body.metrics.openRequests).toBe(2); // the fixture request + the extra one

      expect(resA.body.portfolio.totalProperties).toBe(1);
      expect(resB.body.portfolio.totalProperties).toBe(1);

      // Recent activity never crosses orgs.
      const activityOrgIds = new Set(
        (resA.body.recentActivity as Array<{ organisationId: string }>).map(
          (a) => a.organisationId,
        ),
      );
      expect([...activityOrgIds]).toEqual([orgA.organisationId]);

      // Attention items never cross orgs — org A has an urgent item, org B doesn't.
      expect(
        resA.body.attention.items.some((i: { type: string }) => i.type === 'URGENT_REQUEST_OPEN'),
      ).toBe(false); // not yet aged past 4h
      expect(resB.body.attention.items).toEqual([]);
    });
  });

  describe('metrics correctness', () => {
    it('computes openRequests, activeWorkOrders, completedThisPeriod and pendingSignature exactly', async () => {
      const { accessToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);

      // Two open requests, one resolved (not open).
      await createRequest(accessToken, propertyId, spaceId);
      await createRequest(accessToken, propertyId, spaceId);
      const resolvedReqId = await createRequest(accessToken, propertyId, spaceId);
      await request(app)
        .patch(`/api/v1/maintenance-requests/${resolvedReqId}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'UNDER_REVIEW' });
      await request(app)
        .patch(`/api/v1/maintenance-requests/${resolvedReqId}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'IN_PROGRESS' });
      await request(app)
        .patch(`/api/v1/maintenance-requests/${resolvedReqId}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'RESOLVED' });

      // One active (READY) work order, one completed inside the period, one completed outside it.
      const activeReqId = await createRequest(accessToken, propertyId, spaceId);
      const activeWoId = await createWorkOrderFor(accessToken, activeReqId);
      await request(app)
        .patch(`/api/v1/work-orders/${activeWoId}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'READY' });

      const insideReqId = await createRequest(accessToken, propertyId, spaceId);
      const insideWoId = await createWorkOrderFor(accessToken, insideReqId);
      await request(app)
        .patch(`/api/v1/work-orders/${insideWoId}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'READY' });
      await request(app)
        .patch(`/api/v1/work-orders/${insideWoId}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() + DAY).toISOString() });
      await request(app)
        .patch(`/api/v1/work-orders/${insideWoId}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'IN_PROGRESS' });
      await request(app)
        .patch(`/api/v1/work-orders/${insideWoId}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'COMPLETED' });

      const outsideReqId = await createRequest(accessToken, propertyId, spaceId);
      const outsideWoId = await createWorkOrderFor(accessToken, outsideReqId);
      await request(app)
        .patch(`/api/v1/work-orders/${outsideWoId}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'READY' });
      await testPrisma.workOrder.update({
        where: { id: outsideWoId },
        data: { status: 'COMPLETED', completedAt: new Date(Date.now() - 40 * DAY) },
      });

      // One pending-signature quote.
      const sigReqId = await createRequest(accessToken, propertyId, spaceId);
      const sigWoId = await createWorkOrderFor(accessToken, sigReqId);
      const sigQuoteId = await createQuoteFor(accessToken, sigWoId);
      await request(app)
        .patch(`/api/v1/quotes/${sigQuoteId}/workflow-mode`)
        .set(authHeader(accessToken))
        .send({ workflowMode: 'SIGNATURE_ONLY' });

      const res = await request(app)
        .get('/api/v1/dashboard?period=30d')
        .set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.metrics.openRequests).toBe(6); // 2 + active + inside + outside + sig, resolved excluded
      expect(res.body.metrics.activeWorkOrders).toBe(1); // only activeWoId (READY)
      expect(res.body.metrics.completedThisPeriod).toBe(1); // insideWoId only
      expect(res.body.metrics.pendingSignature).toBe(1);
    });
  });

  describe('portfolio + breakdowns', () => {
    it('reflects real space occupancy status and groupBy breakdowns including zero-count values', async () => {
      const { accessToken } = await registerTestUser(app);
      const propertyRes = await request(app)
        .post('/api/v1/properties')
        .set(authHeader(accessToken))
        .send({ ...validProperty, code: 'MARINA-1' });
      const occupiedSpace = await request(app)
        .post(`/api/v1/properties/${propertyRes.body.id}/spaces`)
        .set(authHeader(accessToken))
        .send({ name: 'Unit A', code: 'A', spaceType: 'APARTMENT' });
      await testPrisma.space.update({
        where: { id: occupiedSpace.body.id },
        data: { status: 'OCCUPIED' },
      });
      await request(app)
        .post(`/api/v1/properties/${propertyRes.body.id}/spaces`)
        .set(authHeader(accessToken))
        .send({ name: 'Unit B', code: 'B', spaceType: 'APARTMENT' });

      await createRequest(accessToken, propertyRes.body.id, occupiedSpace.body.id, {
        category: 'PLUMBING',
        priority: 'LOW',
      });
      await createRequest(accessToken, propertyRes.body.id, occupiedSpace.body.id, {
        category: 'PLUMBING',
        priority: 'LOW',
      });

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.portfolio).toEqual({
        totalProperties: 1,
        totalSpaces: 2,
        occupiedSpaces: 1,
        vacantSpaces: 1,
        occupancyRatePct: 50,
      });

      expect(res.body.categoryBreakdown).toHaveLength(10);
      const plumbing = res.body.categoryBreakdown.find(
        (c: { category: string }) => c.category === 'PLUMBING',
      );
      expect(plumbing.count).toBe(2);
      const electrical = res.body.categoryBreakdown.find(
        (c: { category: string }) => c.category === 'ELECTRICAL',
      );
      expect(electrical.count).toBe(0);

      expect(res.body.priorityBreakdown).toHaveLength(4);
      const low = res.body.priorityBreakdown.find(
        (p: { priority: string }) => p.priority === 'LOW',
      );
      expect(low.count).toBe(2);
    });
  });

  describe('quotesSnapshot.byWorkflowResult', () => {
    it('derives each workflow result via the same deriveWorkflowResult used elsewhere', async () => {
      const { accessToken } = await registerTestUser(app);
      const { workOrderId } = await fullFixture(accessToken);

      // NOT_REQUIRED — a NONE-mode quote (below threshold).
      const belowThresholdWoId = await (async () => {
        const { workOrderId: id } = await fullFixture(accessToken);
        return id;
      })();
      await createQuoteFor(accessToken, belowThresholdWoId, 100);

      // PENDING — APPROVAL_ONLY, still pending.
      const pendingQuoteId = await createQuoteFor(accessToken, workOrderId);
      await request(app)
        .patch(`/api/v1/quotes/${pendingQuoteId}/workflow-mode`)
        .set(authHeader(accessToken))
        .send({ workflowMode: 'APPROVAL_ONLY' });

      // COMPLETED — APPROVAL_ONLY, approved.
      const { workOrderId: approvedWoId } = await fullFixture(accessToken);
      const approvedQuoteId = await createQuoteFor(accessToken, approvedWoId);
      await request(app)
        .patch(`/api/v1/quotes/${approvedQuoteId}/workflow-mode`)
        .set(authHeader(accessToken))
        .send({ workflowMode: 'APPROVAL_ONLY' });
      await request(app)
        .post(`/api/v1/quotes/${approvedQuoteId}/approve`)
        .set(authHeader(accessToken));

      // REJECTED.
      const { workOrderId: rejectedWoId } = await fullFixture(accessToken);
      const rejectedQuoteId = await createQuoteFor(accessToken, rejectedWoId);
      await request(app)
        .patch(`/api/v1/quotes/${rejectedQuoteId}/workflow-mode`)
        .set(authHeader(accessToken))
        .send({ workflowMode: 'APPROVAL_ONLY' });
      await request(app)
        .post(`/api/v1/quotes/${rejectedQuoteId}/reject`)
        .set(authHeader(accessToken));

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      const byResult = new Map(
        (res.body.quotesSnapshot.byWorkflowResult as Array<{ result: string; count: number }>).map(
          (r) => [r.result, r.count],
        ),
      );
      expect(byResult.get('NOT_REQUIRED')).toBe(1);
      expect(byResult.get('PENDING')).toBe(1);
      expect(byResult.get('COMPLETED')).toBe(1);
      expect(byResult.get('REJECTED')).toBe(1);
      expect([...byResult.keys()].sort()).toEqual(
        ['NOT_REQUIRED', 'PENDING', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED'].sort(),
      );
    });
  });

  describe('average resolution hours', () => {
    it('computes the exact mean and returns null when nothing resolved in the period', async () => {
      const { accessToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);

      const req1 = await createRequest(accessToken, propertyId, spaceId);
      const req2 = await createRequest(accessToken, propertyId, spaceId);

      const now = Date.now();
      await testPrisma.maintenanceRequest.update({
        where: { id: req1 },
        data: {
          reportedAt: new Date(now - 10 * HOUR),
          status: 'RESOLVED',
          resolvedAt: new Date(now),
        },
      });
      await testPrisma.maintenanceRequest.update({
        where: { id: req2 },
        data: {
          reportedAt: new Date(now - 20 * HOUR),
          status: 'RESOLVED',
          resolvedAt: new Date(now),
        },
      });

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      expect(res.body.averageResolutionHours).toBe(15); // mean(10, 20)

      // A different org with nothing resolved gets null, not 0.
      const other = await registerTestUser(app);
      const otherRes = await request(app)
        .get('/api/v1/dashboard')
        .set(authHeader(other.accessToken));
      expect(otherRes.body.averageResolutionHours).toBeNull();
    });
  });

  describe('trend', () => {
    it('buckets created/resolved counts per UTC calendar day within the window', async () => {
      const { accessToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);

      const req1 = await createRequest(accessToken, propertyId, spaceId);
      const req2 = await createRequest(accessToken, propertyId, spaceId);

      const twoDaysAgo = new Date(
        Date.UTC(
          new Date().getUTCFullYear(),
          new Date().getUTCMonth(),
          new Date().getUTCDate() - 2,
          10,
        ),
      );
      await testPrisma.maintenanceRequest.update({
        where: { id: req1 },
        data: { reportedAt: twoDaysAgo },
      });
      await testPrisma.maintenanceRequest.update({
        where: { id: req2 },
        data: { reportedAt: twoDaysAgo, status: 'RESOLVED', resolvedAt: twoDaysAgo },
      });

      const res = await request(app)
        .get('/api/v1/dashboard?period=7d')
        .set(authHeader(accessToken));
      expect(res.body.trend.points).toHaveLength(7);
      const dayKey = twoDaysAgo.toISOString().slice(0, 10);
      const point = res.body.trend.points.find((p: { date: string }) => p.date === dayKey);
      expect(point.created).toBe(2); // both req1 and req2 were reported that day
      expect(point.completed).toBe(1); // only req2 was resolved that day
      const totalCreated = res.body.trend.points.reduce(
        (sum: number, p: { created: number }) => sum + p.created,
        0,
      );
      expect(totalCreated).toBe(2);
    });
  });

  describe('recent activity', () => {
    it('is org-wide (crosses properties), ordered newest-first, limited to 10', async () => {
      const { accessToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);
      for (let i = 0; i < 12; i++) {
        await createRequest(accessToken, propertyId, spaceId);
      }

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      expect(res.body.recentActivity).toHaveLength(10);
      const timestamps = res.body.recentActivity.map((a: { createdAt: string }) =>
        new Date(a.createdAt).getTime(),
      );
      expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
    });
  });

  describe('attention engine', () => {
    it('URGENT_REQUEST_OPEN: absent below 4h, WARNING at 5h, CRITICAL at 25h', async () => {
      const { accessToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);

      const freshId = await createRequest(accessToken, propertyId, spaceId, { priority: 'URGENT' });
      await testPrisma.maintenanceRequest.update({
        where: { id: freshId },
        data: { reportedAt: new Date(Date.now() - 2 * HOUR) },
      });

      const warnId = await createRequest(accessToken, propertyId, spaceId, { priority: 'URGENT' });
      await testPrisma.maintenanceRequest.update({
        where: { id: warnId },
        data: { reportedAt: new Date(Date.now() - 5 * HOUR) },
      });

      const critId = await createRequest(accessToken, propertyId, spaceId, { priority: 'URGENT' });
      await testPrisma.maintenanceRequest.update({
        where: { id: critId },
        data: { reportedAt: new Date(Date.now() - 25 * HOUR) },
      });

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      const items = res.body.attention.items.filter(
        (i: { type: string }) => i.type === 'URGENT_REQUEST_OPEN',
      );
      const byEntity = new Map(
        items.map((i: { entityId: string; severity: string }) => [i.entityId, i.severity]),
      );
      expect(byEntity.has(freshId)).toBe(false);
      expect(byEntity.get(warnId)).toBe('WARNING');
      expect(byEntity.get(critId)).toBe('CRITICAL');
    });

    it('STALE_OPEN_REQUEST: absent below 7d, WARNING above it, never CRITICAL', async () => {
      const { accessToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);

      const freshId = await createRequest(accessToken, propertyId, spaceId, { priority: 'LOW' });
      await testPrisma.maintenanceRequest.update({
        where: { id: freshId },
        data: { reportedAt: new Date(Date.now() - 3 * DAY) },
      });
      const staleId = await createRequest(accessToken, propertyId, spaceId, { priority: 'LOW' });
      await testPrisma.maintenanceRequest.update({
        where: { id: staleId },
        data: { reportedAt: new Date(Date.now() - 30 * DAY) },
      });

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      const items = res.body.attention.items.filter(
        (i: { type: string }) => i.type === 'STALE_OPEN_REQUEST',
      );
      expect(items.map((i: { entityId: string }) => i.entityId)).toEqual([staleId]);
      expect(items[0].severity).toBe('WARNING');
    });

    it('WORK_ORDER_STUCK_IN_DRAFT: absent below 3d, WARNING at 4d, CRITICAL at 8d', async () => {
      const { accessToken } = await registerTestUser(app);
      const { workOrderId: freshWo } = await fullFixture(accessToken);
      await testPrisma.workOrder.update({
        where: { id: freshWo },
        data: { createdAt: new Date(Date.now() - 1 * DAY) },
      });
      const { workOrderId: warnWo } = await fullFixture(accessToken);
      await testPrisma.workOrder.update({
        where: { id: warnWo },
        data: { createdAt: new Date(Date.now() - 4 * DAY) },
      });
      const { workOrderId: critWo } = await fullFixture(accessToken);
      await testPrisma.workOrder.update({
        where: { id: critWo },
        data: { createdAt: new Date(Date.now() - 8 * DAY) },
      });

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      const items = res.body.attention.items.filter(
        (i: { type: string }) => i.type === 'WORK_ORDER_STUCK_IN_DRAFT',
      );
      const byEntity = new Map(
        items.map((i: { entityId: string; severity: string }) => [i.entityId, i.severity]),
      );
      expect(byEntity.has(freshWo)).toBe(false);
      expect(byEntity.get(warnWo)).toBe('WARNING');
      expect(byEntity.get(critWo)).toBe('CRITICAL');
    });

    it('WORK_ORDER_OVERDUE_SCHEDULE: WARNING as soon as overdue, CRITICAL past 48h', async () => {
      const { accessToken } = await registerTestUser(app);

      const { workOrderId: warnWo } = await fullFixture(accessToken);
      await request(app)
        .patch(`/api/v1/work-orders/${warnWo}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'READY' });
      await request(app)
        .patch(`/api/v1/work-orders/${warnWo}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() + HOUR).toISOString() });
      await testPrisma.workOrder.update({
        where: { id: warnWo },
        data: { scheduledAt: new Date(Date.now() - 5 * HOUR) },
      });

      const { workOrderId: critWo } = await fullFixture(accessToken);
      await request(app)
        .patch(`/api/v1/work-orders/${critWo}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'READY' });
      await request(app)
        .patch(`/api/v1/work-orders/${critWo}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() + HOUR).toISOString() });
      await testPrisma.workOrder.update({
        where: { id: critWo },
        data: { scheduledAt: new Date(Date.now() - 50 * HOUR) },
      });

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      const items = res.body.attention.items.filter(
        (i: { type: string }) => i.type === 'WORK_ORDER_OVERDUE_SCHEDULE',
      );
      const byEntity = new Map(
        items.map((i: { entityId: string; severity: string }) => [i.entityId, i.severity]),
      );
      expect(byEntity.get(warnWo)).toBe('WARNING');
      expect(byEntity.get(critWo)).toBe('CRITICAL');
    });

    it('QUOTE_PENDING_APPROVAL_TOO_LONG: absent below 3d, WARNING at 4d, CRITICAL at 8d', async () => {
      const { accessToken } = await registerTestUser(app);

      const { workOrderId: freshWo } = await fullFixture(accessToken);
      const freshQuote = await createQuoteFor(accessToken, freshWo);
      await request(app)
        .patch(`/api/v1/quotes/${freshQuote}/workflow-mode`)
        .set(authHeader(accessToken))
        .send({ workflowMode: 'APPROVAL_ONLY' });

      const { workOrderId: warnWo } = await fullFixture(accessToken);
      const warnQuote = await createQuoteFor(accessToken, warnWo);
      await request(app)
        .patch(`/api/v1/quotes/${warnQuote}/workflow-mode`)
        .set(authHeader(accessToken))
        .send({ workflowMode: 'APPROVAL_ONLY' });
      await testPrisma.contractorQuote.update({
        where: { id: warnQuote },
        data: { createdAt: new Date(Date.now() - 4 * DAY) },
      });

      const { workOrderId: critWo } = await fullFixture(accessToken);
      const critQuote = await createQuoteFor(accessToken, critWo);
      await request(app)
        .patch(`/api/v1/quotes/${critQuote}/workflow-mode`)
        .set(authHeader(accessToken))
        .send({ workflowMode: 'APPROVAL_ONLY' });
      await testPrisma.contractorQuote.update({
        where: { id: critQuote },
        data: { createdAt: new Date(Date.now() - 8 * DAY) },
      });

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      const items = res.body.attention.items.filter(
        (i: { type: string }) => i.type === 'QUOTE_PENDING_APPROVAL_TOO_LONG',
      );
      const byEntity = new Map(
        items.map((i: { entityId: string; severity: string }) => [i.entityId, i.severity]),
      );
      expect(byEntity.has(freshQuote)).toBe(false);
      expect(byEntity.get(warnQuote)).toBe('WARNING');
      expect(byEntity.get(critQuote)).toBe('CRITICAL');
    });

    it('QUOTE_SIGNATURE_STALLED: tighter thresholds once partially signed', async () => {
      const { accessToken } = await registerTestUser(app);

      const { workOrderId: pendingWo } = await fullFixture(accessToken);
      const pendingQuote = await createQuoteFor(accessToken, pendingWo);
      await request(app)
        .patch(`/api/v1/quotes/${pendingQuote}/workflow-mode`)
        .set(authHeader(accessToken))
        .send({ workflowMode: 'SIGNATURE_ONLY' });
      await testPrisma.contractorQuote.update({
        where: { id: pendingQuote },
        data: { createdAt: new Date(Date.now() - 4 * DAY) }, // WARNING (>3d, plain PENDING)
      });

      const { workOrderId: partialWo } = await fullFixture(accessToken);
      const partialQuote = await createQuoteFor(accessToken, partialWo);
      await request(app)
        .patch(`/api/v1/quotes/${partialQuote}/workflow-mode`)
        .set(authHeader(accessToken))
        .send({ workflowMode: 'SIGNATURE_ONLY' });
      await testPrisma.contractorQuote.update({
        where: { id: partialQuote },
        data: {
          signatureStatus: 'PARTIALLY_SIGNED',
          createdAt: new Date(Date.now() - 2 * DAY), // WARNING (>1d, partially signed)
        },
      });

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      const items = res.body.attention.items.filter(
        (i: { type: string }) => i.type === 'QUOTE_SIGNATURE_STALLED',
      );
      const byEntity = new Map(
        items.map((i: { entityId: string; severity: string }) => [i.entityId, i.severity]),
      );
      expect(byEntity.get(pendingQuote)).toBe('WARNING');
      expect(byEntity.get(partialQuote)).toBe('WARNING');
    });

    it('QUOTE_REJECTED_NEEDS_FOLLOWUP: flagged within 14d, not when superseded or too old', async () => {
      const { accessToken } = await registerTestUser(app);

      // Rejected 2 days ago, no replacement quote — should be flagged.
      const { workOrderId: needsFollowupWo } = await fullFixture(accessToken);
      const rejectedQuote = await createQuoteFor(accessToken, needsFollowupWo);
      await request(app)
        .patch(`/api/v1/quotes/${rejectedQuote}/workflow-mode`)
        .set(authHeader(accessToken))
        .send({ workflowMode: 'APPROVAL_ONLY' });
      await request(app)
        .post(`/api/v1/quotes/${rejectedQuote}/reject`)
        .set(authHeader(accessToken));
      await testPrisma.contractorQuote.update({
        where: { id: rejectedQuote },
        data: { rejectedAt: new Date(Date.now() - 2 * DAY) },
      });

      // Rejected 20 days ago — outside the 14-day follow-up window.
      const { workOrderId: tooOldWo } = await fullFixture(accessToken);
      const oldRejectedQuote = await createQuoteFor(accessToken, tooOldWo);
      await request(app)
        .patch(`/api/v1/quotes/${oldRejectedQuote}/workflow-mode`)
        .set(authHeader(accessToken))
        .send({ workflowMode: 'APPROVAL_ONLY' });
      await request(app)
        .post(`/api/v1/quotes/${oldRejectedQuote}/reject`)
        .set(authHeader(accessToken));
      await testPrisma.contractorQuote.update({
        where: { id: oldRejectedQuote },
        data: { rejectedAt: new Date(Date.now() - 20 * DAY) },
      });

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      const items = res.body.attention.items.filter(
        (i: { type: string }) => i.type === 'QUOTE_REJECTED_NEEDS_FOLLOWUP',
      );
      expect(items.map((i: { entityId: string }) => i.entityId)).toEqual([rejectedQuote]);
    });

    it('sorts by severity, then type rank, then oldest first', async () => {
      const { accessToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);

      // A WARNING-tier stale request (typeRank 5).
      const staleId = await createRequest(accessToken, propertyId, spaceId, { priority: 'LOW' });
      await testPrisma.maintenanceRequest.update({
        where: { id: staleId },
        data: { reportedAt: new Date(Date.now() - 10 * DAY) },
      });

      // A CRITICAL-tier urgent request (typeRank 0) — must sort first despite being newer.
      const urgentId = await createRequest(accessToken, propertyId, spaceId, {
        priority: 'URGENT',
      });
      await testPrisma.maintenanceRequest.update({
        where: { id: urgentId },
        data: { reportedAt: new Date(Date.now() - 25 * HOUR) },
      });

      const res = await request(app).get('/api/v1/dashboard').set(authHeader(accessToken));
      const items = res.body.attention.items as Array<{ entityId: string; severity: string }>;
      const urgentIndex = items.findIndex((i) => i.entityId === urgentId);
      const staleIndex = items.findIndex((i) => i.entityId === staleId);
      expect(urgentIndex).toBeGreaterThanOrEqual(0);
      expect(staleIndex).toBeGreaterThanOrEqual(0);
      expect(urgentIndex).toBeLessThan(staleIndex);
      expect(items[urgentIndex].severity).toBe('CRITICAL');
    });
  });
});
