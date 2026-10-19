import { z } from 'zod';
import {
  addBudgetLineSchema,
  approveBudgetSchema,
  createBudgetRevisionSchema,
  createBudgetSchema,
  updateBudgetLineSchema,
  updateBudgetMetadataSchema,
} from '../../modules/financials/budgets.schemas.js';
import { commonErrors, jsonContent } from '../components/common.schemas.js';
import {
  financialBudgetListSchema,
  financialBudgetSchema,
} from '../components/entities.schemas.js';
import { registry, SECURITY_CUSTOMER } from '../registry.js';
import { propertyIdPathParam } from './properties.paths.js';

const TAG = 'Financial Management';

const budgetIdPathParam = registry.register(
  'FinancialBudgetIdPathParam',
  z.object({ propertyId: z.string(), budgetId: z.string() }),
);
const budgetLineIdPathParam = registry.register(
  'FinancialBudgetLineIdPathParam',
  z.object({ propertyId: z.string(), budgetId: z.string(), lineId: z.string() }),
);

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/budgets',
  operationId: 'listFinancialBudgets',
  tags: [TAG],
  summary: 'Lists every budget (every financial year, every version) for this property.',
  description:
    'Requires `financials.view`. Ordered newest financial year first, then newest version ' +
    'first — includes DRAFT, APPROVED, ACTIVE and SUPERSEDED budgets; nothing is ever deleted.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: {
    200: jsonContent(financialBudgetListSchema, 'Budgets.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/budgets',
  operationId: 'createFinancialBudget',
  tags: [TAG],
  summary: 'Creates a new DRAFT budget for a financial year not yet budgeted.',
  description:
    'Requires `financials.manage` and financial management to already be ACTIVE. `source: ' +
    '"IMPORTED"` records the scheme’s already-approved current budget captured during ' +
    'onboarding rather than one built natively — see FinancialBudget.source. The period’s ' +
    'length must match this scheme’s established financial-year cadence and must not overlap ' +
    'any other financial year already budgeted for this property (409). A second create for a ' +
    'financial year that already has a budget (any status) is rejected — use the revise action ' +
    'instead.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: createBudgetSchema } } },
  },
  responses: {
    201: jsonContent(financialBudgetSchema, 'Budget created.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/budgets/{budgetId}',
  operationId: 'getFinancialBudget',
  tags: [TAG],
  summary: 'Returns one budget’s full detail, including lines and derived totals.',
  description: 'Requires `financials.view`. totalBudget/totalsByFund are always derived fresh.',
  security: SECURITY_CUSTOMER,
  request: { params: budgetIdPathParam },
  responses: {
    200: jsonContent(financialBudgetSchema, 'Budget detail.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/properties/{propertyId}/financials/budgets/{budgetId}',
  operationId: 'updateFinancialBudgetMetadata',
  tags: [TAG],
  summary: 'Updates a DRAFT budget’s notes.',
  description:
    'Requires `financials.manage`. Only `notes` is editable here — financial year dates, ' +
    'currency, and source are immutable after creation. Rejected (409) once the budget is no ' +
    'longer DRAFT.',
  security: SECURITY_CUSTOMER,
  request: {
    params: budgetIdPathParam,
    body: { content: { 'application/json': { schema: updateBudgetMetadataSchema } } },
  },
  responses: {
    200: jsonContent(financialBudgetSchema, 'Updated.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/budgets/{budgetId}/lines',
  operationId: 'addFinancialBudgetLine',
  tags: [TAG],
  summary: 'Adds a line to a DRAFT budget.',
  description:
    'Requires `financials.manage`. financialFundId must belong to this same property (409 ' +
    'otherwise — cross-property fund references are always rejected). plannedAmount must be >= ' +
    '0; a $0 line is valid. Rejected (409) once the budget is no longer DRAFT.',
  security: SECURITY_CUSTOMER,
  request: {
    params: budgetIdPathParam,
    body: { content: { 'application/json': { schema: addBudgetLineSchema } } },
  },
  responses: {
    201: jsonContent(financialBudgetSchema, 'Line added — returns the whole budget.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/properties/{propertyId}/financials/budgets/{budgetId}/lines/{lineId}',
  operationId: 'updateFinancialBudgetLine',
  tags: [TAG],
  summary: 'Updates a line on a DRAFT budget.',
  description:
    'Requires `financials.manage`. financialFundId is never changed by update — move the ' +
    'amount by deleting and re-adding instead. Rejected (409) once the budget is no longer DRAFT.',
  security: SECURITY_CUSTOMER,
  request: {
    params: budgetLineIdPathParam,
    body: { content: { 'application/json': { schema: updateBudgetLineSchema } } },
  },
  responses: {
    200: jsonContent(financialBudgetSchema, 'Updated — returns the whole budget.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/properties/{propertyId}/financials/budgets/{budgetId}/lines/{lineId}',
  operationId: 'deleteFinancialBudgetLine',
  tags: [TAG],
  summary: 'Removes a line from a DRAFT budget.',
  description: 'Requires `financials.manage`. Rejected (409) once the budget is no longer DRAFT.',
  security: SECURITY_CUSTOMER,
  request: { params: budgetLineIdPathParam },
  responses: {
    200: jsonContent(financialBudgetSchema, 'Removed — returns the whole budget.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/budgets/{budgetId}/approve',
  operationId: 'approveFinancialBudget',
  tags: [TAG],
  summary: 'Approves a DRAFT budget (requires at least one line).',
  description:
    'Requires `financials.manage`. For an IMPORTED budget, `externalApprovalDate` (the real ' +
    'date the scheme itself approved it, before WaslProp) is required — this never fabricates ' +
    'an approval event that happened inside WaslProp. For a CREATED budget, supplying either ' +
    'external field is rejected (422). Rejected (409) if not DRAFT, or (422) with zero lines.',
  security: SECURITY_CUSTOMER,
  request: {
    params: budgetIdPathParam,
    body: { content: { 'application/json': { schema: approveBudgetSchema } } },
  },
  responses: {
    200: jsonContent(financialBudgetSchema, 'Approved.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/budgets/{budgetId}/activate',
  operationId: 'activateFinancialBudget',
  tags: [TAG],
  summary: 'Activates an APPROVED budget — the authoritative budget for its financial year.',
  description:
    'Requires `financials.manage`. Whatever was previously ACTIVE for the same financial year ' +
    'is transactionally superseded first — a property can never have two ACTIVE budgets for the ' +
    'same financial year (enforced by both a row lock and a database constraint). Idempotent ' +
    'once already ACTIVE. Rejected (409) if not APPROVED.',
  security: SECURITY_CUSTOMER,
  request: { params: budgetIdPathParam },
  responses: {
    200: jsonContent(financialBudgetSchema, 'Activated.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/budgets/{budgetId}/revise',
  operationId: 'reviseFinancialBudget',
  tags: [TAG],
  summary: 'Creates the next version of an APPROVED or ACTIVE budget, as a new DRAFT.',
  description:
    'Requires `financials.manage`. Copies the source budget’s lines as a starting point — the ' +
    'source budget itself is never modified. The new version number is assigned deterministically ' +
    'and is race-safe under concurrent revise calls. Rejected (409) if the source is DRAFT or ' +
    'SUPERSEDED.',
  security: SECURITY_CUSTOMER,
  request: {
    params: budgetIdPathParam,
    body: { content: { 'application/json': { schema: createBudgetRevisionSchema } } },
  },
  responses: {
    201: jsonContent(financialBudgetSchema, 'New revision created.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});
