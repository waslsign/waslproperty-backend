import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import { authHeader, registerTestUser } from '../helpers/auth.js';

const app = createApp();

describe('contractors', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/contractors');
    expect(res.status).toBe(401);
  });

  it('creates and lists a contractor', async () => {
    const { accessToken } = await registerTestUser(app);

    const create = await request(app)
      .post('/api/v1/contractors')
      .set(authHeader(accessToken))
      .send({
        name: 'Acme HVAC',
        companyName: 'Acme HVAC LLC',
        email: 'ops@acmehvac.com',
        tradeTypes: ['HVAC'],
      });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('ACTIVE');

    const list = await request(app).get('/api/v1/contractors').set(authHeader(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('rejects a duplicate email within the same organisation', async () => {
    const { accessToken } = await registerTestUser(app);
    const payload = { name: 'Acme HVAC', email: 'ops@acmehvac.com', tradeTypes: ['HVAC'] };
    await request(app).post('/api/v1/contractors').set(authHeader(accessToken)).send(payload);

    const dup = await request(app)
      .post('/api/v1/contractors')
      .set(authHeader(accessToken))
      .send(payload);
    expect(dup.status).toBe(409);
  });

  it('allows the same email across two different organisations', async () => {
    const orgA = await registerTestUser(app);
    const orgB = await registerTestUser(app);
    const payload = { name: 'Acme HVAC', email: 'ops@acmehvac.com', tradeTypes: ['HVAC'] };

    const a = await request(app)
      .post('/api/v1/contractors')
      .set(authHeader(orgA.accessToken))
      .send(payload);
    const b = await request(app)
      .post('/api/v1/contractors')
      .set(authHeader(orgB.accessToken))
      .send(payload);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('is organisation-isolated for detail lookups', async () => {
    const orgA = await registerTestUser(app);
    const orgB = await registerTestUser(app);
    const created = await request(app)
      .post('/api/v1/contractors')
      .set(authHeader(orgA.accessToken))
      .send({ name: 'Acme HVAC', email: 'ops@acmehvac.com', tradeTypes: ['HVAC'] });

    const res = await request(app)
      .get(`/api/v1/contractors/${created.body.id}`)
      .set(authHeader(orgB.accessToken));
    expect(res.status).toBe(404);
  });

  it('updates a contractor, including deactivating it', async () => {
    const { accessToken } = await registerTestUser(app);
    const created = await request(app)
      .post('/api/v1/contractors')
      .set(authHeader(accessToken))
      .send({ name: 'Acme HVAC', email: 'ops@acmehvac.com', tradeTypes: ['HVAC'] });

    const updated = await request(app)
      .patch(`/api/v1/contractors/${created.body.id}`)
      .set(authHeader(accessToken))
      .send({ status: 'INACTIVE' });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('INACTIVE');
  });
});
