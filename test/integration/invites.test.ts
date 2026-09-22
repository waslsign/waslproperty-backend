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

const validProperty = {
  name: 'Marina Heights',
  code: 'MARINA-HT',
  addressLine1: '1 Marina Blvd',
  city: 'Dubai',
  country: 'UAE',
  propertyType: 'MIXED_USE',
};

async function addContact(
  ownerToken: string,
  propertyId: string,
  overrides: Partial<{ email: string; firstName: string; lastName: string }> = {},
) {
  const email =
    overrides.email ?? `sara+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/memberships`)
    .set(authHeader(ownerToken))
    .send({
      email,
      firstName: overrides.firstName ?? 'Sara',
      lastName: overrides.lastName ?? 'Resident',
      role: 'RESIDENT',
    });
  return { contactId: res.body.contactId as string, email };
}

function activationLinkToken(): string {
  const call = sendMock.mock.calls.at(-1);
  const html = call?.[0]?.html as string;
  const match = /token=([a-f0-9]+)/.exec(html);
  if (!match) throw new Error('No activation token found in the last sent email');
  return match[1] as string;
}

describe('resident invites', () => {
  beforeEach(async () => {
    await resetDb();
    sendMock.mockClear();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('requires authentication to create an invite', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send(validProperty);
    const { contactId } = await addContact(ownerToken, propertyRes.body.id);

    const unauth = await request(app).post(`/api/v1/people/${contactId}/invite`);
    expect(unauth.status).toBe(401);
  });

  it('rejects inviting a contact that already has an active account', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send(validProperty);
    const { contactId, email } = await addContact(ownerToken, propertyRes.body.id);

    await request(app).post(`/api/v1/people/${contactId}/invite`).set(authHeader(ownerToken));
    const token = activationLinkToken();
    await request(app)
      .post(`/api/v1/invites/${token}/accept`)
      .send({ password: 'a-secret-password-1' });

    const res = await request(app)
      .post(`/api/v1/people/${contactId}/invite`)
      .set(authHeader(ownerToken));
    expect(res.status).toBe(409);
    void email;
  });

  it('creates a pending invite and sends an activation email', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send(validProperty);
    const { contactId } = await addContact(ownerToken, propertyRes.body.id);

    const res = await request(app)
      .post(`/api/v1/people/${contactId}/invite`)
      .set(authHeader(ownerToken));

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toBeDefined();
  });

  it('rejects inviting a contact from another organisation', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send(validProperty);
    const { contactId } = await addContact(ownerToken, propertyRes.body.id);

    const { accessToken: otherOwnerToken } = await registerTestUser(app, {
      organisationName: 'A Different Org',
    });

    const res = await request(app)
      .post(`/api/v1/people/${contactId}/invite`)
      .set(authHeader(otherOwnerToken));
    expect(res.status).toBe(404);
  });

  it('does not allow a second active invite while one is pending', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send(validProperty);
    const { contactId } = await addContact(ownerToken, propertyRes.body.id);

    const first = await request(app)
      .post(`/api/v1/people/${contactId}/invite`)
      .set(authHeader(ownerToken));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/people/${contactId}/invite`)
      .set(authHeader(ownerToken));
    expect(second.status).toBe(409);
  });

  it('resend rotates the token and revoke blocks the old one', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send(validProperty);
    const { contactId } = await addContact(ownerToken, propertyRes.body.id);

    await request(app).post(`/api/v1/people/${contactId}/invite`).set(authHeader(ownerToken));
    const firstToken = activationLinkToken();

    const resend = await request(app)
      .post(`/api/v1/people/${contactId}/invite/resend`)
      .set(authHeader(ownerToken));
    expect(resend.status).toBe(200);
    const secondToken = activationLinkToken();
    expect(secondToken).not.toBe(firstToken);

    // The old token is dead once resent.
    const oldPreview = await request(app).get(`/api/v1/invites/${firstToken}`);
    expect(oldPreview.status).toBe(404);

    const newPreview = await request(app).get(`/api/v1/invites/${secondToken}`);
    expect(newPreview.status).toBe(200);

    const revoke = await request(app)
      .post(`/api/v1/people/${contactId}/invite/revoke`)
      .set(authHeader(ownerToken));
    expect(revoke.status).toBe(200);
    expect(revoke.body.status).toBe('REVOKED');

    const revokedPreview = await request(app).get(`/api/v1/invites/${secondToken}`);
    expect(revokedPreview.status).toBe(409);

    // Revoking clears the way to invite again from scratch.
    const fresh = await request(app)
      .post(`/api/v1/people/${contactId}/invite`)
      .set(authHeader(ownerToken));
    expect(fresh.status).toBe(201);
  });

  it('rejects an expired token', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send(validProperty);
    const { contactId } = await addContact(ownerToken, propertyRes.body.id);

    await request(app).post(`/api/v1/people/${contactId}/invite`).set(authHeader(ownerToken));
    const token = activationLinkToken();

    await testPrisma.contactInvite.updateMany({
      where: { propertyContactId: contactId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const preview = await request(app).get(`/api/v1/invites/${token}`);
    expect(preview.status).toBe(409);

    const accept = await request(app)
      .post(`/api/v1/invites/${token}/accept`)
      .send({ password: 'brand-new-secret-1' });
    expect(accept.status).toBe(409);
  });

  it('activates a new account, links the contact, and cannot be reused', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send(validProperty);
    const { contactId, email } = await addContact(ownerToken, propertyRes.body.id, {
      firstName: 'Sara',
      lastName: 'Ali',
    });

    await request(app).post(`/api/v1/people/${contactId}/invite`).set(authHeader(ownerToken));
    const token = activationLinkToken();

    const preview = await request(app).get(`/api/v1/invites/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.email).toBe(email);
    expect(preview.body.accountExists).toBe(false);

    const accept = await request(app)
      .post(`/api/v1/invites/${token}/accept`)
      .send({ password: 'brand-new-secret-1' });
    expect(accept.status).toBe(200);
    expect(accept.body.accountType).toBe('resident');
    expect(accept.body.accessToken).toBeTruthy();

    const contact = await testPrisma.propertyContact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(contact.userId).not.toBeNull();
    expect(contact.status).toBe('ACTIVE');

    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.id).toBe(contact.userId);

    const invite = await testPrisma.contactInvite.findFirstOrThrow({
      where: { propertyContactId: contactId },
    });
    expect(invite.status).toBe('ACCEPTED');
    expect(invite.acceptedAt).not.toBeNull();

    // Cannot reuse.
    const reuse = await request(app)
      .post(`/api/v1/invites/${token}/accept`)
      .send({ password: 'another-secret-1' });
    expect(reuse.status).toBe(409);

    // Exactly one User row for this email.
    const usersWithEmail = await testPrisma.user.count({ where: { email } });
    expect(usersWithEmail).toBe(1);

    // The activated resident can now log in normally.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'brand-new-secret-1' });
    expect(login.status).toBe(200);
    expect(login.body.accountType).toBe('resident');
  });

  it('routes an invite to an email with an existing account through sign-in, never a password reset', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send(validProperty);

    // The contact is created first (no matching account yet, so the
    // existing auto-link-on-add mechanism has nothing to link to), and only
    // afterwards does an account with that same email come to exist — e.g.
    // Sara already runs her own separate organisation on Wasl Property.
    const { contactId, email } = await addContact(ownerToken, propertyRes.body.id);
    const saraPassword = 'sara-own-org-secret-1';
    const sara = await registerTestUser(app, {
      organisationName: "Sara's Own Org",
      email,
      password: saraPassword,
    });

    await request(app).post(`/api/v1/people/${contactId}/invite`).set(authHeader(ownerToken));
    const token = activationLinkToken();

    const preview = await request(app).get(`/api/v1/invites/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.accountExists).toBe(true);

    // The public "set a new password" path must refuse — no account
    // takeover via mere possession of the emailed link.
    const publicAccept = await request(app)
      .post(`/api/v1/invites/${token}/accept`)
      .send({ password: 'attacker-chosen-secret-1' });
    expect(publicAccept.status).toBe(409);

    // Signing in with the account's real password, then accepting, works.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: saraPassword });
    expect(login.status).toBe(200);
    expect(login.body.accountType).toBe('staff');

    const acceptExisting = await request(app)
      .post(`/api/v1/invites/${token}/accept-existing`)
      .set(authHeader(login.body.accessToken as string));
    expect(acceptExisting.status).toBe(204);

    const contact = await testPrisma.propertyContact.findUniqueOrThrow({
      where: { id: contactId },
    });
    expect(contact.userId).toBe(sara.userId);

    const usersWithEmail = await testPrisma.user.count({ where: { email } });
    expect(usersWithEmail).toBe(1);
  });

  it('rejects accept-existing when the authenticated user does not own the invited email', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const propertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(ownerToken))
      .send(validProperty);

    const { contactId } = await addContact(ownerToken, propertyRes.body.id);

    await request(app).post(`/api/v1/people/${contactId}/invite`).set(authHeader(ownerToken));
    const token = activationLinkToken();

    // ownerToken belongs to a different email entirely.
    const wrongUser = await request(app)
      .post(`/api/v1/invites/${token}/accept-existing`)
      .set(authHeader(ownerToken));
    expect(wrongUser.status).toBe(409);
  });

  it('accepts accept-existing even when the account is already a portal identity in a different organisation', async () => {
    const sharedEmail = 'already-a-resident@example.com';

    // This account is already a resident of its own organisation (Org A).
    // PropertyContact.userId is unique per organisation, not globally — the
    // same account may independently hold a second property-scoped
    // identity in a different organisation (Org B, below).
    const { accessToken: orgAOwnerToken } = await registerTestUser(app, {
      organisationName: 'Org A',
      email: sharedEmail,
      password: 'shared-secret-1',
    });
    const orgAPropertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(orgAOwnerToken))
      .send(validProperty);
    const orgAContact = await addContact(orgAOwnerToken, orgAPropertyRes.body.id, {
      email: sharedEmail,
    });
    const orgAContactRow = await testPrisma.propertyContact.findUniqueOrThrow({
      where: { id: orgAContact.contactId },
    });
    expect(orgAContactRow.userId).not.toBeNull();

    // Org B's contact for this same email must be created *before* Org A's
    // link exists in the underlying User row it resolves against — but
    // since the account already exists by the time Org B adds them, the
    // add-person auto-link mechanism would link it immediately (see
    // PeopleService.findOrCreateContact) rather than leaving it pending for
    // an invite. To exercise the invite/accept-existing path specifically,
    // this seeds Org B's contact directly (unlinked), mirroring a contact
    // created via CSV import or before this person's account existed.
    const { accessToken: orgBOwnerToken, organisationId: orgBId } = await registerTestUser(app, {
      organisationName: 'Org B',
    });
    const orgBPropertyRes = await request(app)
      .post('/api/v1/properties')
      .set(authHeader(orgBOwnerToken))
      .send(validProperty);
    const orgBContact = await testPrisma.propertyContact.create({
      data: { organisationId: orgBId, email: sharedEmail, firstName: 'Shared', lastName: 'Person' },
    });
    await testPrisma.propertyMembership.create({
      data: {
        organisationId: orgBId,
        propertyId: orgBPropertyRes.body.id,
        contactId: orgBContact.id,
        role: 'RESIDENT',
        status: 'ACTIVE',
        startDate: new Date(),
      },
    });
    await request(app)
      .post(`/api/v1/people/${orgBContact.id}/invite`)
      .set(authHeader(orgBOwnerToken));
    const token = activationLinkToken();

    // This account is now also a resident of its own Org A (added above with
    // the same email), so a plain login offers a choice — sign in as staff
    // explicitly, which is what this test actually needs.
    const orgALookup = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: 'shared-secret-1' });
    expect(orgALookup.status).toBe(200);
    expect(orgALookup.body.requiresOrganisationSelection).toBe(true);
    const orgAId = orgALookup.body.organisations[0].id as string;

    const login = await request(app).post('/api/v1/auth/login').send({
      email: sharedEmail,
      password: 'shared-secret-1',
      organisationId: orgAId,
      accountType: 'staff',
    });
    expect(login.status).toBe(200);
    expect(login.body.accountType).toBe('staff');

    const acceptExisting = await request(app)
      .post(`/api/v1/invites/${token}/accept-existing`)
      .set(authHeader(login.body.accessToken as string));
    expect(acceptExisting.status).toBe(204);

    const linkedOrgBContact = await testPrisma.propertyContact.findUniqueOrThrow({
      where: { id: orgBContact.id },
    });
    // Same physical account, two independent property-scoped identities —
    // never merged, never sharing a row.
    expect(linkedOrgBContact.userId).toBe(orgAContactRow.userId);
    expect(linkedOrgBContact.id).not.toBe(orgAContactRow.id);

    // The organisation-picker now offers all three real relationships.
    const finalLookup = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: sharedEmail, password: 'shared-secret-1' });
    expect(finalLookup.status).toBe(200);
    expect(finalLookup.body.requiresOrganisationSelection).toBe(true);
    expect(finalLookup.body.organisations).toHaveLength(3);
  });
});
