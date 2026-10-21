import { z } from 'zod';
import { lotLedgerQuerySchema, lotStatementQuerySchema } from '../../modules/financials/lot-ledger.schemas.js';
import { commonErrors, jsonContent } from '../components/common.schemas.js';
import { lotFinancialAccountSchema, lotLedgerPageSchema, lotStatementSchema } from '../components/entities.schemas.js';
import { registry, SECURITY_CUSTOMER } from '../registry.js';

const TAG = 'Financial Management — Lot Ledger';

const lotPathParams = registry.register(
  'LotFinancialPathParams',
  z.object({ propertyId: z.string(), spaceId: z.string() }),
);

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/lots/{spaceId}/financial-account',
  operationId: 'getLotFinancialAccount',
  tags: [TAG],
  summary: "A lot's financial account summary — opening position, totals, current balance and fund breakdown.",
  description:
    'Requires `financials.view`. `ownerName` is populated only when the caller independently ' +
    'holds `people.view` — never bundled into a financials-gated response by default. 409 if ' +
    'the space is not a strata lot, or financial management has not been set up for this ' +
    'property. This is a read-only projection over LotOpeningPosition/LotLevyCharge/' +
    'LevyAdjustment — there is no separate, independently-writable lot ledger table (see ' +
    'lot-ledger.service.ts).',
  security: SECURITY_CUSTOMER,
  request: { params: lotPathParams },
  responses: {
    200: jsonContent(lotFinancialAccountSchema, 'Financial account summary.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/lots/{spaceId}/ledger',
  operationId: 'getLotLedger',
  tags: [TAG],
  summary: "A lot's full chronological transaction history, paginated, with a correct running balance.",
  description:
    'Requires `financials.view`. The running balance is computed over this lot\'s complete ' +
    'row set first, then the requested page is sliced out of that already-correct sequence — ' +
    'never a page-local recomputation (safe because one lot\'s transaction count is always ' +
    'bounded; see lot-ledger.service.ts). Rows are ordered by (date ASC, a fixed type priority ' +
    'ASC, id ASC) for determinism on same-day transactions.',
  security: SECURITY_CUSTOMER,
  request: { params: lotPathParams, query: lotLedgerQuerySchema },
  responses: {
    200: jsonContent(lotLedgerPageSchema, 'Paginated ledger.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/lots/{spaceId}/statement',
  operationId: 'getLotStatement',
  tags: [TAG],
  summary: "A lot's statement for an explicit period — opening balance, itemised movements, closing balance.",
  description:
    'Requires `financials.view`. The period is always explicit (`periodStartDate`/' +
    '`periodEndDate`) — never an implicit financial year or "since the beginning". ' +
    'openingBalance + totalDebits - totalCredits always reconciles to closingBalance.',
  security: SECURITY_CUSTOMER,
  request: { params: lotPathParams, query: lotStatementQuerySchema },
  responses: {
    200: jsonContent(lotStatementSchema, 'Statement for the requested period.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});
