/**
 * Minimal staging demo-data seed — Harbour View Residences.
 *
 * Reuses the already-registered manager account (hello@amaltventures.com)
 * and its existing organisation; never creates/resets that account, never
 * touches its password. Drives the real HTTP API in-process (createApp() +
 * supertest, with a JWT minted directly via signAccessToken — no login,
 * no password needed) rather than hand-building Prisma rows, so every
 * domain invariant (status transitions, double-entry posting, approval
 * workflow, activity/notification side effects) is enforced by the same
 * code real traffic goes through. A handful of steps that have no HTTP
 * endpoint (space status, contact invites, a draft communication) use
 * direct Prisma calls instead — each one is called out below with why.
 *
 * Idempotent: every step checks for an existing row by a natural key
 * before creating one, so rerunning this script updates nothing and
 * creates nothing new once the dataset exists.
 *
 * Never sends real email: the one Communication row this script creates
 * is DRAFT (never SENT/SCHEDULED, and has no CommunicationRecipient/
 * CommunicationDelivery rows — it was never actually sent, so nothing
 * claims it was), ContactInvite rows are created directly without calling
 * InvitesService (which is what actually emails), and the one
 * PaymentReminder this script creates is left at READY_FOR_REVIEW, never
 * APPROVED — so the M16.8 dispatch scheduler (which only ever sends
 * APPROVED reminders for a property with ReminderPolicy.deliveryEnabled)
 * has nothing to pick up. Real delivery for all of these is a deliberate
 * manual step through the app afterward.
 *
 * Refuses to run unless ALLOW_DEMO_SEED_EXECUTION=true is set explicitly
 * and DATABASE_URL's host doesn't look like a production database — see
 * assertSafeToRun() below.
 *
 * Run with (after `pnpm run build`): ALLOW_DEMO_SEED_EXECUTION=true pnpm tsx prisma/seed-staging-demo.ts
 */
// Imports from ../dist (compiled output), not ../src: the deploy artifact
// ships prisma/ as raw TypeScript alongside dist/ and node_modules/, but
// never src/ itself (see .github/workflows/deploy-staging.yml) — this
// script must run against what's actually deployed, which also makes a
// local run exercise the same compiled code staging does. Run `pnpm run
// build` first if dist/ doesn't exist yet.
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../dist/app.js';
import {
  signAccessToken,
  generateInviteToken,
  hashInviteToken,
  inviteTokenExpiresAt,
} from '../dist/lib/tokens.js';
import { buildPublicReference } from '../dist/lib/public-reference.js';

const prisma = new PrismaClient();
const app = createApp();

const MANAGER_EMAIL = 'hello@amaltventures.com';
const OWNER_101_EMAIL = 'hamza.tariq.it@gmail.com';
const OWNER_102_EMAIL = 'mahwishhamza97@gmail.com';
const PROPERTY_NAME = 'Harbour View Residences';
const PROPERTY_CODE = 'HARBOUR-VIEW';

/** Throws with the full response body on any non-2xx — every call site
 * below relies on this instead of asserting one exact status code, since
 * create vs. action endpoints in this codebase return 200/201/202
 * inconsistently by convention (creates are 201, actions are 200/201/202
 * depending on the route — see each route's own controller). */
async function api(
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  auth: { Authorization: string },
  body?: unknown,
) {
  const req = request(app)[method](path).set(auth);
  const res = body === undefined ? await req : await req.send(body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${method.toUpperCase()} ${path} -> ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res;
}

/**
 * Refuses to run unless both conditions hold: an explicit, single-purpose
 * opt-in env var is set for this exact invocation (never left on by
 * accident in a shared .env, since nothing else in this repo reads it),
 * and DATABASE_URL's host doesn't look like a production database by
 * name. Staging itself runs NODE_ENV=production (required for the env
 * schema's cookie/JWT checks — see env.ts), so NODE_ENV can't be the
 * gate here; this is a second, independent check instead of relying on
 * that one env var meaning what its name implies.
 */
function assertSafeToRun() {
  if (process.env.ALLOW_DEMO_SEED_EXECUTION !== 'true') {
    throw new Error(
      'Refusing to run: set ALLOW_DEMO_SEED_EXECUTION=true explicitly to confirm this invocation ' +
        'is intentional (this is never read by any other script or set by any deploy workflow).',
    );
  }
  const databaseUrl = process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error('DATABASE_URL is missing or not a valid connection URL — refusing to run.');
  }
  if (/prod/i.test(host)) {
    throw new Error(`Refusing to run: DATABASE_URL host "${host}" looks like a production database.`);
  }
  console.log(`Safety check passed — target database host: ${host}`);
}

async function main() {
  assertSafeToRun();

  console.log(`Resolving existing manager account ${MANAGER_EMAIL}...`);
  const manager = await prisma.user.findUnique({
    where: { email: MANAGER_EMAIL },
    include: { organisationMemberships: { where: { status: 'ACTIVE' } } },
  });
  if (!manager) {
    throw new Error(
      `Manager account ${MANAGER_EMAIL} does not exist. This script never creates it — register it first.`,
    );
  }
  const membership = manager.organisationMemberships[0];
  if (!membership) {
    throw new Error(`Manager account ${MANAGER_EMAIL} has no active organisation membership.`);
  }
  const organisationId = membership.organisationId;

  const accessToken = signAccessToken({
    sub: manager.id,
    sessionType: 'CUSTOMER',
    organisationId,
    orgRole: membership.role,
  });
  const auth = { Authorization: `Bearer ${accessToken}` };

  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: organisationId } });
  console.log(`Using organisation "${org.name}" (${organisationId}), manager role ${membership.role}.`);

  // AU jurisdiction/currency and AI tools both required by the demo spec —
  // a reversible config flag, not seed *data*, but doing it here keeps the
  // whole demo buildable from one command. Safe to rerun (idempotent by
  // construction: an update, not a create).
  await prisma.organisation.update({
    where: { id: organisationId },
    data: { countryCode: 'AU', currencyCode: 'AUD', aiEnabled: true },
  });

  // --- 1. Property + strata lots -------------------------------------
  let property = await prisma.property.findFirst({ where: { organisationId, name: PROPERTY_NAME } });
  let lot101Id: string;
  let lot102Id: string;

  if (!property) {
    console.log('Creating property Harbour View Residences...');
    const createRes = await api('post', '/api/v1/properties', auth, {
      name: PROPERTY_NAME,
      code: PROPERTY_CODE,
      addressLine1: '1 Harbour View Drive',
      city: 'Sydney',
      state: 'NSW',
      country: 'Australia',
      propertyType: 'RESIDENTIAL',
    });
    property = await prisma.property.findUniqueOrThrow({ where: { id: createRes.body.id } });

    await api('post', `/api/v1/properties/${property.id}/strata/enable`, auth, {
      strataPlanNumber: 'SP99101',
    });

    const lotsRes = await api('put', `/api/v1/properties/${property.id}/strata/lots`, auth, {
      lots: [
        { kind: 'new', name: 'Lot 101', code: '101', unitsOfEntitlement: 50 },
        { kind: 'new', name: 'Lot 102', code: '102', unitsOfEntitlement: 50 },
      ],
    });
    const lots = lotsRes.body.lots as Array<{ spaceId: string; name: string }>;
    lot101Id = lots.find((l) => l.name === 'Lot 101')!.spaceId;
    lot102Id = lots.find((l) => l.name === 'Lot 102')!.spaceId;

    await api('post', `/api/v1/properties/${property.id}/strata/complete`, auth);
  } else {
    console.log('Property already exists, reusing.');
    const spaces = await prisma.space.findMany({
      where: { propertyId: property.id },
      select: { id: true, name: true },
    });
    lot101Id = spaces.find((s) => s.name === 'Lot 101')!.id;
    lot102Id = spaces.find((s) => s.name === 'Lot 102')!.id;
  }

  // Space status has no HTTP concept of "idempotent create" to check —
  // PATCHing to the same value every run is itself idempotent.
  await api('patch', `/api/v1/spaces/${lot101Id}`, auth, { status: 'OCCUPIED' });
  await api('patch', `/api/v1/spaces/${lot102Id}`, auth, { status: 'OCCUPIED' });

  // --- 2. Owners: contact + membership + (unsent) invite --------------
  async function ensureOwner(email: string, firstName: string, lastName: string, spaceId: string) {
    let contact = await prisma.propertyContact.findUnique({
      where: { organisationId_email: { organisationId, email } },
    });
    if (!contact) {
      console.log(`Adding owner ${email} to Lot via property membership...`);
      await api('post', `/api/v1/properties/${property!.id}/memberships`, auth, {
        email,
        firstName,
        lastName,
        role: 'OWNER',
        spaceId,
      });
      contact = await prisma.propertyContact.findUniqueOrThrow({
        where: { organisationId_email: { organisationId, email } },
      });
    } else {
      const existingMembership = await prisma.propertyMembership.findFirst({
        where: { contactId: contact.id, propertyId: property!.id, spaceId, role: 'OWNER' },
      });
      if (!existingMembership) {
        await prisma.propertyMembership.create({
          data: {
            organisationId,
            propertyId: property!.id,
            spaceId,
            contactId: contact.id,
            role: 'OWNER',
            status: 'ACTIVE',
            startDate: new Date(),
          },
        });
      }
      console.log(`Owner ${email} already present, reusing.`);
    }

    // Prepared, never sent: creating the ContactInvite row directly (the
    // same fields InvitesService.createInvite writes) never triggers an
    // email — only calling that service's sendInviteEmail step does, and
    // this script never calls it. Real delivery is a manual "Invite" /
    // "Resend invite" click in the app afterward.
    if (!contact.userId) {
      const existingInvite = await prisma.contactInvite.findFirst({
        where: { propertyContactId: contact.id, status: 'PENDING' },
      });
      if (!existingInvite) {
        await prisma.contactInvite.create({
          data: {
            organisationId,
            propertyContactId: contact.id,
            invitedByUserId: manager!.id,
            tokenHash: hashInviteToken(generateInviteToken()),
            expiresAt: inviteTokenExpiresAt(),
            status: 'PENDING',
          },
        });
        console.log(`  Prepared a pending invite for ${email} (not sent).`);
      }
    }
    return contact;
  }

  await ensureOwner(OWNER_101_EMAIL, 'Hamza', 'Tariq', lot101Id);
  await ensureOwner(OWNER_102_EMAIL, 'Mahwish', 'Hamza', lot102Id);

  // --- 3. Contractor ----------------------------------------------------
  let contractor = await prisma.contractor.findFirst({
    where: { organisationId, email: 'jobs@sydneyflowplumbing.com.au' },
  });
  if (!contractor) {
    console.log('Creating demo plumbing contractor...');
    const res = await api('post', '/api/v1/contractors', auth, {
      name: 'Dave Whitmore',
      companyName: 'Sydney Flow Plumbing Pty Ltd',
      email: 'jobs@sydneyflowplumbing.com.au',
      phone: '+61 2 9000 1234',
      tradeTypes: ['Plumbing'],
      tradeCategories: ['PLUMBING'],
      businessNumber: '51 824 753 556',
      notes: 'Demo contractor for the Harbour View Residences client walkthrough.',
    });
    contractor = await prisma.contractor.findUniqueOrThrow({ where: { id: res.body.id } });
  } else {
    console.log('Contractor already exists, reusing.');
  }

  // --- 4. Maintenance: open request (Lot 101, water leak) + full
  //        contractor/quote/approval/work-order chain ------------------
  let openMr = await prisma.maintenanceRequest.findFirst({
    where: { organisationId, propertyId: property.id, title: 'Water leak under kitchen sink' },
  });
  if (!openMr) {
    console.log('Creating open maintenance request (Lot 101 water leak) and its work order...');
    const mrRes = await api('post', '/api/v1/maintenance-requests', auth, {
      propertyId: property.id,
      spaceId: lot101Id,
      title: 'Water leak under kitchen sink',
      description:
        'Owner reports a steady water leak from the pipe under the kitchen sink, pooling on the cabinet floor. Needs urgent attention to avoid water damage.',
      category: 'PLUMBING',
      priority: 'URGENT',
    });
    openMr = await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: mrRes.body.id } });

    await api('patch', `/api/v1/maintenance-requests/${openMr.id}/status`, auth, { status: 'UNDER_REVIEW' });
    await api('patch', `/api/v1/maintenance-requests/${openMr.id}/status`, auth, { status: 'IN_PROGRESS' });

    const woRes = await api('post', '/api/v1/work-orders', auth, {
      maintenanceRequestId: openMr.id,
      title: 'Repair kitchen sink water leak — Lot 101',
      description: 'Isolate supply, replace failed connector/trap, pressure test, confirm no further leak.',
      priority: 'URGENT',
    });
    const workOrderId = woRes.body.id as string;

    const quoteRes = await api('post', '/api/v1/quotes', auth, {
      workOrderId,
      contractorId: contractor.id,
      amount: 420,
      description:
        'Isolate and replace failed under-sink connector/trap, pressure test, callout included.',
    });
    const quoteId = quoteRes.body.id as string;

    await api('patch', `/api/v1/quotes/${quoteId}/submit`, auth, {});

    // Never override the organisation's own Approval & Acceptance policy —
    // requiredWorkflowMode (resolved at quote-creation time from whatever
    // policy the org actually has, null if none) is the floor a manager
    // must confirm or exceed (see QuotesService.setWorkflowMode's guard).
    const requiredWorkflowMode = quoteRes.body.requiredWorkflowMode as string | null;
    const workflowMode = requiredWorkflowMode ?? 'NONE';

    await api('patch', `/api/v1/quotes/${quoteId}/workflow-mode`, auth, { workflowMode });

    await api('patch', `/api/v1/work-orders/${workOrderId}/contractor`, auth, {
      contractorId: contractor.id,
    });

    if (workflowMode === 'NONE' || workflowMode === 'APPROVAL_ONLY') {
      await api('post', `/api/v1/quotes/${quoteId}/approve`, auth, {});
      await api('patch', `/api/v1/work-orders/${workOrderId}/status`, auth, { status: 'READY' });
      await api('patch', `/api/v1/work-orders/${workOrderId}/status`, auth, {
        status: 'SCHEDULED',
        scheduledAt: '2026-10-28T09:00:00.000Z',
      });
    } else {
      // This organisation's policy requires a contractor signature
      // (SIGNATURE_ONLY / APPROVAL_THEN_SIGNATURE) for a quote this size —
      // genuinely starting that workflow means a real WaslSign agreement,
      // out of scope for seed data. Leave the quote at SUBMITTED and the
      // work order in DRAFT rather than fabricating an approval the
      // policy doesn't actually allow.
      console.log(
        `  Org policy requires "${workflowMode}" for this quote amount — leaving it at SUBMITTED ` +
          'rather than fabricating approval/signature. Approve it through the app to continue.',
      );
    }
  } else {
    console.log('Open maintenance request already exists, reusing.');
  }

  // --- 5. Maintenance: completed historical request --------------------
  let closedMr = await prisma.maintenanceRequest.findFirst({
    where: { organisationId, propertyId: property.id, title: 'Annual fire safety equipment inspection' },
  });
  if (!closedMr) {
    console.log('Creating completed historical maintenance request...');
    const res = await api('post', '/api/v1/maintenance-requests', auth, {
      propertyId: property.id,
      title: 'Annual fire safety equipment inspection',
      description:
        'Scheduled annual inspection and certification of fire extinguishers, hose reels and exit signage across common areas.',
      category: 'COMMON_AREA',
      priority: 'MEDIUM',
    });
    closedMr = await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: res.body.id } });

    await api('patch', `/api/v1/maintenance-requests/${closedMr.id}/status`, auth, { status: 'UNDER_REVIEW' });
    await api('patch', `/api/v1/maintenance-requests/${closedMr.id}/status`, auth, { status: 'IN_PROGRESS' });
    await api('patch', `/api/v1/maintenance-requests/${closedMr.id}/status`, auth, { status: 'RESOLVED' });
    await api('patch', `/api/v1/maintenance-requests/${closedMr.id}/status`, auth, { status: 'CLOSED' });

    // Backdated for realism — purely informational timestamps, not a
    // source of any downstream business invariant.
    await prisma.maintenanceRequest.update({
      where: { id: closedMr.id },
      data: {
        reportedAt: new Date('2026-08-12T09:00:00.000Z'),
        resolvedAt: new Date('2026-08-14T15:30:00.000Z'),
        closedAt: new Date('2026-08-15T10:00:00.000Z'),
      },
    });
  } else {
    console.log('Closed maintenance request already exists, reusing.');
  }

  // --- 6. Financial configuration: funds, accounts, posting profile,
  //        accounting period -------------------------------------------
  const financialConfig = await prisma.financialConfiguration.findUnique({
    where: { propertyId: property.id },
  });
  let adminFundId: string;
  let receivableAccountId: string;
  let incomeAccountId: string;
  let cashAccountId: string;
  let unappliedCashAccountId: string;
  let expenseAccountId: string;

  if (!financialConfig) {
    console.log('Starting financial configuration...');
    await api('post', `/api/v1/properties/${property.id}/financials`, auth, {
      financialYearStartDate: '2026-07-01',
      financialYearEndDate: '2027-06-30',
      cutoverDate: '2026-07-01',
    });
    await api('post', `/api/v1/properties/${property.id}/financials/funds`, auth, {
      fundType: 'ADMINISTRATION',
    });
    await api('post', `/api/v1/properties/${property.id}/financials/funds`, auth, {
      fundType: 'CAPITAL_WORKS',
    });

    const activation = await api('post', `/api/v1/properties/${property.id}/financials/activate`, auth);
    const funds = activation.body.funds as Array<{ id: string; fundType: string }>;
    adminFundId = funds.find((f) => f.fundType === 'ADMINISTRATION')!.id;

    const receivable = await api('post', `/api/v1/properties/${property.id}/financials/accounts`, auth, {
      code: '310000',
      name: 'Lot Levy Receivable',
      classification: 'ASSET',
    });
    const income = await api('post', `/api/v1/properties/${property.id}/financials/accounts`, auth, {
      code: '100000',
      name: 'Levy Contributions',
      classification: 'INCOME',
    });
    const cash = await api('post', `/api/v1/properties/${property.id}/financials/accounts`, auth, {
      code: '110000',
      name: 'Admin Fund Bank Account',
      classification: 'ASSET',
    });
    const unapplied = await api('post', `/api/v1/properties/${property.id}/financials/accounts`, auth, {
      code: '210000',
      name: 'Unapplied Cash',
      classification: 'LIABILITY',
    });
    const expense = await api('post', `/api/v1/properties/${property.id}/financials/accounts`, auth, {
      code: '520000',
      name: 'Repairs & Maintenance',
      classification: 'EXPENSE',
    });
    receivableAccountId = receivable.body.id;
    incomeAccountId = income.body.id;
    cashAccountId = cash.body.id;
    unappliedCashAccountId = unapplied.body.id;
    expenseAccountId = expense.body.id;

    await api('put', `/api/v1/properties/${property.id}/financials/posting-profile`, auth, {
      role: 'LOT_LEVY_RECEIVABLE',
      financialFundId: adminFundId,
      accountId: receivableAccountId,
    });
    await api('put', `/api/v1/properties/${property.id}/financials/posting-profile`, auth, {
      role: 'LEVY_INCOME',
      financialFundId: adminFundId,
      accountId: incomeAccountId,
    });
    await api('put', `/api/v1/properties/${property.id}/financials/posting-profile`, auth, {
      role: 'FUND_CASH',
      financialFundId: adminFundId,
      accountId: cashAccountId,
    });
    await api('put', `/api/v1/properties/${property.id}/financials/posting-profile`, auth, {
      role: 'UNAPPLIED_CASH',
      accountId: unappliedCashAccountId,
    });

    await api('post', `/api/v1/properties/${property.id}/financials/periods`, auth, {
      startDate: '2026-07-01',
      endDate: '2027-06-30',
    });
  } else {
    console.log('Financial configuration already exists, reusing.');
    const funds = await prisma.financialFund.findMany({ where: { propertyId: property.id } });
    adminFundId = funds.find((f) => f.fundType === 'ADMINISTRATION')!.id;
    const accounts = await prisma.accountingAccount.findMany({ where: { propertyId: property.id } });
    receivableAccountId = accounts.find((a) => a.code === '310000')!.id;
    incomeAccountId = accounts.find((a) => a.code === '100000')!.id;
    cashAccountId = accounts.find((a) => a.code === '110000')!.id;
    unappliedCashAccountId = accounts.find((a) => a.code === '210000')!.id;
    expenseAccountId = accounts.find((a) => a.code === '520000')!.id;
  }

  // --- 7. Levy schedule: quarterly, AUD 1,200 per lot ------------------
  const LEVY_NAME = 'Q1 FY27 Admin Levy';
  let schedule = await prisma.levySchedule.findFirst({ where: { propertyId: property.id, name: LEVY_NAME } });
  if (!schedule) {
    console.log('Creating and issuing the quarterly levy schedule...');
    const budgetRes = await api('post', `/api/v1/properties/${property.id}/financials/budgets`, auth, {
      financialYearStartDate: '2026-07-01',
      financialYearEndDate: '2027-06-30',
    });
    const budgetId = budgetRes.body.id as string;
    await api('post', `/api/v1/properties/${property.id}/financials/budgets/${budgetId}/lines`, auth, {
      financialFundId: adminFundId,
      lineType: 'REVENUE',
      category: 'Levy Contributions',
      plannedAmount: 2400,
      accountId: incomeAccountId,
    });
    await api('post', `/api/v1/properties/${property.id}/financials/budgets/${budgetId}/approve`, auth, {});
    await api('post', `/api/v1/properties/${property.id}/financials/budgets/${budgetId}/activate`, auth, {});

    // Equal 50/50 units of entitlement across the two lots means this
    // combined installment amount (2400) splits to exactly 1200 each.
    const scheduleRes = await api(
      'post',
      `/api/v1/properties/${property.id}/financials/levy-schedules/regular`,
      auth,
      {
        financialFundId: adminFundId,
        financialBudgetId: budgetId,
        name: LEVY_NAME,
        installments: [{ dueDate: '2026-10-01', amount: 2400 }],
      },
    );
    const scheduleId = scheduleRes.body.id as string;
    await api('post', `/api/v1/properties/${property.id}/financials/levy-schedules/${scheduleId}/approve`, auth, {});
    await api('post', `/api/v1/properties/${property.id}/financials/levy-schedules/${scheduleId}/issue`, auth, {});
    schedule = await prisma.levySchedule.findUniqueOrThrow({ where: { id: scheduleId } });
  } else {
    console.log('Levy schedule already exists, reusing.');
  }

  const charge101 = await prisma.lotLevyCharge.findFirst({
    where: { spaceId: lot101Id, levyScheduleId: schedule.id },
  });
  const charge102 = await prisma.lotLevyCharge.findFirst({
    where: { spaceId: lot102Id, levyScheduleId: schedule.id },
  });
  if (!charge101 || !charge102) {
    throw new Error('Expected a LotLevyCharge for both lots after issuing the levy schedule — got none.');
  }
  console.log(`  Lot 101 charge: ${charge101.amount} ${org.currencyCode}; Lot 102 charge: ${charge102.amount} ${org.currencyCode}`);

  // --- 8. Receipts: Lot 101 paid in full, Lot 102 partially paid -------
  const receipt101 = await prisma.receipt.findFirst({
    where: { spaceId: lot101Id, paymentReference: 'DEMO-LOT101-Q1' },
  });
  if (!receipt101) {
    console.log('Recording Lot 101 payment in full (AUD 1,200)...');
    await api('post', `/api/v1/properties/${property.id}/financials/receipts`, auth, {
      spaceId: lot101Id,
      financialFundId: adminFundId,
      amount: 1200,
      paymentMethod: 'BANK_TRANSFER',
      paymentReference: 'DEMO-LOT101-Q1',
      description: 'Lot 101 Q1 levy payment in full',
      receiptDate: '2026-10-05',
      autoAllocate: true,
    });
  }

  const receipt102 = await prisma.receipt.findFirst({
    where: { spaceId: lot102Id, paymentReference: 'DEMO-LOT102-Q1' },
  });
  if (!receipt102) {
    console.log('Recording Lot 102 partial payment (AUD 700 of AUD 1,200)...');
    await api('post', `/api/v1/properties/${property.id}/financials/receipts`, auth, {
      spaceId: lot102Id,
      financialFundId: adminFundId,
      amount: 700,
      paymentMethod: 'BANK_TRANSFER',
      paymentReference: 'DEMO-LOT102-Q1',
      description: 'Lot 102 Q1 levy partial payment',
      receiptDate: '2026-10-10',
      autoAllocate: true,
    });
  }

  // --- 9. Maintenance expense (AUD 350) posted to the ledger -----------
  const expenseJournal = await prisma.journalEntry.findFirst({
    where: { propertyId: property.id, sourceType: 'MANUAL', sourceId: 'demo-maintenance-expense-350' },
  });
  if (!expenseJournal) {
    console.log('Posting the AUD 350 maintenance expense journal entry...');
    await api('post', `/api/v1/properties/${property.id}/financials/journals`, auth, {
      effectiveDate: '2026-08-15',
      narration: 'Fire safety equipment inspection — Repairs & Maintenance (Admin Fund)',
      sourceId: 'demo-maintenance-expense-350',
      lines: [
        { accountId: expenseAccountId, financialFundId: adminFundId, debit: 350 },
        { accountId: cashAccountId, financialFundId: adminFundId, credit: 350 },
      ],
    });
  }

  // --- 10. Levy reminder for Lot 102's AUD 500 outstanding -------------
  // Left at READY_FOR_REVIEW, never APPROVED — the M16.8 dispatch
  // scheduler only ever sends APPROVED reminders for a property with
  // ReminderPolicy.deliveryEnabled (default false, never touched here),
  // so this can never trigger a real send; approving it is a deliberate
  // manual step in the app.
  const existingReminder = await prisma.paymentReminder.findFirst({
    where: { organisationId, propertyId: property.id, spaceId: lot102Id },
  });
  if (!existingReminder) {
    console.log('Drafting a levy reminder for Lot 102...');
    const draftRes = await api(
      'post',
      `/api/v1/properties/${property.id}/financials/arrears/lots/${lot102Id}/reminders`,
      auth,
      {},
    );
    const reminderId = draftRes.body.id as string;
    await api(
      'post',
      `/api/v1/properties/${property.id}/financials/arrears/reminders/queue/${reminderId}/submit-for-review`,
      auth,
      {},
    );
    console.log('  Reminder is READY_FOR_REVIEW — approve it manually in-app to test real delivery.');
  } else {
    console.log('Levy reminder for Lot 102 already exists, reusing.');
  }

  // --- 11. One draft communication (owner onboarding note) -------------
  // DRAFT, never SENT/SCHEDULED, and no CommunicationRecipient/
  // CommunicationDelivery rows — this communication was never actually
  // sent, so nothing claims it was. A manager can review and send it for
  // real through the app afterward, which both exercises the real send
  // path and demonstrates the feature honestly.
  const COMM_TITLE = 'Welcome to Harbour View Residences';
  const existingComm = await prisma.communication.findFirst({ where: { organisationId, title: COMM_TITLE } });
  if (!existingComm) {
    console.log('Drafting a welcome communication (not sent)...');
    await prisma.communication.create({
      data: {
        organisationId,
        publicReference: buildPublicReference('COM'),
        title: COMM_TITLE,
        body: 'Welcome! This is your property communications channel — maintenance updates, approvals and levy reminders will appear here.',
        status: 'DRAFT',
        channels: ['EMAIL'],
        audienceCriteria: { scope: 'PROPERTY', propertyIds: [property.id], roles: ['OWNER'] },
        createdByUserId: manager.id,
      },
    });
  } else {
    console.log('Welcome communication already exists, reusing.');
  }

  console.log('\nDone.');
  console.log(`Property: ${PROPERTY_NAME} (${property.id})`);
  console.log(`Manager login: ${MANAGER_EMAIL} (existing credentials, unchanged)`);
  console.log(`Lot 101 owner: ${OWNER_101_EMAIL} — invite prepared, not sent`);
  console.log(`Lot 102 owner: ${OWNER_102_EMAIL} — invite prepared, not sent`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
