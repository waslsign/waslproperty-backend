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
  name: 'Apartment 1204',
  code: '1204',
  spaceType: 'APARTMENT',
  floor: '12',
  sizeSqft: 950,
};

async function createProperty(app: Parameters<typeof registerTestUser>[0], accessToken: string) {
  const res = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(accessToken))
    .send(validProperty);
  return res.body.id as string;
}

describe('spaces', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('creates a space under a property', async () => {
    const { accessToken } = await registerTestUser(app);
    const propertyId = await createProperty(app, accessToken);

    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken))
      .send(validSpace);

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Apartment 1204');
    expect(res.body.code).toBe('1204');
    expect(res.body.status).toBe('VACANT');
  });

  it('rejects creating a space under a property from another organisation', async () => {
    const orgA = await registerTestUser(app);
    const orgB = await registerTestUser(app);
    const propertyId = await createProperty(app, orgA.accessToken);

    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(orgB.accessToken))
      .send(validSpace);

    expect(res.status).toBe(404);
  });

  it('prevents duplicate space codes within the same property', async () => {
    const { accessToken } = await registerTestUser(app);
    const propertyId = await createProperty(app, accessToken);

    await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken))
      .send(validSpace);

    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken))
      .send(validSpace);

    expect(res.status).toBe(409);
  });

  it('allows the same space code on two different properties', async () => {
    const { accessToken } = await registerTestUser(app);
    const propertyAId = await createProperty(app, accessToken);
    const propertyBRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(accessToken))
      .send({ ...validProperty, code: 'PALM-VILLAS' });

    await request(app)
      .post(`/api/v1/properties/${propertyAId}/spaces`)
      .set(authHeader(accessToken))
      .send(validSpace);

    const res = await request(app)
      .post(`/api/v1/properties/${propertyBRes.body.id}/spaces`)
      .set(authHeader(accessToken))
      .send(validSpace);

    expect(res.status).toBe(201);
  });

  it('lists spaces scoped to a single property', async () => {
    const { accessToken } = await registerTestUser(app);
    const propertyId = await createProperty(app, accessToken);
    await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken))
      .send(validSpace);

    const res = await request(app)
      .get(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].code).toBe('1204');
  });

  it('includes the current occupant name on the spaces list, null when vacant', async () => {
    const { accessToken } = await registerTestUser(app);
    const propertyId = await createProperty(app, accessToken);
    const spaceRes = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken))
      .send(validSpace);
    const vacantSpaceRes = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken))
      .send({ name: 'Apartment 1205', code: '1205', spaceType: 'APARTMENT' });

    const before = await request(app)
      .get(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken));
    const beforeOccupied = before.body.items.find((s: { id: string }) => s.id === spaceRes.body.id);
    expect(beforeOccupied.occupantName).toBeNull();

    await request(app)
      .post(`/api/v1/properties/${propertyId}/memberships`)
      .set(authHeader(accessToken))
      .send({
        email: 'tenant@example.com',
        firstName: 'Tara',
        lastName: 'Tenant',
        role: 'TENANT',
        spaceId: spaceRes.body.id,
      });

    const after = await request(app)
      .get(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken));
    const occupied = after.body.items.find((s: { id: string }) => s.id === spaceRes.body.id);
    const vacant = after.body.items.find((s: { id: string }) => s.id === vacantSpaceRes.body.id);
    expect(occupied.occupantName).toBe('Tara Tenant');
    expect(vacant.occupantName).toBeNull();
  });

  it('returns a space 360 view including its parent property', async () => {
    const { accessToken } = await registerTestUser(app);
    const propertyId = await createProperty(app, accessToken);
    const createRes = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken))
      .send(validSpace);

    const res = await request(app)
      .get(`/api/v1/spaces/${createRes.body.id}`)
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.property.code).toBe('MARINA-HT');
  });

  it('returns 404 for a space belonging to another organisation', async () => {
    const orgA = await registerTestUser(app);
    const orgB = await registerTestUser(app);
    const propertyId = await createProperty(app, orgA.accessToken);
    const createRes = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(orgA.accessToken))
      .send(validSpace);

    const res = await request(app)
      .get(`/api/v1/spaces/${createRes.body.id}`)
      .set(authHeader(orgB.accessToken));

    expect(res.status).toBe(404);
  });

  it('updates a space status', async () => {
    const { accessToken } = await registerTestUser(app);
    const propertyId = await createProperty(app, accessToken);
    const createRes = await request(app)
      .post(`/api/v1/properties/${propertyId}/spaces`)
      .set(authHeader(accessToken))
      .send(validSpace);

    const res = await request(app)
      .patch(`/api/v1/spaces/${createRes.body.id}`)
      .set(authHeader(accessToken))
      .send({ status: 'OCCUPIED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OCCUPIED');
  });
});
