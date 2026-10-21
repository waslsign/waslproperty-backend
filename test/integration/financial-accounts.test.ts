import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import { authHeader, createPlainUser, registerTestUser, residentAccessToken } from '../helpers/auth.js';

const app = createApp();

const validProperty = {
  name: 'Darling Harbour Towers',
  code: 'DARLING-01',
  addressLine1: '88 Harbour Street',
  city: 'Sydney',
  state: 'NSW',
  country: 'Australia',
  propertyType: 'RESIDENTIAL',
};

async function registerAuOrg() {
  const session = await registerTestUser(app, {});
  const patchRes = await request(app)
    .patch('/api/v1/organisations/me')
    .set(authHeader(session.accessToken))
    .send({ countryCode: 'AU' });
  expect(patchRes.status).toBe(200);
  return session;
}

async function createProperty(accessToken: string) {
  const res = await request(app)
    .post('/api/v1/properties')
    .set(authHeader(accessToken))
    .send({
      ...validProperty,
      code: `DARLING-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function startFinancialSetup(accessToken: string, propertyId: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials`)
    .set(authHeader(accessToken))
    .send({
      financialYearStartDate: '2026-07-01',
      financialYearEndDate: '2027-06-30',
      cutoverDate: '2026-10-01',
    });
  expect(res.status).toBe(200);
  return res.body;
}

/** Only financial setup needs to have STARTED (not ACTIVE) for chart of
 * accounts work — see AccountsService.getConfiguration's doc comment. */
async function createPropertyWithFinancialSetup(accessToken: string) {
  const property = await createProperty(accessToken);
  await startFinancialSetup(accessToken, property.id);
  return property;
}

async function createAccount(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/accounts`)
    .set(authHeader(accessToken))
    .send(body);
}

async function listAccounts(accessToken: string, propertyId: string, query = '') {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/accounts${query}`)
    .set(authHeader(accessToken));
}

async function updateAccount(
  accessToken: string,
  propertyId: string,
  accountId: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .patch(`/api/v1/properties/${propertyId}/financials/accounts/${accountId}`)
    .set(authHeader(accessToken))
    .send(body);
}

async function deactivateAccount(accessToken: string, propertyId: string, accountId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/accounts/${accountId}/deactivate`)
    .set(authHeader(accessToken));
}

async function previewImport(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/accounts/import/preview`)
    .set(authHeader(accessToken))
    .send(body);
}

async function applyImport(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/accounts/import/apply`)
    .set(authHeader(accessToken))
    .send(body);
}

async function createPropertyRoleToken(
  ownerAccessToken: string,
  organisationId: string,
  propertyId: string,
  role: string,
) {
  const user = await createPlainUser();
  await request(app)
    .post(`/api/v1/properties/${propertyId}/memberships`)
    .set(authHeader(ownerAccessToken))
    .send({ email: user.email, firstName: 'P', lastName: 'M', role });
  const contact = await testPrisma.propertyContact.findFirstOrThrow({
    where: { organisationId, email: user.email },
  });
  return residentAccessToken(user.userId, organisationId, contact.id);
}

const realCsvPath = fileURLToPath(
  new URL('../fixtures/expense_codes_336684074.csv', import.meta.url),
);
const realCsvContent = readFileSync(realCsvPath, 'utf-8');

describe('M16.2.1 Chart of Accounts', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('accounts CRUD', () => {
    it('creates an account scoped to the property, assigning a publicReference', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      const res = await createAccount(accessToken, property.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });
      expect(res.status).toBe(201);
      expect(res.body.publicReference).toMatch(/^ACC-/);
      expect(res.body.isActive).toBe(true);
      expect(res.body.code).toBe('159100');
    });

    it('rejects creating an account before financial setup has started', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);

      const res = await createAccount(accessToken, property.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });
      expect(res.status).toBe(409);
    });

    it('rejects a duplicate code on the same property', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);
      await createAccount(accessToken, property.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });

      const res = await createAccount(accessToken, property.id, {
        code: '159100',
        name: 'A different name',
        classification: 'EXPENSE',
      });
      expect(res.status).toBe(409);
    });

    it('allows the same code on two different properties', async () => {
      const { accessToken } = await registerAuOrg();
      const propertyA = await createPropertyWithFinancialSetup(accessToken);
      const propertyB = await createPropertyWithFinancialSetup(accessToken);

      const a = await createAccount(accessToken, propertyA.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });
      const b = await createAccount(accessToken, propertyB.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
    });

    it('deactivates an account instead of deleting it — it is never removed from the database', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);
      const created = await createAccount(accessToken, property.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });

      const deactivated = await deactivateAccount(accessToken, property.id, created.body.id);
      expect(deactivated.status).toBe(200);
      expect(deactivated.body.isActive).toBe(false);

      const row = await testPrisma.accountingAccount.findUnique({ where: { id: created.body.id } });
      expect(row).not.toBeNull();

      const activeOnly = await listAccounts(accessToken, property.id);
      expect(activeOnly.body.items).toHaveLength(0);
      const all = await listAccounts(accessToken, property.id, '?activeOnly=false');
      expect(all.body.items).toHaveLength(1);
    });

    it('rejects a cross-property account reference', async () => {
      const { accessToken } = await registerAuOrg();
      const propertyA = await createPropertyWithFinancialSetup(accessToken);
      const propertyB = await createPropertyWithFinancialSetup(accessToken);
      const accountOnA = await createAccount(accessToken, propertyA.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });

      const res = await updateAccount(accessToken, propertyB.id, accountOnA.body.id, {
        name: 'Hijacked',
      });
      expect(res.status).toBe(404);
    });

    it('rejects an account being its own parent', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);
      const created = await createAccount(accessToken, property.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });

      const res = await updateAccount(accessToken, property.id, created.body.id, {
        parentAccountId: created.body.id,
      });
      expect(res.status).toBe(422);
    });
  });

  describe('CSV import — preview (dry run, writes nothing)', () => {
    it('does not persist anything from a preview call', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      const res = await previewImport(accessToken, property.id, {
        csvContent: 'Code,Name,Code type\n100000,Levy Contributions,Income\n',
        fileName: 'test.csv',
      });
      expect(res.status).toBe(200);
      expect(res.body.totalRows).toBe(1);

      const count = await testPrisma.accountingAccount.count({ where: { propertyId: property.id } });
      expect(count).toBe(0);
    });

    it('classifies an explicit "Income"/"Expense" Code type cell directly, as READY', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      const res = await previewImport(accessToken, property.id, {
        csvContent: 'Code,Name,Code type\n154804,Admin--Levy Contributions,Income\n',
      });
      expect(res.status).toBe(200);
      expect(res.body.rows[0].suggestedClassification).toBe('INCOME');
      expect(res.body.rows[0].suggestionConfidence).toBe('explicit');
      expect(res.body.rows[0].status).toBe('READY');
    });

    it('flags a duplicate code within the file as a blocking error', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      const res = await previewImport(accessToken, property.id, {
        csvContent:
          'Code,Name,Code type\n159100,Insurance--Premiums,Expense\n159100,Insurance--Premiums Again,Expense\n',
      });
      expect(res.status).toBe(200);
      expect(res.body.errorCount).toBe(1);
      expect(res.body.rows[1].status).toBe('ERROR');
    });

    it('flags a code that already exists on the property as a blocking error', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);
      await createAccount(accessToken, property.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });

      const res = await previewImport(accessToken, property.id, {
        csvContent: 'Code,Name,Code type\n159100,Insurance--Premiums,Expense\n',
      });
      expect(res.body.rows[0].status).toBe('ERROR');
      expect(res.body.rows[0].issues.join(' ')).toMatch(/already exists/);
    });

    it('never classifies from the filename — an unresolvable row is ERROR, not a silent default', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      const res = await previewImport(accessToken, property.id, {
        csvContent: 'Code,Name,Code type\n999999,Suspense & Unallocated Transfers,\n',
        fileName: 'expense_codes.csv',
      });
      expect(res.body.rows[0].suggestedClassification).toBeNull();
      expect(res.body.rows[0].status).toBe('ERROR');
    });

    it('validates the real reference CSV end to end: 483 rows, 0 duplicate codes, 1 explicit Income row', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      const res = await previewImport(accessToken, property.id, {
        csvContent: realCsvContent,
        fileName: 'expense_codes_336684074.csv',
      });
      expect(res.status).toBe(200);
      expect(res.body.totalRows).toBe(483);

      const codes = res.body.rows.map((r: { code: string }) => r.code);
      expect(new Set(codes).size).toBe(483);

      const duplicateCodeErrors = res.body.rows.filter((r: { issues: string[] }) =>
        r.issues.some((i) => i.includes('Duplicate code')),
      );
      expect(duplicateCodeErrors).toHaveLength(0);

      const explicitIncomeRow = res.body.rows.find(
        (r: { code: string }) => r.code === '154804',
      );
      expect(explicitIncomeRow.suggestedClassification).toBe('INCOME');
      expect(explicitIncomeRow.suggestionConfidence).toBe('explicit');

      // The embedded-newline row (160750) must be normalized to a single
      // clean name, never left with a raw newline inside it.
      const multilineRow = res.body.rows.find((r: { code: string }) => r.code === '160750');
      expect(multilineRow.name).not.toMatch(/\n/);
      expect(multilineRow.name.length).toBeGreaterThan(0);
    });
  });

  describe('CSV import — apply (atomic)', () => {
    it('applies a clean import atomically, creating one account per row', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      const res = await applyImport(accessToken, property.id, {
        csvContent:
          'Code,Name,Code type\n154804,Admin--Levy Contributions,Income\n159100,Insurance--Premiums,Expense\n',
        fileName: 'small.csv',
      });
      expect(res.status).toBe(201);
      expect(res.body.accounts).toHaveLength(2);
      expect(res.body.batch.createdCount).toBe(2);

      const count = await testPrisma.accountingAccount.count({ where: { propertyId: property.id } });
      expect(count).toBe(2);
    });

    it('writes nothing if any row is blocking — one bad row rejects the whole batch', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      const res = await applyImport(accessToken, property.id, {
        csvContent:
          'Code,Name,Code type\n154804,Admin--Levy Contributions,Income\n999999,Suspense & Unallocated Transfers,\n',
      });
      expect(res.status).toBe(422);

      const count = await testPrisma.accountingAccount.count({ where: { propertyId: property.id } });
      expect(count).toBe(0);
    });

    it('resolves a row with no heuristic suggestion via an explicit rowClassifications override', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      const res = await applyImport(accessToken, property.id, {
        csvContent: 'Code,Name,Code type\n999999,Suspense & Unallocated Transfers,\n',
        rowClassifications: { '1': 'ASSET' },
      });
      expect(res.status).toBe(201);
      expect(res.body.accounts[0].classification).toBe('ASSET');
    });

    it('re-validates from scratch on apply — a preview never leaves state the apply trusts blindly', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      await previewImport(accessToken, property.id, {
        csvContent: 'Code,Name,Code type\n159100,Insurance--Premiums,Expense\n',
      });
      // A different account with the same code is added by hand between
      // preview and apply — apply must catch the now-stale collision.
      await createAccount(accessToken, property.id, {
        code: '159100',
        name: 'Someone else got there first',
        classification: 'EXPENSE',
      });

      const res = await applyImport(accessToken, property.id, {
        csvContent: 'Code,Name,Code type\n159100,Insurance--Premiums,Expense\n',
      });
      expect(res.status).toBe(422);
    });

    it('applies the real reference CSV end to end with per-row overrides for every unresolved row', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      const preview = await previewImport(accessToken, property.id, { csvContent: realCsvContent });
      const rowClassifications: Record<string, string> = {};
      for (const row of preview.body.rows) {
        if (!row.suggestedClassification) {
          rowClassifications[String(row.rowNumber)] = 'EXPENSE';
        }
      }

      const res = await applyImport(accessToken, property.id, {
        csvContent: realCsvContent,
        fileName: 'expense_codes_336684074.csv',
        rowClassifications,
      });
      expect(res.status).toBe(201);
      expect(res.body.accounts).toHaveLength(483);

      const count = await testPrisma.accountingAccount.count({ where: { propertyId: property.id } });
      expect(count).toBe(483);
    });
  });

  describe('capability enforcement', () => {
    it('rejects every account endpoint for a user without financials.view/manage', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(ownerToken);
      const tenantToken = await createPropertyRoleToken(
        ownerToken,
        organisationId,
        property.id,
        'TENANT',
      );

      expect((await listAccounts(tenantToken, property.id)).status).toBe(403);
      expect(
        (
          await createAccount(tenantToken, property.id, {
            code: '159100',
            name: 'Insurance--Premiums',
            classification: 'EXPENSE',
          })
        ).status,
      ).toBe(403);
    });

    it('financials.view is sufficient to list but not to create/import/deactivate', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(ownerToken);
      const created = await createAccount(ownerToken, property.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });
      const viewerToken = await createPropertyRoleToken(
        ownerToken,
        organisationId,
        property.id,
        'OWNER',
      );

      expect((await listAccounts(viewerToken, property.id)).status).toBe(200);
      expect(
        (
          await createAccount(viewerToken, property.id, {
            code: '159200',
            name: 'Other',
            classification: 'EXPENSE',
          })
        ).status,
      ).toBe(403);
      expect((await deactivateAccount(viewerToken, property.id, created.body.id)).status).toBe(403);
      expect(
        (await previewImport(viewerToken, property.id, { csvContent: 'Code,Name\n1,A\n' })).status,
      ).toBe(403);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await request(app).get(
        '/api/v1/properties/does-not-matter/financials/accounts',
      );
      expect(res.status).toBe(401);
    });
  });

  describe('organisation isolation', () => {
    it('a user from a different organisation cannot see or access this property’s accounts', async () => {
      const { accessToken: ownerToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(ownerToken);
      await createAccount(ownerToken, property.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });

      const { accessToken: otherOrgToken } = await registerAuOrg();
      expect((await listAccounts(otherOrgToken, property.id)).status).toBe(404);
      expect(
        (
          await createAccount(otherOrgToken, property.id, {
            code: '999999',
            name: 'Hijack attempt',
            classification: 'EXPENSE',
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('concurrent imports', () => {
    it('applies two concurrent imports with an overlapping code safely — exactly one succeeds, no partial writes', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);

      const csv = 'Code,Name,Code type\n159100,Insurance--Premiums,Expense\n';
      const [first, second] = await Promise.all([
        applyImport(accessToken, property.id, { csvContent: csv, fileName: 'a.csv' }),
        applyImport(accessToken, property.id, { csvContent: csv, fileName: 'b.csv' }),
      ]);

      const statuses = [first.status, second.status].sort();
      // Either both genuinely raced (one 201, one 409 on the code
      // collision) or Prisma's interactive-transaction serialization
      // happened to fully order them (two 201s would mean a duplicate
      // code was written, which must never happen) — assert the
      // database-level invariant directly rather than the exact status
      // pairing, since that's what actually matters.
      expect(statuses).not.toEqual([201, 201]);

      const accounts = await testPrisma.accountingAccount.findMany({
        where: { propertyId: property.id, code: '159100' },
      });
      expect(accounts).toHaveLength(1);
    });
  });

  describe('CSV export', () => {
    it('exports the current chart of accounts as CSV text', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createPropertyWithFinancialSetup(accessToken);
      await createAccount(accessToken, property.id, {
        code: '159100',
        name: 'Insurance--Premiums',
        classification: 'EXPENSE',
      });

      const res = await request(app)
        .get(`/api/v1/properties/${property.id}/financials/accounts/export`)
        .set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.text).toContain('159100');
      expect(res.text).toContain('Insurance--Premiums');
    });
  });
});
