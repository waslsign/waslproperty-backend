import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireCapability } from '../../middlewares/authorize.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  createContractor,
  getContractor,
  listContractors,
  updateContractor,
} from './contractors.controller.js';

export const contractorsRouter = Router();

// Contractors are operational/vendor data — never resident-visible. The
// Contractor model itself has no propertyId (it's an organisation-wide
// vendor directory, not owned by any one property — a contractor can work
// across many properties), so — unlike property/space/maintenance/work
// order/quote — access here is a coarse "does this user hold
// contractors.view/manage on at least one assigned property" check, not a
// per-contractor property scope. A deliberate, documented simplification;
// see the Roles & Permissions milestone report.
contractorsRouter.use(authenticate);

contractorsRouter.get('/', requireCapability('contractors.view'), asyncHandler(listContractors));
contractorsRouter.post('/', requireCapability('contractors.manage'), asyncHandler(createContractor));
contractorsRouter.get('/:id', requireCapability('contractors.view'), asyncHandler(getContractor));
contractorsRouter.patch(
  '/:id',
  requireCapability('contractors.manage'),
  asyncHandler(updateContractor),
);
