import { z } from 'zod';
import {
  closeAccountingPeriodSchema,
  createAccountingPeriodSchema,
  reopenAccountingPeriodSchema,
} from '../../modules/financials/accounting-periods.schemas.js';
import {
  generateOpeningJournalSchema,
  listJournalsQuerySchema,
  postManualJournalSchema,
  reverseJournalSchema,
  trialBalanceQuerySchema,
} from '../../modules/financials/ledger.schemas.js';
import { upsertPostingProfileRuleSchema } from '../../modules/financials/posting-profile.schemas.js';
import { commonErrors, jsonContent } from '../components/common.schemas.js';
import {
  accountingPeriodListSchema,
  accountingPeriodSchema,
  journalEntryListSchema,
  journalEntrySchema,
  postingProfileRuleListSchema,
  postingProfileRuleSchema,
  trialBalanceListSchema,
} from '../components/entities.schemas.js';
import { registry, SECURITY_CUSTOMER } from '../registry.js';
import { propertyIdPathParam } from './properties.paths.js';

const TAG = 'Financial Management — General Ledger';

const periodIdPathParam = registry.register(
  'AccountingPeriodIdPathParam',
  z.object({ propertyId: z.string(), periodId: z.string() }),
);
const journalIdPathParam = registry.register(
  'JournalEntryIdPathParam',
  z.object({ propertyId: z.string(), journalId: z.string() }),
);

// --- Accounting Periods ---

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/periods',
  operationId: 'listAccountingPeriods',
  tags: [TAG],
  summary: 'Lists this property’s accounting-period calendar.',
  description: 'Requires `financials.view`. Newest period first.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: {
    200: jsonContent(accountingPeriodListSchema, 'Periods.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/periods',
  operationId: 'createAccountingPeriod',
  tags: [TAG],
  summary: 'Opens a new accounting period.',
  description:
    'Requires `financials.approve`. Rejected (409) if it overlaps an existing period on this ' +
    'property — non-overlap is validated under the same row lock every ledger write uses, not a ' +
    'DB exclusion constraint.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: createAccountingPeriodSchema } } },
  },
  responses: {
    201: jsonContent(accountingPeriodSchema, 'Period opened.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/periods/{periodId}/close',
  operationId: 'closeAccountingPeriod',
  tags: [TAG],
  summary: 'Closes an accounting period — posting into it is then rejected.',
  description: 'Requires `financials.approve`. Idempotent for an already-closed period.',
  security: SECURITY_CUSTOMER,
  request: {
    params: periodIdPathParam,
    body: { content: { 'application/json': { schema: closeAccountingPeriodSchema } } },
  },
  responses: {
    200: jsonContent(accountingPeriodSchema, 'Closed.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/periods/{periodId}/reopen',
  operationId: 'reopenAccountingPeriod',
  tags: [TAG],
  summary: 'Reopens a closed accounting period.',
  description:
    'Requires `financials.approve`. A separate, equally-audited action from close — never an ' +
    'automatic undo; a reason is required. Rejected (409) if the period isn’t currently closed.',
  security: SECURITY_CUSTOMER,
  request: {
    params: periodIdPathParam,
    body: { content: { 'application/json': { schema: reopenAccountingPeriodSchema } } },
  },
  responses: {
    200: jsonContent(accountingPeriodSchema, 'Reopened.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

// --- Posting Profile ---

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/posting-profile',
  operationId: 'listPostingProfileRules',
  tags: [TAG],
  summary: 'Lists this property’s posting-profile role -> account mappings.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: {
    200: jsonContent(postingProfileRuleListSchema, 'Rules.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'put',
  path: '/properties/{propertyId}/financials/posting-profile',
  operationId: 'upsertPostingProfileRule',
  tags: [TAG],
  summary: 'Creates or replaces one (role, fund) -> account mapping.',
  description:
    'Requires `financials.approve`. The target account must belong to this property and be ' +
    'active (409 otherwise). Never guesses or falls back to a default account — every role the ' +
    'posting engine needs for a given action must be explicitly configured here first.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: upsertPostingProfileRuleSchema } } },
  },
  responses: {
    201: jsonContent(postingProfileRuleSchema, 'Rule saved.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

// --- Journals ---

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/journals',
  operationId: 'listJournals',
  tags: [TAG],
  summary: 'Lists posted journal entries for this property.',
  description:
    'Requires `financials.view`. Optional `sourceType`/`accountingPeriodId` filters. Newest ' +
    'effective date first.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: listJournalsQuerySchema },
  responses: {
    200: jsonContent(journalEntryListSchema, 'Journals.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/journals',
  operationId: 'postManualJournal',
  tags: [TAG],
  summary: 'Posts a manual journal entry — the generic correction/entry path.',
  description:
    'Requires `financials.approve`. Lines must balance (SUM(debit) = SUM(credit)) and, unless ' +
    'the journal is an inter-fund transfer, balance independently per fund too (422 otherwise). ' +
    'Every account/fund must belong to this property and every account must be active (404/409). ' +
    'Posting into a period that doesn’t exist or isn’t OPEN is rejected (409). `sourceId`, if ' +
    'omitted, is generated server-side; supply it to make a specific retry idempotent against the ' +
    'exact same request.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: postManualJournalSchema } } },
  },
  responses: {
    201: jsonContent(journalEntrySchema, 'Posted (or the pre-existing journal, if this exact source key was already posted).'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/journals/{journalId}',
  operationId: 'getJournal',
  tags: [TAG],
  summary: 'Returns one journal entry’s full detail, including every line.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: journalIdPathParam },
  responses: {
    200: jsonContent(journalEntrySchema, 'Journal detail.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/journals/{journalId}/reverse',
  operationId: 'reverseJournal',
  tags: [TAG],
  summary: 'Posts the exact opposite of a journal entry, linked to the original.',
  description:
    'Requires `financials.approve`. The original is never updated or deleted. Rejected (409) if ' +
    'already reversed once — post a fresh correcting journal for anything further. The reversal ' +
    'posts on `effectiveDate` (default today), which must itself fall in an OPEN period.',
  security: SECURITY_CUSTOMER,
  request: {
    params: journalIdPathParam,
    body: { content: { 'application/json': { schema: reverseJournalSchema } } },
  },
  responses: {
    201: jsonContent(journalEntrySchema, 'Reversal posted.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

// --- Trial balance ---

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/trial-balance',
  operationId: 'getTrialBalance',
  tags: [TAG],
  summary: 'As-of trial balance: SUM(debit)/SUM(credit) per account over every posted line.',
  description:
    'Requires `financials.view`. A read-only aggregation over immutable postings, never a stored ' +
    'running balance. Optional `asOfDate` (default today) and `financialFundId` (restricts to one ' +
    'fund\'s lines — useful where an unrestricted account like GST Payable carries balances from ' +
    'more than one fund). Each row\'s `presentedSide`/`presentedBalance` give the conventional ' +
    'Debit-or-Credit-column presentation; `totalDebit`/`totalCredit`/`netBalance` remain the raw ' +
    'figures.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: trialBalanceQuerySchema },
  responses: {
    200: jsonContent(trialBalanceListSchema, 'Trial balance rows.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

// --- Opening journal ---

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/opening-journal',
  operationId: 'generateOpeningJournal',
  tags: [TAG],
  summary: 'Generates the one-time opening journal from M16.1’s immutable opening snapshots.',
  description:
    'Requires `financials.approve` and financial management to already be ACTIVE. ' +
    '`lotFundSplits` must give an exact, explicit fund allocation for every lot with a nonzero ' +
    'opening position — never fabricated or defaulted (422 listing unresolved/mismatched lots ' +
    'otherwise). Idempotent: calling again after a successful generation returns the same journal, ' +
    'never a duplicate. Requires the posting profile (FUND_CASH, LOT_LEVY_RECEIVABLE, ' +
    'UNAPPLIED_CASH, OPENING_BALANCE_EQUITY) to already be configured (409 otherwise).',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: generateOpeningJournalSchema } } },
  },
  responses: {
    201: jsonContent(journalEntrySchema, 'Opening journal posted (or the existing one, if already generated).'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});
