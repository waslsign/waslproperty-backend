import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireCapability } from '../../middlewares/authorize.middleware.js';
import { fromParam } from '../../middlewares/resolvePropertyId.js';
import { resolvePropertyReference } from '../../middlewares/resolvePublicReference.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { listActivityForProperty } from '../activity/activity.controller.js';
import {
  addPersonToProperty,
  assignExistingPerson,
  listPeopleForProperty,
} from '../people/people.controller.js';
import {
  activateFinancialSetup,
  addFinancialFund,
  bulkSetFinancialLotOpeningPositions,
  getFinancialReconciliation,
  getFinancialSummary,
  startFinancialSetup,
  updateFinancialFund,
  updateFinancialYear,
} from '../financials/financials.controller.js';
import {
  activateFinancialBudget,
  addFinancialBudgetLine,
  approveFinancialBudget,
  createFinancialBudget,
  deleteFinancialBudgetLine,
  getFinancialBudget,
  listFinancialBudgets,
  reviseFinancialBudget,
  updateFinancialBudgetLine,
  updateFinancialBudgetMetadata,
} from '../financials/budgets.controller.js';
import { createSpaceForProperty, listSpacesForProperty } from '../spaces/spaces.controller.js';
import {
  bulkSetStrataLots,
  classifyStrataSpaces,
  completeStrataSetup,
  enableStrata,
  getStrataSummary,
  updateStrataPlan,
} from '../strata/strata.controller.js';
import {
  createProperty,
  getProperty,
  getPropertyInsights,
  listProperties,
  updateProperty,
} from './properties.controller.js';

export const propertiesRouter = Router();

propertiesRouter.use(authenticate);

// Portfolio scoping happens inside the service (PropertiesService.list) via
// AuthorizationService.getAccessiblePropertyIds — a user with no accessible
// properties simply gets an empty list, no separate route gate needed here.
propertiesRouter.get('/', asyncHandler(listProperties));
// Creating a brand-new property has no propertyId to scope against, so this
// is the coarse "does this user hold property.manage on ANY property"
// form of requireCapability (no resolvePropertyId) — OWNER/ADMIN always
// pass via AuthorizationService.can's own special case; a property-scoped
// manager passes only if their organisation has granted property.manage,
// and only once they already manage at least one existing property (a
// user with zero PropertyMemberships holds no capabilities to check).
propertiesRouter.post('/', requireCapability('property.manage'), asyncHandler(createProperty));
// No route-level capability gate: a resident/tenant may view their own
// property read-only (pre-existing behaviour), separate from the
// operational `property.view` capability — PropertiesService.getById
// resolves both and 404s if neither applies (never leaking that a
// different property exists, staff or resident alike).
propertiesRouter.get('/:id', resolvePropertyReference('id'), asyncHandler(getProperty));
propertiesRouter.patch(
  '/:id',
  resolvePropertyReference('id'),
  requireCapability('property.manage', fromParam('id')),
  asyncHandler(updateProperty),
);
propertiesRouter.get(
  '/:id/insights',
  resolvePropertyReference('id'),
  requireCapability('analytics.view', fromParam('id')),
  asyncHandler(getPropertyInsights),
);

propertiesRouter.get(
  '/:propertyId/spaces',
  resolvePropertyReference('propertyId'),
  requireCapability('spaces.view', fromParam('propertyId')),
  asyncHandler(listSpacesForProperty),
);
propertiesRouter.post(
  '/:propertyId/spaces',
  resolvePropertyReference('propertyId'),
  requireCapability('spaces.manage', fromParam('propertyId')),
  asyncHandler(createSpaceForProperty),
);

propertiesRouter.get(
  '/:propertyId/memberships',
  resolvePropertyReference('propertyId'),
  requireCapability('people.view', fromParam('propertyId')),
  asyncHandler(listPeopleForProperty),
);
propertiesRouter.post(
  '/:propertyId/memberships',
  resolvePropertyReference('propertyId'),
  requireCapability('people.manage', fromParam('propertyId')),
  asyncHandler(addPersonToProperty),
);
propertiesRouter.post(
  '/:propertyId/memberships/assign',
  resolvePropertyReference('propertyId'),
  requireCapability('people.manage', fromParam('propertyId')),
  asyncHandler(assignExistingPerson),
);

propertiesRouter.get(
  '/:propertyId/activity',
  resolvePropertyReference('propertyId'),
  requireCapability('activity.view', fromParam('propertyId')),
  asyncHandler(listActivityForProperty),
);

// Strata (M11-B) — the guided "Enable Strata Management" setup flow and
// the Units of Entitlement summary. strata.view/strata.manage, not
// property.manage/spaces.manage: narrower, purpose-built capabilities an
// organisation grants independently (see capabilities.ts) — a property
// manager who can edit a property's name doesn't automatically get to
// configure its strata scheme, and vice versa.
propertiesRouter.get(
  '/:propertyId/strata',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.view', fromParam('propertyId')),
  asyncHandler(getStrataSummary),
);
propertiesRouter.post(
  '/:propertyId/strata/enable',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.manage', fromParam('propertyId')),
  asyncHandler(enableStrata),
);
propertiesRouter.patch(
  '/:propertyId/strata/plan',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.manage', fromParam('propertyId')),
  asyncHandler(updateStrataPlan),
);
propertiesRouter.put(
  '/:propertyId/strata/lots',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.manage', fromParam('propertyId')),
  asyncHandler(bulkSetStrataLots),
);
propertiesRouter.put(
  '/:propertyId/strata/spaces/classify',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.manage', fromParam('propertyId')),
  asyncHandler(classifyStrataSpaces),
);
propertiesRouter.post(
  '/:propertyId/strata/complete',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.manage', fromParam('propertyId')),
  asyncHandler(completeStrataSetup),
);

// Financial Management (M16.1) — financial onboarding and the opening
// financial position for an existing strata scheme. financials.view/
// financials.manage, mirroring strata.view/strata.manage's own narrower-
// than-property.manage rationale (see capabilities.ts).
propertiesRouter.get(
  '/:propertyId/financials',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getFinancialSummary),
);
propertiesRouter.post(
  '/:propertyId/financials',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(startFinancialSetup),
);
propertiesRouter.patch(
  '/:propertyId/financials',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(updateFinancialYear),
);
propertiesRouter.post(
  '/:propertyId/financials/funds',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(addFinancialFund),
);
propertiesRouter.patch(
  '/:propertyId/financials/funds/:fundId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(updateFinancialFund),
);
propertiesRouter.put(
  '/:propertyId/financials/lot-positions',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(bulkSetFinancialLotOpeningPositions),
);
propertiesRouter.get(
  '/:propertyId/financials/reconciliation',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getFinancialReconciliation),
);
propertiesRouter.post(
  '/:propertyId/financials/activate',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(activateFinancialSetup),
);

// Budget Management (M16.2) — the authoritative planned funding requirement
// for a financial year, broken down by fund. Same financials.view/
// financials.manage split as the rest of this section.
propertiesRouter.get(
  '/:propertyId/financials/budgets',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listFinancialBudgets),
);
propertiesRouter.post(
  '/:propertyId/financials/budgets',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(createFinancialBudget),
);
propertiesRouter.get(
  '/:propertyId/financials/budgets/:budgetId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getFinancialBudget),
);
propertiesRouter.patch(
  '/:propertyId/financials/budgets/:budgetId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(updateFinancialBudgetMetadata),
);
propertiesRouter.post(
  '/:propertyId/financials/budgets/:budgetId/lines',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(addFinancialBudgetLine),
);
propertiesRouter.patch(
  '/:propertyId/financials/budgets/:budgetId/lines/:lineId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(updateFinancialBudgetLine),
);
propertiesRouter.delete(
  '/:propertyId/financials/budgets/:budgetId/lines/:lineId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(deleteFinancialBudgetLine),
);
propertiesRouter.post(
  '/:propertyId/financials/budgets/:budgetId/approve',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(approveFinancialBudget),
);
propertiesRouter.post(
  '/:propertyId/financials/budgets/:budgetId/activate',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(activateFinancialBudget),
);
propertiesRouter.post(
  '/:propertyId/financials/budgets/:budgetId/revise',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(reviseFinancialBudget),
);
