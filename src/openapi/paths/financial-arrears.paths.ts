import { z } from 'zod';
import {
  arrearsRegisterQuerySchema,
  arrearsSummaryQuerySchema,
  createCollectionCaseSchema,
  createCollectionNoteSchema,
  draftReminderSchema,
  lotArrearsDetailQuerySchema,
  updateCollectionCaseSchema,
} from '../../modules/financials/arrears.schemas.js';
import { commonErrors, jsonContent } from '../components/common.schemas.js';
import {
  arrearsRegisterSchema,
  arrearsSummarySchema,
  collectionCaseSchema,
  collectionNoteSchema,
  lotArrearsDetailSchema,
  paymentReminderSchema,
} from '../components/entities.schemas.js';
import { propertyIdPathParam } from './properties.paths.js';
import { registry, SECURITY_CUSTOMER } from '../registry.js';

const TAG = 'Financial Management — Arrears';

const lotArrearsPathParams = registry.register(
  'LotArrearsPathParams',
  z.object({ propertyId: z.string(), spaceId: z.string() }),
);
const collectionCasePathParams = registry.register(
  'CollectionCasePathParams',
  z.object({ propertyId: z.string(), caseId: z.string() }),
);
const reminderPathParams = registry.register(
  'ReminderPathParams',
  z.object({ propertyId: z.string(), reminderId: z.string() }),
);

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/arrears/summary',
  operationId: 'getArrearsSummary',
  tags: [TAG],
  summary: 'Property-wide arrears totals — overdue, current outstanding, unapplied credits, ageing buckets, per-fund breakdown.',
  description:
    'Requires `financials.view`. Every figure is computed live from LotLevyCharge/LevyAdjustment/' +
    'PaymentAllocation/LevyInstallment/Receipt (ADR-027) — nothing here is a persisted financial ' +
    'balance. `asOfDate` defaults to today; a past date reconstructs the position as it genuinely ' +
    'stood then, never today\'s allocations applied retroactively. Unapplied credits are reported ' +
    'separately and never netted into the overdue/outstanding totals.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: arrearsSummaryQuerySchema },
  responses: {
    200: jsonContent(arrearsSummarySchema, 'Property-wide arrears summary.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/arrears/register',
  operationId: 'getArrearsRegister',
  tags: [TAG],
  summary: 'Every lot with its arrears position and current collection status, sorted by overdue amount.',
  description:
    'Requires `financials.view`. `ownerName` is populated only when the caller independently ' +
    'holds `people.view`. Filterable by fund, ageing bucket, and collection status.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: arrearsRegisterQuerySchema },
  responses: {
    200: jsonContent(arrearsRegisterSchema, 'Arrears register.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/arrears/lots/{spaceId}',
  operationId: 'getLotArrearsDetail',
  tags: [TAG],
  summary: "A single lot's full arrears position — overdue/current charges, unapplied credits, opening balance, receipts, and collection history.",
  description:
    'Requires `financials.view`. The opening balance (if any) is shown separately with ' +
    '`ageingBucket: "UNKNOWN"` — M16.1 opening positions carry no original due date and are never ' +
    'fabricated into an aged position (ADR-027).',
  security: SECURITY_CUSTOMER,
  request: { params: lotArrearsPathParams, query: lotArrearsDetailQuerySchema },
  responses: {
    200: jsonContent(lotArrearsDetailSchema, 'Lot arrears detail.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/lots/{spaceId}/collection-cases',
  operationId: 'createCollectionCase',
  tags: [TAG],
  summary: 'Opens a new collection case for a lot.',
  description:
    'Requires `financials.manage` — a reversible workflow record, never a ledger posting, so this ' +
    'is deliberately not gated on `financials.approve` (reserved for immutable-ledger actions). A ' +
    'lot may have multiple cases over time (reopenable episodes), never a single mutable singleton.',
  security: SECURITY_CUSTOMER,
  request: { params: lotArrearsPathParams, body: { content: { 'application/json': { schema: createCollectionCaseSchema } } } },
  responses: {
    201: jsonContent(collectionCaseSchema, 'Opened collection case.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/arrears/collection-cases/{caseId}',
  operationId: 'getCollectionCase',
  tags: [TAG],
  summary: 'A single collection case with its notes and reminders.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: collectionCasePathParams },
  responses: {
    200: jsonContent(collectionCaseSchema, 'Collection case.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/properties/{propertyId}/financials/arrears/collection-cases/{caseId}',
  operationId: 'updateCollectionCase',
  tags: [TAG],
  summary: 'Updates a collection case\'s status, assignee, follow-up date, or closes it.',
  description:
    'Requires `financials.manage`. 409 once the case is `CLOSED` — open a new case for any further ' +
    'follow-up rather than reopening an old one, preserving its own closed history intact.',
  security: SECURITY_CUSTOMER,
  request: { params: collectionCasePathParams, body: { content: { 'application/json': { schema: updateCollectionCaseSchema } } } },
  responses: {
    200: jsonContent(collectionCaseSchema, 'Updated collection case.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/collection-cases/{caseId}/notes',
  operationId: 'addCollectionNote',
  tags: [TAG],
  summary: 'Adds a follow-up note (and optional contact-attempt record) to a collection case.',
  description: 'Requires `financials.manage`. Notes are immutable once created — no edit/delete route.',
  security: SECURITY_CUSTOMER,
  request: { params: collectionCasePathParams, body: { content: { 'application/json': { schema: createCollectionNoteSchema } } } },
  responses: {
    201: jsonContent(collectionNoteSchema, 'Added note.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/lots/{spaceId}/reminders',
  operationId: 'draftReminder',
  tags: [TAG],
  summary: "Drafts a payment reminder from a lot's current (or as-of-date) overdue charges.",
  description:
    'Requires `financials.manage`. Never sends anything — the reminder is created in `DRAFT` ' +
    'status only; `content` is a point-in-time snapshot for preview/print, never read back as ' +
    'current arrears truth. `SENT`/`FAILED` statuses are reserved for a future, explicitly-' +
    'authorised dispatch milestone and are never set by this endpoint (ADR-027).',
  security: SECURITY_CUSTOMER,
  request: { params: lotArrearsPathParams, body: { content: { 'application/json': { schema: draftReminderSchema } } } },
  responses: {
    201: jsonContent(paymentReminderSchema, 'Drafted reminder.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/arrears/reminders/{reminderId}',
  operationId: 'getReminder',
  tags: [TAG],
  summary: 'A single drafted reminder.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: reminderPathParams },
  responses: {
    200: jsonContent(paymentReminderSchema, 'Reminder.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/reminders/{reminderId}/cancel',
  operationId: 'cancelReminder',
  tags: [TAG],
  summary: 'Cancels a draft reminder.',
  description: 'Requires `financials.manage`. 409 if the reminder is not currently `DRAFT`.',
  security: SECURITY_CUSTOMER,
  request: { params: reminderPathParams },
  responses: {
    200: jsonContent(paymentReminderSchema, 'Cancelled reminder.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});
