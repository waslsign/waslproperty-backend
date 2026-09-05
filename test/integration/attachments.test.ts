import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import {
  authHeader,
  createPlainUser,
  registerTestUser,
  residentAccessToken,
} from '../helpers/auth.js';

const { presignPutMock, presignGetMock } = vi.hoisted(() => ({
  presignPutMock: vi.fn(async (key: string) => `https://s3.example.com/${key}?upload=1`),
  presignGetMock: vi.fn(async (key: string) => `https://s3.example.com/${key}?download=1`),
}));

vi.mock('../../src/lib/s3.js', () => ({
  presignPut: presignPutMock,
  presignGet: presignGetMock,
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

const validSpace = {
  name: 'Apartment 1204',
  code: '1204',
  spaceType: 'APARTMENT',
};

const validRequestPayload = {
  title: 'Bedroom AC leaking',
  description: 'The bedroom AC is leaking water and has stopped cooling.',
  category: 'HVAC',
  priority: 'HIGH',
};

async function setupPropertyAndSpace(accessToken: string) {
  const propertyRes = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(accessToken))
    .send(validProperty);
  const spaceRes = await request(app)
    .post(`/api/v1/properties/${propertyRes.body.id}/spaces`)
    .set(authHeader(accessToken))
    .send(validSpace);
  return { propertyId: propertyRes.body.id as string, spaceId: spaceRes.body.id as string };
}

async function setupResidentOnSpace(
  ownerToken: string,
  organisationId: string,
  propertyId: string,
  spaceId: string,
) {
  const resident = await createPlainUser();
  const addRes = await request(app)
    .post(`/api/v1/properties/${propertyId}/memberships`)
    .set(authHeader(ownerToken))
    .send({ email: resident.email, firstName: 'Resi', lastName: 'Dent', role: 'TENANT', spaceId });

  const contactId = addRes.body.contactId as string;
  const accessToken = residentAccessToken(resident.userId, organisationId, contactId);
  return { userId: resident.userId, accessToken };
}

const onePng = { fileName: 'leak.png', contentType: 'image/png', fileSize: 1024 };

describe('maintenance request attachments', () => {
  beforeEach(async () => {
    await resetDb();
    presignPutMock.mockClear();
    presignGetMock.mockClear();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  it('lets the reporting resident presign, register, and list their own attachments', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
    const resident = await setupResidentOnSpace(ownerToken, organisationId, propertyId, spaceId);

    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(resident.accessToken))
      .send({ propertyId, spaceId, ...validRequestPayload });
    const requestId = createRes.body.id as string;

    const presign = await request(app)
      .post(`/api/v1/maintenance-requests/${requestId}/attachments/presign`)
      .set(authHeader(resident.accessToken))
      .send({ files: [onePng] });
    expect(presign.status).toBe(200);
    expect(presign.body.uploads).toHaveLength(1);
    const { storageKey, uploadUrl } = presign.body.uploads[0];
    expect(storageKey).toContain(
      `organisations/${organisationId}/maintenance-requests/${requestId}/`,
    );
    expect(uploadUrl).toContain(storageKey);

    const register = await request(app)
      .post(`/api/v1/maintenance-requests/${requestId}/attachments`)
      .set(authHeader(resident.accessToken))
      .send({ attachments: [{ ...onePng, storageKey }] });
    expect(register.status).toBe(201);
    expect(register.body.items).toHaveLength(1);
    expect(register.body.items[0].fileName).toBe('leak.png');

    const list = await request(app)
      .get(`/api/v1/maintenance-requests/${requestId}/attachments`)
      .set(authHeader(resident.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].url).toContain('download=1');
    expect(list.body.items[0].storageKey).toBeUndefined();
  });

  it('requires authentication to list attachments', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const { propertyId } = await setupPropertyAndSpace(ownerToken);
    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(ownerToken))
      .send({ propertyId, ...validRequestPayload });

    const res = await request(app).get(
      `/api/v1/maintenance-requests/${createRes.body.id}/attachments`,
    );
    expect(res.status).toBe(401);
  });

  it('does not let a resident upload to a request they did not report', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
    const reporter = await setupResidentOnSpace(ownerToken, organisationId, propertyId, spaceId);
    const otherResident = await setupResidentOnSpace(
      ownerToken,
      organisationId,
      propertyId,
      spaceId,
    );

    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(reporter.accessToken))
      .send({ propertyId, spaceId, ...validRequestPayload });
    const requestId = createRes.body.id as string;

    const presign = await request(app)
      .post(`/api/v1/maintenance-requests/${requestId}/attachments/presign`)
      .set(authHeader(otherResident.accessToken))
      .send({ files: [onePng] });
    expect(presign.status).toBe(404);

    const list = await request(app)
      .get(`/api/v1/maintenance-requests/${requestId}/attachments`)
      .set(authHeader(otherResident.accessToken));
    expect(list.status).toBe(404);
  });

  it('blocks cross-organisation access to attachments', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
    const resident = await setupResidentOnSpace(ownerToken, organisationId, propertyId, spaceId);

    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(resident.accessToken))
      .send({ propertyId, spaceId, ...validRequestPayload });
    const requestId = createRes.body.id as string;

    const { accessToken: otherOwnerToken } = await registerTestUser(app, {
      organisationName: 'A Different Org',
    });

    const res = await request(app)
      .get(`/api/v1/maintenance-requests/${requestId}/attachments`)
      .set(authHeader(otherOwnerToken));
    expect(res.status).toBe(404);
  });

  it('lets staff view attachments uploaded by a resident on their own org', async () => {
    const { accessToken: ownerToken, organisationId } = await registerTestUser(app);
    const { propertyId, spaceId } = await setupPropertyAndSpace(ownerToken);
    const resident = await setupResidentOnSpace(ownerToken, organisationId, propertyId, spaceId);

    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(resident.accessToken))
      .send({ propertyId, spaceId, ...validRequestPayload });
    const requestId = createRes.body.id as string;

    const presign = await request(app)
      .post(`/api/v1/maintenance-requests/${requestId}/attachments/presign`)
      .set(authHeader(resident.accessToken))
      .send({ files: [onePng] });
    await request(app)
      .post(`/api/v1/maintenance-requests/${requestId}/attachments`)
      .set(authHeader(resident.accessToken))
      .send({ attachments: [{ ...onePng, storageKey: presign.body.uploads[0].storageKey }] });

    const list = await request(app)
      .get(`/api/v1/maintenance-requests/${requestId}/attachments`)
      .set(authHeader(ownerToken));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('rejects a disallowed file type', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const { propertyId } = await setupPropertyAndSpace(ownerToken);
    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(ownerToken))
      .send({ propertyId, ...validRequestPayload });

    const res = await request(app)
      .post(`/api/v1/maintenance-requests/${createRes.body.id}/attachments/presign`)
      .set(authHeader(ownerToken))
      .send({
        files: [{ fileName: 'evil.exe', contentType: 'application/x-msdownload', fileSize: 100 }],
      });
    expect(res.status).toBe(422);
  });

  it('rejects a file over the size limit', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const { propertyId } = await setupPropertyAndSpace(ownerToken);
    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(ownerToken))
      .send({ propertyId, ...validRequestPayload });

    const res = await request(app)
      .post(`/api/v1/maintenance-requests/${createRes.body.id}/attachments/presign`)
      .set(authHeader(ownerToken))
      .send({ files: [{ ...onePng, fileSize: 11 * 1024 * 1024 }] });
    expect(res.status).toBe(422);
  });

  it('rejects more files than the per-request maximum', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const { propertyId } = await setupPropertyAndSpace(ownerToken);
    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(ownerToken))
      .send({ propertyId, ...validRequestPayload });

    const res = await request(app)
      .post(`/api/v1/maintenance-requests/${createRes.body.id}/attachments/presign`)
      .set(authHeader(ownerToken))
      .send({ files: Array.from({ length: 6 }, () => onePng) });
    expect(res.status).toBe(422);
  });

  it('rejects registering a storage key outside the request scope', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const { propertyId } = await setupPropertyAndSpace(ownerToken);
    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(ownerToken))
      .send({ propertyId, ...validRequestPayload });

    const res = await request(app)
      .post(`/api/v1/maintenance-requests/${createRes.body.id}/attachments`)
      .set(authHeader(ownerToken))
      .send({
        attachments: [
          { ...onePng, storageKey: 'organisations/someone-else/maintenance-requests/x/f.png' },
        ],
      });
    expect(res.status).toBe(422);
  });

  it('records a single activity event for a batch of attachments', async () => {
    const { accessToken: ownerToken } = await registerTestUser(app);
    const { propertyId } = await setupPropertyAndSpace(ownerToken);
    const createRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set(authHeader(ownerToken))
      .send({ propertyId, ...validRequestPayload });
    const requestId = createRes.body.id as string;

    const presign = await request(app)
      .post(`/api/v1/maintenance-requests/${requestId}/attachments/presign`)
      .set(authHeader(ownerToken))
      .send({ files: [onePng, onePng] });

    await request(app)
      .post(`/api/v1/maintenance-requests/${requestId}/attachments`)
      .set(authHeader(ownerToken))
      .send({
        attachments: presign.body.uploads.map((u: { storageKey: string }) => ({
          ...onePng,
          storageKey: u.storageKey,
        })),
      });

    const events = await testPrisma.activityEvent.findMany({
      where: { eventType: 'MAINTENANCE_REQUEST_ATTACHMENTS_ADDED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({ count: 2 });
  });
});
