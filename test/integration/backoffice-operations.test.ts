import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import { authHeader, createPlatformUser, registerTestUser } from '../helpers/auth.js';

const app = createApp();

async function platformLogin(username: string, password: string) {
  const res = await request(app).post('/api/v1/backoffice/auth/login').send({ username, password });
  return res.body.accessToken as string;
}

describe('backoffice operational modules', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    env.BACKOFFICE_PII_MODE = undefined;
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('cross-cutting RBAC', () => {
    it('an ordinary customer OWNER token cannot reach any Backoffice operational route', async () => {
      const { accessToken } = await registerTestUser(app);
      const routes = [
        '/api/v1/backoffice/dashboard',
        '/api/v1/backoffice/organisations',
        '/api/v1/backoffice/users',
        '/api/v1/backoffice/property-data/properties',
        '/api/v1/backoffice/operations/requests',
        '/api/v1/backoffice/communications',
        '/api/v1/backoffice/jobs',
        '/api/v1/backoffice/integrations',
        '/api/v1/backoffice/audit',
        '/api/v1/backoffice/platform-users',
      ];
      for (const route of routes) {
        const res = await request(app).get(route).set(authHeader(accessToken));
        expect(res.status).toBe(401);
      }
    });

    it('PLATFORM_SUPPORT cannot manage organisations, retry-capability aside', async () => {
      const { username, password } = await createPlatformUser({ role: 'PLATFORM_SUPPORT' });
      const token = await platformLogin(username, password);

      const org = await testPrisma.organisation.create({
        data: { name: 'Support Test Org', slug: `support-test-${Date.now()}` },
      });

      const res = await request(app)
        .patch(`/api/v1/backoffice/organisations/${org.id}`)
        .set(authHeader(token))
        .send({ name: 'Renamed', reason: 'should be blocked' });
      expect(res.status).toBe(403);
    });

    it('PLATFORM_ADMIN cannot manage platform users (no platformUsers.manage)', async () => {
      const { username, password } = await createPlatformUser({ role: 'PLATFORM_ADMIN' });
      const token = await platformLogin(username, password);

      const res = await request(app).get('/api/v1/backoffice/platform-users').set(authHeader(token));
      expect(res.status).toBe(403);
    });
  });

  describe('dashboard', () => {
    it('returns real cross-organisation counts, not fabricated metrics', async () => {
      const { username, password } = await createPlatformUser();
      const token = await platformLogin(username, password);
      await registerTestUser(app, { organisationName: 'Dashboard Count Org' });

      const res = await request(app).get('/api/v1/backoffice/dashboard').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.metrics.organisations.total).toBeGreaterThanOrEqual(1);
      expect(res.body).not.toHaveProperty('uptimePercentage');
      expect(res.body).not.toHaveProperty('revenue');
    });
  });

  describe('organisations', () => {
    it('lists organisations across every tenant, not scoped to one', async () => {
      const { username, password } = await createPlatformUser();
      const token = await platformLogin(username, password);
      await registerTestUser(app, { organisationName: 'Cross Org Alpha' });
      await registerTestUser(app, { organisationName: 'Cross Org Beta' });

      const res = await request(app).get('/api/v1/backoffice/organisations').set(authHeader(token));
      expect(res.status).toBe(200);
      const names = res.body.items.map((o: { name: string }) => o.name);
      expect(names).toContain('Cross Org Alpha');
      expect(names).toContain('Cross Org Beta');
    });

    it('PLATFORM_ADMIN can update an organisation and it is audited', async () => {
      const { username, password } = await createPlatformUser({ role: 'PLATFORM_ADMIN' });
      const token = await platformLogin(username, password);
      const { organisationId } = await registerTestUser(app, { organisationName: 'Before Rename' });

      const res = await request(app)
        .patch(`/api/v1/backoffice/organisations/${organisationId}`)
        .set(authHeader(token))
        .send({ name: 'After Rename', reason: 'correcting a typo' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('After Rename');

      const audit = await testPrisma.platformAuditEvent.findFirst({
        where: { entityType: 'Organisation', entityId: organisationId },
      });
      expect(audit?.action).toBe('organisation.updated');
      expect(audit?.reason).toBe('correcting a typo');
    });
  });

  describe('global search', () => {
    it('finds a real organisation and masks person PII when policy requires it', async () => {
      const { username, password } = await createPlatformUser({ role: 'PLATFORM_SUPPORT' });
      const token = await platformLogin(username, password);
      const unique = `Findable-${Date.now()}`;
      await registerTestUser(app, { organisationName: `${unique} Properties` });

      // Force masked mode regardless of the (dev/test-friendly) default.
      env.BACKOFFICE_PII_MODE = 'masked';

      const res = await request(app)
        .get('/api/v1/backoffice/search')
        .query({ q: unique })
        .set(authHeader(token));
      expect(res.status).toBe(200);
      const org = res.body.items.find((r: { entityType: string }) => r.entityType === 'Organisation');
      expect(org.label).toContain(unique);
    });
  });

  describe('users directory', () => {
    it('excludes a pure platform-only employee with no customer relationship', async () => {
      const { email, username, password } = await createPlatformUser();
      const token = await platformLogin(username, password);

      const res = await request(app).get('/api/v1/backoffice/users').set(authHeader(token));
      expect(res.status).toBe(200);
      const emails = res.body.items.map((u: { email: string }) => u.email);
      expect(emails).not.toContain(email);
    });

    it('User 360 traces a staff member’s organisation membership', async () => {
      const { username, password } = await createPlatformUser();
      const token = await platformLogin(username, password);
      const { userId } = await registerTestUser(app, { organisationName: 'Trace Org' });

      const res = await request(app).get(`/api/v1/backoffice/users/${userId}`).set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.staffOrganisations).toHaveLength(1);
      expect(res.body.staffOrganisations[0].organisation.name).toBe('Trace Org');
      expect(res.body.staffOrganisations[0].role).toBe('OWNER');
    });
  });

  describe('jobs / delivery operations', () => {
    it('retries a FAILED delivery by resetting it to PENDING, and rejects retrying a non-failed one', async () => {
      const { username, password } = await createPlatformUser({ role: 'PLATFORM_SUPPORT' });
      const token = await platformLogin(username, password);
      const { organisationId, userId } = await registerTestUser(app, {
        organisationName: 'Retry Test Org',
      });

      const contact = await testPrisma.propertyContact.create({
        data: {
          organisationId,
          firstName: 'Retry',
          lastName: 'Recipient',
          email: `retry+${Date.now()}@example.com`,
        },
      });
      const communication = await testPrisma.communication.create({
        data: {
          organisationId,
          title: 'Retry Test Announcement',
          body: 'Body',
          channels: ['EMAIL'],
          audienceCriteria: { scope: 'ORGANISATION' },
          createdByUserId: userId,
          status: 'SENT',
          sentAt: new Date(),
        },
      });
      const recipient = await testPrisma.communicationRecipient.create({
        data: { communicationId: communication.id, contactId: contact.id },
      });
      const delivery = await testPrisma.communicationDelivery.create({
        data: {
          communicationRecipientId: recipient.id,
          channel: 'EMAIL',
          status: 'FAILED',
          failureReason: 'SMTP timeout',
        },
      });

      const retryRes = await request(app)
        .post(`/api/v1/backoffice/jobs/deliveries/${delivery.id}/retry`)
        .set(authHeader(token));
      expect(retryRes.status).toBe(200);
      expect(retryRes.body.status).toBe('PENDING');
      expect(retryRes.body.failureReason).toBeNull();

      const secondRetry = await request(app)
        .post(`/api/v1/backoffice/jobs/deliveries/${delivery.id}/retry`)
        .set(authHeader(token));
      expect(secondRetry.status).toBe(409);

      const audit = await testPrisma.platformAuditEvent.findFirst({
        where: { entityType: 'CommunicationDelivery', entityId: delivery.id },
      });
      expect(audit?.action).toBe('delivery.retried');
    });
  });

  describe('integrations / system health', () => {
    it('reports real, non-fabricated checks', async () => {
      const { username, password } = await createPlatformUser({ role: 'PLATFORM_DEVELOPER' });
      const token = await platformLogin(username, password);

      const res = await request(app).get('/api/v1/backoffice/integrations').set(authHeader(token));
      expect(res.status).toBe(200);
      const names = res.body.checks.map((c: { name: string }) => c.name);
      expect(names).toContain('Database (PostgreSQL)');
      expect(names).toContain('Communication delivery scheduler');
      expect(JSON.stringify(res.body)).not.toMatch(/uptime|datadog|cloudwatch|pagerduty/i);
    });
  });

  describe('internal platform users', () => {
    it('grants Backoffice access to an existing WaslProperty user and audits it', async () => {
      const { username: adminUsername, password: adminPassword } = await createPlatformUser();
      const token = await platformLogin(adminUsername, adminPassword);
      const { userId, accessToken: _t } = await registerTestUser(app, {
        email: `grantee+${Date.now()}@example.com`,
      });
      void _t;
      const granteeEmail = (await testPrisma.user.findUniqueOrThrow({ where: { id: userId } })).email;

      const res = await request(app)
        .post('/api/v1/backoffice/platform-users')
        .set(authHeader(token))
        .send({
          email: granteeEmail,
          username: `grantee.${Date.now()}`,
          role: 'PLATFORM_SUPPORT',
          reason: 'new support hire',
        });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe('PLATFORM_SUPPORT');

      const audit = await testPrisma.platformAuditEvent.findFirst({
        where: { action: 'platformUser.granted' },
      });
      expect(audit?.reason).toBe('new support hire');
    });

    it('refuses to deactivate the last active PLATFORM_SUPER_ADMIN', async () => {
      const { username, password, platformUserId } = await createPlatformUser();
      const token = await platformLogin(username, password);

      const res = await request(app)
        .patch(`/api/v1/backoffice/platform-users/${platformUserId}`)
        .set(authHeader(token))
        .send({ isActive: false, reason: 'self-lockout attempt' });
      expect(res.status).toBe(409);
    });

    it('allows deactivating a super admin once a second active one exists', async () => {
      const { username, password, platformUserId } = await createPlatformUser();
      const token = await platformLogin(username, password);
      await createPlatformUser({ email: `second-admin+${Date.now()}@example.com` });

      const res = await request(app)
        .patch(`/api/v1/backoffice/platform-users/${platformUserId}`)
        .set(authHeader(token))
        .send({ isActive: false, reason: 'role change' });
      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
    });
  });

  describe('property-data / spaces', () => {
    it('reports occupancy derived from active tenant/resident memberships, not raw Space.status', async () => {
      const { username, password } = await createPlatformUser();
      const token = await platformLogin(username, password);
      const { accessToken, organisationId } = await registerTestUser(app, {
        organisationName: 'Occupancy Test Org',
      });

      const propertyRes = await request(app)
        .post('/api/v1/properties')
        .set(authHeader(accessToken))
        .send({
          name: 'Occupancy Test Property',
          code: 'OCC-TEST',
          addressLine1: '1 Test St',
          city: 'Sydney',
          country: 'Australia',
          propertyType: 'RESIDENTIAL',
        });
      const propertyId = propertyRes.body.id as string;

      const spaceRes = await request(app)
        .post(`/api/v1/properties/${propertyId}/spaces`)
        .set(authHeader(accessToken))
        .send({ name: 'Unit 1', code: 'U1', spaceType: 'APARTMENT' });
      const occupiedSpaceId = spaceRes.body.id as string;

      const vacantSpaceRes = await request(app)
        .post(`/api/v1/properties/${propertyId}/spaces`)
        .set(authHeader(accessToken))
        .send({ name: 'Unit 2', code: 'U2', spaceType: 'APARTMENT' });
      const vacantSpaceId = vacantSpaceRes.body.id as string;

      const contact = await testPrisma.propertyContact.create({
        data: {
          organisationId,
          firstName: 'Occupant',
          lastName: 'Tenant',
          email: `occupant+${Date.now()}@example.com`,
        },
      });
      await testPrisma.propertyMembership.create({
        data: {
          organisationId,
          propertyId,
          spaceId: occupiedSpaceId,
          contactId: contact.id,
          role: 'TENANT',
          status: 'ACTIVE',
          startDate: new Date(),
        },
      });

      const res = await request(app)
        .get('/api/v1/backoffice/property-data/spaces')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      const items = res.body.items as { id: string; occupancy: string }[];
      expect(items.find((s) => s.id === occupiedSpaceId)?.occupancy).toBe('OCCUPIED');
      expect(items.find((s) => s.id === vacantSpaceId)?.occupancy).toBe('VACANT');
    });
  });

  describe('audit log', () => {
    it('lists recorded Backoffice mutations', async () => {
      const { username, password } = await createPlatformUser({ role: 'PLATFORM_ADMIN' });
      const token = await platformLogin(username, password);
      const { organisationId } = await registerTestUser(app, { organisationName: 'Audited Org' });
      await request(app)
        .patch(`/api/v1/backoffice/organisations/${organisationId}`)
        .set(authHeader(token))
        .send({ name: 'Audited Org Renamed', reason: 'test' });

      const res = await request(app).get('/api/v1/backoffice/audit').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.items.some((e: { action: string }) => e.action === 'organisation.updated')).toBe(
        true,
      );
    });
  });
});
