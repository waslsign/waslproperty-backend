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
  name: 'Wasl Heights',
  code: 'WASL-HTS',
  addressLine1: '1 Wasl Blvd',
  city: 'Dubai',
  country: 'UAE',
  propertyType: 'MIXED_USE',
};

const validSpace = {
  name: 'Office 1204',
  code: '1204',
  spaceType: 'OFFICE',
};

const validRequestPayload = {
  title: 'Bedroom AC leaking',
  description: 'The bedroom AC is leaking water and has stopped cooling.',
  category: 'HVAC',
  priority: 'HIGH',
};

async function setupPropertyAndSpace(accessToken: string) {
  const propertyRes = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(accessToken))
    .send(validProperty);
  const spaceRes = await request(app)
    .post(`/api/v1/properties/${propertyRes.body.id}/spaces`)
    .set(authHeader(accessToken))
    .send(validSpace);
  return { propertyId: propertyRes.body.id as string, spaceId: spaceRes.body.id as string };
}

/** Creates a resident (plain user + Add Person link) tied to a space and
 * returns a ready-to-use access token for them. */
async function setupResidentOnSpace(
  ownerToken: string,
  organisationId: string,
  propertyId: string,
  spaceId: string | undefined,
  role: 'TENANT' | 'OWNER' | 'RESIDENT' = 'TENANT',
) {
  const resident = await createPlainUser();
  const addRes = await request(app)
    .post(`/api/v1/properties/${propertyId}/memberships`)
    .set(authHeader(ownerToken))
    .send({
      email: resident.email,
      firstName: 'Resi',
      lastName: 'Dent',
      role,
      spaceId,
    });

  const contactId = addRes.body.contactId as string;
  const accessToken = residentAccessToken(resident.userId, organisationId, contactId);
  return { userId: resident.userId, accessToken };
}

describe('maintenance requests', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/maintenance-requests');
    expect(res.status).toBe(401);
  });

  it('lets an active resident create a request for their own space, reporter taken from the token', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
    const resident = await setupResidentOnSpace(ownerToken, organisationId, propertyId, spaceId);

    const res = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(resident.accessToken))
      .send({ propertyId, spaceId, ...validRequestPayload });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('NEW');
    expect(res.body.reportedBy.id).toBe(resident.userId);
    expect(res.body.title).toBe('Bedroom AC leaking');

    // Never trusts a client-supplied reporter.
    const tampered = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(resident.accessToken))
      .send({ propertyId, spaceId, ...validRequestPayload, reportedByUserId: 'someone-else' });
    expect(tampered.status).toBe(201);
    expect(tampered.body.reportedBy.id).toBe(resident.userId);
  });

  it('lets staff create a request for any property in their organisation', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const { propertyId } = await setupPropertyAndSpace(ownerToken);

    const res = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(ownerToken))
      .send({ propertyId, ...validRequestPayload });

    expect(res.status).toBe(201);
    expect(res.body.space).toBeNull();
  });

  it('rejects a resident creating a request for a property they are not associated with', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const { propertyId: propertyAId, spaceId: spaceAId } = await setupPropertyAndSpace(ownerToken);

    // A second, unrelated property in the same org.
    const propertyBRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send({ ...validProperty, code: 'OTHER-CODE' });

    const resident = await setupResidentOnSpace(ownerToken, organisationId, propertyAId, spaceAId);

    const res = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(resident.accessToken))
      .send({ propertyId: propertyBRes.body.id, ...validRequestPayload });

    expect(res.status).toBe(403);
  });

  it('rejects a space that does not belong to the given property, even for a resident of that property', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);

    const otherPropertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send({ ...validProperty, code: 'OTHER-CODE' });
    const otherSpaceRes = await request(app)
      .post(`/api/v1/properties/${otherPropertyRes.body.id}/spaces`)
      .set(authHeader(ownerToken))
      .send(validSpace);

    const resident = await setupResidentOnSpace(ownerToken, organisationId, propertyId, spaceId);

    const res = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(resident.accessToken))
      .send({ propertyId, spaceId: otherSpaceRes.body.id, ...validRequestPayload });

    expect(res.status).toBe(404);
  });

  it('rejects a resident reporting against a different unit in the same property', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
    const otherSpaceRes = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(ownerToken))
      .send({ name: 'Office 1205', code: '1205', spaceType: 'OFFICE' });

    const resident = await setupResidentOnSpace(ownerToken, organisationId, propertyId, spaceId);

    const res = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(resident.accessToken))
      .send({ propertyId, spaceId: otherSpaceRes.body.id, ...validRequestPayload });

    expect(res.status).toBe(403);
  });

  it('lets a manager list all requests for the organisation and a resident see only their own', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
    const residentA = await setupResidentOnSpace(ownerToken, organisationId, propertyId, spaceId);

    const secondSpaceRes = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(ownerToken))
      .send({ name: 'Office 1205', code: '1205', spaceType: 'OFFICE' });
    const residentB = await setupResidentOnSpace(
      ownerToken,
      organisationId,
      propertyId,
      secondSpaceRes.body.id,
    );

    await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(residentA.accessToken))
      .send({ propertyId, spaceId, ...validRequestPayload });
    await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(residentB.accessToken))
      .send({
        propertyId,
        spaceId: secondSpaceRes.body.id,
        ...validRequestPayload,
        title: 'Leaky tap',
      });

    const managerList = await request(app)
      .get('/api/v1/maintenance-requests')
      .set(authHeader(ownerToken));
    expect(managerList.body.total).toBe(2);

    const residentAList = await request(app)
      .get('/api/v1/maintenance-requests')
      .set(authHeader(residentA.accessToken));
    expect(residentAList.body.total).toBe(1);
    expect(residentAList.body.items[0].title).toBe('Bedroom AC leaking');

    // A resident cannot see anyone else's requests even by passing filters.
    const residentASnooping = await request(app)
      .get(`/api/v1/maintenance-requests?propertyId=${propertyId}`)
      .set(authHeader(residentA.accessToken));
    expect(residentASnooping.body.total).toBe(1);
  });

  it('filters by a comma-separated list of statuses (used by dashboard deep-links)', async () => {
    const { accessToken } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);
    const newReq = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(accessToken))
      .send({ ...validRequestPayload, propertyId, spaceId });
    const closedReq = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(accessToken))
      .send({ ...validRequestPayload, propertyId, spaceId });
    await request(app)
      .patch(`/api/v1/maintenance-requests/${closedReq.body.id}/status`)
      .set(authHeader(accessToken))
      .send({ status: 'CANCELLED' });

    const singleStatus = await request(app)
      .get('/api/v1/maintenance-requests?status=NEW')
      .set(authHeader(accessToken));
    expect(singleStatus.status).toBe(200);
    expect(singleStatus.body.items.map((r: { id: string }) => r.id)).toEqual([newReq.body.id]);

    const multiStatus = await request(app)
      .get('/api/v1/maintenance-requests?status=NEW,CANCELLED')
      .set(authHeader(accessToken));
    expect(multiStatus.status).toBe(200);
    expect(multiStatus.body.items.map((r: { id: string }) => r.id).sort()).toEqual(
      [newReq.body.id, closedReq.body.id].sort(),
    );
  });

  it('is organisation-isolated for both list and detail', async () => {
    const orgA = await registerTestUser(app);
    const orgB = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(orgA.accessToken);

    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(orgA.accessToken))
      .send({ propertyId, spaceId, ...validRequestPayload });

    const listRes = await request(app)
      .get('/api/v1/maintenance-requests')
      .set(authHeader(orgB.accessToken));
    expect(listRes.body.total).toBe(0);

    const detailRes = await request(app)
      .get(`/api/v1/maintenance-requests/${createRes.body.id}`)
      .set(authHeader(orgB.accessToken));
    expect(detailRes.status).toBe(404);
  });

  it('lets the reporting resident view their own request but not another resident’s', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
    const residentA = await setupResidentOnSpace(ownerToken, organisationId, propertyId, spaceId);
    const secondSpaceRes = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(ownerToken))
      .send({ name: 'Office 1205', code: '1205', spaceType: 'OFFICE' });
    const residentB = await setupResidentOnSpace(
      ownerToken,
      organisationId,
      propertyId,
      secondSpaceRes.body.id,
    );

    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(residentA.accessToken))
      .send({ propertyId, spaceId, ...validRequestPayload });

    const ownView = await request(app)
      .get(`/api/v1/maintenance-requests/${createRes.body.id}`)
      .set(authHeader(residentA.accessToken));
    expect(ownView.status).toBe(200);

    const otherView = await request(app)
      .get(`/api/v1/maintenance-requests/${createRes.body.id}`)
      .set(authHeader(residentB.accessToken));
    expect(otherView.status).toBe(404);
  });

  describe('status transitions', () => {
    it('allows the documented forward path and rejects invalid jumps', async () => {
      const { accessToken: ownerToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
      const createRes = await request(app)
        .post('/api/v1/maintenance-requests')
        .set(authHeader(ownerToken))
        .send({ propertyId, spaceId, ...validRequestPayload });
      const id = createRes.body.id as string;

      const invalidJump = await request(app)
        .patch(`/api/v1/maintenance-requests/${id}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'RESOLVED' });
      expect(invalidJump.status).toBe(409);

      const toUnderReview = await request(app)
        .patch(`/api/v1/maintenance-requests/${id}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'UNDER_REVIEW' });
      expect(toUnderReview.status).toBe(200);
      expect(toUnderReview.body.status).toBe('UNDER_REVIEW');

      const toInProgress = await request(app)
        .patch(`/api/v1/maintenance-requests/${id}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'IN_PROGRESS' });
      expect(toInProgress.status).toBe(200);

      const toResolved = await request(app)
        .patch(`/api/v1/maintenance-requests/${id}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'RESOLVED' });
      expect(toResolved.status).toBe(200);
      expect(toResolved.body.resolvedAt).not.toBeNull();

      const toClosed = await request(app)
        .patch(`/api/v1/maintenance-requests/${id}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'CLOSED' });
      expect(toClosed.status).toBe(200);
      expect(toClosed.body.closedAt).not.toBeNull();

      // Terminal — no further transitions.
      const afterClosed = await request(app)
        .patch(`/api/v1/maintenance-requests/${id}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'CANCELLED' });
      expect(afterClosed.status).toBe(409);
    });

    it('allows cancellation from a non-terminal state', async () => {
      const { accessToken: ownerToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
      const createRes = await request(app)
        .post('/api/v1/maintenance-requests')
        .set(authHeader(ownerToken))
        .send({ propertyId, spaceId, ...validRequestPayload });

      const res = await request(app)
        .patch(`/api/v1/maintenance-requests/${createRes.body.id}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'CANCELLED' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('rejects a resident performing a manager status transition', async () => {
      const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
      const resident = await setupResidentOnSpace(ownerToken, organisationId, propertyId, spaceId);

      const createRes = await request(app)
        .post('/api/v1/maintenance-requests')
        .set(authHeader(resident.accessToken))
        .send({ propertyId, spaceId, ...validRequestPayload });

      const res = await request(app)
        .patch(`/api/v1/maintenance-requests/${createRes.body.id}/status`)
        .set(authHeader(resident.accessToken))
        .send({ status: 'UNDER_REVIEW' });

      expect(res.status).toBe(403);
    });
  });

  describe('activity', () => {
    it('writes activity on creation, visible on both property and space activity feeds', async () => {
      const { accessToken: ownerToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);

      const createRes = await request(app)
        .post('/api/v1/maintenance-requests')
        .set(authHeader(ownerToken))
        .send({ propertyId, spaceId, ...validRequestPayload });

      const propertyActivity = await request(app)
        .get(`/api/v1/properties/${propertyId}/activity`)
        .set(authHeader(ownerToken));
      expect(
        propertyActivity.body.items.some(
          (e: { eventType: string }) => e.eventType === 'MAINTENANCE_REQUEST_CREATED',
        ),
      ).toBe(true);

      const spaceActivity = await request(app)
        .get(`/api/v1/spaces/${spaceId}/activity`)
        .set(authHeader(ownerToken));
      expect(
        spaceActivity.body.items.some(
          (e: { eventType: string }) => e.eventType === 'MAINTENANCE_REQUEST_CREATED',
        ),
      ).toBe(true);

      // A single ActivityEvent row serves both feeds — not two rows.
      const entityActivity = await request(app)
        .get(`/api/v1/properties/${propertyId}/activity?entityId=${createRes.body.id}`)
        .set(authHeader(ownerToken));
      expect(entityActivity.body.total).toBe(1);
    });

    it('writes activity on a status transition', async () => {
      const { accessToken: ownerToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
      const createRes = await request(app)
        .post('/api/v1/maintenance-requests')
        .set(authHeader(ownerToken))
        .send({ propertyId, spaceId, ...validRequestPayload });

      await request(app)
        .patch(`/api/v1/maintenance-requests/${createRes.body.id}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'UNDER_REVIEW' });

      const activity = await request(app)
        .get(`/api/v1/properties/${propertyId}/activity?entityId=${createRes.body.id}`)
        .set(authHeader(ownerToken));

      expect(activity.body.total).toBe(2);
      expect(activity.body.items[0].eventType).toBe('MAINTENANCE_REQUEST_STATUS_CHANGED');
      expect(activity.body.items[0].title).toBe('Maintenance request moved to Under Review');
    });

    it('writes activity on a general update', async () => {
      const { accessToken: ownerToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
      const createRes = await request(app)
        .post('/api/v1/maintenance-requests')
        .set(authHeader(ownerToken))
        .send({ propertyId, spaceId, ...validRequestPayload });

      const res = await request(app)
        .patch(`/api/v1/maintenance-requests/${createRes.body.id}`)
        .set(authHeader(ownerToken))
        .send({ priority: 'URGENT' });
      expect(res.status).toBe(200);
      expect(res.body.priority).toBe('URGENT');

      const activity = await request(app)
        .get(`/api/v1/properties/${propertyId}/activity?entityId=${createRes.body.id}`)
        .set(authHeader(ownerToken));
      expect(
        activity.body.items.some(
          (e: { eventType: string }) => e.eventType === 'MAINTENANCE_REQUEST_UPDATED',
        ),
      ).toBe(true);
    });
  });

  describe('filters', () => {
    it('scopes propertyId/status/priority filters to the caller organisation and access', async () => {
      const { accessToken: ownerToken } = await registerTestUser(app);
      const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);

      await request(app)
        .post('/api/v1/maintenance-requests')
        .set(authHeader(ownerToken))
        .send({ propertyId, spaceId, ...validRequestPayload });
      await request(app)
        .post('/api/v1/maintenance-requests')
        .set(authHeader(ownerToken))
        .send({
          propertyId,
          ...validRequestPayload,
          category: 'PLUMBING',
          priority: 'LOW',
          title: 'Leaky tap',
        });

      const byPriority = await request(app)
        .get('/api/v1/maintenance-requests?priority=LOW')
        .set(authHeader(ownerToken));
      expect(byPriority.body.total).toBe(1);
      expect(byPriority.body.items[0].title).toBe('Leaky tap');

      const bySpace = await request(app)
        .get(`/api/v1/maintenance-requests?spaceId=${spaceId}`)
        .set(authHeader(ownerToken));
      expect(bySpace.body.total).toBe(1);
      expect(bySpace.body.items[0].title).toBe('Bedroom AC leaking');
    });
  });
});
