import { z } from 'zod';
import {
  createAllocationSchema,
  listReceiptsQuerySchema,
  recordReceiptSchema,
  reverseAllocationSchema,
  reverseReceiptSchema,
} from '../../modules/financials/receipts.schemas.js';
import { commonErrors, jsonContent } from '../components/common.schemas.js';
import { paymentAllocationViewSchema, receiptListSchema, receiptViewSchema } from '../components/entities.schemas.js';
import { propertyIdPathParam } from './properties.paths.js';
import { registry, SECURITY_CUSTOMER } from '../registry.js';

const TAG = 'Financial Management — Receipts & Payment Allocation';

const receiptIdPathParam = registry.register(
  'ReceiptIdPathParam',
  z.object({ propertyId: z.string(), receiptId: z.string() }),
);
const allocationIdPathParam = registry.register(
  'PaymentAllocationIdPathParam',
  z.object({ propertyId: z.string(), allocationId: z.string() }),
);

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/receipts',
  operationId: 'recordReceipt',
  tags: [TAG],
  summary: 'Records money received against a lot, optionally allocating it immediately.',
  description:
    'Requires `financials.approve`. Always posts exactly one journal (Dr fund cash / Cr unapplied ' +
    'cash — ADR-026) regardless of whether `allocations`/`autoAllocate` is supplied — recording a ' +
    'receipt never itself claims bank reconciliation. Any immediate allocation posts its own, ' +
    'separate journal(s) (Dr unapplied cash / Cr the charge\'s lot-levy-receivable), so the cash ' +
    'event and its application stay independently auditable and reversible. 409 if the receipt\'s ' +
    'fund does not match an allocation target charge\'s fund (cross-fund allocation is not ' +
    'supported — ADR-020), or if an allocation would exceed the charge\'s outstanding balance or ' +
    'the receipt\'s own unapplied balance. Idempotent on `idempotencyKey`.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, body: { content: { 'application/json': { schema: recordReceiptSchema } } } },
  responses: {
    201: jsonContent(receiptViewSchema, 'Recorded receipt, with any immediate allocations.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/receipts',
  operationId: 'listReceipts',
  tags: [TAG],
  summary: 'Lists receipts for this property, optionally filtered by lot or status.',
  description:
    'Requires `financials.view`. `ownerName` on each receipt is populated only when the caller ' +
    'independently holds `people.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, query: listReceiptsQuerySchema },
  responses: {
    200: jsonContent(receiptListSchema, 'Receipts.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/receipts/{receiptId}',
  operationId: 'getReceipt',
  tags: [TAG],
  summary: 'A single receipt, with its full allocation history.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: receiptIdPathParam },
  responses: {
    200: jsonContent(receiptViewSchema, 'Receipt.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/receipts/{receiptId}/reverse',
  operationId: 'reverseReceipt',
  tags: [TAG],
  summary: 'Reverses a receipt that has no currently-applied allocations.',
  description:
    'Requires `financials.approve`. 409 if any `PaymentAllocation` against this receipt is still ' +
    'APPLIED — every allocation must be reversed first (mirrors the levy-schedule "blocked once ' +
    'anything has issued" discipline), and 409 if the receipt\'s posting date falls in a closed ' +
    'accounting period. Never mutates the original journal — posts a balancing reversal journal ' +
    'and marks the receipt REVERSED. Idempotent: reversing an already-reversed receipt returns the ' +
    'existing reversal, never a second one.',
  security: SECURITY_CUSTOMER,
  request: { params: receiptIdPathParam, body: { content: { 'application/json': { schema: reverseReceiptSchema } } } },
  responses: {
    201: jsonContent(receiptViewSchema, 'Reversed receipt.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/receipts/{receiptId}/allocations',
  operationId: 'createPaymentAllocation',
  tags: [TAG],
  summary: 'Applies part or all of a receipt\'s unapplied balance to a specific lot levy charge.',
  description:
    'Requires `financials.approve`. For previously-unapplied cash (an advance payment, or a ' +
    'leftover balance from an earlier partial allocation) — applies against this same receipt\'s ' +
    'remaining balance, posting Dr unapplied cash / Cr lot-levy-receivable. 409 on cross-fund ' +
    'mismatch, over-allocation against the charge\'s outstanding balance, or the receipt\'s own ' +
    'unapplied balance. Idempotent on `idempotencyKey`.',
  security: SECURITY_CUSTOMER,
  request: { params: receiptIdPathParam, body: { content: { 'application/json': { schema: createAllocationSchema } } } },
  responses: {
    201: jsonContent(paymentAllocationViewSchema, 'Created allocation.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/payment-allocations/{allocationId}/reverse',
  operationId: 'reversePaymentAllocation',
  tags: [TAG],
  summary: 'Reverses a single payment allocation, freeing its amount back to the receipt\'s unapplied balance.',
  description:
    'Requires `financials.approve`. Posts a balancing reversal journal against the allocation\'s ' +
    'own journal (never the receipt\'s cash-receipt journal), recomputes the affected ' +
    '`LotLevyCharge.status` (ISSUED/PART_PAID/PAID), and marks the allocation REVERSED. 409 if the ' +
    'allocation is already REVERSED, or if the charge\'s accounting period is closed.',
  security: SECURITY_CUSTOMER,
  request: { params: allocationIdPathParam, body: { content: { 'application/json': { schema: reverseAllocationSchema } } } },
  responses: {
    201: jsonContent(paymentAllocationViewSchema, 'Reversed allocation.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});
