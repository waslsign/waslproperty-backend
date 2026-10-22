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
    .send({ ...validProperty, code: `DARLING-${Date.now()}-${Math.random().toString(36).slice(2)}` });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function enableStrata(accessToken: string, propertyId: string) {
  return request(app).post(`/api/v1/properties/${propertyId}/strata/enable`).set(authHeader(accessToken)).send({ strataPlanNumber: 'SP90001' });
}

async function setLots(accessToken: string, propertyId: string, lots: unknown[]) {
  const res = await request(app).put(`/api/v1/properties/${propertyId}/strata/lots`).set(authHeader(accessToken)).send({ lots });
  expect(res.status).toBe(200);
  return res.body;
}

async function completeStrataSetup(accessToken: string, propertyId: string) {
  const res = await request(app).post(`/api/v1/properties/${propertyId}/strata/complete`).set(authHeader(accessToken));
  expect(res.status).toBe(200);
}

async function startFinancialSetup(accessToken: string, propertyId: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials`)
    .set(authHeader(accessToken))
    .send({ financialYearStartDate: '2026-07-01', financialYearEndDate: '2027-06-30', cutoverDate: '2026-10-01' });
  expect(res.status).toBe(200);
}

async function addFund(accessToken: string, propertyId: string, fundType: string) {
  const res = await request(app).post(`/api/v1/properties/${propertyId}/financials/funds`).set(authHeader(accessToken)).send({ fundType });
  expect(res.status).toBe(200);
  return res.body;
}

async function activateFinancialSetup(accessToken: string, propertyId: string) {
  return request(app).post(`/api/v1/properties/${propertyId}/financials/activate`).set(authHeader(accessToken));
}

async function createAccount(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  const res = await request(app).post(`/api/v1/properties/${propertyId}/financials/accounts`).set(authHeader(accessToken)).send(body);
  expect(res.status).toBe(201);
  return res.body as { id: string; code: string };
}

async function upsertPostingProfile(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  const res = await request(app).put(`/api/v1/properties/${propertyId}/financials/posting-profile`).set(authHeader(accessToken)).send(body);
  expect(res.status).toBe(201);
  return res.body;
}

async function createPeriod(accessToken: string, propertyId: string, startDate: string, endDate: string) {
  const res = await request(app).post(`/api/v1/properties/${propertyId}/financials/periods`).set(authHeader(accessToken)).send({ startDate, endDate });
  expect(res.status).toBe(201);
  return res.body;
}

async function recordReceipt(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  const res = await request(app).post(`/api/v1/properties/${propertyId}/financials/receipts`).set(authHeader(accessToken)).send(body);
  expect(res.status).toBe(201);
  return res.body;
}

async function registerBankAccount(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/v1/properties/${propertyId}/financials/bank-accounts`).set(authHeader(accessToken)).send(body);
}

async function previewStatement(accessToken: string, propertyId: string, bankAccountId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/bank-accounts/${bankAccountId}/statements/preview`)
    .set(authHeader(accessToken))
    .send(body);
}

async function applyStatement(accessToken: string, propertyId: string, bankAccountId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/bank-accounts/${bankAccountId}/statements/apply`)
    .set(authHeader(accessToken))
    .send(body);
}

async function listTransactions(accessToken: string, propertyId: string, bankAccountId: string, query = '') {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/bank-accounts/${bankAccountId}/transactions${query}`)
    .set(authHeader(accessToken));
}

async function suggestMatch(accessToken: string, propertyId: string, bankTransactionId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/bank-transactions/${bankTransactionId}/suggest-match`)
    .set(authHeader(accessToken))
    .send({});
}

async function confirmMatch(accessToken: string, propertyId: string, matchId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/bank-transaction-matches/${matchId}/confirm`)
    .set(authHeader(accessToken))
    .send({});
}

async function manualMatchReceipt(accessToken: string, propertyId: string, bankTransactionId: string, receiptId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/bank-transactions/${bankTransactionId}/match/receipt`)
    .set(authHeader(accessToken))
    .send({ receiptId });
}

async function createDraftReconciliation(accessToken: string, propertyId: string, bankAccountId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/bank-accounts/${bankAccountId}/reconciliations`)
    .set(authHeader(accessToken))
    .send(body);
}

async function calculateReconciliation(accessToken: string, propertyId: string, reconciliationId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/reconciliations/${reconciliationId}/calculate`)
    .set(authHeader(accessToken))
    .send({});
}

async function completeReconciliation(accessToken: string, propertyId: string, reconciliationId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/reconciliations/${reconciliationId}/complete`)
    .set(authHeader(accessToken))
    .send({});
}

async function reopenReconciliation(accessToken: string, propertyId: string, reconciliationId: string, reason = 'test reopen') {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/reconciliations/${reconciliationId}/reopen`)
    .set(authHeader(accessToken))
    .send({ reason });
}

async function createSchemeReadyForBanking(accessToken: string) {
  const property = await createProperty(accessToken);
  await enableStrata(accessToken, property.id);
  const summary = await setLots(accessToken, property.id, [
    { kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 100 },
    { kind: 'new', name: 'Lot 2', code: 'L2', unitsOfEntitlement: 100 },
  ]);
  await completeStrataSetup(accessToken, property.id);
  await startFinancialSetup(accessToken, property.id);
  await addFund(accessToken, property.id, 'ADMINISTRATION');
  await addFund(accessToken, property.id, 'CAPITAL_WORKS');
  const lots = summary.lots as Array<{ spaceId: string }>;
  const spaceId = lots[0]!.spaceId;
  const space2Id = lots[1]!.spaceId;

  const activation = await activateFinancialSetup(accessToken, property.id);
  expect(activation.status).toBe(200);
  const funds = activation.body.funds as Array<{ id: string; fundType: string }>;
  const administrationFundId = funds.find((f) => f.fundType === 'ADMINISTRATION')!.id;

  const receivable = await createAccount(accessToken, property.id, { code: '310000', name: 'Lot Levy Receivable', classification: 'ASSET' });
  const income = await createAccount(accessToken, property.id, { code: '100000', name: 'Levy Contributions', classification: 'INCOME' });
  const cash = await createAccount(accessToken, property.id, { code: '110000', name: 'Admin Bank Account', classification: 'ASSET' });
  const unapplied = await createAccount(accessToken, property.id, { code: '210000', name: 'Unapplied Cash', classification: 'LIABILITY' });

  await upsertPostingProfile(accessToken, property.id, { role: 'LOT_LEVY_RECEIVABLE', financialFundId: administrationFundId, accountId: receivable.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'LEVY_INCOME', financialFundId: administrationFundId, accountId: income.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'FUND_CASH', financialFundId: administrationFundId, accountId: cash.id });
  await upsertPostingProfile(accessToken, property.id, { role: 'UNAPPLIED_CASH', accountId: unapplied.id });

  await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31');

  const bankAccountRes = await registerBankAccount(accessToken, property.id, {
    accountName: 'Operating Account',
    institutionName: 'Commonwealth Bank',
    accountIdentifier: 'BSB 062-000 ACC 87654321',
    currencyCode: 'AUD',
    accountType: 'OPERATING',
    glCashAccountId: cash.id,
    financialFundId: administrationFundId,
  });
  expect(bankAccountRes.status).toBe(201);

  return { property, spaceId, space2Id, administrationFundId, cash, unapplied, receivable, income, bankAccount: bankAccountRes.body };
}

async function createPropertyRoleToken(ownerAccessToken: string, organisationId: string, propertyId: string, role: string) {
  const user = await createPlainUser();
  await request(app)
    .post(`/api/v1/properties/${propertyId}/memberships`)
    .set(authHeader(ownerAccessToken))
    .send({ email: user.email, firstName: 'P', lastName: 'M', role });
  const contact = await testPrisma.propertyContact.findFirstOrThrow({ where: { organisationId, email: user.email } });
  return residentAccessToken(user.userId, organisationId, contact.id);
}

const simpleMapping = {
  hasHeaderRow: true,
  dateFormat: 'DD/MM/YYYY',
  dateColumn: 0,
  descriptionColumn: 1,
  amountColumn: 2,
  referenceColumn: 3,
};

describe('M16.7 Banking & Manual Bank Reconciliation', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('bank account registration', () => {
    it('masks the raw account identifier — never persists or returns it unmasked', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);

      expect(scheme.bankAccount.accountIdentifierMasked).toBe('••••4321');
      expect(JSON.stringify(scheme.bankAccount)).not.toContain('87654321');

      const raw = await testPrisma.bankAccount.findUnique({ where: { id: scheme.bankAccount.id } });
      expect(JSON.stringify(raw)).not.toContain('87654321');
    });

    it('rejects a GL cash account that is not ASSET-classified', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const res = await registerBankAccount(accessToken, scheme.property.id, {
        accountName: 'Bad Account',
        institutionName: 'Test Bank',
        accountIdentifier: '12345678',
        currencyCode: 'AUD',
        accountType: 'OPERATING',
        glCashAccountId: scheme.unapplied.id,
      });
      expect(res.status).toBe(409);
    });

    it('rejects an ASSET-classified account that is not configured as a FUND_CASH posting-profile role (e.g. a receivable)', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      // `receivable` is ASSET-classified but mapped to LOT_LEVY_RECEIVABLE,
      // never FUND_CASH — must never be selectable as a bank account's
      // cash account even though the old (too-broad) check would have
      // allowed it.
      const res = await registerBankAccount(accessToken, scheme.property.id, {
        accountName: 'Wrong Account Type',
        institutionName: 'Test Bank',
        accountIdentifier: '12345678',
        currencyCode: 'AUD',
        accountType: 'OPERATING',
        glCashAccountId: scheme.receivable.id,
      });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/Fund Cash account/);
    });

    it('rejects a GL cash account already linked to another active bank account', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const res = await registerBankAccount(accessToken, scheme.property.id, {
        accountName: 'Duplicate Mapping',
        institutionName: 'Test Bank',
        accountIdentifier: '99999999',
        currencyCode: 'AUD',
        accountType: 'OPERATING',
        glCashAccountId: scheme.cash.id, // already linked by createSchemeReadyForBanking
      });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/already linked/);
    });

    it('rejects a fund mismatch between the requested fund and the FUND_CASH posting-profile rule\'s own fund', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const capitalWorksFundId = (
        await request(app)
          .get(`/api/v1/properties/${scheme.property.id}/financials`)
          .set(authHeader(accessToken))
      ).body.funds.find((f: { fundType: string }) => f.fundType === 'CAPITAL_WORKS').id;

      const res = await registerBankAccount(accessToken, scheme.property.id, {
        accountName: 'Mismatched Fund',
        institutionName: 'Test Bank',
        accountIdentifier: '55555555',
        currencyCode: 'AUD',
        accountType: 'OPERATING',
        glCashAccountId: scheme.cash.id,
        financialFundId: capitalWorksFundId, // cash is mapped to Administration Fund's FUND_CASH role
      });
      expect(res.status).toBe(409);
    });

    it('lists only eligible (FUND_CASH, unlinked) GL accounts for the picker', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const res = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/bank-accounts/eligible-gl-accounts`)
        .set(authHeader(accessToken));
      expect(res.status).toBe(200);
      const items = res.body.items as Array<{ accountId: string }>;
      // `cash` is FUND_CASH but already linked to the scheme's bank account
      // — excluded. `receivable`/`income`/`unapplied` are never FUND_CASH —
      // excluded. So the eligible list is empty for this fully-linked fixture.
      expect(items.find((i) => i.accountId === scheme.cash.id)).toBeUndefined();
      expect(items.find((i) => i.accountId === scheme.receivable.id)).toBeUndefined();
    });
  });

  describe('cross-property and cross-organisation isolation', () => {
    it('404s a bank account lookup from a different organisation', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const other = await registerAuOrg();
      const res = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/bank-accounts/${scheme.bankAccount.id}`)
        .set(authHeader(other.accessToken));
      expect(res.status).toBe(404);
    });
  });

  describe('CSV import — column mapping and date parsing', () => {
    it('parses DD/MM/YYYY correctly and rejects an out-of-range date rather than guessing', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const csv = 'Date,Description,Amount,Reference\n21/10/2026,Owner payment,150.00,REF1\n31/02/2026,Bad date,50.00,REF2\n';

      const preview = await previewStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: csv,
        columnMapping: simpleMapping,
        currencyCode: 'AUD',
      });
      expect(preview.status).toBe(200);
      expect(preview.body.rows[0].transactionDate).toBe('2026-10-21');
      expect(preview.body.rows[0].status).toBe('READY');
      expect(preview.body.rows[1].status).toBe('ERROR');
      expect(preview.body.rows[1].issues[0]).toMatch(/Could not parse date/);
    });

    it('normalizes separate debit/credit columns into one signed amount', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const mapping = { hasHeaderRow: true, dateFormat: 'DD/MM/YYYY', dateColumn: 0, descriptionColumn: 1, debitColumn: 2, creditColumn: 3 };
      const csv = 'Date,Description,Debit,Credit\n21/10/2026,Bank fee,15.00,\n22/10/2026,Owner payment,,200.00\n';

      const preview = await previewStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: csv,
        columnMapping: mapping,
        currencyCode: 'AUD',
      });
      expect(preview.status).toBe(200);
      expect(preview.body.rows[0].amount).toBe('-15.00');
      expect(preview.body.rows[1].amount).toBe('200.00');
    });

    it('rejects invalid currency codes', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const res = await previewStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: 'Date,Description,Amount,Reference\n21/10/2026,Payment,100.00,REF1\n',
        columnMapping: simpleMapping,
        currencyCode: 'AU',
      });
      expect(res.status).toBe(422); // zod length(3) rejects at the schema level
    });
  });

  describe('import safety — duplicates and idempotency', () => {
    it('applying the same file twice against the same account is idempotent, never a duplicate import', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const csv = 'Date,Description,Amount,Reference\n21/10/2026,Owner payment,150.00,REF1\n';
      const body = { csvContent: csv, fileName: 'oct.csv', columnMapping: simpleMapping, currencyCode: 'AUD' };

      const first = await applyStatement(accessToken, scheme.property.id, scheme.bankAccount.id, body);
      expect(first.status).toBe(201);
      expect(first.body.import.importedCount).toBe(1);

      const second = await applyStatement(accessToken, scheme.property.id, scheme.bankAccount.id, body);
      expect(second.status).toBe(201);
      expect(second.body.import.id).toBe(first.body.import.id);

      const count = await testPrisma.bankTransaction.count({ where: { bankAccountId: scheme.bankAccount.id } });
      expect(count).toBe(1);
    });

    it('a row identical to an already-imported transaction (different file) is skipped as a duplicate, not re-imported', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const firstCsv = 'Date,Description,Amount,Reference\n21/10/2026,Owner payment,150.00,REF1\n';
      const firstApply = await applyStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: firstCsv,
        fileName: 'statement-a.csv',
        columnMapping: simpleMapping,
        currencyCode: 'AUD',
      });
      expect(firstApply.status).toBe(201);
      expect(firstApply.body.import.importedCount).toBe(1);

      // Different file (different name/hash), overlapping statement period,
      // containing the exact same row plus one genuinely new row.
      const secondCsv =
        'Date,Description,Amount,Reference\n21/10/2026,Owner payment,150.00,REF1\n22/10/2026,Another payment,75.00,REF2\n';
      const secondApply = await applyStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: secondCsv,
        fileName: 'statement-b.csv',
        columnMapping: simpleMapping,
        currencyCode: 'AUD',
      });
      expect(secondApply.status).toBe(201);
      expect(secondApply.body.import.importedCount).toBe(1);
      expect(secondApply.body.import.duplicateCount).toBe(1);

      const count = await testPrisma.bankTransaction.count({ where: { bankAccountId: scheme.bankAccount.id } });
      expect(count).toBe(2);
    });

    it('rejects the whole apply if any row is malformed — no partial/incomplete import', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const csv = 'Date,Description,Amount,Reference\n21/10/2026,Good row,150.00,REF1\n21/10/2026,Bad row,not-a-number,REF2\n';
      const res = await applyStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: csv,
        columnMapping: simpleMapping,
        currencyCode: 'AUD',
      });
      expect(res.status).toBe(409);
      const count = await testPrisma.bankTransaction.count({ where: { bankAccountId: scheme.bankAccount.id } });
      expect(count).toBe(0);
    });
  });

  describe('matching — deterministic rules', () => {
    it('suggests an exact match via unique payment reference, and importing never posts a GL journal', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);

      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 150,
        paymentMethod: 'BANK_TRANSFER',
        paymentReference: 'LEVY-LOT1-Q1',
        receiptDate: '2026-10-21',
      });

      const journalCountBefore = await testPrisma.journalEntry.count({ where: { propertyId: scheme.property.id } });

      const csv = 'Date,Description,Amount,Reference\n21/10/2026,Owner payment,150.00,LEVY-LOT1-Q1\n';
      const apply = await applyStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: csv,
        columnMapping: simpleMapping,
        currencyCode: 'AUD',
      });
      expect(apply.status).toBe(201);

      const journalCountAfterImport = await testPrisma.journalEntry.count({ where: { propertyId: scheme.property.id } });
      expect(journalCountAfterImport).toBe(journalCountBefore); // import alone posts nothing

      const txId = apply.body.transactionIds[0];
      const suggestion = await suggestMatch(accessToken, scheme.property.id, txId);
      expect(suggestion.status).toBe(200);
      expect(suggestion.body.suggestion.confidence).toBe('UNIQUE_REFERENCE');
      expect(suggestion.body.suggestion.receiptId).toBe(receipt.id);

      const confirm = await confirmMatch(accessToken, scheme.property.id, suggestion.body.suggestion.id);
      expect(confirm.status).toBe(201);
      expect(confirm.body.status).toBe('CONFIRMED');

      const journalCountAfterMatch = await testPrisma.journalEntry.count({ where: { propertyId: scheme.property.id } });
      expect(journalCountAfterMatch).toBe(journalCountBefore); // matching alone also posts nothing

      const tx = await listTransactions(accessToken, scheme.property.id, scheme.bankAccount.id);
      expect(tx.body.items.find((t: { id: string }) => t.id === txId).matchStatus).toBe('MATCHED');
    });

    it('does not suggest a match when two candidate receipts are equally ambiguous', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);

      await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 150,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-21',
      });
      await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.space2Id,
        financialFundId: scheme.administrationFundId,
        amount: 150,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-21',
      });

      const csv = 'Date,Description,Amount,Reference\n21/10/2026,Owner payment,150.00,\n';
      const apply = await applyStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: csv,
        columnMapping: simpleMapping,
        currencyCode: 'AUD',
      });
      const txId = apply.body.transactionIds[0];
      const suggestion = await suggestMatch(accessToken, scheme.property.id, txId);
      expect(suggestion.status).toBe(200);
      expect(suggestion.body.suggestion).toBeNull();
    });

    it('does not allocate the same receipt to two different bank transactions', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 150,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-21',
      });

      const csv = 'Date,Description,Amount,Reference\n21/10/2026,Payment A,150.00,A\n22/10/2026,Payment B,150.00,B\n';
      const apply = await applyStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: csv,
        columnMapping: simpleMapping,
        currencyCode: 'AUD',
      });
      const [tx1, tx2] = apply.body.transactionIds;

      const match1 = await manualMatchReceipt(accessToken, scheme.property.id, tx1, receipt.id);
      expect(match1.status).toBe(201);

      const match2 = await manualMatchReceipt(accessToken, scheme.property.id, tx2, receipt.id);
      expect(match2.status).toBe(409);
    });
  });

  describe('reconciliation', () => {
    async function recordAndMatch(accessToken: string, scheme: Awaited<ReturnType<typeof createSchemeReadyForBanking>>, amount: number, date: string, ref: string) {
      const receipt = await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount,
        paymentMethod: 'BANK_TRANSFER',
        paymentReference: ref,
        receiptDate: date,
      });
      const csv = `Date,Description,Amount,Reference\n${date.split('-').reverse().join('/')},Owner payment,${amount.toFixed(2)},${ref}\n`;
      const apply = await applyStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: csv,
        fileName: `${ref}.csv`,
        columnMapping: simpleMapping,
        currencyCode: 'AUD',
      });
      const txId = apply.body.transactionIds[0];
      const suggestion = await suggestMatch(accessToken, scheme.property.id, txId);
      const confirm = await confirmMatch(accessToken, scheme.property.id, suggestion.body.suggestion.id);
      expect(confirm.status).toBe(201);
      return receipt;
    }

    it('balances to a 0.00 difference once every in-period GL movement is matched, and completion succeeds', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      await recordAndMatch(accessToken, scheme, 150, '2026-10-21', 'REF1');

      const draft = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 150,
      });
      expect(draft.status).toBe(201);
      expect(draft.body.difference).toBe('0.00');
      expect(draft.body.glClosingBalance).toBe('150.00');
      expect(draft.body.outstandingDepositsTotal).toBe('0.00');

      const complete = await completeReconciliation(accessToken, scheme.property.id, draft.body.id);
      expect(complete.status).toBe(201);
      expect(complete.body.status).toBe('RECONCILED');

      const tx = await testPrisma.bankTransaction.findFirst({ where: { bankAccountId: scheme.bankAccount.id } });
      expect(tx!.reconciliationStatus).toBe('RECONCILED');
    });

    it('reports an unmatched GL receipt as an outstanding deposit — a legitimate outstanding item, not an error, so completion still succeeds once the adjusted figures tie out', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      // Posted to GL but never imported/matched on the bank side — a
      // genuine deposit-in-transit scenario.
      await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 150,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-21',
      });

      const draft = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 0, // the bank statement itself shows nothing yet — correctly so
      });
      expect(draft.status).toBe(201);
      expect(draft.body.outstandingDepositsTotal).toBe('150.00');
      expect(draft.body.glClosingBalance).toBe('150.00');
      // The outstanding deposit is excluded from the GL-vs-statement
      // comparison (never required to be matched to complete) — see
      // bank-reconciliation.service.ts's doc comment.
      expect(draft.body.difference).toBe('0.00');

      const complete = await completeReconciliation(accessToken, scheme.property.id, draft.body.id);
      expect(complete.status).toBe(201);

      const tx = await testPrisma.bankTransaction.findMany({ where: { bankAccountId: scheme.bankAccount.id } });
      expect(tx).toHaveLength(0); // nothing was ever imported for this deposit — nothing to mark reconciled
    });

    it('a statement closing balance that genuinely does not tie out (even after excluding outstanding items) blocks completion — never silently written off', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      await recordAndMatch(accessToken, scheme, 150, '2026-10-21', 'REF1');

      // The real matched/cleared GL movement is 150, but the manager
      // enters a wrong statement closing balance of 200 — a genuine
      // unexplained difference, never written off automatically.
      const draft = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 200,
      });
      expect(draft.status).toBe(201);
      expect(draft.body.difference).toBe('-50.00');

      const complete = await completeReconciliation(accessToken, scheme.property.id, draft.body.id);
      expect(complete.status).toBe(409);
    });

    it('calculate can be called repeatedly while DRAFT, reflecting newly confirmed matches each time', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      await recordReceipt(accessToken, scheme.property.id, {
        spaceId: scheme.spaceId,
        financialFundId: scheme.administrationFundId,
        amount: 150,
        paymentMethod: 'BANK_TRANSFER',
        receiptDate: '2026-10-21',
      });

      const draft = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 0,
      });
      expect(draft.body.outstandingDepositsTotal).toBe('150.00');

      // Now import + match the deposit, then recalculate — the outstanding
      // total should drop to zero on this SAME draft without recreating it.
      const csv = 'Date,Description,Amount,Reference\n21/10/2026,Owner payment,150.00,REF1\n';
      const apply = await applyStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: csv,
        columnMapping: simpleMapping,
        currencyCode: 'AUD',
      });
      const txId = apply.body.transactionIds[0];
      const suggestion = await suggestMatch(accessToken, scheme.property.id, txId);
      await confirmMatch(accessToken, scheme.property.id, suggestion.body.suggestion.id);

      const recalculated = await calculateReconciliation(accessToken, scheme.property.id, draft.body.id);
      expect(recalculated.status).toBe(200);
      expect(recalculated.body.outstandingDepositsTotal).toBe('0.00');
    });

    it('rejects an overlapping reconciliation period for the same bank account', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const first = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 0,
      });
      expect(first.status).toBe(201);

      const overlapping = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-15',
        periodEndDate: '2026-11-15',
        statementOpeningBalance: 0,
        statementClosingBalance: 0,
      });
      expect(overlapping.status).toBe(409);
    });

    it('rejects a draft whose opening balance does not continue from the prior reconciliation', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      await recordAndMatch(accessToken, scheme, 150, '2026-10-21', 'REF1');
      const draft = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 150,
      });
      await completeReconciliation(accessToken, scheme.property.id, draft.body.id);

      const next = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-11-01',
        periodEndDate: '2026-11-30',
        statementOpeningBalance: 999, // wrong — should be 150
        statementClosingBalance: 999,
      });
      expect(next.status).toBe(409);
    });

    it('reopening a completed reconciliation releases its transactions and never edits its own history fields', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      await recordAndMatch(accessToken, scheme, 150, '2026-10-21', 'REF1');
      const draft = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 150,
      });
      const completed = await completeReconciliation(accessToken, scheme.property.id, draft.body.id);
      expect(completed.body.statementClosingBalance).toBe('150.00');

      const reopened = await reopenReconciliation(accessToken, scheme.property.id, draft.body.id, 'Found a correction needed');
      expect(reopened.status).toBe(201);
      expect(reopened.body.status).toBe('REOPENED');
      // The original snapshot fields are untouched.
      expect(reopened.body.statementClosingBalance).toBe('150.00');

      const tx = await testPrisma.bankTransaction.findFirst({ where: { bankAccountId: scheme.bankAccount.id } });
      expect(tx!.reconciliationStatus).toBe('UNRECONCILED');
      expect(tx!.reconciliationId).toBeNull();
    });

    it('blocks reopening an earlier period while a later period is already reconciled (chain-continuity)', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);

      await recordAndMatch(accessToken, scheme, 150, '2026-10-21', 'REF1');
      const period1 = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 150,
      });
      await completeReconciliation(accessToken, scheme.property.id, period1.body.id);

      await recordAndMatch(accessToken, scheme, 50, '2026-11-15', 'REF2');
      const period2 = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-11-01',
        periodEndDate: '2026-11-30',
        statementOpeningBalance: 150,
        statementClosingBalance: 200,
      });
      await completeReconciliation(accessToken, scheme.property.id, period2.body.id);

      // Reopening period1 (the earlier period) must be refused — period2 is
      // already reconciled and its own opening balance (150) depends on
      // period1's closing balance never silently changing underneath it.
      const reopenEarlier = await reopenReconciliation(accessToken, scheme.property.id, period1.body.id, 'Trying to fix an earlier period');
      expect(reopenEarlier.status).toBe(409);

      // Reopening period2 (the latest) is fine — nothing depends on it.
      const reopenLatest = await reopenReconciliation(accessToken, scheme.property.id, period2.body.id, 'Correcting the latest period');
      expect(reopenLatest.status).toBe(201);
    });

    it('blocks starting a new forward period while an earlier period sits reopened and uncorrected', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);

      await recordAndMatch(accessToken, scheme, 150, '2026-10-21', 'REF1');
      const period1 = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 150,
      });
      await completeReconciliation(accessToken, scheme.property.id, period1.body.id);
      await reopenReconciliation(accessToken, scheme.property.id, period1.body.id, 'Needs a correction');

      // Starting a brand-new November period now, without first resolving
      // (re-superseding) the reopened October period, must be refused —
      // continuing from "150" would be trusting a closing balance that is
      // no longer an authoritative, completed figure.
      const period2Attempt = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-11-01',
        periodEndDate: '2026-11-30',
        statementOpeningBalance: 150,
        statementClosingBalance: 150,
      });
      expect(period2Attempt.status).toBe(409);

      // Resolving it via a superseding draft for the SAME period is fine.
      const corrected = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 150,
        supersedesReconciliationId: period1.body.id,
      });
      expect(corrected.status).toBe(201);
    });

    it('rejects a superseding draft whose period does not match the reconciliation it claims to correct', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);

      await recordAndMatch(accessToken, scheme, 150, '2026-10-21', 'REF1');
      const period1 = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 150,
      });
      await completeReconciliation(accessToken, scheme.property.id, period1.body.id);
      await reopenReconciliation(accessToken, scheme.property.id, period1.body.id, 'Needs a correction');

      const mismatchedPeriod = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-15', // does not match period1's 2026-10-31 end date
        statementOpeningBalance: 0,
        statementClosingBalance: 150,
        supersedesReconciliationId: period1.body.id,
      });
      expect(mismatchedPeriod.status).toBe(409);
    });

    it('a correcting (superseding) reconciliation becomes the real continuity anchor for the next period', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);

      await recordAndMatch(accessToken, scheme, 150, '2026-10-21', 'REF1');
      const period1 = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 150,
      });
      await completeReconciliation(accessToken, scheme.property.id, period1.body.id);

      // A correction is discovered: the real closing balance should have
      // been 150 all along (nothing actually changes GL-side here — this
      // models a manager correcting a mistyped statement balance), so
      // reopen and re-supersede with the SAME, still-correct figures to
      // prove the chain re-anchors on the NEW row, not the old one.
      await reopenReconciliation(accessToken, scheme.property.id, period1.body.id, 'Mistyped statement balance, re-confirming');
      const corrected = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        statementOpeningBalance: 0,
        statementClosingBalance: 150,
        supersedesReconciliationId: period1.body.id,
      });
      expect(corrected.status).toBe(201);
      const correctedCompleted = await completeReconciliation(accessToken, scheme.property.id, corrected.body.id);
      expect(correctedCompleted.status).toBe(201);

      // period1 itself is permanently REOPENED (never silently flipped
      // back to RECONCILED) — the corrected row is the new history.
      const originalAfter = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/reconciliations/${period1.body.id}`)
        .set(authHeader(accessToken));
      expect(originalAfter.body.status).toBe('REOPENED');

      // The next period must continue from the CORRECTED row's closing
      // balance — proving the corrected reconciliation, not the original,
      // is now the authoritative continuity anchor.
      const period2 = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-11-01',
        periodEndDate: '2026-11-30',
        statementOpeningBalance: 150,
        statementClosingBalance: 150,
      });
      expect(period2.status).toBe(201);

      const wrongOpening = await createDraftReconciliation(accessToken, scheme.property.id, scheme.bankAccount.id, {
        periodStartDate: '2026-12-01',
        periodEndDate: '2026-12-31',
        statementOpeningBalance: 999,
        statementClosingBalance: 999,
      });
      expect(wrongOpening.status).toBe(409);
    });
  });

  describe('authorization', () => {
    it('rejects a caller without financials.view from listing bank accounts, and without financials.approve from creating a receipt off a bank transaction', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const residentToken = await createPropertyRoleToken(accessToken, organisationId, scheme.property.id, 'RESIDENT');

      const list = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/bank-accounts`)
        .set(authHeader(residentToken));
      expect(list.status).toBe(403);

      const csv = 'Date,Description,Amount,Reference\n21/10/2026,Owner payment,150.00,REF1\n';
      const apply = await applyStatement(accessToken, scheme.property.id, scheme.bankAccount.id, {
        csvContent: csv,
        columnMapping: simpleMapping,
        currencyCode: 'AUD',
      });
      const txId = apply.body.transactionIds[0];

      const createReceipt = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/bank-transactions/${txId}/create-receipt`)
        .set(authHeader(residentToken))
        .send({ spaceId: scheme.spaceId, financialFundId: scheme.administrationFundId });
      expect(createReceipt.status).toBe(403);
    });

    it('rejects an unauthenticated request', async () => {
      const { accessToken } = await registerAuOrg();
      const scheme = await createSchemeReadyForBanking(accessToken);
      const res = await request(app).get(`/api/v1/properties/${scheme.property.id}/financials/bank-accounts`);
      expect(res.status).toBe(401);
    });
  });
});
