import { z } from 'zod';
import {
  addFundSchema,
  bulkSetLotOpeningPositionsSchema,
  startFinancialSetupSchema,
  updateFinancialYearSchema,
  updateFundSchema,
} from '../../modules/financials/financials.schemas.js';
import { commonErrors, jsonContent } from '../components/common.schemas.js';
import {
  financialReconciliationReportSchema,
  financialSummarySchema,
} from '../components/entities.schemas.js';
import { registry, SECURITY_CUSTOMER } from '../registry.js';
import { propertyIdPathParam } from './properties.paths.js';

const TAG = 'Financial Management';

const fundIdPathParam = registry.register(
  'FinancialFundIdPathParam',
  z.object({ propertyId: z.string(), fundId: z.string() }),
);

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials',
  operationId: 'getFinancialSummary',
  tags: [TAG],
  summary: 'Returns a property’s financial onboarding status and opening financial position.',
  description:
    'Requires `financials.view`. Returns a NOT_CONFIGURED shape (all fields null/empty) rather ' +
    'than 404 when financial setup has never been started for this property.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: {
    200: jsonContent(financialSummarySchema, 'Financial summary.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials',
  operationId: 'startFinancialSetup',
  tags: [TAG],
  summary: 'Starts (or resumes) the guided financial management setup flow — Step 1.',
  description:
    'Creates the FinancialConfiguration row on first call (NOT_CONFIGURED -> SETUP_IN_PROGRESS); ' +
    'idempotent — safe to call again while SETUP_IN_PROGRESS to apply newly-provided financial ' +
    'year/cutover fields. Requires `financials.manage`. Rejected once ACTIVE.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: startFinancialSetupSchema } } },
  },
  responses: {
    200: jsonContent(financialSummarySchema, 'Setup started/updated.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/properties/{propertyId}/financials',
  operationId: 'updateFinancialYear',
  tags: [TAG],
  summary: 'Updates the financial year start/end and cutover dates.',
  description:
    'Requires `financials.manage` and an already-started setup. Fields may be explicitly ' +
    'cleared (null). Rejected once ACTIVE — the financial year/cutover become historically fixed.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: updateFinancialYearSchema } } },
  },
  responses: {
    200: jsonContent(financialSummarySchema, 'Updated.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/funds',
  operationId: 'addFinancialFund',
  tags: [TAG],
  summary: 'Adds a fund (Administration, Capital Works, or Other) — Step 2.',
  description:
    'Optionally includes the fund’s opening balance in the same call. A duplicate Administration ' +
    'or Capital Works fund on the same property is rejected (409); Other funds may be added ' +
    'multiple times. Requires `financials.manage`. Rejected once ACTIVE.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: addFundSchema } } },
  },
  responses: {
    200: jsonContent(financialSummarySchema, 'Fund added.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/properties/{propertyId}/financials/funds/{fundId}',
  operationId: 'updateFinancialFund',
  tags: [TAG],
  summary: 'Updates a fund’s name and/or (upserts) its opening balance.',
  description: 'fundType is never editable. Requires `financials.manage`. Rejected once ACTIVE.',
  security: SECURITY_CUSTOMER,
  request: {
    params: fundIdPathParam,
    body: { content: { 'application/json': { schema: updateFundSchema } } },
  },
  responses: {
    200: jsonContent(financialSummarySchema, 'Fund updated.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'put',
  path: '/properties/{propertyId}/financials/lot-positions',
  operationId: 'bulkSetFinancialLotOpeningPositions',
  tags: [TAG],
  summary: 'Bulk-records each lot’s opening financial position — Step 3.',
  description:
    'Every spaceId must be a strata LOT on this property (never Common Property or ' +
    'unclassified) — 409 otherwise. amountOwing and creditBalance are separate non-negative ' +
    'fields, never one signed number. Requires `financials.manage`. Rejected once ACTIVE.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: bulkSetLotOpeningPositionsSchema } } },
  },
  responses: {
    200: jsonContent(financialSummarySchema, 'Lot opening positions recorded.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/reconciliation',
  operationId: 'getFinancialReconciliation',
  tags: [TAG],
  summary: 'Runs the deterministic financial setup reconciliation check — Step 4.',
  description:
    'Computed fresh on every call, never cached. Distinguishes ERROR (blocks activation), ' +
    'WARNING (does not block, but should be reviewed), and INFO. Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: {
    200: jsonContent(financialReconciliationReportSchema, 'Reconciliation report.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/activate',
  operationId: 'activateFinancialSetup',
  tags: [TAG],
  summary: 'Explicitly activates financial management for this property — Step 5.',
  description:
    'Re-runs the reconciliation check server-side (never trusts a client-reported state) and ' +
    'rejects with 409 if any error remains. Idempotent once already ACTIVE. Never automatic — ' +
    'this is the one explicit user action that locks in the opening position. Requires ' +
    '`financials.manage`.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: {
    200: jsonContent(financialSummarySchema, 'Activated.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});
