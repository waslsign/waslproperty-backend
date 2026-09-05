import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/lib/tokens.js';
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

describe('properties', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/properties');
    expect(res.status).toBe(401);
  });

  it('creates a property scoped to the caller organisation', async () => {
    const { accessToken } = await registerTestUser(app);

    const res = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(accessToken))
      .send(validProperty);

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Marina Heights');
    expect(res.body.code).toBe('MARINA-HT');
    expect(res.body.status).toBe('ACTIVE');
  });

  it('rejects invalid payloads', async () => {
    const { accessToken } = await registerTestUser(app);

    const res = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(accessToken))
      .send({ ...validProperty, propertyType: 'NOT_A_TYPE' });

    expect(res.status).toBe(422);
  });

  it('allows a MEMBER to list properties but rejects a MEMBER creating one (RBAC)', async () => {
    const { organisationId, userId } = await registerTestUser(app);
    const memberToken = signAccessToken({ sub: userId, organisationId, orgRole: 'MEMBER' });

    const listRes = await request(app).get('/api/v1/properties').set(authHeader(memberToken));
    expect(listRes.status).toBe(200);

    const createRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(memberToken))
      .send(validProperty);
    expect(createRes.status).toBe(403);
  });

  it('prevents duplicate property codes within the same organisation', async () => {
    const { accessToken } = await registerTestUser(app);
    await request(app).post('/api/v1/properties').set(authHeader(accessToken)).send(validProperty);

    const res = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(accessToken))
      .send(validProperty);

    expect(res.status).toBe(409);
  });

  it('lists only the caller organisation properties (tenant isolation)', async () => {
    const orgA = await registerTestUser(app);
    const orgB = await registerTestUser(app);

    await request(app)
      .post('/api/v1/properties')
      .set(authHeader(orgA.accessToken))
      .send(validProperty);
    await request(app)
      .post('/api/v1/properties')
      .set(authHeader(orgB.accessToken))
      .send({ ...validProperty, code: 'OTHER-CODE' });

    const res = await request(app).get('/api/v1/properties').set(authHeader(orgA.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].code).toBe('MARINA-HT');
  });

  it('returns 404 when reading a property that belongs to another organisation', async () => {
    const orgA = await registerTestUser(app);
    const orgB = await registerTestUser(app);

    const createRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(orgA.accessToken))
      .send(validProperty);

    const res = await request(app)
      .get(`/api/v1/properties/${createRes.body.id}`)
      .set(authHeader(orgB.accessToken));

    expect(res.status).toBe(404);
  });

  it('returns a property 360 view including its space count', async () => {
    const { accessToken } = await registerTestUser(app);
    const createRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(accessToken))
      .send(validProperty);

    await request(app)
      .post(`/api/v1/properties/${createRes.body.id}/spaces`)
      .set(authHeader(accessToken))
      .send({ name: 'Apartment 1204', code: '1204', spaceType: 'APARTMENT' });

    const res = await request(app)
      .get(`/api/v1/properties/${createRes.body.id}`)
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body._count.spaces).toBe(1);
  });

  it('updates a property', async () => {
    const { accessToken } = await registerTestUser(app);
    const createRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(accessToken))
      .send(validProperty);

    const res = await request(app)
      .patch(`/api/v1/properties/${createRes.body.id}`)
      .set(authHeader(accessToken))
      .send({ name: 'Marina Heights Tower', status: 'INACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Marina Heights Tower');
    expect(res.body.status).toBe('INACTIVE');
  });
});
