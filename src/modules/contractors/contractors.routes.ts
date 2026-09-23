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
import {
  createCredential,
  getContractorComplianceOverview,
  listCommonCredentialTypes,
  listCredentials,
  presignCredentialDocument,
  rejectCredential,
  removeCredential,
  updateCredential,
  verifyCredential,
} from './compliance/compliance.controller.js';

export const contractorsRouter = Router();

// Contractors are operational/vendor data — never resident-visible. The
// Contractor model itself has no propertyId (it's an organisation-wide
// vendor directory, not owned by any one property — a contractor can work
// across many properties), so — unlike property/space/maintenance/work
// order/quote — access here is a coarse "does this user hold
// contractors.view/manage on at least one assigned property" check, not a
// per-contractor property scope. A deliberate, documented simplification;
// see the Roles & Permissions milestone report. The same coarse pattern
// applies to contractor_compliance.* below — a credential is exactly as
// org-wide as the contractor it belongs to.
contractorsRouter.use(authenticate);

// Registered before /:id so "credential-types" is never captured as an id.
contractorsRouter.get(
  '/credential-types',
  requireCapability('contractor_compliance.view'),
  listCommonCredentialTypes,
);

contractorsRouter.get('/', requireCapability('contractors.view'), asyncHandler(listContractors));
contractorsRouter.post(
  '/',
  requireCapability('contractors.manage'),
  asyncHandler(createContractor),
);
contractorsRouter.get('/:id', requireCapability('contractors.view'), asyncHandler(getContractor));
contractorsRouter.patch(
  '/:id',
  requireCapability('contractors.manage'),
  asyncHandler(updateContractor),
);

contractorsRouter.get(
  '/:contractorId/compliance',
  requireCapability('contractor_compliance.view'),
  asyncHandler(getContractorComplianceOverview),
);

contractorsRouter.get(
  '/:contractorId/credentials',
  requireCapability('contractor_compliance.view'),
  asyncHandler(listCredentials),
);
contractorsRouter.post(
  '/:contractorId/credentials/presign',
  requireCapability('contractor_compliance.manage'),
  asyncHandler(presignCredentialDocument),
);
contractorsRouter.post(
  '/:contractorId/credentials',
  requireCapability('contractor_compliance.manage'),
  asyncHandler(createCredential),
);
contractorsRouter.patch(
  '/:contractorId/credentials/:credentialId',
  requireCapability('contractor_compliance.manage'),
  asyncHandler(updateCredential),
);
contractorsRouter.delete(
  '/:contractorId/credentials/:credentialId',
  requireCapability('contractor_compliance.manage'),
  asyncHandler(removeCredential),
);
contractorsRouter.post(
  '/:contractorId/credentials/:credentialId/verify',
  requireCapability('contractor_compliance.verify'),
  asyncHandler(verifyCredential),
);
contractorsRouter.post(
  '/:contractorId/credentials/:credentialId/reject',
  requireCapability('contractor_compliance.verify'),
  asyncHandler(rejectCredential),
);
