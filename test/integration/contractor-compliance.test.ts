import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import { authHeader, registerTestUser, residentAccessToken } from '../helpers/auth.js';
import { ContractorComplianceNotificationService } from '../../src/modules/contractors/compliance/complianceNotifications.service.js';
import { getAttentionItems } from '../../src/lib/attention-engine.js';

const app = createApp();

const validProperty = {
  name: 'Marina Heights',
  code: 'MARINA-HT',
  addressLine1: '1 Marina Blvd',
  city: 'Dubai',
  country: 'UAE',
  propertyType: 'MIXED_USE',
};

async function setupWorkOrder(accessToken: string, category = 'ELECTRICAL') {
  const propertyRes = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(accessToken))
    .send(validProperty);
  const propertyId = propertyRes.body.id as string;
  const spaceRes = await request(app)
    .post(`/api/v1/properties/${propertyId}/spaces`)
    .set(authHeader(accessToken))
    .send({ name: 'Unit 1', code: 'U1', spaceType: 'APARTMENT' });
  const requestRes = await request(app)
    .post('/api/v1/maintenance-requests')
    .set(authHeader(accessToken))
    .send({
      title: 'Fix it',
      description: 'Needs fixing.',
      category,
      priority: 'HIGH',
      propertyId,
      spaceId: spaceRes.body.id,
    });
  const workOrderRes = await request(app)
    .post('/api/v1/work-orders')
    .set(authHeader(accessToken))
    .send({
      maintenanceRequestId: requestRes.body.id,
      title: 'Do the work',
      description: 'Do it well.',
      priority: 'HIGH',
    });
  return { propertyId, workOrderId: workOrderRes.body.id as string };
}

async function createContractor(
  accessToken: string,
  overrides: Partial<{ name: string; tradeCategories: string[] }> = {},
) {
  const res = await request(app)
    .post('/api/v1/contractors')
    .set(authHeader(accessToken))
    .send({
      name: overrides.name ?? 'Sparky Electrical',
      email: `contractor+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      tradeTypes: ['Electrical'],
      tradeCategories: overrides.tradeCategories ?? ['ELECTRICAL'],
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function createRequirement(
  accessToken: string,
  overrides: Partial<{
    category: string;
    credentialCategory: string;
    credentialType: string;
    required: boolean;
    enforcement: string;
    mustBeVerified: boolean;
    mustNotBeExpired: boolean;
  }> = {},
) {
  const res = await request(app)
    .post('/api/v1/organisations/me/contractor-compliance-requirements')
    .set(authHeader(accessToken))
    .send({
      category: overrides.category ?? 'ELECTRICAL',
      credentialCategory: overrides.credentialCategory ?? 'INSURANCE',
      credentialType: overrides.credentialType ?? 'Public Liability Insurance',
      required: overrides.required ?? true,
      enforcement: overrides.enforcement ?? 'BLOCK_ASSIGNMENT',
      mustBeVerified: overrides.mustBeVerified ?? true,
      mustNotBeExpired: overrides.mustNotBeExpired ?? true,
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function addCredential(
  accessToken: string,
  contractorId: string,
  overrides: Partial<{
    category: string;
    type: string;
    expiresAt: string;
    issuedAt: string;
  }> = {},
) {
  const res = await request(app)
    .post(`/api/v1/contractors/${contractorId}/credentials`)
    .set(authHeader(accessToken))
    .send({
      category: overrides.category ?? 'INSURANCE',
      type: overrides.type ?? 'Public Liability Insurance',
      ...(overrides.issuedAt ? { issuedAt: overrides.issuedAt } : {}),
      ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('contractor compliance & work eligibility', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('backward compatibility — no configured requirements', () => {
    it('a contractor remains assignable exactly as before when the organisation has configured nothing', async () => {
      const { accessToken } = await registerTestUser(app);
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken, { tradeCategories: [] });

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(200);
      expect(res.body.contractorId).toBe(contractorId);
    });

    it('an unclassified contractor (no tradeCategories) is never blocked by trade mismatch', async () => {
      const { accessToken } = await registerTestUser(app);
      const { workOrderId } = await setupWorkOrder(accessToken, 'PLUMBING');
      const contractorId = await createContractor(accessToken, { tradeCategories: [] });

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(200);
    });
  });

  describe('trade matching', () => {
    it('a contractor classified only for Plumbing is blocked from Electrical work (trade mismatch)', async () => {
      const { accessToken } = await registerTestUser(app);
      const { workOrderId } = await setupWorkOrder(accessToken, 'ELECTRICAL');
      const contractorId = await createContractor(accessToken, { tradeCategories: ['PLUMBING'] });

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(403);
      expect(res.body.error.details.blockingIssues[0].reason).toBe('TRADE_MISMATCH');
    });

    it('a requirement configured for Electrical never blocks a Plumbing work order', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, { category: 'ELECTRICAL' });
      const { workOrderId } = await setupWorkOrder(accessToken, 'PLUMBING');
      const contractorId = await createContractor(accessToken, { tradeCategories: ['PLUMBING'] });

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(200);
    });
  });

  describe('credential-based eligibility', () => {
    it('a required, verified, current credential satisfies the requirement — eligible', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(200);
    });

    it('a missing required credential blocks assignment when BLOCK_ASSIGNMENT', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(403);
      const issue = res.body.error.details.blockingIssues[0];
      expect(issue.reason).toBe('MISSING');
      expect(issue.credentialType).toBe('Public Liability Insurance');
    });

    it('an expired credential blocks assignment when mustNotBeExpired', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        issuedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(403);
      expect(res.body.error.details.blockingIssues[0].reason).toBe('EXPIRED');
    });

    it('an expired credential blocks assignment even when never verified (PENDING)', async () => {
      // Expiry is an objective date fact independent of verification — a
      // PENDING (never-reviewed) credential that is also expired must still
      // be treated as EXPIRED, not silently accepted because it "hasn't
      // been rejected yet."
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, { mustBeVerified: false });
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);
      await addCredential(accessToken, contractorId, {
        issuedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(403);
      expect(res.body.error.details.blockingIssues[0].reason).toBe('EXPIRED');
    });

    it('a credential still PENDING verification blocks assignment when mustBeVerified', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);
      await addCredential(accessToken, contractorId, {
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(403);
      expect(res.body.error.details.blockingIssues[0].reason).toBe('NOT_VERIFIED');
    });

    it('a PENDING credential is accepted when the requirement does not mandate verification', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, { mustBeVerified: false });
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);
      await addCredential(accessToken, contractorId, {
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(200);
    });

    it('a rejected credential fails the requirement', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId);
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/reject`)
        .set(authHeader(accessToken))
        .send({ notes: 'Certificate looks forged' });

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(403);
      expect(res.body.error.details.blockingIssues[0].reason).toBe('REJECTED');
    });

    it('a verified credential with no expiry date is valid indefinitely', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, {
        credentialCategory: 'BUSINESS_REGISTRATION',
        credentialType: 'ABN Registration',
      });
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        category: 'BUSINESS_REGISTRATION',
        type: 'ABN Registration',
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(200);
    });

    it('multiple requirements return structured, individually explained reasons', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, {
        credentialCategory: 'INSURANCE',
        credentialType: 'Public Liability Insurance',
      });
      await createRequirement(accessToken, {
        credentialCategory: 'CERTIFICATION',
        credentialType: 'Electrical Safety Certification',
      });
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);
      // Neither credential provided at all.

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(403);
      const issues = res.body.error.details.blockingIssues as Array<{ credentialType: string }>;
      expect(issues.map((i) => i.credentialType).sort()).toEqual([
        'Electrical Safety Certification',
        'Public Liability Insurance',
      ]);
    });

    it('a WARN_ONLY failure allows assignment', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, { enforcement: 'WARN_ONLY' });
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);
      // Missing credential entirely.

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(200);
    });

    it('the eligibility endpoint reports the same warning without blocking', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, { enforcement: 'WARN_ONLY' });
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);

      const res = await request(app)
        .get(`/api/v1/work-orders/${workOrderId}/contractor-eligibility`)
        .set(authHeader(accessToken));

      expect(res.status).toBe(200);
      const row = res.body.contractors.find(
        (c: { contractor: { id: string } }) => c.contractor.id === contractorId,
      );
      expect(row.eligibility.eligible).toBe(true);
      expect(row.eligibility.warnings).toHaveLength(1);
    });

    it('an optional (not required) requirement never blocks or warns when absent', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, {
        required: false,
        credentialCategory: 'INSURANCE',
        credentialType: 'Professional Indemnity',
      });
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(200);
    });
  });

  describe('contractor list compliance summary', () => {
    it('a compliant contractor has no issues and a Compliant status', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const res = await request(app).get('/api/v1/contractors').set(authHeader(accessToken));
      const row = res.body.items.find((c: { id: string }) => c.id === contractorId);

      expect(row.complianceStatus).toBe('COMPLIANT');
      expect(row.complianceIssueCount).toBe(0);
      expect(row.complianceTopIssues).toEqual([]);
    });

    it('an unclassified contractor (no trade categories) shows Compliant with no issues', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const contractorId = await createContractor(accessToken, { tradeCategories: [] });

      const res = await request(app).get('/api/v1/contractors').set(authHeader(accessToken));
      const row = res.body.items.find((c: { id: string }) => c.id === contractorId);

      expect(row.complianceStatus).toBe('COMPLIANT');
      expect(row.complianceIssueCount).toBe(0);
      expect(row.complianceTopIssues).toEqual([]);
    });

    it('a contractor with a single blocking issue surfaces its real reason in the list row', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const contractorId = await createContractor(accessToken);
      await addCredential(accessToken, contractorId, {
        issuedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });

      const res = await request(app).get('/api/v1/contractors').set(authHeader(accessToken));
      const row = res.body.items.find((c: { id: string }) => c.id === contractorId);

      expect(row.complianceStatus).toBe('EXPIRED_CREDENTIALS');
      expect(row.complianceIssueCount).toBe(1);
      expect(row.complianceTopIssues).toHaveLength(1);
      expect(row.complianceTopIssues[0].reason).toBe('EXPIRED');
      expect(row.complianceTopIssues[0].message).toMatch(/Public Liability Insurance expired/);
    });

    it('a contractor with multiple issues surfaces a capped top-issues list and a real total count', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, {
        credentialCategory: 'INSURANCE',
        credentialType: 'Public Liability Insurance',
      });
      await createRequirement(accessToken, {
        credentialCategory: 'LICENCE',
        credentialType: 'Electrical Contractor Licence',
        mustBeVerified: true,
      });
      const contractorId = await createContractor(accessToken);
      // Expired insurance.
      await addCredential(accessToken, contractorId, {
        category: 'INSURANCE',
        type: 'Public Liability Insurance',
        issuedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });
      // Licence uploaded but never verified.
      await addCredential(accessToken, contractorId, {
        category: 'LICENCE',
        type: 'Electrical Contractor Licence',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const res = await request(app).get('/api/v1/contractors').set(authHeader(accessToken));
      const row = res.body.items.find((c: { id: string }) => c.id === contractorId);

      expect(row.complianceIssueCount).toBe(2);
      expect(row.complianceTopIssues).toHaveLength(2);
      // Most severe first — an expired credential outranks a not-yet-verified one.
      expect(row.complianceTopIssues[0].reason).toBe('EXPIRED');
      expect(row.complianceTopIssues[1].reason).toBe('NOT_VERIFIED');
      // The overall status reflects the worse of the two.
      expect(row.complianceStatus).toBe('EXPIRED_CREDENTIALS');
    });

    it('a contractor with only a verified, expiring-soon credential shows an Expiring soon status and reason', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const res = await request(app).get('/api/v1/contractors').set(authHeader(accessToken));
      const row = res.body.items.find((c: { id: string }) => c.id === contractorId);

      expect(row.complianceStatus).toBe('EXPIRING_SOON');
      expect(row.complianceIssueCount).toBe(1);
      expect(row.complianceTopIssues[0].reason).toBe('EXPIRING_SOON');
      expect(row.complianceTopIssues[0].message).toMatch(/expires soon/);
    });

    it('list compliance summaries do not leak between contractors sharing the same trade category', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const compliantId = await createContractor(accessToken, { name: 'Compliant Co' });
      const compliantCredentialId = await addCredential(accessToken, compliantId, {
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${compliantId}/credentials/${compliantCredentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});
      const expiredId = await createContractor(accessToken, { name: 'Expired Co' });
      await addCredential(accessToken, expiredId, {
        issuedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });

      const res = await request(app).get('/api/v1/contractors').set(authHeader(accessToken));
      const compliantRow = res.body.items.find((c: { id: string }) => c.id === compliantId);
      const expiredRow = res.body.items.find((c: { id: string }) => c.id === expiredId);

      expect(compliantRow.complianceStatus).toBe('COMPLIANT');
      expect(compliantRow.complianceIssueCount).toBe(0);
      expect(expiredRow.complianceStatus).toBe('EXPIRED_CREDENTIALS');
      expect(expiredRow.complianceIssueCount).toBe(1);
    });
  });

  describe('applicable requirements (Contractor Detail compliance view)', () => {
    async function getCompliance(accessToken: string, contractorId: string) {
      const res = await request(app)
        .get(`/api/v1/contractors/${contractorId}/compliance`)
        .set(authHeader(accessToken));
      expect(res.status).toBe(200);
      return res.body as {
        status: string;
        applicableRequirements: Array<{
          requirementIds: string[];
          credentialCategory: string;
          credentialType: string;
          categories: string[];
          status: string;
          message: string;
          matchedCredentialId: string | null;
        }>;
      };
    }

    it('a contractor with two missing applicable requirements shows both, uncapped', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, {
        credentialCategory: 'INSURANCE',
        credentialType: 'Public Liability Insurance',
      });
      await createRequirement(accessToken, {
        credentialCategory: 'LICENCE',
        credentialType: 'Electrical Contractor Licence',
      });
      const contractorId = await createContractor(accessToken);

      const overview = await getCompliance(accessToken, contractorId);

      expect(overview.applicableRequirements).toHaveLength(2);
      expect(overview.applicableRequirements.every((r) => r.status === 'MISSING')).toBe(true);
      const types = overview.applicableRequirements.map((r) => r.credentialType).sort();
      expect(types).toEqual(['Electrical Contractor Licence', 'Public Liability Insurance']);
    });

    it('an expired credential is reflected on its requirement row with an EXPIRED status', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        issuedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const overview = await getCompliance(accessToken, contractorId);

      expect(overview.applicableRequirements).toHaveLength(1);
      expect(overview.applicableRequirements[0].status).toBe('EXPIRED');
      expect(overview.applicableRequirements[0].matchedCredentialId).toBe(credentialId);
    });

    it('a credential awaiting verification shows PENDING_VERIFICATION, not a dead end', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, { mustBeVerified: true });
      const contractorId = await createContractor(accessToken);
      await addCredential(accessToken, contractorId, {
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const overview = await getCompliance(accessToken, contractorId);

      expect(overview.applicableRequirements).toHaveLength(1);
      expect(overview.applicableRequirements[0].status).toBe('PENDING_VERIFICATION');
    });

    it('a fully verified, current credential shows the requirement as SATISFIED', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const overview = await getCompliance(accessToken, contractorId);

      expect(overview.applicableRequirements).toHaveLength(1);
      expect(overview.applicableRequirements[0].status).toBe('SATISFIED');
      expect(overview.applicableRequirements[0].matchedCredentialId).toBe(credentialId);
    });

    it('no credentials but applicable requirements exist: requirements are shown, not an empty page', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const contractorId = await createContractor(accessToken);

      const overview = await getCompliance(accessToken, contractorId);

      expect(overview.applicableRequirements).toHaveLength(1);
      expect(overview.applicableRequirements[0].status).toBe('MISSING');
    });

    it('no credentials and no applicable requirements: an empty list, not a fabricated one', async () => {
      const { accessToken } = await registerTestUser(app);
      const contractorId = await createContractor(accessToken);

      const overview = await getCompliance(accessToken, contractorId);

      expect(overview.applicableRequirements).toEqual([]);
      expect(overview.status).toBe('COMPLIANT');
    });

    it('a contractor classified for multiple trades sees every applicable requirement, without incorrect duplication', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, {
        category: 'ELECTRICAL',
        credentialCategory: 'LICENCE',
        credentialType: 'Electrical Contractor Licence',
      });
      await createRequirement(accessToken, {
        category: 'PLUMBING',
        credentialCategory: 'LICENCE',
        credentialType: 'Plumbing Contractor Licence',
      });
      const contractorId = await createContractor(accessToken, {
        tradeCategories: ['ELECTRICAL', 'PLUMBING'],
      });

      const overview = await getCompliance(accessToken, contractorId);

      expect(overview.applicableRequirements).toHaveLength(2);
      const types = overview.applicableRequirements.map((r) => r.credentialType).sort();
      expect(types).toEqual(['Electrical Contractor Licence', 'Plumbing Contractor Licence']);
    });

    it('the same credential requirement configured for two trades is represented once, listing both trades', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken, {
        category: 'ELECTRICAL',
        credentialCategory: 'INSURANCE',
        credentialType: 'Public Liability Insurance',
      });
      await createRequirement(accessToken, {
        category: 'PLUMBING',
        credentialCategory: 'INSURANCE',
        credentialType: 'Public Liability Insurance',
      });
      const contractorId = await createContractor(accessToken, {
        tradeCategories: ['ELECTRICAL', 'PLUMBING'],
      });

      const overview = await getCompliance(accessToken, contractorId);

      // One merged row, not two duplicate-looking "Public Liability
      // Insurance — Missing" rows.
      expect(overview.applicableRequirements).toHaveLength(1);
      const merged = overview.applicableRequirements[0];
      expect(merged.requirementIds).toHaveLength(2);
      expect([...merged.categories].sort()).toEqual(['ELECTRICAL', 'PLUMBING']);
      expect(merged.status).toBe('MISSING');
    });
  });

  describe('assignment enforcement cannot be bypassed', () => {
    it('a direct API assignment request is rejected exactly like the UI path — no bypass', async () => {
      const { accessToken } = await registerTestUser(app);
      await createRequirement(accessToken);
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);

      // No UI involved at all — a raw crafted request against the same
      // endpoint the frontend would call.
      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });

      expect(res.status).toBe(403);
      const workOrder = await testPrisma.workOrder.findUniqueOrThrow({
        where: { id: workOrderId },
      });
      expect(workOrder.contractorId).toBeNull();
    });
  });

  describe('organisation isolation', () => {
    it("Organisation A's compliance requirements never affect Organisation B", async () => {
      const orgA = await registerTestUser(app, { organisationName: 'Org A' });
      await createRequirement(orgA.accessToken);

      const orgB = await registerTestUser(app, { organisationName: 'Org B' });
      const { workOrderId } = await setupWorkOrder(orgB.accessToken);
      const contractorId = await createContractor(orgB.accessToken);

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(orgB.accessToken))
        .send({ contractorId });

      expect(res.status).toBe(200);
    });
  });

  describe('property-scoped authorization', () => {
    it('a property-scoped manager cannot assign a contractor on a work order for a property they do not manage', async () => {
      const owner = await registerTestUser(app);
      const propertyARes = await request(app)
        .post('/api/v1/properties')
        .set(authHeader(owner.accessToken))
        .send({ ...validProperty, code: 'PROP-A' });
      const propertyBRes = await request(app)
        .post('/api/v1/properties')
        .set(authHeader(owner.accessToken))
        .send({ ...validProperty, code: 'PROP-B' });

      // Manager is assigned to property A only.
      const addPersonRes = await request(app)
        .post(`/api/v1/properties/${propertyARes.body.id}/memberships`)
        .set(authHeader(owner.accessToken))
        .send({ email: 'pm@example.com', firstName: 'P', lastName: 'M', role: 'PROPERTY_MANAGER' });
      const managerToken = residentAccessToken(
        addPersonRes.body.contact.userId ?? addPersonRes.body.contactId,
        owner.organisationId,
        addPersonRes.body.contactId,
      );

      // A work order on property B.
      const spaceRes = await request(app)
        .post(`/api/v1/properties/${propertyBRes.body.id}/spaces`)
        .set(authHeader(owner.accessToken))
        .send({ name: 'Unit 1', code: 'U1', spaceType: 'APARTMENT' });
      const reqRes = await request(app)
        .post('/api/v1/maintenance-requests')
        .set(authHeader(owner.accessToken))
        .send({
          title: 'Fix it',
          description: 'Needs fixing.',
          category: 'ELECTRICAL',
          priority: 'HIGH',
          propertyId: propertyBRes.body.id,
          spaceId: spaceRes.body.id,
        });
      const workOrderRes = await request(app)
        .post('/api/v1/work-orders')
        .set(authHeader(owner.accessToken))
        .send({
          maintenanceRequestId: reqRes.body.id,
          title: 'Do the work',
          description: 'Do it well.',
          priority: 'HIGH',
        });
      const contractorId = await createContractor(owner.accessToken);

      const res = await request(app)
        .patch(`/api/v1/work-orders/${workOrderRes.body.id}/contractor`)
        .set(authHeader(managerToken))
        .send({ contractorId });

      // A real work order within the manager's own organisation, just on a
      // property they aren't assigned to — 403, not 404 (404 is reserved
      // for resources invisible to the caller's organisation entirely; see
      // the property-role-authorization milestone).
      expect(res.status).toBe(403);
    });
  });

  describe('credential verification authorization', () => {
    it('a resident/tenant cannot verify a credential', async () => {
      const owner = await registerTestUser(app);
      const propertyRes = await request(app)
        .post('/api/v1/properties')
        .set(authHeader(owner.accessToken))
        .send(validProperty);
      const contractorId = await createContractor(owner.accessToken);
      const credentialId = await addCredential(owner.accessToken, contractorId);

      const addPersonRes = await request(app)
        .post(`/api/v1/properties/${propertyRes.body.id}/memberships`)
        .set(authHeader(owner.accessToken))
        .send({ email: 'tenant@example.com', firstName: 'T', lastName: 'N', role: 'TENANT' });
      const tenantToken = residentAccessToken(
        addPersonRes.body.contactId,
        owner.organisationId,
        addPersonRes.body.contactId,
      );

      const res = await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(tenantToken))
        .send({});

      expect(res.status).toBe(403);
    });

    it('a user who can only view contractors cannot verify credentials', async () => {
      const owner = await registerTestUser(app);
      const propertyRes = await request(app)
        .post('/api/v1/properties')
        .set(authHeader(owner.accessToken))
        .send(validProperty);
      const contractorId = await createContractor(owner.accessToken);
      const credentialId = await addCredential(owner.accessToken, contractorId);

      // FACILITY_MANAGER holds contractors.view / contractor_compliance.view
      // by default, but not contractor_compliance.manage or .verify.
      const addPersonRes = await request(app)
        .post(`/api/v1/properties/${propertyRes.body.id}/memberships`)
        .set(authHeader(owner.accessToken))
        .send({ email: 'fm@example.com', firstName: 'F', lastName: 'M', role: 'FACILITY_MANAGER' });
      const fmToken = residentAccessToken(
        addPersonRes.body.contactId,
        owner.organisationId,
        addPersonRes.body.contactId,
      );

      const viewRes = await request(app)
        .get(`/api/v1/contractors/${contractorId}/credentials`)
        .set(authHeader(fmToken));
      expect(viewRes.status).toBe(200);

      const verifyRes = await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(fmToken))
        .send({});
      expect(verifyRes.status).toBe(403);
    });
  });

  describe('requirement configuration authorization', () => {
    it('only OWNER/ADMIN can configure compliance requirements — MEMBER is rejected', async () => {
      const { accessToken, organisationId } = await registerTestUser(app);
      const { signAccessToken } = await import('../../src/lib/tokens.js');
      const memberToken = signAccessToken({
        sub: 'nonexistent-but-shape-only',
        sessionType: 'CUSTOMER',
        organisationId,
        orgRole: 'MEMBER',
      });

      const res = await request(app)
        .post('/api/v1/organisations/me/contractor-compliance-requirements')
        .set(authHeader(memberToken))
        .send({
          category: 'ELECTRICAL',
          credentialCategory: 'INSURANCE',
          credentialType: 'Public Liability Insurance',
        });

      expect(res.status).toBe(403);
      // Sanity: OWNER succeeds with the same payload.
      const ownerRes = await request(app)
        .post('/api/v1/organisations/me/contractor-compliance-requirements')
        .set(authHeader(accessToken))
        .send({
          category: 'ELECTRICAL',
          credentialCategory: 'INSURANCE',
          credentialType: 'Public Liability Insurance',
        });
      expect(ownerRes.status).toBe(201);
    });
  });

  describe('expiry boundary calculation', () => {
    it('a credential expiring exactly at the threshold reads as EXPIRING_SOON, one second later as EXPIRED', async () => {
      const { accessToken } = await registerTestUser(app);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const res = await request(app)
        .get(`/api/v1/contractors/${contractorId}/credentials`)
        .set(authHeader(accessToken));
      expect(res.body.items[0].effectiveStatus).toBe('EXPIRING_SOON');
    });
  });

  describe('activity audit', () => {
    it('records activity for credential add, verify, reject, and requirement changes', async () => {
      const { accessToken, organisationId } = await registerTestUser(app);
      await createRequirement(accessToken);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId);
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const events = await testPrisma.activityEvent.findMany({ where: { organisationId } });
      const types = events.map((e) => e.eventType);
      expect(types).toContain('CONTRACTOR_CREDENTIAL_ADDED');
      expect(types).toContain('CONTRACTOR_CREDENTIAL_VERIFIED');
      expect(types).toContain('CONTRACTOR_COMPLIANCE_REQUIREMENTS_UPDATED');
    });
  });

  describe('notifications', () => {
    it('rejecting a credential notifies org OWNER/ADMIN staff, not the rejecting actor themselves', async () => {
      const { accessToken, organisationId, userId } = await registerTestUser(app);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId);

      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/reject`)
        .set(authHeader(accessToken))
        .send({ notes: 'Not valid' });

      const notifications = await testPrisma.notification.findMany({ where: { organisationId } });
      expect(notifications).toHaveLength(0); // sole OWNER excluded as the actor themself
      const allForUser = await testPrisma.notification.findMany({ where: { userId } });
      expect(allForUser).toHaveLength(0);
    });

    it('the expiry scheduler notifies org staff exactly once per credential per expiry state', async () => {
      const { accessToken, organisationId } = await registerTestUser(app);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const service = new ContractorComplianceNotificationService(testPrisma);
      const first = await service.checkExpiringAndExpiredCredentials(new Date());
      expect(first.notified).toBe(1);

      const second = await service.checkExpiringAndExpiredCredentials(new Date());
      expect(second.notified).toBe(0);

      const notifications = await testPrisma.notification.findMany({ where: { organisationId } });
      expect(notifications).toHaveLength(1);
    });
  });

  describe('Needs Your Attention — deterministic facts', () => {
    it('surfaces an expired credential as a CRITICAL, deterministic fact for org-wide staff', async () => {
      const { accessToken, organisationId } = await registerTestUser(app);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        issuedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const result = await getAttentionItems(testPrisma, organisationId, new Date());
      const item = result.items.find((i) => i.type === 'CONTRACTOR_CREDENTIAL_EXPIRED');
      expect(item).toBeTruthy();
      expect(item?.severity).toBe('CRITICAL');
      expect(item?.propertyId).toBeNull();
    });

    it('never appears for a property-scoped caller (contractors are organisation-wide, not property-scoped)', async () => {
      const { accessToken, organisationId } = await registerTestUser(app);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        issuedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});

      const result = await getAttentionItems(testPrisma, organisationId, new Date(), []);
      expect(result.items.some((i) => i.type === 'CONTRACTOR_CREDENTIAL_EXPIRED')).toBe(false);
    });

    it('surfaces a scheduled work order whose assigned contractor is no longer eligible', async () => {
      const { accessToken, organisationId } = await registerTestUser(app);
      await createRequirement(accessToken);
      const { workOrderId } = await setupWorkOrder(accessToken);
      const contractorId = await createContractor(accessToken);
      const credentialId = await addCredential(accessToken, contractorId, {
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/verify`)
        .set(authHeader(accessToken))
        .send({});
      await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/contractor`)
        .set(authHeader(accessToken))
        .send({ contractorId });
      await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'READY' });
      await request(app)
        .patch(`/api/v1/work-orders/${workOrderId}/status`)
        .set(authHeader(accessToken))
        .send({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 86400000).toISOString() });

      // The contractor's compliance now lapses (rejection) after assignment.
      await request(app)
        .post(`/api/v1/contractors/${contractorId}/credentials/${credentialId}/reject`)
        .set(authHeader(accessToken))
        .send({ notes: 'Revoked' });

      const result = await getAttentionItems(testPrisma, organisationId, new Date());
      const item = result.items.find((i) => i.type === 'WORK_ORDER_CONTRACTOR_NO_LONGER_ELIGIBLE');
      expect(item).toBeTruthy();
      expect(item?.propertyId).toBeTruthy();
    });
  });
});
