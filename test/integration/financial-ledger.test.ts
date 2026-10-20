import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDb, testPrisma } from '../helpers/db.js';
import {
  authHeader,
  createPlainUser,
  registerTestUser,
  residentAccessToken,
} from '../helpers/auth.js';

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
  return request(app)
    .post(`/api/v1/properties/${propertyId}/strata/enable`)
    .set(authHeader(accessToken))
    .send({ strataPlanNumber: 'SP90001' });
}

async function setLots(accessToken: string, propertyId: string, lots: unknown[]) {
  const res = await request(app)
    .put(`/api/v1/properties/${propertyId}/strata/lots`)
    .set(authHeader(accessToken))
    .send({ lots });
  expect(res.status).toBe(200);
  return res.body;
}

async function completeStrataSetup(accessToken: string, propertyId: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/strata/complete`)
    .set(authHeader(accessToken));
  expect(res.status).toBe(200);
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
}

async function addFund(accessToken: string, propertyId: string, fundType: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/funds`)
    .set(authHeader(accessToken))
    .send({ fundType });
  expect(res.status).toBe(200);
  return res.body;
}

async function setLotPositions(accessToken: string, propertyId: string, positions: unknown[]) {
  const res = await request(app)
    .put(`/api/v1/properties/${propertyId}/financials/lot-positions`)
    .set(authHeader(accessToken))
    .send({ positions });
  expect(res.status).toBe(200);
}

async function activateFinancialSetup(accessToken: string, propertyId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/activate`)
    .set(authHeader(accessToken));
}

/** Drives a property through strata + financial onboarding to ACTIVE
 * financial management with zero opening lot balances — the baseline every
 * ledger-posting test needs. */
async function createActiveFinancialProperty(accessToken: string, lotOwing = 0, lotCredit = 0) {
  const property = await createProperty(accessToken);
  await enableStrata(accessToken, property.id);
  const summary = await setLots(accessToken, property.id, [
    { kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 50 },
    { kind: 'new', name: 'Lot 2', code: 'L2', unitsOfEntitlement: 50 },
  ]);
  await completeStrataSetup(accessToken, property.id);
  await startFinancialSetup(accessToken, property.id);
  await addFund(accessToken, property.id, 'ADMINISTRATION');
  await addFund(accessToken, property.id, 'CAPITAL_WORKS');
  const lots = summary.lots as Array<{ spaceId: string; code: string }>;
  await setLotPositions(
    accessToken,
    property.id,
    lots.map((l) => ({
      spaceId: l.spaceId,
      amountOwing: lotOwing,
      creditBalance: lotCredit,
      asOfDate: '2026-10-01',
    })),
  );
  const activation = await activateFinancialSetup(accessToken, property.id);
  expect(activation.status).toBe(200);
  const funds = activation.body.funds as Array<{ id: string; fundType: string }>;
  return {
    property,
    lots,
    administrationFundId: funds.find((f) => f.fundType === 'ADMINISTRATION')!.id,
    capitalWorksFundId: funds.find((f) => f.fundType === 'CAPITAL_WORKS')!.id,
  };
}

async function createAccount(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/accounts`)
    .set(authHeader(accessToken))
    .send(body);
  expect(res.status).toBe(201);
  return res.body as { id: string; code: string };
}

async function createPeriod(accessToken: string, propertyId: string, startDate: string, endDate: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/periods`)
    .set(authHeader(accessToken))
    .send({ startDate, endDate });
}

async function closePeriod(accessToken: string, propertyId: string, periodId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/periods/${periodId}/close`)
    .set(authHeader(accessToken))
    .send({});
}

async function reopenPeriod(accessToken: string, propertyId: string, periodId: string, reason = 'test') {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/periods/${periodId}/reopen`)
    .set(authHeader(accessToken))
    .send({ reason });
}

async function upsertPostingProfile(
  accessToken: string,
  propertyId: string,
  body: Record<string, unknown>,
) {
  const res = await request(app)
    .put(`/api/v1/properties/${propertyId}/financials/posting-profile`)
    .set(authHeader(accessToken))
    .send(body);
  expect(res.status).toBe(201);
  return res.body;
}

/** Same as upsertPostingProfile but doesn't assert success — for tests
 * expecting a rejection. */
async function upsertPostingProfileRaw(
  accessToken: string,
  propertyId: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .put(`/api/v1/properties/${propertyId}/financials/posting-profile`)
    .set(authHeader(accessToken))
    .send(body);
}

async function postJournal(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/journals`)
    .set(authHeader(accessToken))
    .send(body);
}

async function reverseJournal(
  accessToken: string,
  propertyId: string,
  journalId: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/journals/${journalId}/reverse`)
    .set(authHeader(accessToken))
    .send(body);
}

async function getJournal(accessToken: string, propertyId: string, journalId: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/journals/${journalId}`)
    .set(authHeader(accessToken));
}

async function getTrialBalance(accessToken: string, propertyId: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/financials/trial-balance`)
    .set(authHeader(accessToken));
}

async function generateOpeningJournal(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/opening-journal`)
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

/** Sets up two basic accounts (Cash asset, Fees income) and one open
 * period covering 2026-10-01 — the baseline most manual-posting tests
 * build on. */
async function setupBasicLedger(accessToken: string, property: { id: string }) {
  const cash = await createAccount(accessToken, property.id, {
    code: '300000',
    name: 'Cash at Bank',
    classification: 'ASSET',
  });
  const income = await createAccount(accessToken, property.id, {
    code: '100000',
    name: 'Fees Income',
    classification: 'INCOME',
  });
  const periodRes = await createPeriod(accessToken, property.id, '2026-10-01', '2026-12-31');
  expect(periodRes.status).toBe(201);
  return { cash, income, period: periodRes.body };
}

describe('M16.2.2 General Ledger & Posting Engine', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('accounting periods', () => {
    it('opens a period and rejects an overlapping one', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);

      const first = await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31');
      expect(first.status).toBe(201);

      const overlapping = await createPeriod(accessToken, property.id, '2026-12-01', '2027-03-31');
      expect(overlapping.status).toBe(409);

      const adjacent = await createPeriod(accessToken, property.id, '2027-01-01', '2027-06-30');
      expect(adjacent.status).toBe(201);
    });

    it('close/reopen is idempotent-for-close and requires a reason to reopen', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);
      const period = (await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31')).body;

      const closed = await closePeriod(accessToken, property.id, period.id);
      expect(closed.status).toBe(200);
      expect(closed.body.status).toBe('CLOSED');
      const closedAgain = await closePeriod(accessToken, property.id, period.id);
      expect(closedAgain.status).toBe(200);

      const noReason = await request(app)
        .post(`/api/v1/properties/${property.id}/financials/periods/${period.id}/reopen`)
        .set(authHeader(accessToken))
        .send({});
      expect(noReason.status).toBe(422);

      const reopened = await reopenPeriod(accessToken, property.id, period.id, 'Correcting an entry');
      expect(reopened.status).toBe(200);
      expect(reopened.body.status).toBe('OPEN');
    });
  });

  describe('balanced/unbalanced journals', () => {
    it('posts a balanced journal and rejects an unbalanced one', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash, income } = await setupBasicLedger(accessToken, property);

      const balanced = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'Levy fee received',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 500 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 500 },
        ],
      });
      expect(balanced.status).toBe(201);
      expect(balanced.body.totalDebit).toBe('500.00');
      expect(balanced.body.publicReference).toMatch(/^JRN-/);

      const unbalanced = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'Bad entry',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 500 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 400 },
        ],
      });
      expect(unbalanced.status).toBe(422);
    });

    it('rejects a journal with fewer than two lines, and a line with both debit and credit set', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash } = await setupBasicLedger(accessToken, property);

      const oneLine = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'Bad',
        lines: [{ accountId: cash.id, financialFundId: administrationFundId, debit: 100 }],
      });
      expect(oneLine.status).toBe(422);

      const bothSides = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'Bad',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 100, credit: 100 },
          { accountId: cash.id, financialFundId: administrationFundId, debit: 100 },
        ],
      });
      expect(bothSides.status).toBe(422);
    });

    it('rejects a journal that moves value across funds without balancing per fund', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const { cash, income } = await setupBasicLedger(accessToken, property);

      // Overall balanced (500 debit = 500 credit) but NOT per fund — this
      // must be rejected since the manual journal endpoint never exposes
      // allowCrossFund.
      const res = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'Cross-fund without flag',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 500 },
          { accountId: income.id, financialFundId: capitalWorksFundId, credit: 500 },
        ],
      });
      expect(res.status).toBe(422);
    });
  });

  describe('decimal precision', () => {
    it('sums fractional-cent lines exactly, with no float drift', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash, income } = await setupBasicLedger(accessToken, property);

      const res = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'Three fractional debits',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 0.1 },
          { accountId: cash.id, financialFundId: administrationFundId, debit: 0.1 },
          { accountId: cash.id, financialFundId: administrationFundId, debit: 0.1 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 0.3 },
        ],
      });
      expect(res.status).toBe(201);
      expect(res.body.totalDebit).toBe('0.30');

      const trialBalance = await getTrialBalance(accessToken, property.id);
      const cashRow = trialBalance.body.items.find((r: { accountId: string }) => r.accountId === cash.id);
      expect(cashRow.totalDebit).toBe('0.30');
      expect(cashRow.netBalance).toBe('0.30');
    });
  });

  describe('idempotency and concurrency', () => {
    it('a duplicate sourceId is a no-op, not a second posting', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash, income } = await setupBasicLedger(accessToken, property);

      const body = {
        effectiveDate: '2026-10-05',
        narration: 'Idempotent test',
        sourceId: 'fixed-source-id-1',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 200 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 200 },
        ],
      };

      const first = await postJournal(accessToken, property.id, body);
      const second = await postJournal(accessToken, property.id, body);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);

      const count = await testPrisma.journalEntry.count({ where: { propertyId: property.id } });
      expect(count).toBe(1);
    });

    it('two truly concurrent posts with the same sourceId resolve to exactly one journal', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash, income } = await setupBasicLedger(accessToken, property);

      const body = {
        effectiveDate: '2026-10-05',
        narration: 'Concurrent idempotent test',
        sourceId: 'fixed-source-id-concurrent',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 300 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 300 },
        ],
      };

      const [a, b] = await Promise.all([
        postJournal(accessToken, property.id, body),
        postJournal(accessToken, property.id, body),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).toBe(b.body.id);

      const count = await testPrisma.journalEntry.count({ where: { propertyId: property.id } });
      expect(count).toBe(1);
    });
  });

  describe('transaction rollback', () => {
    it('writes nothing when a line references an account from a different property', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash, income } = await setupBasicLedger(accessToken, property);
      const other = await createActiveFinancialProperty(accessToken);
      const otherAccount = await createAccount(accessToken, other.property.id, {
        code: '999999',
        name: 'Foreign account',
        classification: 'ASSET',
      });

      const res = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'Cross-property injection attempt',
        lines: [
          { accountId: otherAccount.id, financialFundId: administrationFundId, debit: 100 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 100 },
        ],
      });
      expect(res.status).toBe(404);

      const count = await testPrisma.journalEntry.count({ where: { propertyId: property.id } });
      expect(count).toBe(0);
      const lineCount = await testPrisma.journalLine.count({ where: { propertyId: property.id } });
      expect(lineCount).toBe(0);
      void cash;
    });

    it('writes nothing when posting into a period that does not exist', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash, income } = await setupBasicLedger(accessToken, property);

      const res = await postJournal(accessToken, property.id, {
        effectiveDate: '2030-01-01', // outside the 2026-10 to 2026-12 period created
        narration: 'No period covers this date',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 100 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 100 },
        ],
      });
      expect(res.status).toBe(409);

      const count = await testPrisma.journalEntry.count({ where: { propertyId: property.id } });
      expect(count).toBe(0);
    });
  });

  describe('closed-period posting', () => {
    it('rejects posting into a closed period', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash, income, period } = await setupBasicLedger(accessToken, property);

      await closePeriod(accessToken, property.id, period.id);

      const res = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'Posting into a closed period',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 100 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 100 },
        ],
      });
      expect(res.status).toBe(409);

      const count = await testPrisma.journalEntry.count({ where: { propertyId: property.id } });
      expect(count).toBe(0);
    });
  });

  describe('reversal integrity', () => {
    it('reverses a journal with exact sign-swapped lines, links it, and blocks a second reversal', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash, income } = await setupBasicLedger(accessToken, property);

      const posted = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'Original entry',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 250 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 250 },
        ],
      });
      expect(posted.status).toBe(201);

      const reversed = await reverseJournal(accessToken, property.id, posted.body.id, {
        reason: 'Posted in error',
      });
      expect(reversed.status).toBe(201);
      expect(reversed.body.reversalOfJournalId).toBe(posted.body.id);
      expect(reversed.body.reversalReason).toBe('Posted in error');

      const cashLine = reversed.body.lines.find((l: { accountId: string }) => l.accountId === cash.id);
      const incomeLine = reversed.body.lines.find((l: { accountId: string }) => l.accountId === income.id);
      expect(cashLine.credit).toBe('250.00');
      expect(cashLine.debit).toBe('0.00');
      expect(incomeLine.debit).toBe('250.00');
      expect(incomeLine.credit).toBe('0.00');

      // The original is untouched by its own reversal.
      const originalAfter = await getJournal(accessToken, property.id, posted.body.id);
      expect(originalAfter.body.narration).toBe('Original entry');
      expect(originalAfter.body.reversalOfJournalId).toBeNull();

      const secondAttempt = await reverseJournal(accessToken, property.id, posted.body.id, {
        reason: 'Trying again',
      });
      expect(secondAttempt.status).toBe(409);

      // Net ledger effect of an entry plus its reversal is zero.
      const trialBalance = await getTrialBalance(accessToken, property.id);
      const cashRow = trialBalance.body.items.find((r: { accountId: string }) => r.accountId === cash.id);
      expect(cashRow.netBalance).toBe('0.00');
    });

    it('rejects reversing into a closed period', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash, income, period } = await setupBasicLedger(accessToken, property);

      const posted = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'To be reversed into a closed period',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 100 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 100 },
        ],
      });
      await closePeriod(accessToken, property.id, period.id);

      const reversed = await reverseJournal(accessToken, property.id, posted.body.id, {
        effectiveDate: '2026-10-06',
        reason: 'Attempted reversal into closed period',
      });
      expect(reversed.status).toBe(409);
    });
  });

  describe('historical immutability', () => {
    it('exposes no update/delete path for a posted journal — only reverse creates a new row', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash, income } = await setupBasicLedger(accessToken, property);

      const posted = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'Immutable entry',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 100 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 100 },
        ],
      });

      const patchAttempt = await request(app)
        .patch(`/api/v1/properties/${property.id}/financials/journals/${posted.body.id}`)
        .set(authHeader(accessToken))
        .send({ narration: 'Tampered' });
      expect(patchAttempt.status).toBe(404); // no such route exists

      const deleteAttempt = await request(app)
        .delete(`/api/v1/properties/${property.id}/financials/journals/${posted.body.id}`)
        .set(authHeader(accessToken));
      expect(deleteAttempt.status).toBe(404); // no such route exists

      const stillThere = await getJournal(accessToken, property.id, posted.body.id);
      expect(stillThere.body.narration).toBe('Immutable entry');
    });
  });

  describe('cross-organisation/property/fund access', () => {
    it('rejects every ledger endpoint for a user without financials.view/approve', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(ownerToken);
      const { cash, income } = await setupBasicLedger(ownerToken, property);
      const tenantToken = await createPropertyRoleToken(ownerToken, organisationId, property.id, 'TENANT');

      expect(
        (
          await request(app)
            .get(`/api/v1/properties/${property.id}/financials/journals`)
            .set(authHeader(tenantToken))
        ).status,
      ).toBe(403);
      expect(
        (
          await postJournal(tenantToken, property.id, {
            effectiveDate: '2026-10-05',
            narration: 'Unauthorized',
            lines: [
              { accountId: cash.id, financialFundId: administrationFundId, debit: 100 },
              { accountId: income.id, financialFundId: administrationFundId, credit: 100 },
            ],
          })
        ).status,
      ).toBe(403);
    });

    it('financials.view is sufficient to read the ledger but not to post or approve actions', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(ownerToken);
      const { cash, income, period } = await setupBasicLedger(ownerToken, property);
      const viewerToken = await createPropertyRoleToken(ownerToken, organisationId, property.id, 'OWNER');

      expect(
        (
          await request(app)
            .get(`/api/v1/properties/${property.id}/financials/journals`)
            .set(authHeader(viewerToken))
        ).status,
      ).toBe(200);
      expect(
        (
          await postJournal(viewerToken, property.id, {
            effectiveDate: '2026-10-05',
            narration: 'Should be forbidden',
            lines: [
              { accountId: cash.id, financialFundId: administrationFundId, debit: 100 },
              { accountId: income.id, financialFundId: administrationFundId, credit: 100 },
            ],
          })
        ).status,
      ).toBe(403);
      expect((await closePeriod(viewerToken, property.id, period.id)).status).toBe(403);
    });

    it('a user from a different organisation cannot see or post to this property’s ledger', async () => {
      const { accessToken: ownerToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(ownerToken);
      const { cash, income } = await setupBasicLedger(ownerToken, property);

      const { accessToken: otherOrgToken } = await registerAuOrg();
      expect(
        (
          await request(app)
            .get(`/api/v1/properties/${property.id}/financials/journals`)
            .set(authHeader(otherOrgToken))
        ).status,
      ).toBe(404);
      expect(
        (
          await postJournal(otherOrgToken, property.id, {
            effectiveDate: '2026-10-05',
            narration: 'Hijack attempt',
            lines: [
              { accountId: cash.id, financialFundId: administrationFundId, debit: 100 },
              { accountId: income.id, financialFundId: administrationFundId, credit: 100 },
            ],
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('opening-balance transition', () => {
    async function setupOpeningProfile(
      accessToken: string,
      propertyId: string,
      administrationFundId: string,
    ) {
      const cash = await createAccount(accessToken, propertyId, {
        code: '300000',
        name: 'Cash at Bank — Administration',
        classification: 'ASSET',
      });
      const receivable = await createAccount(accessToken, propertyId, {
        code: '310000',
        name: 'Lot Levy Receivable',
        classification: 'ASSET',
      });
      const unapplied = await createAccount(accessToken, propertyId, {
        code: '410000',
        name: 'Unapplied Owner Cash',
        classification: 'LIABILITY',
      });
      const equity = await createAccount(accessToken, propertyId, {
        code: '500000',
        name: 'Opening Balance Equity',
        classification: 'EQUITY',
      });

      await upsertPostingProfile(accessToken, propertyId, {
        role: 'FUND_CASH',
        financialFundId: administrationFundId,
        accountId: cash.id,
      });
      await upsertPostingProfile(accessToken, propertyId, {
        role: 'LOT_LEVY_RECEIVABLE',
        financialFundId: administrationFundId,
        accountId: receivable.id,
      });
      await upsertPostingProfile(accessToken, propertyId, {
        role: 'UNAPPLIED_CASH',
        financialFundId: administrationFundId,
        accountId: unapplied.id,
      });
      await upsertPostingProfile(accessToken, propertyId, {
        role: 'OPENING_BALANCE_EQUITY',
        accountId: equity.id,
      });

      await createPeriod(accessToken, propertyId, '2026-07-01', '2026-12-31');

      return { cash, receivable, unapplied, equity };
    }

    it('generates a balanced opening journal from M16.1 snapshots with an explicit fund split', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots, administrationFundId } = await createActiveFinancialProperty(
        accessToken,
        1000,
        200,
      );
      const { cash, receivable, unapplied, equity } = await setupOpeningProfile(
        accessToken,
        property.id,
        administrationFundId,
      );

      const res = await generateOpeningJournal(accessToken, property.id, {
        lotFundSplits: lots.map((l) => ({
          spaceId: l.spaceId,
          allocations: [{ financialFundId: administrationFundId, amountOwing: 1000, creditBalance: 200 }],
        })),
      });
      expect(res.status).toBe(201);
      expect(res.body.sourceType).toBe('OPENING_BALANCE');

      const trialBalance = await getTrialBalance(accessToken, property.id);
      const receivableRow = trialBalance.body.items.find(
        (r: { accountId: string }) => r.accountId === receivable.id,
      );
      // Two lots, each 1000 owing.
      expect(receivableRow.netBalance).toBe('2000.00');
      const unappliedRow = trialBalance.body.items.find(
        (r: { accountId: string }) => r.accountId === unapplied.id,
      );
      expect(unappliedRow.netBalance).toBe('-400.00'); // liability: credit-heavy, 2 x 200
      const equityRow = trialBalance.body.items.find((r: { accountId: string }) => r.accountId === equity.id);
      // Equity nets: credited for cash (0, no FinancialOpeningBalance set in
      // this test) + receivables (2000 credit) + debited for unapplied
      // cash offset (400 debit) = -1600 net credit.
      expect(equityRow.netBalance).toBe('-1600.00');
      void cash;
    });

    it('retrying generation after success is a no-op — no duplicate opening journal', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots, administrationFundId } = await createActiveFinancialProperty(
        accessToken,
        500,
        0,
      );
      await setupOpeningProfile(accessToken, property.id, administrationFundId);

      const splits = {
        lotFundSplits: lots.map((l) => ({
          spaceId: l.spaceId,
          allocations: [{ financialFundId: administrationFundId, amountOwing: 500, creditBalance: 0 }],
        })),
      };

      const first = await generateOpeningJournal(accessToken, property.id, splits);
      const second = await generateOpeningJournal(accessToken, property.id, splits);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);

      const count = await testPrisma.journalEntry.count({
        where: { propertyId: property.id, sourceType: 'OPENING_BALANCE' },
      });
      expect(count).toBe(1);
    });

    it('never fabricates an allocation — rejects an unresolved or mismatched lot split', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots, administrationFundId } = await createActiveFinancialProperty(
        accessToken,
        1000,
        0,
      );
      await setupOpeningProfile(accessToken, property.id, administrationFundId);

      // Only resolve the first lot, leave the second unresolved.
      const unresolved = await generateOpeningJournal(accessToken, property.id, {
        lotFundSplits: [
          {
            spaceId: lots[0]!.spaceId,
            allocations: [{ financialFundId: administrationFundId, amountOwing: 1000, creditBalance: 0 }],
          },
        ],
      });
      expect(unresolved.status).toBe(422);
      expect(unresolved.body.error.details.unresolvedLots).toContain(lots[1]!.spaceId);

      // Resolve both, but one with the wrong total.
      const mismatched = await generateOpeningJournal(accessToken, property.id, {
        lotFundSplits: lots.map((l, i) => ({
          spaceId: l.spaceId,
          allocations: [
            { financialFundId: administrationFundId, amountOwing: i === 0 ? 999 : 1000, creditBalance: 0 },
          ],
        })),
      });
      expect(mismatched.status).toBe(422);
      expect(mismatched.body.error.details.mismatchedLots.length).toBeGreaterThan(0);

      const count = await testPrisma.journalEntry.count({ where: { propertyId: property.id } });
      expect(count).toBe(0);
    });

    it('blocks generation when the posting profile is not configured', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, lots, administrationFundId } = await createActiveFinancialProperty(
        accessToken,
        100,
        0,
      );
      await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31');

      const res = await generateOpeningJournal(accessToken, property.id, {
        lotFundSplits: lots.map((l) => ({
          spaceId: l.spaceId,
          allocations: [{ financialFundId: administrationFundId, amountOwing: 100, creditBalance: 0 }],
        })),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('reversal — concurrency and idempotency (closure verification)', () => {
    it('two truly concurrent reversals of the same journal resolve to exactly one reversal, with the original reason preserved', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const { cash, income } = await setupBasicLedger(accessToken, property);

      const posted = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'To be concurrently reversed',
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 400 },
          { accountId: income.id, financialFundId: administrationFundId, credit: 400 },
        ],
      });
      expect(posted.status).toBe(201);

      const [a, b] = await Promise.all([
        reverseJournal(accessToken, property.id, posted.body.id, { reason: 'Reason A (first caller)' }),
        reverseJournal(accessToken, property.id, posted.body.id, { reason: 'Reason B (racing caller)' }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const reversals = await testPrisma.journalEntry.findMany({
        where: { propertyId: property.id, reversalOfJournalId: posted.body.id },
      });
      expect(reversals).toHaveLength(1);
      // The reason must belong to whichever call actually won — never
      // silently overwritten by the losing concurrent call.
      expect(['Reason A (first caller)', 'Reason B (racing caller)']).toContain(
        reversals[0]!.reversalReason,
      );

      const winner = [a, b].find((r) => r.status === 201)!;
      expect(winner.body.reversalReason).toBe(reversals[0]!.reversalReason);
    });
  });

  describe('cross-fund flag — not reachable from the public API (closure verification)', () => {
    it('ignores an allowCrossFund field injected into the manual journal request body', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId, capitalWorksFundId } =
        await createActiveFinancialProperty(accessToken);
      const { cash, income } = await setupBasicLedger(accessToken, property);

      const res = await postJournal(accessToken, property.id, {
        effectiveDate: '2026-10-05',
        narration: 'Attempting to smuggle allowCrossFund',
        allowCrossFund: true, // not a declared field — must be stripped/ignored, never honoured
        lines: [
          { accountId: cash.id, financialFundId: administrationFundId, debit: 500 },
          { accountId: income.id, financialFundId: capitalWorksFundId, credit: 500 },
        ],
      });
      // Still rejected — proves the flag was never read, not just that
      // this particular request happened to be invalid for another reason.
      expect(res.status).toBe(422);

      const count = await testPrisma.journalEntry.count({ where: { propertyId: property.id } });
      expect(count).toBe(0);
    });
  });

  describe('posting profile — invalid account assignment (closure verification)', () => {
    it('rejects configuring an inactive account', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const account = await createAccount(accessToken, property.id, {
        code: '300000',
        name: 'Cash at Bank',
        classification: 'ASSET',
      });
      const deactivated = await request(app)
        .post(`/api/v1/properties/${property.id}/financials/accounts/${account.id}/deactivate`)
        .set(authHeader(accessToken));
      expect(deactivated.status).toBe(200);

      const res = await upsertPostingProfileRaw(accessToken, property.id, {
        role: 'FUND_CASH',
        financialFundId: administrationFundId,
        accountId: account.id,
      });
      expect(res.status).toBe(409);

      const rules = await testPrisma.postingProfileRule.findMany({ where: { propertyId: property.id } });
      expect(rules).toHaveLength(0);
    });

    it('rejects configuring an account that belongs to a different property', async () => {
      const { accessToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(accessToken);
      const other = await createActiveFinancialProperty(accessToken);
      const foreignAccount = await createAccount(accessToken, other.property.id, {
        code: '300000',
        name: 'Cash at Bank — foreign property',
        classification: 'ASSET',
      });

      const res = await upsertPostingProfileRaw(accessToken, property.id, {
        role: 'FUND_CASH',
        financialFundId: administrationFundId,
        accountId: foreignAccount.id,
      });
      expect(res.status).toBe(404);
    });

    it('rejects configuring a fund that belongs to a different property', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);
      const other = await createActiveFinancialProperty(accessToken);
      const account = await createAccount(accessToken, property.id, {
        code: '300000',
        name: 'Cash at Bank',
        classification: 'ASSET',
      });

      const res = await upsertPostingProfileRaw(accessToken, property.id, {
        role: 'FUND_CASH',
        financialFundId: other.administrationFundId,
        accountId: account.id,
      });
      expect(res.status).toBe(404);
    });
  });

  describe('accounting periods — concurrency (closure verification)', () => {
    it('two truly concurrent requests to open overlapping periods resolve to exactly one period', async () => {
      const { accessToken } = await registerAuOrg();
      const { property } = await createActiveFinancialProperty(accessToken);

      const [a, b] = await Promise.all([
        createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31'),
        createPeriod(accessToken, property.id, '2026-09-01', '2027-02-28'),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const count = await testPrisma.accountingPeriod.count({ where: { propertyId: property.id } });
      expect(count).toBe(1);
    });
  });

  describe('organisation isolation — periods and posting profile (closure verification)', () => {
    it('a user from a different organisation cannot see or modify this property’s periods or posting profile', async () => {
      const { accessToken: ownerToken } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(ownerToken);
      const account = await createAccount(ownerToken, property.id, {
        code: '300000',
        name: 'Cash at Bank',
        classification: 'ASSET',
      });
      const period = (await createPeriod(ownerToken, property.id, '2026-07-01', '2026-12-31')).body;

      const { accessToken: otherOrgToken } = await registerAuOrg();

      expect(
        (
          await request(app)
            .get(`/api/v1/properties/${property.id}/financials/periods`)
            .set(authHeader(otherOrgToken))
        ).status,
      ).toBe(404);
      expect((await createPeriod(otherOrgToken, property.id, '2027-07-01', '2027-12-31')).status).toBe(404);
      expect((await closePeriod(otherOrgToken, property.id, period.id)).status).toBe(404);
      expect(
        (
          await request(app)
            .get(`/api/v1/properties/${property.id}/financials/posting-profile`)
            .set(authHeader(otherOrgToken))
        ).status,
      ).toBe(404);
      expect(
        (
          await upsertPostingProfileRaw(otherOrgToken, property.id, {
            role: 'FUND_CASH',
            financialFundId: administrationFundId,
            accountId: account.id,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('capability enforcement — periods, posting profile, opening journal (closure verification)', () => {
    it('financials.manage alone is not sufficient for approve-gated ledger actions', async () => {
      const { accessToken: ownerToken, organisationId } = await registerAuOrg();
      const { property, administrationFundId } = await createActiveFinancialProperty(ownerToken);
      const account = await createAccount(ownerToken, property.id, {
        code: '300000',
        name: 'Cash at Bank',
        classification: 'ASSET',
      });
      const period = (await createPeriod(ownerToken, property.id, '2026-07-01', '2026-12-31')).body;

      // PROPERTY_MANAGER holds financials.view by default but not
      // financials.manage/financials.approve — grant financials.manage
      // explicitly via an organisation override so this test isolates
      // "manage but not approve", not "no financials access at all".
      const managerToken = await createPropertyRoleToken(
        ownerToken,
        organisationId,
        property.id,
        'PROPERTY_MANAGER',
      );
      const overrideRes = await request(app)
        .put('/api/v1/organisations/me/role-permissions/PROPERTY_MANAGER')
        .set(authHeader(ownerToken))
        .send({ overrides: [{ capability: 'financials.manage', granted: true }] });
      expect(overrideRes.status).toBe(200);

      expect(
        (
          await createPeriod(managerToken, property.id, '2027-07-01', '2027-12-31')
        ).status,
      ).toBe(403);
      expect((await closePeriod(managerToken, property.id, period.id)).status).toBe(403);
      expect(
        (
          await upsertPostingProfileRaw(managerToken, property.id, {
            role: 'FUND_CASH',
            financialFundId: administrationFundId,
            accountId: account.id,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await generateOpeningJournal(managerToken, property.id, { lotFundSplits: [] })
        ).status,
      ).toBe(403);
    });
  });
});
