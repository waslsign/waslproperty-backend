import request from 'supertest';
import type { Express } from 'express';
import { hashPassword } from '../../src/lib/password.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { testPrisma } from './db.js';

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

/**
 * Creates a plain login (User row, no OrganisationMembership) — the
 * pre-condition for the existing Add Person flow to link it as a resident
 * via email match. There is no self-service resident sign-up in M6.
 */
export async function createPlainUser(
  overrides: Partial<{ email: string; firstName: string; lastName: string; password: string }> = {},
) {
  const email =
    overrides.email ?? `resident+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = overrides.password ?? 'resident-secret-1';
  const passwordHash = await hashPassword(password);

  const user = await testPrisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: overrides.firstName ?? 'Resi',
      lastName: overrides.lastName ?? 'Dent',
    },
  });

  return { userId: user.id, email, password };
}

/** Signs a resident-shaped access token directly, mirroring how existing
 * tests simulate a MEMBER-role staff token without a full invite flow. */
export function residentAccessToken(
  userId: string,
  organisationId: string,
  propertyContactId: string,
) {
  return signAccessToken({ sub: userId, organisationId, orgRole: null, propertyContactId });
}
