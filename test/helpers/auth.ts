import request from 'supertest';
import type { Express } from 'express';

export async function registerTestUser(
  app: Express,
  overrides: Partial<{
    organisationName: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }> = {},
) {
  const body = {
    organisationName: 'Marina Heights Management',
    firstName: 'Jane',
    lastName: 'Doe',
    email: `jane+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'super-secret-1',
    ...overrides,
  };

  const res = await request(app).post('/api/v1/auth/register').send(body);
  return {
    accessToken: res.body.accessToken as string,
    organisationId: res.body.organisation.id as string,
    userId: res.body.user.id as string,
  };
}

export function authHeader(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}
