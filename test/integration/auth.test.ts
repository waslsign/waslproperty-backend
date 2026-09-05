import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';

const app = createApp();

const validRegisterBody = {
  organisationName: 'Marina Heights Management',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  password: 'super-secret-1',
};

describe('auth flow', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('registers a new organisation + owner user', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(validRegisterBody);

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('jane@example.com');
    expect(res.body.organisation.name).toBe('Marina Heights Management');
    expect(res.body.organisation.slug).toBe('marina-heights-management');
    expect(res.body.orgRole).toBe('OWNER');
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.headers['set-cookie']?.[0]).toMatch(/wasl_property_refresh_token=/);
  });

  it('rejects registering the same email twice', async () => {
    await request(app).post('/api/v1/auth/register').send(validRegisterBody);
    const res = await request(app).post('/api/v1/auth/register').send(validRegisterBody);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects invalid registration payloads', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validRegisterBody, email: 'not-an-email' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with correct credentials', async () => {
    await request(app).post('/api/v1/auth/register').send(validRegisterBody);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validRegisterBody.email, password: validRegisterBody.password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
  });

  it('rejects login with the wrong password', async () => {
    await request(app).post('/api/v1/auth/register').send(validRegisterBody);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validRegisterBody.email, password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('rotates the refresh token and issues a new access token', async () => {
    const registerRes = await request(app).post('/api/v1/auth/register').send(validRegisterBody);
    const cookie = registerRes.headers['set-cookie'][0];

    const refreshRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTypeOf('string');
    // The rotated refresh cookie must differ from the one just used.
    expect(refreshRes.headers['set-cookie'][0]).not.toBe(cookie);

    // The old refresh token must be revoked (rotation) and no longer usable.
    const reuseRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(reuseRes.status).toBe(401);
  });

  it('logs out and revokes the refresh token', async () => {
    const registerRes = await request(app).post('/api/v1/auth/register').send(validRegisterBody);
    const cookie = registerRes.headers['set-cookie'][0];

    const logoutRes = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(logoutRes.status).toBe(204);

    const refreshRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refreshRes.status).toBe(401);
  });

  it('rejects refresh with no cookie at all', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('GET /organisations/me', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/organisations/me');
    expect(res.status).toBe(401);
  });

  it('returns the caller organisation and role', async () => {
    const registerRes = await request(app).post('/api/v1/auth/register').send(validRegisterBody);

    const res = await request(app)
      .get('/api/v1/organisations/me')
      .set('Authorization', `Bearer ${registerRes.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Marina Heights Management');
    expect(res.body.orgRole).toBe('OWNER');
  });

  it('rejects a tenant-isolation-breaking tampered token', async () => {
    const res = await request(app)
      .get('/api/v1/organisations/me')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(401);
  });
});
