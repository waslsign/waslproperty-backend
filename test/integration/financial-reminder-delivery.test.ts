import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ providerMessageId: 'test-provider-message-id' }),
}));
const { suppressedMock } = vi.hoisted(() => ({ suppressedMock: vi.fn().mockReturnValue(false) }));

vi.mock('../../src/lib/email.js', () => ({
  emailService: { send: sendMock },
  isEmailSendSuppressed: suppressedMock,
}));

import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { EmailProviderError } from '../../src/lib/email/types.js';
import { ReminderDispatchService } from '../../src/modules/financials/reminder-dispatch.service.js';
import { ReminderEligibilityService } from '../../src/modules/financials/reminder-eligibility.service.js';
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

async function createPeriod(accessToken: string, propertyId: string, startDate: string, endDate: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/periods`)
    .set(authHeader(accessToken))
    .send({ startDate, endDate });
  expect(res.status).toBe(201);
  return res.body;
}

async function upsertPostingProfile(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  const res = await request(app).put(`/api/v1/properties/${propertyId}/financials/posting-profile`).set(authHeader(accessToken)).send(body);
  expect(res.status).toBe(201);
  return res.body;
}

async function createBudget(accessToken: string, propertyId: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/financials/budgets`)
    .set(authHeader(accessToken))
    .send({ financialYearStartDate: '2026-07-01', financialYearEndDate: '2027-06-30', ...body });
  expect(res.status).toBe(201);
  return res.body;
}

async function addBudgetLine(accessToken: string, propertyId: string, budgetId: string, body: Record<string, unknown>) {
  const res = await request(app).post(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/lines`).set(authHeader(accessToken)).send(body);
  expect(res.status).toBe(201);
  return res.body;
}

async function approveBudget(accessToken: string, propertyId: string, budgetId: string) {
  const res = await request(app).post(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/approve`).set(authHeader(accessToken)).send({});
  expect(res.status).toBe(200);
  return res.body;
}

async function activateBudget(accessToken: string, propertyId: string, budgetId: string) {
  const res = await request(app).post(`/api/v1/properties/${propertyId}/financials/budgets/${budgetId}/activate`).set(authHeader(accessToken)).send({});
  expect(res.status).toBe(200);
  return res.body;
}

async function createRegularSchedule(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/v1/properties/${propertyId}/financials/levy-schedules/regular`).set(authHeader(accessToken)).send(body);
}

async function approveSchedule(accessToken: string, propertyId: string, scheduleId: string) {
  const res = await request(app).post(`/api/v1/properties/${propertyId}/financials/levy-schedules/${scheduleId}/approve`).set(authHeader(accessToken)).send({});
  expect(res.status).toBe(200);
  return res.body;
}

async function issueInstallment(accessToken: string, propertyId: string, scheduleId: string) {
  const res = await request(app).post(`/api/v1/properties/${propertyId}/financials/levy-schedules/${scheduleId}/issue`).set(authHeader(accessToken)).send({});
  expect(res.status).toBe(201);
  return res.body;
}

async function createPropertyRoleToken(
  ownerAccessToken: string,
  organisationId: string,
  propertyId: string,
  role: string,
  spaceId?: string,
  emailOverride?: string,
) {
  const user = await createPlainUser(emailOverride ? { email: emailOverride } : {});
  const email = emailOverride ?? user.email;
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/memberships`)
    .set(authHeader(ownerAccessToken))
    .send({ email, firstName: 'P', lastName: 'Owner', role, spaceId });
  expect(res.status).toBe(201);
  const contact = await testPrisma.propertyContact.findFirstOrThrow({ where: { organisationId, email } });
  return { token: residentAccessToken(user.userId, organisationId, contact.id), contact, email };
}

/** A single-lot scheme ready for arrears, extended with an active OWNER
 * membership/contact on the lot so recipient resolution succeeds — same
 * M16.5/M16.6 fixture plus the M16.8 ownership wiring. */
async function createSchemeReadyForReminders(accessToken: string, organisationId: string) {
  const property = await createProperty(accessToken);
  await enableStrata(accessToken, property.id);
  const summary = await setLots(accessToken, property.id, [{ kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 100 }]);
  await completeStrataSetup(accessToken, property.id);
  await startFinancialSetup(accessToken, property.id);
  await addFund(accessToken, property.id, 'ADMINISTRATION');
  await addFund(accessToken, property.id, 'CAPITAL_WORKS');
  const lots = summary.lots as Array<{ spaceId: string }>;
  const spaceId = lots[0]!.spaceId;

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

  const owner = await createPropertyRoleToken(accessToken, organisationId, property.id, 'OWNER', spaceId, 'owner.lot1@example.com');

  return { property, spaceId, administrationFundId, income, owner };
}

async function issueOverdueLevy(accessToken: string, propertyId: string, fundId: string, incomeAccountId: string, amount: number, dueDate: string) {
  const budget = await createBudget(accessToken, propertyId);
  await addBudgetLine(accessToken, propertyId, budget.id, {
    financialFundId: fundId,
    lineType: 'REVENUE',
    category: 'Levy Contributions',
    plannedAmount: amount,
    accountId: incomeAccountId,
  });
  await approveBudget(accessToken, propertyId, budget.id);
  await activateBudget(accessToken, propertyId, budget.id);

  const created = await createRegularSchedule(accessToken, propertyId, {
    financialFundId: fundId,
    financialBudgetId: budget.id,
    name: 'Q1 Admin Levy',
    installments: [{ dueDate, amount }],
  });
  expect(created.status).toBe(201);
  await approveSchedule(accessToken, propertyId, created.body.id);
  await issueInstallment(accessToken, propertyId, created.body.id);
}

function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

async function getPolicy(accessToken: string, propertyId: string) {
  return request(app).get(`/api/v1/properties/${propertyId}/financials/arrears/reminders/policy`).set(authHeader(accessToken));
}

async function updatePolicy(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return request(app).patch(`/api/v1/properties/${propertyId}/financials/arrears/reminders/policy`).set(authHeader(accessToken)).send(body);
}

async function evaluate(accessToken: string, propertyId: string, asOfDate?: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/arrears/reminders/evaluate`)
    .set(authHeader(accessToken))
    .send(asOfDate ? { asOfDate } : {});
}

async function listQueue(accessToken: string, propertyId: string, query = '') {
  return request(app).get(`/api/v1/properties/${propertyId}/financials/arrears/reminders/queue${query}`).set(authHeader(accessToken));
}

async function getDetail(accessToken: string, propertyId: string, reminderId: string) {
  return request(app).get(`/api/v1/properties/${propertyId}/financials/arrears/reminders/queue/${reminderId}`).set(authHeader(accessToken));
}

async function approve(accessToken: string, propertyId: string, reminderId: string) {
  return request(app).post(`/api/v1/properties/${propertyId}/financials/arrears/reminders/queue/${reminderId}/approve`).set(authHeader(accessToken)).send();
}

/** M16.6's original manual-draft endpoint — the OTHER entry point into
 * the now-unified reminder lifecycle, distinct from the M16.8
 * eligibility evaluator. */
async function draftReminderM166(accessToken: string, propertyId: string, spaceId: string) {
  return request(app).post(`/api/v1/properties/${propertyId}/financials/arrears/lots/${spaceId}/reminders`).set(authHeader(accessToken)).send({});
}

async function submitForReview(accessToken: string, propertyId: string, reminderId: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/arrears/reminders/queue/${reminderId}/submit-for-review`)
    .set(authHeader(accessToken))
    .send();
}

async function batchApprove(accessToken: string, propertyId: string, reminderIds: string[]) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/arrears/reminders/queue/batch-approve`)
    .set(authHeader(accessToken))
    .send({ reminderIds });
}

async function dispatchNow(accessToken: string, propertyId: string, reminderId: string) {
  return request(app).post(`/api/v1/properties/${propertyId}/financials/arrears/reminders/queue/${reminderId}/dispatch`).set(authHeader(accessToken)).send();
}

async function retryDispatch(accessToken: string, propertyId: string, reminderId: string) {
  return request(app).post(`/api/v1/properties/${propertyId}/financials/arrears/reminders/queue/${reminderId}/retry`).set(authHeader(accessToken)).send();
}

async function resolveQuarantine(accessToken: string, propertyId: string, reminderId: string, resolution: string) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/financials/arrears/reminders/queue/${reminderId}/resolve-quarantine`)
    .set(authHeader(accessToken))
    .send({ resolution, note: 'manual check against provider dashboard' });
}

async function cancelM168(accessToken: string, propertyId: string, reminderId: string) {
  return request(app).post(`/api/v1/properties/${propertyId}/financials/arrears/reminders/queue/${reminderId}/cancel`).set(authHeader(accessToken)).send();
}

async function enableAndDeliver(accessToken: string, propertyId: string) {
  const res = await updatePolicy(accessToken, propertyId, {
    enabled: true,
    deliveryEnabled: true,
    initialDelayDays: 0,
    minimumOutstandingAmount: 0,
  });
  expect(res.status).toBe(200);
  return res.body;
}

describe('M16.8 Arrears Reminder Delivery & Scheduling', () => {
  beforeEach(async () => {
    await resetDb();
    sendMock.mockClear();
    suppressedMock.mockReturnValue(false);
  });

  afterAll(async () => {
    await resetDb();
    await testPrisma.$disconnect();
  });

  describe('policy', () => {
    it('defaults to disabled (enabled=false, deliveryEnabled=false) on first read', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const property = await createProperty(accessToken);
      const res = await getPolicy(accessToken, property.id);
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(res.body.deliveryEnabled).toBe(false);
      void organisationId;
    });

    it('reflects the EMAIL_SEND_DISABLED kill switch as a plain boolean, never a secret value', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);

      suppressedMock.mockReturnValue(false);
      const enabledRes = await getPolicy(accessToken, property.id);
      expect(enabledRes.body.emailSendGloballyDisabled).toBe(false);

      suppressedMock.mockReturnValue(true);
      const disabledRes = await getPolicy(accessToken, property.id);
      expect(disabledRes.body.emailSendGloballyDisabled).toBe(true);
      expect(JSON.stringify(disabledRes.body)).not.toMatch(/EMAIL_SEND_DISABLED/);
    });

    it('rejects an invalid rolling-window pair (one set without the other)', async () => {
      const { accessToken } = await registerAuOrg();
      const property = await createProperty(accessToken);
      const res = await updatePolicy(accessToken, property.id, { maxRemindersInRollingWindow: 3 });
      expect(res.status).toBe(422);
    });
  });

  describe('eligibility evaluation', () => {
    it('creates a READY_FOR_REVIEW candidate for a genuinely overdue lot past the initial delay', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      const dueDate = addDays(TODAY, -20);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, dueDate);
      await enableAndDeliver(accessToken, scheme.property.id);

      const evalRes = await evaluate(accessToken, scheme.property.id);
      expect(evalRes.status).toBe(201);
      expect(evalRes.body.candidatesCreated).toBe(1);

      const queue = await listQueue(accessToken, scheme.property.id, '?status=READY_FOR_REVIEW');
      expect(queue.status).toBe(200);
      expect(queue.body.items).toHaveLength(1);
      expect(queue.body.items[0].totalAmountOwing).toBe('500.00');
      expect(queue.body.items[0].recipientEmail).toBe('owner.lot1@example.com');
    });

    it('does not create a candidate before the initial delay has elapsed', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      const dueDate = addDays(TODAY, -2);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, dueDate);
      await updatePolicy(accessToken, scheme.property.id, { enabled: true, initialDelayDays: 14 });

      const evalRes = await evaluate(accessToken, scheme.property.id);
      expect(evalRes.body.candidatesCreated).toBe(0);
      expect(evalRes.body.skipped).toBe(1);
    });

    it('does not evaluate anything while the policy is disabled', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, addDays(TODAY, -30));

      const evalRes = await evaluate(accessToken, scheme.property.id);
      expect(evalRes.body.lotsConsidered).toBe(0);
      expect(evalRes.body.candidatesCreated).toBe(0);
    });

    it('is idempotent across repeated evaluation runs for the same day', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, addDays(TODAY, -20));
      await enableAndDeliver(accessToken, scheme.property.id);

      await evaluate(accessToken, scheme.property.id);
      const second = await evaluate(accessToken, scheme.property.id);
      expect(second.body.candidatesCreated).toBe(0);

      const queue = await listQueue(accessToken, scheme.property.id);
      expect(queue.body.items).toHaveLength(1);
    });

    it('suppresses a candidate when the lot has a DISPUTED collection case', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, addDays(TODAY, -20));
      await enableAndDeliver(accessToken, scheme.property.id);

      const caseRes = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/arrears/lots/${scheme.spaceId}/collection-cases`)
        .set(authHeader(accessToken))
        .send({});
      expect(caseRes.status).toBe(201);
      const patchRes = await request(app)
        .patch(`/api/v1/properties/${scheme.property.id}/financials/arrears/collection-cases/${caseRes.body.id}`)
        .set(authHeader(accessToken))
        .send({ status: 'DISPUTED' });
      expect(patchRes.status).toBe(200);

      const evalRes = await evaluate(accessToken, scheme.property.id);
      expect(evalRes.body.candidatesCreated).toBe(0);
      expect(evalRes.body.suppressedCreated).toBe(1);

      const queue = await listQueue(accessToken, scheme.property.id, '?status=SUPPRESSED');
      expect(queue.body.items).toHaveLength(1);
      expect(queue.body.items[0].eligibilityReason).toMatch(/DISPUTED/);
    });

    it('flags a lot with no active owner contact instead of fabricating a recipient', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await enableStrata(accessToken, property.id);
      const summary = await setLots(accessToken, property.id, [{ kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 100 }]);
      await completeStrataSetup(accessToken, property.id);
      await startFinancialSetup(accessToken, property.id);
      await addFund(accessToken, property.id, 'ADMINISTRATION');
      await addFund(accessToken, property.id, 'CAPITAL_WORKS');
      void summary;
      const activation = await activateFinancialSetup(accessToken, property.id);
      const fundId = (activation.body.funds as Array<{ id: string; fundType: string }>).find((f) => f.fundType === 'ADMINISTRATION')!.id;
      const receivable = await createAccount(accessToken, property.id, { code: '310000', name: 'Receivable', classification: 'ASSET' });
      const income = await createAccount(accessToken, property.id, { code: '100000', name: 'Income', classification: 'INCOME' });
      const cash = await createAccount(accessToken, property.id, { code: '110000', name: 'Cash', classification: 'ASSET' });
      const unapplied = await createAccount(accessToken, property.id, { code: '210000', name: 'Unapplied', classification: 'LIABILITY' });
      await upsertPostingProfile(accessToken, property.id, { role: 'LOT_LEVY_RECEIVABLE', financialFundId: fundId, accountId: receivable.id });
      await upsertPostingProfile(accessToken, property.id, { role: 'LEVY_INCOME', financialFundId: fundId, accountId: income.id });
      await upsertPostingProfile(accessToken, property.id, { role: 'FUND_CASH', financialFundId: fundId, accountId: cash.id });
      await upsertPostingProfile(accessToken, property.id, { role: 'UNAPPLIED_CASH', accountId: unapplied.id });
      await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31');
      // Deliberately NO owner membership created on this lot.
      await issueOverdueLevy(accessToken, property.id, fundId, income.id, 500, addDays(TODAY, -20));
      await updatePolicy(accessToken, property.id, { enabled: true, initialDelayDays: 0 });
      void organisationId;

      const evalRes = await evaluate(accessToken, property.id);
      expect(evalRes.body.candidatesCreated).toBe(1);

      const queue = await listQueue(accessToken, property.id, '?status=READY_FOR_REVIEW');
      expect(queue.body.items[0].recipientEmail).toBeNull();
      expect(queue.body.items[0].recipientResolutionNote).toMatch(/No active owner/);
    });
  });

  describe('approval', () => {
    async function createCandidate(accessToken: string, organisationId: string) {
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, addDays(TODAY, -20));
      await enableAndDeliver(accessToken, scheme.property.id);
      await evaluate(accessToken, scheme.property.id);
      const queue = await listQueue(accessToken, scheme.property.id);
      return { scheme, reminderId: queue.body.items[0].id as string };
    }

    it('approves a valid candidate and stores an immutable approval snapshot', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createCandidate(accessToken, organisationId);

      const res = await approve(accessToken, scheme.property.id, reminderId);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('APPROVED');

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(row.approvalSnapshot).toBeTruthy();
      expect(row.approvedByUserId).toBeTruthy();
    });

    it('reminder detail exposes the exact rendered email preview for a resolved recipient', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createCandidate(accessToken, organisationId);

      const detail = await getDetail(accessToken, scheme.property.id, reminderId);
      expect(detail.status).toBe(200);
      expect(detail.body.emailPreview).toBeTruthy();
      expect(detail.body.emailPreview.to).toBe('owner.lot1@example.com');
      expect(detail.body.emailPreview.subject).toMatch(/levy payment reminder/i);
      expect(detail.body.emailPreview.html).toContain('500.00');
      expect(detail.body.emailPreviewUnavailableReason).toBeNull();
    });

    it('reminder detail has no email preview (and a reason) when no recipient is resolved', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await enableStrata(accessToken, property.id);
      const summary = await setLots(accessToken, property.id, [{ kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 100 }]);
      await completeStrataSetup(accessToken, property.id);
      await startFinancialSetup(accessToken, property.id);
      await addFund(accessToken, property.id, 'ADMINISTRATION');
      await addFund(accessToken, property.id, 'CAPITAL_WORKS');
      void summary;
      const activation = await activateFinancialSetup(accessToken, property.id);
      const fundId = (activation.body.funds as Array<{ id: string; fundType: string }>).find((f) => f.fundType === 'ADMINISTRATION')!.id;
      const receivable = await createAccount(accessToken, property.id, { code: '310000', name: 'Receivable', classification: 'ASSET' });
      const income = await createAccount(accessToken, property.id, { code: '100000', name: 'Income', classification: 'INCOME' });
      const cash = await createAccount(accessToken, property.id, { code: '110000', name: 'Cash', classification: 'ASSET' });
      const unapplied = await createAccount(accessToken, property.id, { code: '210000', name: 'Unapplied', classification: 'LIABILITY' });
      await upsertPostingProfile(accessToken, property.id, { role: 'LOT_LEVY_RECEIVABLE', financialFundId: fundId, accountId: receivable.id });
      await upsertPostingProfile(accessToken, property.id, { role: 'LEVY_INCOME', financialFundId: fundId, accountId: income.id });
      await upsertPostingProfile(accessToken, property.id, { role: 'FUND_CASH', financialFundId: fundId, accountId: cash.id });
      await upsertPostingProfile(accessToken, property.id, { role: 'UNAPPLIED_CASH', accountId: unapplied.id });
      await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31');
      await issueOverdueLevy(accessToken, property.id, fundId, income.id, 500, addDays(TODAY, -20));
      await updatePolicy(accessToken, property.id, { enabled: true, initialDelayDays: 0 });
      void organisationId;
      await evaluate(accessToken, property.id);
      const queue = await listQueue(accessToken, property.id);
      const reminderId = queue.body.items[0].id as string;

      const detail = await getDetail(accessToken, property.id, reminderId);
      expect(detail.body.emailPreview).toBeNull();
      expect(detail.body.emailPreviewUnavailableReason).toMatch(/No active owner/);
    });

    it('cancels (not approves) a candidate whose debt has been fully settled since generation', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createCandidate(accessToken, organisationId);

      const charges = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/lot-levy-charges?spaceId=${scheme.spaceId}`)
        .set(authHeader(accessToken));
      await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/receipts`)
        .set(authHeader(accessToken))
        .send({
          spaceId: scheme.spaceId,
          financialFundId: scheme.administrationFundId,
          amount: 500,
          paymentMethod: 'BANK_TRANSFER',
          receiptDate: TODAY,
          allocations: [{ lotLevyChargeId: charges.body.items[0].id, amount: 500 }],
        });

      const res = await approve(accessToken, scheme.property.id, reminderId);
      expect(res.status).toBe(409);

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(row.status).toBe('CANCELLED');
    });

    it('batch-approves multiple candidates independently, one failure not blocking the rest', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createCandidate(accessToken, organisationId);

      const res = await batchApprove(accessToken, scheme.property.id, [reminderId, 'does-not-exist']);
      expect(res.status).toBe(201);
      expect(res.body.approvedCount).toBe(1);
      expect(res.body.skippedCount).toBe(1);
    });

    it('live reminder detail flags staleness when the figures have changed since generation', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createCandidate(accessToken, organisationId);

      const charges = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/lot-levy-charges?spaceId=${scheme.spaceId}`)
        .set(authHeader(accessToken));
      await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/receipts`)
        .set(authHeader(accessToken))
        .send({
          spaceId: scheme.spaceId,
          financialFundId: scheme.administrationFundId,
          amount: 100,
          paymentMethod: 'BANK_TRANSFER',
          receiptDate: TODAY,
          allocations: [{ lotLevyChargeId: charges.body.items[0].id, amount: 100 }],
        });

      const detail = await getDetail(accessToken, scheme.property.id, reminderId);
      expect(detail.status).toBe(200);
      expect(detail.body.stale).toBe(true);
      expect(detail.body.live.totalOverdue).toBe('400.00');
    });

    it('cancels an approved reminder on request', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createCandidate(accessToken, organisationId);
      await approve(accessToken, scheme.property.id, reminderId);
      const res = await cancelM168(accessToken, scheme.property.id, reminderId);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CANCELLED');
    });
  });

  describe('dispatch and email safety', () => {
    async function createApprovedReminder(accessToken: string, organisationId: string) {
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, addDays(TODAY, -20));
      await enableAndDeliver(accessToken, scheme.property.id);
      await evaluate(accessToken, scheme.property.id);
      const queue = await listQueue(accessToken, scheme.property.id);
      const reminderId = queue.body.items[0].id as string;
      await approve(accessToken, scheme.property.id, reminderId);
      return { scheme, reminderId };
    }

    it('EMAIL_SEND_DISABLED is a hard stop — dispatch never calls the provider and never reports SENT', async () => {
      suppressedMock.mockReturnValue(true);
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createApprovedReminder(accessToken, organisationId);

      const res = await dispatchNow(accessToken, scheme.property.id, reminderId);
      expect(res.status).toBe(202);
      expect(sendMock).not.toHaveBeenCalled();

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(row.status).toBe('APPROVED');
      expect(row.status).not.toBe('SENT');
    });

    it('dispatches successfully through the mocked, explicitly non-delivering email transport', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createApprovedReminder(accessToken, organisationId);

      const res = await dispatchNow(accessToken, scheme.property.id, reminderId);
      expect(res.status).toBe(202);
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock.mock.calls[0][0].to).toBe('owner.lot1@example.com');

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(row.status).toBe('SENT');
      expect(row.providerMessageId).toBe('test-provider-message-id');
    });

    it('a repeated dispatch click/retry never duplicates the send (second call is a conflict, not a second email)', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createApprovedReminder(accessToken, organisationId);

      const first = await dispatchNow(accessToken, scheme.property.id, reminderId);
      expect(first.status).toBe(202);
      const second = await dispatchNow(accessToken, scheme.property.id, reminderId);
      expect(second.status).toBe(409);
      expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it('an ambiguous provider timeout quarantines the reminder instead of auto-retrying', async () => {
      sendMock.mockRejectedValueOnce(new EmailProviderError('TIMEOUT', 'provider timed out'));
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createApprovedReminder(accessToken, organisationId);

      await dispatchNow(accessToken, scheme.property.id, reminderId);
      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(row.status).toBe('QUARANTINED');

      // Never auto-retried: dispatch attempts don't change its status.
      await dispatchNow(accessToken, scheme.property.id, reminderId).catch(() => undefined);
      expect(sendMock).toHaveBeenCalledTimes(1);

      const resolveRes = await resolveQuarantine(accessToken, scheme.property.id, reminderId, 'CONFIRMED_NOT_SENT');
      expect(resolveRes.status).toBe(201);
      const after = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(after.status).toBe('APPROVED');
    });

    it('a permanent provider failure marks the reminder FAILED and allows a manual retry', async () => {
      sendMock.mockRejectedValueOnce(new Error('550 permanent rejection'));
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createApprovedReminder(accessToken, organisationId);

      await dispatchNow(accessToken, scheme.property.id, reminderId);
      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(row.status).toBe('FAILED');

      const retryRes = await retryDispatch(accessToken, scheme.property.id, reminderId);
      expect(retryRes.status).toBe(201);
      const after = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(after.status).toBe('APPROVED');
    });

    it('invalidates an approval and never sends if the debt was settled between approval and dispatch', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const { scheme, reminderId } = await createApprovedReminder(accessToken, organisationId);

      const charges = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/lot-levy-charges?spaceId=${scheme.spaceId}`)
        .set(authHeader(accessToken));
      await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/receipts`)
        .set(authHeader(accessToken))
        .send({
          spaceId: scheme.spaceId,
          financialFundId: scheme.administrationFundId,
          amount: 500,
          paymentMethod: 'BANK_TRANSFER',
          receiptDate: TODAY,
          allocations: [{ lotLevyChargeId: charges.body.items[0].id, amount: 500 }],
        });

      await dispatchNow(accessToken, scheme.property.id, reminderId);
      expect(sendMock).not.toHaveBeenCalled();
      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(row.status).toBe('READY_FOR_REVIEW');
    });
  });

  describe('delivery confirmation webhook', () => {
    it('moves SENT -> DELIVERED on a correctly signed webhook, and deduplicates a redelivered event', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, addDays(TODAY, -20));
      await enableAndDeliver(accessToken, scheme.property.id);
      await evaluate(accessToken, scheme.property.id);
      const queue = await listQueue(accessToken, scheme.property.id);
      const reminderId = queue.body.items[0].id as string;
      await approve(accessToken, scheme.property.id, reminderId);
      await dispatchNow(accessToken, scheme.property.id, reminderId);

      if (!env.REMINDER_DELIVERY_WEBHOOK_SECRET) {
        // No secret configured in this test env — verify the documented 503, not a crash.
        const bare = await request(app)
          .post('/api/v1/integrations/reminder-delivery/webhook')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ providerMessageId: 'test-provider-message-id', status: 'delivered' }));
        expect(bare.status).toBe(503);
        return;
      }

      const payload = JSON.stringify({ providerMessageId: 'test-provider-message-id', status: 'delivered' });
      const signature = crypto.createHmac('sha256', env.REMINDER_DELIVERY_WEBHOOK_SECRET).update(payload).digest('hex');

      const first = await request(app)
        .post('/api/v1/integrations/reminder-delivery/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Reminder-Signature', `sha256=${signature}`)
        .send(payload);
      expect(first.status).toBe(200);
      expect(first.body.handled).toBe(true);

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(row.status).toBe('DELIVERED');

      const second = await request(app)
        .post('/api/v1/integrations/reminder-delivery/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Reminder-Signature', `sha256=${signature}`)
        .send(payload);
      expect(second.status).toBe(200);
      expect(second.body.handled).toBe(false);
    });
  });

  describe('tenant/property isolation and RBAC', () => {
    it('404s a reminder-queue request for a property belonging to a different organisation', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);

      const other = await registerAuOrg();
      const res = await listQueue(other.accessToken, scheme.property.id);
      expect(res.status).toBe(404);
    });

    it('403s a caller without financials.manage from updating the policy or approving', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      const residentToken = (await createPropertyRoleToken(accessToken, organisationId, scheme.property.id, 'RESIDENT', scheme.spaceId, 'resident@example.com')).token;

      const res = await updatePolicy(residentToken, scheme.property.id, { enabled: true });
      expect(res.status).toBe(403);
    });
  });

  describe('scheduler safety — true concurrency, not just sequential retries', () => {
    it('two truly concurrent dispatchNow calls on the same reminder send exactly once (the atomic APPROVED->QUEUED claim is DB-level, not in-process, so this holds across multiple app instances too)', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, addDays(TODAY, -20));
      await enableAndDeliver(accessToken, scheme.property.id);
      await evaluate(accessToken, scheme.property.id);
      const queue = await listQueue(accessToken, scheme.property.id);
      const reminderId = queue.body.items[0].id as string;
      await approve(accessToken, scheme.property.id, reminderId);

      const dispatchService = new ReminderDispatchService(testPrisma);
      const results = await Promise.allSettled([
        dispatchService.dispatchNow(organisationId, scheme.property.id, reminderId),
        dispatchService.dispatchNow(organisationId, scheme.property.id, reminderId),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected').length;
      expect(fulfilled).toBe(1);
      expect(rejected).toBe(1);
      expect(sendMock).toHaveBeenCalledTimes(1);

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(row.status).toBe('SENT');
    });

    it('two truly concurrent eligibility evaluations do not duplicate a SEND (the dispatch-side claim is what actually matters) and the scheduler itself never approves or dispatches anything on its own', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, addDays(TODAY, -20));
      await enableAndDeliver(accessToken, scheme.property.id);

      const eligibilityService = new ReminderEligibilityService(testPrisma);
      await Promise.all([
        eligibilityService.evaluate(organisationId, scheme.property.id),
        eligibilityService.evaluate(organisationId, scheme.property.id),
      ]);

      // Even if two overlapping evaluation ticks raced and both created a
      // candidate (a known limitation of the check-then-create dedup —
      // see ADR-029's scheduler-safety note), NEITHER a candidate nor a
      // suppressed row is ever auto-approved or auto-dispatched — every
      // row the scheduler can produce stops at READY_FOR_REVIEW/
      // SUPPRESSED, never APPROVED/QUEUED/SENT on its own.
      const rows = await testPrisma.paymentReminder.findMany({ where: { organisationId, propertyId: scheme.property.id } });
      for (const row of rows) {
        expect(['READY_FOR_REVIEW', 'SUPPRESSED']).toContain(row.status);
      }
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('processDue never dispatches anything for a property whose deliveryEnabled is off, even when a reminder is APPROVED', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, addDays(TODAY, -20));
      await updatePolicy(accessToken, scheme.property.id, { enabled: true, deliveryEnabled: false, initialDelayDays: 0, minimumOutstandingAmount: 0 });
      await evaluate(accessToken, scheme.property.id);
      const queue = await listQueue(accessToken, scheme.property.id);
      const reminderId = queue.body.items[0].id as string;
      await approve(accessToken, scheme.property.id, reminderId);
      void organisationId;

      const dispatchService = new ReminderDispatchService(testPrisma);
      const result = await dispatchService.processDue();
      expect(result.processed).toBe(0);
      expect(sendMock).not.toHaveBeenCalled();

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(row.status).toBe('APPROVED');
    });
  });

  describe('manual draft -> submit for review (M16.6/M16.8 convergence)', () => {
    async function createOverdueScheme(accessToken: string, organisationId: string, dueDaysAgo = 20) {
      const scheme = await createSchemeReadyForReminders(accessToken, organisationId);
      await issueOverdueLevy(accessToken, scheme.property.id, scheme.administrationFundId, scheme.income.id, 500, addDays(TODAY, -dueDaysAgo));
      return scheme;
    }

    it('a manually drafted reminder can be submitted for review, approved and dispatched through the SAME pipeline as an automated candidate', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createOverdueScheme(accessToken, organisationId);
      await enableAndDeliver(accessToken, scheme.property.id); // deliveryEnabled only — evaluation stays OFF

      const draftRes = await draftReminderM166(accessToken, scheme.property.id, scheme.spaceId);
      expect(draftRes.status).toBe(201);
      expect(draftRes.body.status).toBe('DRAFT');
      const reminderId = draftRes.body.id as string;

      const submitRes = await submitForReview(accessToken, scheme.property.id, reminderId);
      expect(submitRes.status).toBe(201);
      expect(submitRes.body.status).toBe('READY_FOR_REVIEW');
      expect(submitRes.body.recipientEmail).toBe('owner.lot1@example.com');

      const approveRes = await approve(accessToken, scheme.property.id, reminderId);
      expect(approveRes.status).toBe(201);
      expect(approveRes.body.status).toBe('APPROVED');

      const dispatchRes = await dispatchNow(accessToken, scheme.property.id, reminderId);
      expect(dispatchRes.status).toBe(202);
      expect(sendMock).toHaveBeenCalledTimes(1);

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: reminderId } });
      expect(row.status).toBe('SENT');
    });

    it('does not require the automatic Evaluation policy switch to be enabled', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createOverdueScheme(accessToken, organisationId);
      // No policy row created at all — enabled defaults false, never touched.
      const draftRes = await draftReminderM166(accessToken, scheme.property.id, scheme.spaceId);

      const submitRes = await submitForReview(accessToken, scheme.property.id, draftRes.body.id);
      expect(submitRes.status).toBe(201);
      expect(submitRes.body.status).toBe('READY_FOR_REVIEW');

      const policy = await getPolicy(accessToken, scheme.property.id);
      expect(policy.body.enabled).toBe(false);
    });

    it('does not apply the automated initial-delay timing rule to a manual submission', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      // Overdue by only 1 day — would fail the default 14-day initialDelayDays rule if that rule applied here.
      const scheme = await createOverdueScheme(accessToken, organisationId, 1);
      const draftRes = await draftReminderM166(accessToken, scheme.property.id, scheme.spaceId);

      const submitRes = await submitForReview(accessToken, scheme.property.id, draftRes.body.id);
      expect(submitRes.status).toBe(201);
      expect(submitRes.body.status).toBe('READY_FOR_REVIEW');
    });

    it('cancels (not submits) a draft whose debt has been fully settled since drafting', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createOverdueScheme(accessToken, organisationId);
      const draftRes = await draftReminderM166(accessToken, scheme.property.id, scheme.spaceId);

      const charges = await request(app)
        .get(`/api/v1/properties/${scheme.property.id}/financials/lot-levy-charges?spaceId=${scheme.spaceId}`)
        .set(authHeader(accessToken));
      await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/receipts`)
        .set(authHeader(accessToken))
        .send({
          spaceId: scheme.spaceId,
          financialFundId: scheme.administrationFundId,
          amount: 500,
          paymentMethod: 'BANK_TRANSFER',
          receiptDate: TODAY,
          allocations: [{ lotLevyChargeId: charges.body.items[0].id, amount: 500 }],
        });

      const submitRes = await submitForReview(accessToken, scheme.property.id, draftRes.body.id);
      expect(submitRes.status).toBe(409);

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: draftRes.body.id } });
      expect(row.status).toBe('CANCELLED');
    });

    it('rejects submission below the configured minimum-outstanding threshold, without silently bypassing it', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createOverdueScheme(accessToken, organisationId);
      await updatePolicy(accessToken, scheme.property.id, { minimumOutstandingAmount: 1000 });
      const draftRes = await draftReminderM166(accessToken, scheme.property.id, scheme.spaceId);

      const submitRes = await submitForReview(accessToken, scheme.property.id, draftRes.body.id);
      expect(submitRes.status).toBe(409);
      expect(submitRes.body.error.message).toMatch(/below the configured minimum/);

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: draftRes.body.id } });
      expect(row.status).toBe('DRAFT');
    });

    it('suppresses (rather than silently blocking) submission for a lot whose collection case is DISPUTED', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createOverdueScheme(accessToken, organisationId);
      const draftRes = await draftReminderM166(accessToken, scheme.property.id, scheme.spaceId);

      const caseRes = await request(app)
        .post(`/api/v1/properties/${scheme.property.id}/financials/arrears/lots/${scheme.spaceId}/collection-cases`)
        .set(authHeader(accessToken))
        .send({});
      await request(app)
        .patch(`/api/v1/properties/${scheme.property.id}/financials/arrears/collection-cases/${caseRes.body.id}`)
        .set(authHeader(accessToken))
        .send({ status: 'DISPUTED' });

      const submitRes = await submitForReview(accessToken, scheme.property.id, draftRes.body.id);
      expect(submitRes.status).toBe(201);
      expect(submitRes.body.status).toBe('SUPPRESSED');
      expect(submitRes.body.eligibilityReason).toMatch(/DISPUTED/);
    });

    it('flags a missing recipient but still allows submission, consistent with the automated evaluator', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const property = await createProperty(accessToken);
      await enableStrata(accessToken, property.id);
      const summary = await setLots(accessToken, property.id, [{ kind: 'new', name: 'Lot 1', code: 'L1', unitsOfEntitlement: 100 }]);
      await completeStrataSetup(accessToken, property.id);
      await startFinancialSetup(accessToken, property.id);
      await addFund(accessToken, property.id, 'ADMINISTRATION');
      await addFund(accessToken, property.id, 'CAPITAL_WORKS');
      void summary;
      const activation = await activateFinancialSetup(accessToken, property.id);
      const fundId = (activation.body.funds as Array<{ id: string; fundType: string }>).find((f) => f.fundType === 'ADMINISTRATION')!.id;
      const receivable = await createAccount(accessToken, property.id, { code: '310000', name: 'Receivable', classification: 'ASSET' });
      const income = await createAccount(accessToken, property.id, { code: '100000', name: 'Income', classification: 'INCOME' });
      const cash = await createAccount(accessToken, property.id, { code: '110000', name: 'Cash', classification: 'ASSET' });
      const unapplied = await createAccount(accessToken, property.id, { code: '210000', name: 'Unapplied', classification: 'LIABILITY' });
      await upsertPostingProfile(accessToken, property.id, { role: 'LOT_LEVY_RECEIVABLE', financialFundId: fundId, accountId: receivable.id });
      await upsertPostingProfile(accessToken, property.id, { role: 'LEVY_INCOME', financialFundId: fundId, accountId: income.id });
      await upsertPostingProfile(accessToken, property.id, { role: 'FUND_CASH', financialFundId: fundId, accountId: cash.id });
      await upsertPostingProfile(accessToken, property.id, { role: 'UNAPPLIED_CASH', accountId: unapplied.id });
      await createPeriod(accessToken, property.id, '2026-07-01', '2026-12-31');
      await issueOverdueLevy(accessToken, property.id, fundId, income.id, 500, addDays(TODAY, -20));
      void organisationId;

      const draftRes = await draftReminderM166(accessToken, property.id, (summary.lots as Array<{ spaceId: string }>)[0]!.spaceId);
      const submitRes = await submitForReview(accessToken, property.id, draftRes.body.id);

      expect(submitRes.status).toBe(201);
      expect(submitRes.body.status).toBe('READY_FOR_REVIEW');
      expect(submitRes.body.recipientEmail).toBeNull();
      expect(submitRes.body.recipientResolutionNote).toMatch(/No active owner/);
    });

    it('blocks submission when an automated candidate already exists for the same lot and stage, pointing at the existing one', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createOverdueScheme(accessToken, organisationId);
      const draftRes = await draftReminderM166(accessToken, scheme.property.id, scheme.spaceId);

      // The eligibility evaluator creates its OWN READY_FOR_REVIEW candidate
      // for the same lot/stage — eligibility's own dedup only looks at
      // READY_FOR_REVIEW/APPROVED/QUEUED/SENDING/SUPPRESSED, never DRAFT, so
      // the untouched manual draft does not stop it from being created.
      await updatePolicy(accessToken, scheme.property.id, { enabled: true, initialDelayDays: 0, minimumOutstandingAmount: 0 });
      await evaluate(accessToken, scheme.property.id);

      const submitRes = await submitForReview(accessToken, scheme.property.id, draftRes.body.id);
      expect(submitRes.status).toBe(409);
      expect(submitRes.body.error.message).toMatch(/Another reminder already exists/);

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: draftRes.body.id } });
      expect(row.status).toBe('DRAFT');
    });

    it('only a DRAFT reminder can be submitted — an already-READY_FOR_REVIEW reminder is rejected', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createOverdueScheme(accessToken, organisationId);
      await updatePolicy(accessToken, scheme.property.id, { enabled: true, initialDelayDays: 0, minimumOutstandingAmount: 0 });
      await evaluate(accessToken, scheme.property.id);
      const queue = await listQueue(accessToken, scheme.property.id);
      const reminderId = queue.body.items[0].id as string;

      const submitRes = await submitForReview(accessToken, scheme.property.id, reminderId);
      expect(submitRes.status).toBe(409);
      expect(submitRes.body.error.message).toMatch(/Only a DRAFT reminder/);
    });

    it('two truly concurrent submission attempts on the same draft succeed exactly once', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createOverdueScheme(accessToken, organisationId);
      const draftRes = await draftReminderM166(accessToken, scheme.property.id, scheme.spaceId);

      const results = await Promise.allSettled([
        submitForReview(accessToken, scheme.property.id, draftRes.body.id),
        submitForReview(accessToken, scheme.property.id, draftRes.body.id),
      ]);
      const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 'rejected'));
      const successCount = statuses.filter((s) => s === 201).length;
      expect(successCount).toBe(1);

      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: draftRes.body.id } });
      expect(row.status).toBe('READY_FOR_REVIEW');
    });

    it('403s a caller without financials.manage from submitting a draft for review', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createOverdueScheme(accessToken, organisationId);
      const draftRes = await draftReminderM166(accessToken, scheme.property.id, scheme.spaceId);
      const residentToken = (await createPropertyRoleToken(accessToken, organisationId, scheme.property.id, 'RESIDENT', scheme.spaceId, 'resident2@example.com')).token;

      const submitRes = await submitForReview(residentToken, scheme.property.id, draftRes.body.id);
      expect(submitRes.status).toBe(403);
    });

    it('preserves the original DRAFT reminder history — submitting creates no new row, only transitions the existing one', async () => {
      const { accessToken, organisationId } = await registerAuOrg();
      const scheme = await createOverdueScheme(accessToken, organisationId);
      const draftRes = await draftReminderM166(accessToken, scheme.property.id, scheme.spaceId);
      const beforeCount = await testPrisma.paymentReminder.count({ where: { organisationId } });

      await submitForReview(accessToken, scheme.property.id, draftRes.body.id);

      const afterCount = await testPrisma.paymentReminder.count({ where: { organisationId } });
      expect(afterCount).toBe(beforeCount);
      const row = await testPrisma.paymentReminder.findUniqueOrThrow({ where: { id: draftRes.body.id } });
      expect(row.publicReference).toBe(draftRes.body.publicReference);
      expect(row.generatedByUserId).not.toBeNull();
    });
  });
});
