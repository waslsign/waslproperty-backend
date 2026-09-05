import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import { authHeader, registerTestUser } from '../helpers/auth.js';

const app = createApp();

const validProperty = {
  name: 'Marina Heights',
  code: 'MARINA-HT',
  addressLine1: '1 Marina Blvd',
  city: 'Dubai',
  country: 'UAE',
  propertyType: 'MIXED_USE',
};

const validSpace = {
  name: 'Office 1204',
  code: '1204',
  spaceType: 'OFFICE',
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

describe('property/space overview summaries', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('derives property summary counts from real membership data', async () => {
    const { accessToken } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);

    // A second, empty space so vacant/occupied actually differ.
    await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken))
      .send({ name: 'Office 1205', code: '1205', spaceType: 'OFFICE' });

    await request(app)
      .post(`/api/v1/properties/${propertyId}/memberships`)
      .set(authHeader(accessToken))
      .send({
        email: 'owner@example.com',
        firstName: 'Omar',
        lastName: 'Owner',
        role: 'OWNER',
        spaceId,
      });
    await request(app)
      .post(`/api/v1/properties/${propertyId}/memberships`)
      .set(authHeader(accessToken))
      .send({
        email: 'tenant@example.com',
        firstName: 'Tara',
        lastName: 'Tenant',
        role: 'TENANT',
        spaceId,
      });
    await request(app)
      .post(`/api/v1/properties/${propertyId}/memberships`)
      .set(authHeader(accessToken))
      .send({
        email: 'pm@example.com',
        firstName: 'Priya',
        lastName: 'Manager',
        role: 'PROPERTY_MANAGER',
      });

    const res = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(authHeader(accessToken));

    expect(res.body.summary).toEqual({ spaces: 2, occupied: 1, vacant: 1, people: 3 });
  });

  it('shows a natural 1/1/0/N summary for a single-space property', async () => {
    const { accessToken } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);

    await request(app)
      .post(`/api/v1/properties/${propertyId}/memberships`)
      .set(authHeader(accessToken))
      .send({
        email: 'resident@example.com',
        firstName: 'Ahmed',
        lastName: 'Resident',
        role: 'RESIDENT',
        spaceId,
      });

    const res = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(authHeader(accessToken));

    expect(res.body.summary).toEqual({ spaces: 1, occupied: 1, vacant: 0, people: 1 });
  });

  it('derives owner/tenant key people on the space and leaves vacant spaces empty', async () => {
    const { accessToken } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);

    const vacant = await request(app).get(`/api/v1/spaces/${spaceId}`).set(authHeader(accessToken));
    expect(vacant.body.occupancy).toBe('VACANT');
    expect(vacant.body.owners).toEqual([]);
    expect(vacant.body.tenants).toEqual([]);
    expect(vacant.body.residents).toEqual([]);

    await request(app)
      .post(`/api/v1/properties/${propertyId}/memberships`)
      .set(authHeader(accessToken))
      .send({
        email: 'owner@example.com',
        firstName: 'Omar',
        lastName: 'Owner',
        role: 'OWNER',
        spaceId,
      });
    await request(app)
      .post(`/api/v1/properties/${propertyId}/memberships`)
      .set(authHeader(accessToken))
      .send({
        email: 'tenant@example.com',
        firstName: 'Tara',
        lastName: 'Tenant',
        role: 'TENANT',
        spaceId,
      });
    // A property manager on the same space should not show up as a key person.
    await request(app)
      .post(`/api/v1/properties/${propertyId}/memberships`)
      .set(authHeader(accessToken))
      .send({
        email: 'pm@example.com',
        firstName: 'Priya',
        lastName: 'Manager',
        role: 'PROPERTY_MANAGER',
        spaceId,
      });

    const occupied = await request(app)
      .get(`/api/v1/spaces/${spaceId}`)
      .set(authHeader(accessToken));
    expect(occupied.body.occupancy).toBe('OCCUPIED');
    expect(occupied.body.owners).toEqual([
      expect.objectContaining({ firstName: 'Omar', lastName: 'Owner' }),
    ]);
    expect(occupied.body.tenants).toEqual([
      expect.objectContaining({ firstName: 'Tara', lastName: 'Tenant' }),
    ]);
    expect(occupied.body.residents).toEqual([]);
  });
});

describe('activity', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/properties/does-not-matter/activity');
    expect(res.status).toBe(401);
  });

  it('records an event when a property is created', async () => {
    const { accessToken } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(accessToken))
      .send(validProperty);

    const res = await request(app)
      .get(`/api/v1/properties/${propertyRes.body.id}/activity`)
      .set(authHeader(accessToken));

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].eventType).toBe('PROPERTY_CREATED');
    expect(res.body.items[0].title).toBe('Marina Heights created');
  });

  it('records an event when a space is created, visible on both property and space activity', async () => {
    const { accessToken } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);

    const propertyActivity = await request(app)
      .get(`/api/v1/properties/${propertyId}/activity`)
      .set(authHeader(accessToken));
    expect(propertyActivity.body.total).toBe(2); // property created + space created
    expect(propertyActivity.body.items[0].eventType).toBe('SPACE_CREATED'); // newest first

    const spaceActivity = await request(app)
      .get(`/api/v1/spaces/${spaceId}/activity`)
      .set(authHeader(accessToken));
    expect(spaceActivity.body.total).toBe(1);
    expect(spaceActivity.body.items[0].eventType).toBe('SPACE_CREATED');
    expect(spaceActivity.body.items[0].title).toBe('Office 1204 created');
  });

  it('records an event when a person is added, scoped correctly to property vs space', async () => {
    const { accessToken } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(accessToken);

    await request(app)
      .post(`/api/v1/properties/${propertyId}/memberships`)
      .set(authHeader(accessToken))
      .send({
        email: 'owner@example.com',
        firstName: 'Omar',
        lastName: 'Owner',
        role: 'OWNER',
        spaceId,
      });
    await request(app)
      .post(`/api/v1/properties/${propertyId}/memberships`)
      .set(authHeader(accessToken))
      .send({
        email: 'pm@example.com',
        firstName: 'Priya',
        lastName: 'Manager',
        role: 'PROPERTY_MANAGER',
      });

    const propertyActivity = await request(app)
      .get(`/api/v1/properties/${propertyId}/activity`)
      .set(authHeader(accessToken));
    // property created, space created, 2x person added
    expect(propertyActivity.body.total).toBe(4);
    expect(propertyActivity.body.items[0].title).toBe(
      'Priya Manager added as Property Manager to Marina Heights',
    );
    expect(propertyActivity.body.items[1].title).toBe('Omar Owner added to Office 1204');

    const spaceActivity = await request(app)
      .get(`/api/v1/spaces/${spaceId}/activity`)
      .set(authHeader(accessToken));
    // Only the space-scoped person-added event and the space-created event — not the
    // property-level manager, and not the property-created event.
    expect(spaceActivity.body.total).toBe(2);
    expect(spaceActivity.body.items.map((e: { eventType: string }) => e.eventType).sort()).toEqual(
      ['PERSON_ADDED', 'SPACE_CREATED'].sort(),
    );
  });

  it('is organisation-isolated for property activity', async () => {
    const orgA = await registerTestUser(app);
    const orgB = await registerTestUser(app);
    const { propertyId } = await setupPropertyAndSpace(orgA.accessToken);

    const res = await request(app)
      .get(`/api/v1/properties/${propertyId}/activity`)
      .set(authHeader(orgB.accessToken));

    expect(res.status).toBe(404);
  });

  it('is organisation-isolated for space activity', async () => {
    const orgA = await registerTestUser(app);
    const orgB = await registerTestUser(app);
    const { spaceId } = await setupPropertyAndSpace(orgA.accessToken);

    const res = await request(app)
      .get(`/api/v1/spaces/${spaceId}/activity`)
      .set(authHeader(orgB.accessToken));

    expect(res.status).toBe(404);
  });

  it('rejects a tampered/unauthorised token', async () => {
    const { accessToken } = await registerTestUser(app);
    const { propertyId } = await setupPropertyAndSpace(accessToken);

    const res = await request(app)
      .get(`/api/v1/properties/${propertyId}/activity`)
      .set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(401);
  });
});
