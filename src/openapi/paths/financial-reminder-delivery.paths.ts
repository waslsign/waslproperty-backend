import { z } from 'zod';
import {
  evaluateRemindersSchema,
  updateReminderPolicySchema,
} from '../../modules/financials/reminder-policy.schemas.js';
import { commonErrors, errorResponse, jsonContent } from '../components/common.schemas.js';
import {
  reminderBatchApproveResultSchema,
  reminderDeliveryAttemptListSchema,
  reminderDetailSchema,
  reminderEvaluationSummarySchema,
  reminderPolicySchema,
  reminderQueueItemSchema,
  reminderQueueListSchema,
} from '../components/entities.schemas.js';
import { propertyIdPathParam } from './properties.paths.js';
import { registry, SECURITY_CUSTOMER, SECURITY_PUBLIC } from '../registry.js';

const TAG = 'Financial Management — Arrears Reminder Delivery';

const reminderQueuePathParams = registry.register(
  'ReminderQueuePathParams',
  z.object({ propertyId: z.string(), reminderId: z.string() }),
);

const reminderQueueFilterQuery = registry.register(
  'ReminderQueueFilterQuery',
  z.object({
    status: z
      .enum(['DRAFT', 'CANCELLED', 'SENT', 'FAILED', 'READY_FOR_REVIEW', 'APPROVED', 'QUEUED', 'SENDING', 'DELIVERED', 'SUPPRESSED', 'QUARANTINED'])
      .optional(),
    spaceId: z.string().optional(),
  }),
);

const batchApproveBodySchema = registry.register(
  'ReminderBatchApproveBody',
  z.object({ reminderIds: z.array(z.string()).min(1).max(200) }),
);

const cancelReminderBodySchema = registry.register(
  'ReminderCancelBody',
  z.object({ reason: z.string().max(500).optional() }),
);

const resolveQuarantineBodySchema = registry.register(
  'ReminderResolveQuarantineBody',
  z.object({
    resolution: z.enum(['CONFIRMED_SENT', 'CONFIRMED_NOT_SENT']),
    note: z.string().min(1).max(500),
  }),
);

const reminderDeliveryWebhookPayloadSchema = registry.register(
  'ReminderDeliveryWebhookPayload',
  z.object({
    providerMessageId: z.string().min(1),
    status: z.enum(['delivered', 'bounced', 'complained']),
    occurredAt: z.string().optional(),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/arrears/reminders/policy',
  operationId: 'getReminderPolicy',
  tags: [TAG],
  summary: "A property's reminder policy — created with safe (disabled) defaults on first read.",
  description:
    'Requires `financials.view`. `enabled` gates daily eligibility evaluation; `deliveryEnabled` ' +
    'separately gates actual dispatch — both default `false` and both must be true (on top of, ' +
    'never instead of, the process-wide EMAIL_SEND_DISABLED kill switch) before any email is sent ' +
    '(ADR-029).',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: {
    200: jsonContent(reminderPolicySchema, 'Reminder policy.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/properties/{propertyId}/financials/arrears/reminders/policy',
  operationId: 'updateReminderPolicy',
  tags: [TAG],
  summary: 'Updates the reminder policy for a property.',
  description:
    'Requires `financials.manage`. Every update bumps `version`, which is stamped onto every ' +
    'reminder candidate/approval generated under it, so a later policy change never silently ' +
    'reinterprets an already-approved reminder.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, body: { content: { 'application/json': { schema: updateReminderPolicySchema } } } },
  responses: {
    200: jsonContent(reminderPolicySchema, 'Updated reminder policy.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/reminders/evaluate',
  operationId: 'evaluateReminders',
  tags: [TAG],
  summary: 'Manually triggers the daily eligibility evaluation for a property.',
  description:
    'Requires `financials.manage`. The same evaluation the scheduler runs automatically each day ' +
    '— produces reviewable READY_FOR_REVIEW/SUPPRESSED candidates only, never an email. A no-op if ' +
    'the policy is not `enabled`. `asOfDate` is test/manual-override only; the scheduler never ' +
    'supplies it.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, body: { content: { 'application/json': { schema: evaluateRemindersSchema } } } },
  responses: {
    201: jsonContent(reminderEvaluationSummarySchema, 'Evaluation summary.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/arrears/reminders/queue',
  operationId: 'listReminderQueue',
  tags: [TAG],
  summary: 'Lists reminder candidates/approvals/deliveries, optionally filtered by status or lot.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: reminderQueueFilterQuery },
  responses: {
    200: jsonContent(reminderQueueListSchema, 'Reminder queue.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/arrears/reminders/queue/{reminderId}',
  operationId: 'getReminderDetail',
  tags: [TAG],
  summary: 'A single reminder candidate with a live debt/recipient recheck and a staleness flag.',
  description:
    'Requires `financials.view`. Always recomputes current arrears and recipient (never trusts the ' +
    "stored snapshot) so the review screen can show `stale: true` before a manager approves on " +
    'outdated figures.',
  security: SECURITY_CUSTOMER,
  request: { params: reminderQueuePathParams },
  responses: {
    200: jsonContent(reminderDetailSchema, 'Reminder detail.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/reminders/queue/{reminderId}/submit-for-review',
  operationId: 'submitReminderForReview',
  tags: [TAG],
  summary: 'Submits a manually drafted (M16.6) reminder into the unified review/approval/dispatch pipeline.',
  description:
    'Requires `financials.manage`. Only a `DRAFT` reminder can be submitted. Applies the exact same ' +
    'restrictions the automated daily evaluator applies — minimum-outstanding threshold, case-status ' +
    'suppression (DISPUTED/PAUSED/AWAITING_PAYMENT/ESCALATED), per-case/rolling-window caps, and the ' +
    '(lot, stage) duplicate-active-reminder dedup — a manual submission can never bypass a ' +
    'restriction an automated candidate would have been stopped by (ADR-029 Addendum 2). Does NOT ' +
    'require `ReminderPolicy.enabled` and does NOT apply the initial-delay/follow-up-interval timing ' +
    'rule — those pace automated reminders against a clock and have no meaning against a manager ' +
    'acting right now. A settled debt is cancelled instead of submitted; a suppressing condition ' +
    'moves the reminder straight to `SUPPRESSED` with the reason recorded, rather than silently ' +
    'blocking the request without explanation. The duplicate-check and status transition run inside ' +
    'one serializable transaction, so two concurrent submission attempts can never both succeed.',
  security: SECURITY_CUSTOMER,
  request: { params: reminderQueuePathParams },
  responses: {
    201: jsonContent(reminderQueueItemSchema, 'The reminder in its new state — READY_FOR_REVIEW, SUPPRESSED, or (if the debt was settled) CANCELLED.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/reminders/queue/{reminderId}/approve',
  operationId: 'approveReminder',
  tags: [TAG],
  summary: 'Approves a reminder candidate for delivery.',
  description:
    'Requires `financials.manage`. Only a `READY_FOR_REVIEW` reminder can be approved. Live debt, ' +
    'recipient, and case status are recalculated immediately before approval; if the debt has been ' +
    'settled, or the figures/recipient have changed, the reminder is cancelled or refreshed instead ' +
    'and a 409 explains why — never silently approved on stale content (ADR-029). On success, an ' +
    'immutable approval snapshot (approver, timestamp, recipient, amount, template/policy version) ' +
    'is stored.',
  security: SECURITY_CUSTOMER,
  request: { params: reminderQueuePathParams },
  responses: {
    201: jsonContent(reminderQueueItemSchema, 'Approved reminder.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/reminders/queue/batch-approve',
  operationId: 'batchApproveReminders',
  tags: [TAG],
  summary: 'Approves multiple reminder candidates in one call.',
  description:
    'Requires `financials.manage`. Each id is approved independently via the same revalidation as ' +
    'the single-approve endpoint — one failure (stale content, settled debt, unresolved recipient) ' +
    'never blocks the rest. Returns a clear per-id outcome and counts.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, body: { content: { 'application/json': { schema: batchApproveBodySchema } } } },
  responses: {
    201: jsonContent(reminderBatchApproveResultSchema, 'Batch approval result.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/reminders/queue/{reminderId}/cancel',
  operationId: 'cancelReminderM168',
  tags: [TAG],
  summary: 'Cancels a reminder candidate or approval.',
  description:
    'Requires `financials.manage`. Only `DRAFT`/`READY_FOR_REVIEW`/`APPROVED`/`SUPPRESSED` can be ' +
    'cancelled — a reminder already `QUEUED`/`SENDING` (in-flight dispatch) or terminal ' +
    '(`SENT`/`DELIVERED`/`FAILED`/`QUARANTINED`) requires its own resolution path instead.',
  security: SECURITY_CUSTOMER,
  request: { params: reminderQueuePathParams, body: { content: { 'application/json': { schema: cancelReminderBodySchema } } } },
  responses: {
    201: jsonContent(reminderQueueItemSchema, 'Cancelled reminder.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/reminders/queue/{reminderId}/dispatch',
  operationId: 'dispatchReminder',
  tags: [TAG],
  summary: 'Manually triggers immediate dispatch of an approved reminder.',
  description:
    'Requires `financials.approve` — this is the action that actually sends an email, so it sits ' +
    'at the same maker-checker tier as M16.7\'s reconciliation-completion actions. Only an ' +
    '`APPROVED` reminder can be dispatched; it is atomically claimed (APPROVED -> QUEUED) so a ' +
    'repeated click or a concurrent scheduler run can never duplicate the send. Live debt/recipient ' +
    "are revalidated again immediately before the provider call; EMAIL_SEND_DISABLED is a hard " +
    'stop that reverts to APPROVED without ever reporting SENT.',
  security: SECURITY_CUSTOMER,
  request: { params: reminderQueuePathParams },
  responses: {
    202: jsonContent(z.object({ dispatched: z.literal(true) }), 'Dispatch accepted (outcome recorded asynchronously on the reminder itself).'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/reminders/queue/{reminderId}/retry',
  operationId: 'retryReminderDispatch',
  tags: [TAG],
  summary: 'Manually retries a permanently FAILED reminder dispatch.',
  description:
    'Requires `financials.approve`. Only a `FAILED` reminder can be retried — an explicit human ' +
    'override of the automatic-retry cap. Never applies to `QUARANTINED` (see resolve-quarantine): ' +
    'a failed-permanently send is known not to have been accepted, whereas a quarantined one has an ' +
    'unknown outcome and must never be retried automatically or casually.',
  security: SECURITY_CUSTOMER,
  request: { params: reminderQueuePathParams },
  responses: {
    201: jsonContent(z.object({ retried: z.literal(true) }), 'Reminder returned to APPROVED for the next dispatch attempt.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/arrears/reminders/queue/{reminderId}/resolve-quarantine',
  operationId: 'resolveReminderQuarantine',
  tags: [TAG],
  summary: 'Resolves a QUARANTINED reminder whose delivery outcome is unknown.',
  description:
    'Requires `financials.approve`. A reminder is quarantined when the provider call timed out — it ' +
    'may or may not have been accepted, and is never auto-retried (a duplicate send would otherwise ' +
    'be possible). This is the only way such a reminder leaves quarantine: an explicit human ' +
    'decision, `CONFIRMED_SENT` (moves to `SENT`) or `CONFIRMED_NOT_SENT` (returns to `APPROVED` for ' +
    'another dispatch attempt), always with an audited note.',
  security: SECURITY_CUSTOMER,
  request: { params: reminderQueuePathParams, body: { content: { 'application/json': { schema: resolveQuarantineBodySchema } } } },
  responses: {
    201: jsonContent(z.object({ resolved: z.literal(true) }), 'Quarantine resolved.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/arrears/reminders/queue/{reminderId}/attempts',
  operationId: 'listReminderDeliveryAttempts',
  tags: [TAG],
  summary: 'The full delivery-attempt history for one reminder.',
  description:
    'Requires `financials.view`. Each attempt records only provider message id, timestamps, and an ' +
    'error category — never raw provider payloads, secrets, or message content.',
  security: SECURITY_CUSTOMER,
  request: { params: reminderQueuePathParams },
  responses: {
    200: jsonContent(reminderDeliveryAttemptListSchema, 'Delivery attempts.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/integrations/reminder-delivery/webhook',
  operationId: 'handleReminderDeliveryWebhook',
  tags: [TAG],
  summary: 'Webhook — receives delivery-confirmation callbacks from the email provider.',
  description:
    'Not a customer-callable endpoint. Authenticated by HMAC-SHA256 signature, never a bearer ' +
    'token: the `X-Reminder-Signature: sha256=<hex>` header is verified against the raw request ' +
    'body (registered ahead of the global JSON body parser, same pattern as the WaslSign webhook) ' +
    'using a shared secret (`REMINDER_DELIVERY_WEBHOOK_SECRET`, never exposed here). Only a ' +
    '`delivered` status moves a reminder from `SENT` to `DELIVERED`, via an atomic compare-and-swap ' +
    'so a redelivered/duplicated event is a no-op. `bounced`/`complained` are accepted and logged ' +
    'but do not change status in this MVP.',
  security: SECURITY_PUBLIC,
  request: {
    body: {
      content: { 'application/json': { schema: reminderDeliveryWebhookPayloadSchema } },
      description: 'Signed by the email provider — see the X-Reminder-Signature header requirement above.',
    },
  },
  responses: {
    200: jsonContent(z.object({ handled: z.boolean() }), 'Processed (idempotently — a duplicate delivered event is a no-op).'),
    401: errorResponse('Missing or invalid X-Reminder-Signature.'),
    400: errorResponse('Malformed JSON body.'),
    503: {
      description: 'The webhook receiver is not configured (REMINDER_DELIVERY_WEBHOOK_SECRET missing).',
      content: {
        'application/json': {
          schema: z.object({ error: z.object({ code: z.literal('NOT_CONFIGURED'), message: z.string() }) }),
        },
      },
    },
  },
});
