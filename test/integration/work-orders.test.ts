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
  name: 'Marina Heights',
  code: 'MARINA-HT',
  addressLine1: '1 Marina Blvd',
  city: 'Dubai',
  country: 'UAE',
  propertyType: 'MIXED_USE',
};

const validSpace = { name: 'Apartment 1204', code: '1204', spaceType: 'APARTMENT' };

const validRequestPayload = {
  title: 'Bedroom AC leaking',
  description: 'The bedroom AC is leaking water and has stopped cooling.',
  category: 'HVAC',
  priority: 'HIGH',
};

async function setupPropertySpaceAndRequest(accessToken: string) {
  const propertyRes = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(accessToken))
    .send(validProperty);
  const spaceRes = await request(app)
    .post(`/api/v1/properties/${propertyRes.body.id}/spaces`)
    .set(authHeader(accessToken))
    .send(validSpace);
  const requestRes = await request(app)
    .post('/api/v1/maintenance-requests')
    .set(authHeader(accessToken))
    .send({ ...validRequestPayload, propertyId: propertyRes.body.id, spaceId: spaceRes.body.id });
  return {
    propertyId: propertyRes.body.id as string,
    spaceId: spaceRes.body.id as string,
    maintenanceRequestId: requestRes.body.id as string,
  };
}

describe('work orders', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/work-orders');
    expect(res.status).toBe(401);
  });

  it('lets a manager create a work order from a maintenance request', async () => {
    const { accessToken, organisationId } = await registerTestUser(app);
    const { maintenanceRequestId, propertyId, spaceId } =
      await setupPropertySpaceAndRequest(accessToken);

    const res = await request(app).post('/api/v1/work-orders').set(authHeader(accessToken)).send({
      maintenanceRequestId,
      title: 'Repair leaking AC unit',
      description: 'Replace the drain pan and re-seal the unit.',
      priority: 'HIGH',
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.propertyId).toBe(propertyId);
    expect(res.body.spaceId).toBe(spaceId);
    expect(res.body.maintenanceRequestId).toBe(maintenanceRequestId);

    const activity = await testPrisma.activityEvent.findMany({
      where: { organisationId, eventType: 'WORK_ORDER_CREATED' },
    });
    expect(activity).toHaveLength(1);
  });

  it('prevents a second non-cancelled work order on the same maintenance request', async () => {
    const { accessToken } = await registerTestUser(app);
    const { maintenanceRequestId } = await setupPropertySpaceAndRequest(accessToken);

    const payload = {
      maintenanceRequestId,
      title: 'Repair AC',
      description: 'Fix it.',
      priority: 'HIGH',
    };
    const first = await request(app)
      .post('/api/v1/work-orders')
      .set(authHeader(accessToken))
      .send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/work-orders')
      .set(authHeader(accessToken))
      .send(payload);
    expect(second.status).toBe(409);
  });

  it('allows creating a new work order once the previous one was cancelled', async () => {
    const { accessToken } = await registerTestUser(app);
    const { maintenanceRequestId } = await setupPropertySpaceAndRequest(accessToken);
    const payload = {
      maintenanceRequestId,
      title: 'Repair AC',
      description: 'Fix it.',
      priority: 'HIGH',
    };

    const first = await request(app)
      .post('/api/v1/work-orders')
      .set(authHeader(accessToken))
      .send(payload);
    await request(app)
      .patch(`/api/v1/work-orders/${first.body.id}/status`)
      .set(authHeader(accessToken))
      .send({ status: 'CANCELLED' });

    const second = await request(app)
      .post('/api/v1/work-orders')
      .set(authHeader(accessToken))
      .send(payload);
    expect(second.status).toBe(201);
  });

  it('is organisation-isolated', async () => {
    const orgA = await registerTestUser(app);
    const orgB = await registerTestUser(app);
    const { maintenanceRequestId } = await setupPropertySpaceAndRequest(orgA.accessToken);

    const created = await request(app)
      .post('/api/v1/work-orders')
      .set(authHeader(orgA.accessToken))
      .send({ maintenanceRequestId, title: 'Repair AC', description: 'Fix it.', priority: 'HIGH' });

    const res = await request(app)
      .get(`/api/v1/work-orders/${created.body.id}`)
      .set(authHeader(orgB.accessToken));
    expect(res.status).toBe(404);
  });

  it('rejects a work order for a maintenance request from another organisation', async () => {
    const orgA = await registerTestUser(app);
    const orgB = await registerTestUser(app);
    const { maintenanceRequestId } = await setupPropertySpaceAndRequest(orgA.accessToken);

    const res = await request(app)
      .post('/api/v1/work-orders')
      .set(authHeader(orgB.accessToken))
      .send({ maintenanceRequestId, title: 'Repair AC', description: 'Fix it.', priority: 'HIGH' });
    expect(res.status).toBe(404);
  });

  it('enforces the explicit lifecycle transitions', async () => {
    const { accessToken } = await registerTestUser(app);
    const { maintenanceRequestId } = await setupPropertySpaceAndRequest(accessToken);
    const created = await request(app)
      .post('/api/v1/work-orders')
      .set(authHeader(accessToken))
      .send({ maintenanceRequestId, title: 'Repair AC', description: 'Fix it.', priority: 'HIGH' });
    const id = created.body.id;

    // DRAFT -> IN_PROGRESS is not a legal jump.
    const invalid = await request(app)
      .patch(`/api/v1/work-orders/${id}/status`)
      .set(authHeader(accessToken))
      .send({ status: 'IN_PROGRESS' });
    expect(invalid.status).toBe(409);

    const toReady = await request(app)
      .patch(`/api/v1/work-orders/${id}/status`)
      .set(authHeader(accessToken))
      .send({ status: 'READY' });
    expect(toReady.status).toBe(200);
    expect(toReady.body.status).toBe('READY');

    const missingDate = await request(app)
      .patch(`/api/v1/work-orders/${id}/status`)
      .set(authHeader(accessToken))
      .send({ status: 'SCHEDULED' });
    expect(missingDate.status).toBe(409);

    const toScheduled = await request(app)
      .patch(`/api/v1/work-orders/${id}/status`)
      .set(authHeader(accessToken))
      .send({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(toScheduled.status).toBe(200);
    expect(toScheduled.body.scheduledAt).toBeTruthy();

    const toInProgress = await request(app)
      .patch(`/api/v1/work-orders/${id}/status`)
      .set(authHeader(accessToken))
      .send({ status: 'IN_PROGRESS' });
    expect(toInProgress.status).toBe(200);
    expect(toInProgress.body.startedAt).toBeTruthy();

    const toCompleted = await request(app)
      .patch(`/api/v1/work-orders/${id}/status`)
      .set(authHeader(accessToken))
      .send({ status: 'COMPLETED' });
    expect(toCompleted.status).toBe(200);
    expect(toCompleted.body.completedAt).toBeTruthy();

    const activityTypes = (
      await testPrisma.activityEvent.findMany({
        where: { entityId: id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((e) => e.eventType);
    expect(activityTypes).toEqual([
      'WORK_ORDER_CREATED',
      'WORK_ORDER_STATUS_CHANGED',
      'WORK_ORDER_STATUS_CHANGED',
      'WORK_ORDER_STATUS_CHANGED',
      'WORK_ORDER_STATUS_CHANGED',
    ]);
  });

  it('assigns a contractor and records activity', async () => {
    const { accessToken, organisationId } = await registerTestUser(app);
    const { maintenanceRequestId } = await setupPropertySpaceAndRequest(accessToken);
    const created = await request(app)
      .post('/api/v1/work-orders')
      .set(authHeader(accessToken))
      .send({ maintenanceRequestId, title: 'Repair AC', description: 'Fix it.', priority: 'HIGH' });

    const contractorRes = await request(app)
      .post('/api/v1/contractors')
      .set(authHeader(accessToken))
      .send({ name: 'Acme HVAC', email: 'ops@acmehvac.com', tradeTypes: ['HVAC'] });

    const assignRes = await request(app)
      .patch(`/api/v1/work-orders/${created.body.id}/contractor`)
      .set(authHeader(accessToken))
      .send({ contractorId: contractorRes.body.id });

    expect(assignRes.status).toBe(200);
    expect(assignRes.body.contractorId).toBe(contractorRes.body.id);

    const activity = await testPrisma.activityEvent.findFirst({
      where: { organisationId, eventType: 'CONTRACTOR_ASSIGNED' },
    });
    expect(activity).toBeTruthy();
  });

  it('denies resident access entirely', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const { propertyId, spaceId, maintenanceRequestId } =
      await setupPropertySpaceAndRequest(ownerToken);
    const created = await request(app)
      .post('/api/v1/work-orders')
      .set(authHeader(ownerToken))
      .send({ maintenanceRequestId, title: 'Repair AC', description: 'Fix it.', priority: 'HIGH' });

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

    const list = await request(app).get('/api/v1/work-orders').set(authHeader(residentToken));
    expect(list.status).toBe(403);

    const detail = await request(app)
      .get(`/api/v1/work-orders/${created.body.id}`)
      .set(authHeader(residentToken));
    expect(detail.status).toBe(403);
  });

  it('gives the resident a safe, plain-language progress label with no cost/contractor data', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send(validProperty);
    const spaceRes = await request(app)
      .post(`/api/v1/properties/${propertyRes.body.id}/spaces`)
      .set(authHeader(ownerToken))
      .send(validSpace);

    const resident = await createPlainUser();
    await request(app)
      .post(`/api/v1/properties/${propertyRes.body.id}/memberships`)
      .set(authHeader(ownerToken))
      .send({
        email: resident.email,
        firstName: 'Resi',
        lastName: 'Dent',
        role: 'TENANT',
        spaceId: spaceRes.body.id,
      });
    const contact = await testPrisma.propertyContact.findFirst({
      where: { email: resident.email },
    });
    const residentToken = residentAccessToken(resident.userId, organisationId, contact!.id);

    const reportRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(residentToken))
      .send({ ...validRequestPayload, propertyId: propertyRes.body.id, spaceId: spaceRes.body.id });
    const maintenanceRequestId = reportRes.body.id as string;

    await request(app)
      .post('/api/v1/work-orders')
      .set(authHeader(ownerToken))
      .send({ maintenanceRequestId, title: 'Repair AC', description: 'Fix it.', priority: 'HIGH' });

    const res = await request(app)
      .get(`/api/v1/maintenance-requests/${maintenanceRequestId}`)
      .set(authHeader(residentToken));
    expect(res.status).toBe(200);
    expect(res.body.residentWorkOrderStatus).toBe('Being reviewed');
    expect(res.body.contractorId).toBeUndefined();
    expect(res.body.estimatedCost).toBeUndefined();
  });
});
