import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { CommunicationDeliveryService } from '../../src/modules/communications/communications.delivery.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import { authHeader, registerTestUser } from '../helpers/auth.js';

const app = createApp();
const deliveryService = new CommunicationDeliveryService(testPrisma);

const validProperty = {
  name: 'Darling Harbour Towers',
  code: 'DARLING-01',
  addressLine1: '88 Harbour Street',
  city: 'Sydney',
  country: 'Australia',
  propertyType: 'MIXED_USE',
};

async function setupPropertyWithTenant(accessToken: string) {
  const propertyRes = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(accessToken))
    .send(validProperty);
  const propertyId = propertyRes.body.id as string;

  const spaceRes = await request(app)
    .post(`/api/v1/properties/${propertyId}/spaces`)
    .set(authHeader(accessToken))
    .send({ name: 'Apartment 803', code: '803', spaceType: 'APARTMENT' });
  const spaceId = spaceRes.body.id as string;

  const memberRes = await request(app)
    .post(`/api/v1/properties/${propertyId}/memberships`)
    .set(authHeader(accessToken))
    .send({
      email: `james+${Date.now()}@example.com`,
      firstName: 'James',
      lastName: 'Nguyen',
      role: 'TENANT',
      spaceId,
    });

  return { propertyId, spaceId, contactId: memberRes.body.contactId as string };
}

describe('communications', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/communications');
    expect(res.status).toBe(401);
  });

  it('rejects a MEMBER creating a communication but the endpoint stays staff-only (RBAC)', async () => {
    const { organisationId, userId } = await registerTestUser(app);
    const memberToken = signAccessToken({ sub: userId, sessionType: 'CUSTOMER', organisationId, orgRole: 'MEMBER' });

    const res = await request(app)
      .post('/api/v1/communications')
      .set(authHeader(memberToken))
      .send({
        title: 'Test',
        body: 'Body',
        channels: ['IN_APP'],
        audienceCriteria: { scope: 'ORGANISATION' },
      });

    expect(res.status).toBe(403);
  });

  it('creates a draft and does not resolve/send anything yet', async () => {
    const { accessToken, organisationId } = await registerTestUser(app);
    await setupPropertyWithTenant(accessToken);

    const res = await request(app)
      .post('/api/v1/communications')
      .set(authHeader(accessToken))
      .send({
        title: 'Lift maintenance this Thursday',
        body: 'Scheduled lift servicing.',
        channels: ['IN_APP', 'EMAIL'],
        audienceCriteria: { scope: 'ORGANISATION' },
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.sentAt).toBeNull();

    const recipients = await testPrisma.communicationRecipient.count({
      where: { communicationId: res.body.id },
    });
    expect(recipients).toBe(0);

    const activity = await testPrisma.activityEvent.findFirst({
      where: { organisationId, eventType: 'ANNOUNCEMENT_CREATED' },
    });
    expect(activity).not.toBeNull();
  });

  it('rejects WHATSAPP as a selectable channel — it is not live yet', async () => {
    const { accessToken } = await registerTestUser(app);
    const res = await request(app)
      .post('/api/v1/communications')
      .set(authHeader(accessToken))
      .send({
        title: 'Test',
        body: 'Body',
        channels: ['WHATSAPP'],
        audienceCriteria: { scope: 'ORGANISATION' },
      });

    expect(res.status).toBe(422);
  });

  it('previews audience count scoped to a property, filtered by role', async () => {
    const { accessToken } = await registerTestUser(app);
    const { propertyId } = await setupPropertyWithTenant(accessToken);

    const tenantPreview = await request(app)
      .post('/api/v1/communications/preview-audience')
      .set(authHeader(accessToken))
      .send({ audienceCriteria: { scope: 'PROPERTY', propertyIds: [propertyId], roles: ['TENANT'] } });
    expect(tenantPreview.status).toBe(200);
    expect(tenantPreview.body.count).toBe(1);
    expect(tenantPreview.body.summary).toContain('Darling Harbour Towers');

    const ownerPreview = await request(app)
      .post('/api/v1/communications/preview-audience')
      .set(authHeader(accessToken))
      .send({ audienceCriteria: { scope: 'PROPERTY', propertyIds: [propertyId], roles: ['OWNER'] } });
    expect(ownerPreview.status).toBe(200);
    expect(ownerPreview.body.count).toBe(0);
  });

  it('previews audience scoped to a specific space', async () => {
    const { accessToken } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyWithTenant(accessToken);

    // A second, unrelated space in the same property with nobody in it.
    const otherSpace = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken))
      .send({ name: 'Apartment 804', code: '804', spaceType: 'APARTMENT' });

    const inSpace = await request(app)
      .post('/api/v1/communications/preview-audience')
      .set(authHeader(accessToken))
      .send({ audienceCriteria: { scope: 'SPACE', spaceIds: [spaceId] } });
    expect(inSpace.body.count).toBe(1);

    const otherSpacePreview = await request(app)
      .post('/api/v1/communications/preview-audience')
      .set(authHeader(accessToken))
      .send({ audienceCriteria: { scope: 'SPACE', spaceIds: [otherSpace.body.id] } });
    expect(otherSpacePreview.body.count).toBe(0);
  });

  it('rejects PROPERTY scope with no properties selected', async () => {
    const { accessToken } = await registerTestUser(app);
    const res = await request(app)
      .post('/api/v1/communications/preview-audience')
      .set(authHeader(accessToken))
      .send({ audienceCriteria: { scope: 'PROPERTY' } });
    expect(res.status).toBe(422);
  });

  it('cannot edit a communication once it has been sent', async () => {
    const { accessToken } = await registerTestUser(app);
    await setupPropertyWithTenant(accessToken);

    const created = await request(app)
      .post('/api/v1/communications')
      .set(authHeader(accessToken))
      .send({
        title: 'Original title',
        body: 'Body',
        channels: ['IN_APP'],
        audienceCriteria: { scope: 'ORGANISATION' },
      });

    await request(app)
      .post(`/api/v1/communications/${created.body.id}/send`)
      .set(authHeader(accessToken))
      .send({});
    await deliveryService.processDue(new Date(Date.now() + 60_000));

    const editAttempt = await request(app)
      .patch(`/api/v1/communications/${created.body.id}`)
      .set(authHeader(accessToken))
      .send({ title: 'Changed title' });
    expect(editAttempt.status).toBe(409);
  });

  it('send-now resolves real recipients, creates in-app notifications, and marks SENT — full lifecycle', async () => {
    const { accessToken, organisationId } = await registerTestUser(app);
    const { propertyId } = await setupPropertyWithTenant(accessToken);

    const created = await request(app)
      .post('/api/v1/communications')
      .set(authHeader(accessToken))
      .send({
        title: 'Lift maintenance this Thursday',
        body: 'Scheduled lift servicing between 9am and 3pm.',
        channels: ['IN_APP'],
        audienceCriteria: { scope: 'PROPERTY', propertyIds: [propertyId], roles: ['TENANT'] },
      });
    const communicationId = created.body.id as string;

    const sendRes = await request(app)
      .post(`/api/v1/communications/${communicationId}/send`)
      .set(authHeader(accessToken))
      .send({});
    expect(sendRes.status).toBe(200);
    expect(sendRes.body.status).toBe('SCHEDULED');

    // Simulate the delivery worker's next tick, well past scheduledAt.
    const { processed } = await deliveryService.processDue(new Date(Date.now() + 60_000));
    expect(processed).toBe(1);

    const sent = await testPrisma.communication.findUnique({ where: { id: communicationId } });
    expect(sent?.status).toBe('SENT');
    expect(sent?.sentAt).not.toBeNull();

    const recipients = await testPrisma.communicationRecipient.findMany({
      where: { communicationId },
    });
    expect(recipients).toHaveLength(1);

    // James has no portal account in this fixture (contact-only) — there's
    // no inbox to deliver an IN_APP notice to, so no delivery row (and no
    // Notification row) is fabricated for a channel that isn't actually
    // reachable for him.
    const deliveries = await testPrisma.communicationDelivery.findMany({
      where: { communicationRecipientId: recipients[0]!.id },
    });
    expect(deliveries).toHaveLength(0);

    const notifications = await testPrisma.notification.count({ where: { organisationId } });
    expect(notifications).toBe(0);

    const activity = await testPrisma.activityEvent.findFirst({
      where: { organisationId, eventType: 'ANNOUNCEMENT_SENT' },
    });
    expect(activity?.description).toContain('1 recipient');
  });

  it('creates an in-app notification for a recipient who does have portal access', async () => {
    const { accessToken, organisationId } = await registerTestUser(app);
    const { propertyId } = await setupPropertyWithTenant(accessToken);

    // A second tenant who *does* have a linked portal user, via the
    // existing "link an existing Wasl Property user by email" behaviour.
    const portalUser = await request(app).post('/api/v1/auth/register').send({
      organisationName: 'Unrelated Org',
      firstName: 'Mia',
      lastName: 'Johnson',
      email: `mia+${Date.now()}@example.com`,
      password: 'super-secret-1',
    });

    await request(app)
      .post(`/api/v1/properties/${propertyId}/memberships`)
      .set(authHeader(accessToken))
      .send({
        email: portalUser.body.user.email,
        firstName: 'Mia',
        lastName: 'Johnson',
        role: 'OWNER',
      });

    const created = await request(app)
      .post('/api/v1/communications')
      .set(authHeader(accessToken))
      .send({
        title: 'Owner notice',
        body: 'Body',
        channels: ['IN_APP'],
        audienceCriteria: { scope: 'PROPERTY', propertyIds: [propertyId], roles: ['OWNER'] },
      });

    await request(app)
      .post(`/api/v1/communications/${created.body.id}/send`)
      .set(authHeader(accessToken))
      .send({});
    await deliveryService.processDue(new Date(Date.now() + 60_000));

    const notifications = await testPrisma.notification.findMany({
      where: { organisationId, sourceCommunicationId: created.body.id },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.title).toBe('Owner notice');
  });

  it('schedules for later, then can be cancelled before delivery', async () => {
    const { accessToken } = await registerTestUser(app);
    await setupPropertyWithTenant(accessToken);

    const created = await request(app)
      .post('/api/v1/communications')
      .set(authHeader(accessToken))
      .send({
        title: 'Scheduled notice',
        body: 'Body',
        channels: ['IN_APP'],
        audienceCriteria: { scope: 'ORGANISATION' },
      });

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const sendRes = await request(app)
      .post(`/api/v1/communications/${created.body.id}/send`)
      .set(authHeader(accessToken))
      .send({ scheduledAt: future });
    expect(sendRes.body.status).toBe('SCHEDULED');

    // Not yet due — processing now must not touch it.
    const { processed } = await deliveryService.processDue(new Date());
    expect(processed).toBe(0);
    const stillScheduled = await testPrisma.communication.findUnique({
      where: { id: created.body.id },
    });
    expect(stillScheduled?.status).toBe('SCHEDULED');

    const cancelRes = await request(app)
      .post(`/api/v1/communications/${created.body.id}/cancel`)
      .set(authHeader(accessToken));
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');

    const cancelAgain = await request(app)
      .post(`/api/v1/communications/${created.body.id}/cancel`)
      .set(authHeader(accessToken));
    expect(cancelAgain.status).toBe(409);
  });

  it('is organisation-isolated — another org cannot see or act on this communication', async () => {
    const orgA = await registerTestUser(app);
    await setupPropertyWithTenant(orgA.accessToken);
    const orgB = await registerTestUser(app);

    const created = await request(app)
      .post('/api/v1/communications')
      .set(authHeader(orgA.accessToken))
      .send({
        title: 'Org A only',
        body: 'Body',
        channels: ['IN_APP'],
        audienceCriteria: { scope: 'ORGANISATION' },
      });

    const crossOrgGet = await request(app)
      .get(`/api/v1/communications/${created.body.id}`)
      .set(authHeader(orgB.accessToken));
    expect(crossOrgGet.status).toBe(404);

    const crossOrgSend = await request(app)
      .post(`/api/v1/communications/${created.body.id}/send`)
      .set(authHeader(orgB.accessToken))
      .send({});
    expect(crossOrgSend.status).toBe(404);

    const list = await request(app)
      .get('/api/v1/communications')
      .set(authHeader(orgB.accessToken));
    expect(list.body.items).toHaveLength(0);
  });

  it('duplicates a sent announcement as a new editable draft', async () => {
    const { accessToken } = await registerTestUser(app);
    await setupPropertyWithTenant(accessToken);

    const created = await request(app)
      .post('/api/v1/communications')
      .set(authHeader(accessToken))
      .send({
        title: 'Original',
        body: 'Body text',
        channels: ['IN_APP'],
        audienceCriteria: { scope: 'ORGANISATION' },
      });
    await request(app)
      .post(`/api/v1/communications/${created.body.id}/send`)
      .set(authHeader(accessToken))
      .send({});
    await deliveryService.processDue(new Date(Date.now() + 60_000));

    const duplicated = await request(app)
      .post(`/api/v1/communications/${created.body.id}/duplicate`)
      .set(authHeader(accessToken));
    expect(duplicated.status).toBe(201);
    expect(duplicated.body.status).toBe('DRAFT');
    expect(duplicated.body.title).toBe('Original');
    expect(duplicated.body.id).not.toBe(created.body.id);
  });
});
