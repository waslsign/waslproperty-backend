import { z } from 'zod';
import {
  approveLevyScheduleSchema,
  cancelLevyScheduleSchema,
  createLevyAdjustmentSchema,
  createRegularLevyScheduleSchema,
  createSpecialLevyScheduleSchema,
  issueLevyScheduleSchema,
  listLotLevyChargesQuerySchema,
  reverseLevyScheduleSchema,
} from '../../modules/financials/levies.schemas.js';
import { commonErrors, jsonContent } from '../components/common.schemas.js';
import {
  levyAdjustmentSchema,
  levyScheduleListSchema,
  levyScheduleSchema,
  lotAllocationPreviewListSchema,
  lotLevyChargeListSchema,
} from '../components/entities.schemas.js';
import { registry, SECURITY_CUSTOMER } from '../registry.js';
import { propertyIdPathParam } from './properties.paths.js';

const TAG = 'Financial Management — Levies';

const scheduleIdPathParam = registry.register(
  'LevyScheduleIdPathParam',
  z.object({ propertyId: z.string(), scheduleId: z.string() }),
);
const chargeIdPathParam = registry.register(
  'LotLevyChargeIdPathParam',
  z.object({ propertyId: z.string(), chargeId: z.string() }),
);

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/levy-schedules',
  operationId: 'listLevySchedules',
  tags: [TAG],
  summary: 'Lists every levy schedule for this property.',
  description: 'Requires `financials.view`. Newest first.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: {
    200: jsonContent(levyScheduleListSchema, 'Schedules.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/levy-schedules/regular',
  operationId: 'createRegularLevySchedule',
  tags: [TAG],
  summary: 'Drafts a regular levy schedule, with its total derived from the linked budget.',
  description:
    'Requires `financials.manage`. The total is never caller-supplied — it is the SUM of the ' +
    'linked budget\'s REVENUE lines whose account matches the LEVY_INCOME posting-profile role for ' +
    'this fund (409 if the posting profile isn\'t configured, 422 if no such revenue line exists — ' +
    'never assumed from unrelated income). `installments` must sum exactly to that derived total ' +
    '(422 otherwise). The budget must be this financial year\'s ACTIVE budget (409 if only ' +
    'APPROVED — approve AND activate it first; see ADR-024).',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: createRegularLevyScheduleSchema } } },
  },
  responses: {
    201: jsonContent(levyScheduleSchema, 'Schedule drafted.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/levy-schedules/special',
  operationId: 'createSpecialLevySchedule',
  tags: [TAG],
  summary: 'Drafts a special levy schedule, with explicit approval evidence.',
  description:
    'Requires `financials.manage`. `rationale` and `externalApprovalDate` (the real-world AGM/' +
    'committee resolution date, never fabricated — must not be in the future) are required. The ' +
    'total is the SUM of `installments`.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: createSpecialLevyScheduleSchema } } },
  },
  responses: {
    201: jsonContent(levyScheduleSchema, 'Schedule drafted.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/levy-schedules/{scheduleId}',
  operationId: 'getLevySchedule',
  tags: [TAG],
  summary: 'Returns one levy schedule, including its installments.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: scheduleIdPathParam },
  responses: {
    200: jsonContent(levyScheduleSchema, 'Schedule detail.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/levy-schedules/{scheduleId}/approve',
  operationId: 'approveLevySchedule',
  tags: [TAG],
  summary: 'DRAFT -> APPROVED.',
  description: 'Requires `financials.manage`. Rejected (409) if not currently DRAFT.',
  security: SECURITY_CUSTOMER,
  request: {
    params: scheduleIdPathParam,
    body: { content: { 'application/json': { schema: approveLevyScheduleSchema } } },
  },
  responses: {
    200: jsonContent(levyScheduleSchema, 'Approved.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/levy-schedules/{scheduleId}/cancel',
  operationId: 'cancelLevySchedule',
  tags: [TAG],
  summary: 'Cancels a DRAFT or APPROVED (not yet issued) schedule.',
  description:
    'Requires `financials.manage`. Nothing has been posted yet, so this is a simple terminal ' +
    'state, not a reversal. Rejected (409) once ISSUED — use reverse instead.',
  security: SECURITY_CUSTOMER,
  request: {
    params: scheduleIdPathParam,
    body: { content: { 'application/json': { schema: cancelLevyScheduleSchema } } },
  },
  responses: {
    200: jsonContent(levyScheduleSchema, 'Cancelled.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/levy-schedules/{scheduleId}/preview',
  operationId: 'previewLevySchedule',
  tags: [TAG],
  summary: 'Computes the per-lot allocation for every still-PENDING instalment — never persisted.',
  description:
    'Requires `financials.view`. Only PENDING instalments are previewed (ADR-024) — an already-' +
    'ISSUED or REVERSED instalment has real LotLevyCharge rows as its source of truth; see the lot ' +
    'levy charges endpoint for those. Rejected (409) once the schedule is CANCELLED. Recomputed ' +
    'from CURRENT lot entitlements on every call — may differ from an earlier preview, or from the ' +
    'eventual issued amount, if entitlement data changes in between; issuance always uses the data ' +
    'current at issue time, never a cached preview.',
  security: SECURITY_CUSTOMER,
  request: { params: scheduleIdPathParam },
  responses: {
    200: jsonContent(lotAllocationPreviewListSchema, 'Preview rows, one per lot.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/levy-schedules/{scheduleId}/issue',
  operationId: 'issueLevySchedule',
  tags: [TAG],
  summary: 'Issues exactly ONE instalment (ADR-024) — never the whole schedule at once.',
  description:
    'Requires `financials.approve`. NSW strata practice (Strata Schemes Management Act 2015 ' +
    's.81/s.85): a scheme\'s annual contribution is determined once, but each instalment is ' +
    'separately levied at its own date — this endpoint never posts a future, still-pending ' +
    'instalment early. Omit `levyInstallmentId` to issue the earliest PENDING instalment, or ' +
    'supply one to issue a specific instalment out of due-date order. Idempotent: re-issuing an ' +
    'already-ISSUED instalment, or calling with nothing left PENDING, returns the schedule ' +
    'unchanged — no duplicate charges, no duplicate posting. Concurrency-safe via the same ' +
    'FinancialConfiguration row lock every M16.2.2 ledger write uses. Posts one DEBIT ' +
    'LOT_LEVY_RECEIVABLE + one CREDIT LEVY_INCOME line for just this instalment\'s total; the ' +
    'LotLevyCharge rows created in the same transaction (one per lot, for this instalment only) are ' +
    'the real per-lot subledger. A personalised owner notice (lot, fund, amount, due date) is ' +
    'scheduled per charged lot through the Communications module AFTER the posting commits — a ' +
    'notice failure never affects the already-posted levy. The schedule\'s own `status` is derived ' +
    'from its instalments (DRAFT/APPROVED/PARTIALLY_ISSUED/ISSUED/CANCELLED; legacy REVERSED). ' +
    'Rejected (409) if the schedule is DRAFT/CANCELLED, if a named instalment was already reversed, ' +
    'if no OPEN accounting period covers today, or if any lot is missing a recorded ' +
    'entitlementValue; 404 if a named `levyInstallmentId` doesn\'t belong to this schedule.',
  security: SECURITY_CUSTOMER,
  request: {
    params: scheduleIdPathParam,
    body: { content: { 'application/json': { schema: issueLevyScheduleSchema } } },
  },
  responses: {
    201: jsonContent(levyScheduleSchema, 'Instalment issued (or unchanged, if idempotently retried).'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/levy-schedules/{scheduleId}/reverse',
  operationId: 'reverseLevySchedule',
  tags: [TAG],
  summary: 'Reverses ONE issued instalment’s posted journal and cancels its charges (ADR-024).',
  description:
    'Requires `financials.approve`. `levyInstallmentId` (required) names the specific instalment ' +
    'to reverse — every OTHER instalment on the schedule, issued or still pending, is completely ' +
    'unaffected. Posts the exact opposite journal, linked to the original (never edited or ' +
    'deleted) via LedgerPostingService.reverseWithinTransaction — the same reversal-integrity ' +
    'guarantees as a manual journal reversal. Every LotLevyCharge under that one instalment moves ' +
    'to CANCELLED; the charge rows themselves are never deleted. Terminal — a reversed instalment ' +
    'can never be re-issued (raise a LevyAdjustment or a fresh special levy instead). Rejected ' +
    '(409) if that instalment is not currently ISSUED, or if already reversed.',
  security: SECURITY_CUSTOMER,
  request: {
    params: scheduleIdPathParam,
    body: { content: { 'application/json': { schema: reverseLevyScheduleSchema } } },
  },
  responses: {
    201: jsonContent(levyScheduleSchema, 'Instalment reversed.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/lot-levy-charges',
  operationId: 'listLotLevyCharges',
  tags: [TAG],
  summary: 'Lists issued lot levy charges — the real per-lot subledger (FIN-013).',
  description:
    'Requires `financials.view`. Optional `spaceId`/`levyScheduleId` filters. `effectiveAmount` ' +
    'on each row already includes every posted adjustment. Each row carries human-readable ' +
    '`lotLabel`/`fundName`/`levyScheduleName`/`installmentNumber`/`dueDate` (never a raw internal ' +
    'id) — `ownerName` is additionally gated on the caller independently holding `people.view`; ' +
    'null otherwise, or if the lot has no recorded OWNER membership.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: listLotLevyChargesQuerySchema },
  responses: {
    200: jsonContent(lotLevyChargeListSchema, 'Charges.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/lot-levy-charges/{chargeId}/adjust',
  operationId: 'createLevyAdjustment',
  tags: [TAG],
  summary: 'Posts a controlled correction to one lot’s charge.',
  description:
    'Requires `financials.approve`. Never edits LotLevyCharge.amount — posts its own small signed ' +
    'DEBIT/CREDIT journal between LOT_LEVY_RECEIVABLE and LEVY_INCOME and records a LevyAdjustment ' +
    'row. `sourceId`, if supplied, makes a specific adjustment request idempotent against retries ' +
    '(same convention as a manual journal\'s own sourceId). Rejected (409) if the charge\'s own ' +
    'instalment was reversed (its charges are CANCELLED).',
  security: SECURITY_CUSTOMER,
  request: {
    params: chargeIdPathParam,
    body: { content: { 'application/json': { schema: createLevyAdjustmentSchema } } },
  },
  responses: {
    201: jsonContent(levyAdjustmentSchema, 'Adjustment posted.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});
