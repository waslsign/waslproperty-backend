import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import { authHeader, registerTestUser } from '../helpers/auth.js';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../src/lib/email.js', () => ({
  emailService: { send: sendMock },
}));

const app = createApp();

function activationTokenFromLastEmail(): string {
  const call = sendMock.mock.calls.at(-1);
  const html = call?.[0]?.html as string;
  const match = /token=([a-f0-9]+)/.exec(html);
  if (!match) throw new Error('No activation token found in the last sent email');
  return match[1] as string;
}

/**
 * Builds the scenario at the heart of these tests: one email/password that
 * is staff (OWNER) of Org A, and — independently — a resident of a space in
 * Org B. In practice this arises the moment Org B's staff adds a person
 * using an email that already has a Wasl Property account elsewhere — the
 * existing (M4) add-person-by-email-match auto-link fires immediately, no
 * invite needed (an invite is only for an email with *no* account yet).
 */
async function setupDualIdentityUser() {
  const sharedEmail = `dual+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const sharedPassword = 'dual-identity-secret-1';

  const orgA = await registerTestUser(app, {
    organisationName: 'Org A Staff Co',
    email: sharedEmail,
    password: sharedPassword,
  });

  const orgBOwner = await registerTestUser(app, { organisationName: 'Org B Residences' });
  const orgBPropertyRes = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(orgBOwner.accessToken))
    .send({
      name: 'Org B Property',
      code: 'ORGB-01',
      addressLine1: '1 Org B Street',
      city: 'Dubai',
      country: 'UAE',
      propertyType: 'MIXED_USE',
    });
  const orgBPropertyId = orgBPropertyRes.body.id as string;

  const addContactRes = await request(app)
    .post(`/api/v1/properties/${orgBPropertyId}/memberships`)
    .set(authHeader(orgBOwner.accessToken))
    .send({ email: sharedEmail, firstName: 'Dual', lastName: 'Identity', role: 'RESIDENT' });
  expect(addContactRes.body.contact.userId).toBeTruthy();

  return {
    sharedEmail,
    sharedPassword,
    orgAId: orgA.organisationId,
    orgBId: orgBOwner.organisationId,
    orgBPropertyId,
  };
}

/**
 * The same scenario as setupDualIdentityUser, but both relationships live
 * in the *same* organisation — a property manager who also personally
 * rents a unit in the portfolio they manage. Same auto-link mechanism:
 * adding a contact by an email that already has an account in *this same*
 * organisation links it immediately, no invite needed.
 */
async function setupSameOrgDualRoleUser() {
  const sharedEmail = `dual-same-org+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const sharedPassword = 'dual-same-org-secret-1';

  const owner = await registerTestUser(app, {
    organisationName: 'Self-Managed Residences',
    email: sharedEmail,
    password: sharedPassword,
  });

  const propertyRes = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(owner.accessToken))
    .send({
      name: 'Owner-Occupied Tower',
      code: 'SELF-01',
      addressLine1: '1 Self Street',
      city: 'Dubai',
      country: 'UAE',
      propertyType: 'MIXED_USE',
    });
  const propertyId = propertyRes.body.id as string;

  const addContactRes = await request(app)
    .post(`/api/v1/properties/${propertyId}/memberships`)
    .set(authHeader(owner.accessToken))
    .send({ email: sharedEmail, firstName: 'Dual', lastName: 'Role', role: 'RESIDENT' });
  expect(addContactRes.body.contact.userId).toBeTruthy();

  return {
    sharedEmail,
    sharedPassword,
    organisationId: owner.organisationId,
    propertyId,
  };
}

describe('organisation-contextual access', () => {
  beforeEach(async () => {
    await resetDb();
    sendMock.mockClear();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('a normal staff-only user signs in immediately, with no organisation choice', async () => {
    const email = `staff-only+${Date.now()}@example.com`;
    const password = 'staff-only-secret-1';
    await registerTestUser(app, { email, password });

    const res = await request(app).post('/api/v1/auth/login').send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.requiresOrganisationSelection).toBeUndefined();
    expect(res.body.accountType).toBe('staff');
    expect(res.body.orgRole).toBe('OWNER');
  });

  it('a normal resident-only user signs in immediately, with no organisation choice', async () => {
    const ownerToken = (await registerTestUser(app)).accessToken;
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send({
        name: 'Single Org Property',
        code: 'SOP-01',
        addressLine1: '1 Street',
        city: 'Dubai',
        country: 'UAE',
        propertyType: 'MIXED_USE',
      });

    const email = `resident-only+${Date.now()}@example.com`;
    const addRes = await request(app)
      .post(`/api/v1/properties/${propertyRes.body.id}/memberships`)
      .set(authHeader(ownerToken))
      .send({ email, firstName: 'Resi', lastName: 'Dent', role: 'RESIDENT' });

    await request(app)
      .post(`/api/v1/people/${addRes.body.contactId}/invite`)
      .set(authHeader(ownerToken));
    const token = activationTokenFromLastEmail();

    await request(app)
      .post(`/api/v1/invites/${token}/accept`)
      .send({ password: 'resident-secret-1' });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'resident-secret-1' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.requiresOrganisationSelection).toBeUndefined();
    expect(loginRes.body.accountType).toBe('resident');
  });

  it('a user who is staff in one org and resident in another is asked to choose, with both options listed', async () => {
    const { sharedEmail, sharedPassword, orgAId, orgBId } = await setupDualIdentityUser();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: sharedPassword });

    expect(res.status).toBe(200);
    expect(res.body.requiresOrganisationSelection).toBe(true);
    expect(res.body.accessToken).toBeUndefined();

    const orgIds = res.body.organisations.map((o: { id: string }) => o.id).sort();
    expect(orgIds).toEqual([orgAId, orgBId].sort());

    const orgAOption = res.body.organisations.find((o: { id: string }) => o.id === orgAId);
    const orgBOption = res.body.organisations.find((o: { id: string }) => o.id === orgBId);
    expect(orgAOption.accountType).toBe('staff');
    expect(orgBOption.accountType).toBe('resident');
  });

  it('signs into Org A as staff or Org B as resident depending on which organisationId is chosen', async () => {
    const { sharedEmail, sharedPassword, orgAId, orgBId } = await setupDualIdentityUser();

    const asStaff = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: sharedPassword, organisationId: orgAId });
    expect(asStaff.status).toBe(200);
    expect(asStaff.body.accountType).toBe('staff');
    expect(asStaff.body.orgRole).toBe('OWNER');
    expect(asStaff.body.organisation.id).toBe(orgAId);

    const asResident = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: sharedPassword, organisationId: orgBId });
    expect(asResident.status).toBe(200);
    expect(asResident.body.accountType).toBe('resident');
    expect(asResident.body.orgRole).toBeNull();
    expect(asResident.body.organisation.id).toBe(orgBId);
  });

  it('rejects an organisationId the user has no relationship in', async () => {
    const { sharedEmail, sharedPassword } = await setupDualIdentityUser();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: sharedPassword, organisationId: 'not-a-real-org' });

    expect(res.status).toBe(401);
  });

  it('does not let the resident-in-Org-B token access an Org A staff resource', async () => {
    const { sharedEmail, sharedPassword, orgAId, orgBId, orgBPropertyId } =
      await setupDualIdentityUser();

    const asStaffOrgA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: sharedPassword, organisationId: orgAId });
    const orgAPropertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(asStaffOrgA.body.accessToken))
      .send({
        name: 'Org A Property',
        code: 'ORGA-01',
        addressLine1: '1 Org A Street',
        city: 'Dubai',
        country: 'UAE',
        propertyType: 'MIXED_USE',
      });
    const orgAPropertyId = orgAPropertyRes.body.id as string;

    const asResidentOrgB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: sharedPassword, organisationId: orgBId });

    // Cannot reach Org A's property at all, even though this is the exact
    // same physical user/email that owns it as staff.
    const crossOrgRes = await request(app)
      .get(`/api/v1/properties/${orgAPropertyId}`)
      .set(authHeader(asResidentOrgB.body.accessToken));
    expect(crossOrgRes.status).toBe(404);

    // Their own Org B property (as a resident, read-only) is reachable.
    const ownOrgRes = await request(app)
      .get(`/api/v1/properties/${orgBPropertyId}`)
      .set(authHeader(asResidentOrgB.body.accessToken));
    expect(ownOrgRes.status).toBe(200);
  });

  it('does not let the staff-in-Org-A token inherit access to Org B, despite the same user being a resident there', async () => {
    const { sharedEmail, sharedPassword, orgAId, orgBId, orgBPropertyId } =
      await setupDualIdentityUser();

    const asStaffOrgA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: sharedPassword, organisationId: orgAId });

    const res = await request(app)
      .get(`/api/v1/properties/${orgBPropertyId}`)
      .set(authHeader(asStaffOrgA.body.accessToken));
    expect(res.status).toBe(404);

    void orgBId;
  });

  it('pins a refreshed session to the same organisation it was issued for', async () => {
    const { sharedEmail, sharedPassword, orgAId, orgBId } = await setupDualIdentityUser();

    const asResidentOrgB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: sharedPassword, organisationId: orgBId });
    const cookie = asResidentOrgB.headers['set-cookie'][0];

    const refreshRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refreshRes.status).toBe(200);

    const meRes = await request(app)
      .get('/api/v1/organisations/me')
      .set(authHeader(refreshRes.body.accessToken));
    expect(meRes.body.id).toBe(orgBId);
    expect(meRes.body.accountType).toBe('resident');

    void orgAId;
  });

  it('a user who is both staff and a resident in the SAME organisation is asked to choose', async () => {
    const { sharedEmail, sharedPassword, organisationId } = await setupSameOrgDualRoleUser();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: sharedPassword });

    expect(res.status).toBe(200);
    expect(res.body.requiresOrganisationSelection).toBe(true);
    expect(res.body.accessToken).toBeUndefined();

    // Both options share the same organisationId — accountType is what
    // distinguishes them.
    expect(res.body.organisations).toHaveLength(2);
    for (const option of res.body.organisations) {
      expect(option.id).toBe(organisationId);
    }
    const accountTypes = res.body.organisations
      .map((o: { accountType: string }) => o.accountType)
      .sort();
    expect(accountTypes).toEqual(['resident', 'staff']);
  });

  it('signs in as staff or resident within the same organisation depending on accountType', async () => {
    const { sharedEmail, sharedPassword, organisationId } = await setupSameOrgDualRoleUser();

    const asStaff = await request(app).post('/api/v1/auth/login').send({
      email: sharedEmail,
      password: sharedPassword,
      organisationId,
      accountType: 'staff',
    });
    expect(asStaff.status).toBe(200);
    expect(asStaff.body.accountType).toBe('staff');
    expect(asStaff.body.orgRole).toBe('OWNER');
    expect(asStaff.body.organisation.id).toBe(organisationId);

    const asResident = await request(app).post('/api/v1/auth/login').send({
      email: sharedEmail,
      password: sharedPassword,
      organisationId,
      accountType: 'resident',
    });
    expect(asResident.status).toBe(200);
    expect(asResident.body.accountType).toBe('resident');
    expect(asResident.body.orgRole).toBeNull();
    expect(asResident.body.organisation.id).toBe(organisationId);
  });

  it('rejects a same-organisation login when accountType is missing or does not match either option', async () => {
    const { sharedEmail, sharedPassword, organisationId } = await setupSameOrgDualRoleUser();

    const noAccountType = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: sharedPassword, organisationId });
    expect(noAccountType.status).toBe(401);

    const wrongAccountType = await request(app).post('/api/v1/auth/login').send({
      email: sharedEmail,
      password: sharedPassword,
      organisationId,
      accountType: 'not-a-real-type',
    });
    expect(wrongAccountType.status).toBe(422); // fails schema validation (enum)
  });

  it('pins a refreshed session to the exact relationship (resident) it was issued for, not the staff one gained in the same org', async () => {
    const { sharedEmail, sharedPassword, organisationId } = await setupSameOrgDualRoleUser();

    const asResident = await request(app).post('/api/v1/auth/login').send({
      email: sharedEmail,
      password: sharedPassword,
      organisationId,
      accountType: 'resident',
    });
    const cookie = asResident.headers['set-cookie'][0];

    const refreshRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refreshRes.status).toBe(200);

    const meRes = await request(app)
      .get('/api/v1/organisations/me')
      .set(authHeader(refreshRes.body.accessToken));
    expect(meRes.body.id).toBe(organisationId);
    // Must still resolve as resident on refresh — never silently upgraded
    // to the staff relationship that also exists in this same organisation.
    expect(meRes.body.accountType).toBe('resident');
  });

  it('pins a refreshed session to the staff relationship when that is what was issued, in the same dual-role org', async () => {
    const { sharedEmail, sharedPassword, organisationId } = await setupSameOrgDualRoleUser();

    const asStaff = await request(app).post('/api/v1/auth/login').send({
      email: sharedEmail,
      password: sharedPassword,
      organisationId,
      accountType: 'staff',
    });
    const cookie = asStaff.headers['set-cookie'][0];

    const refreshRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refreshRes.status).toBe(200);

    const meRes = await request(app)
      .get('/api/v1/organisations/me')
      .set(authHeader(refreshRes.body.accessToken));
    expect(meRes.body.id).toBe(organisationId);
    expect(meRes.body.accountType).toBe('staff');
  });
});
