import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../../middlewares/asyncHandler.js';
import {
  createComplianceRequirement,
  listComplianceRequirements,
  removeComplianceRequirement,
  updateComplianceRequirement,
} from './compliance.controller.js';

export const contractorComplianceRequirementsRouter = Router();

// Organisation Settings -> Contractor Compliance. Configuring what
// credentials are required per trade is a genuinely organisation-wide
// setting with no property to scope against — same bar as Roles &
// Permissions (role-permissions.routes.ts): OWNER/ADMIN only, not a
// capability. Anyone else who needs to know *why* a contractor is
// ineligible already gets the full explanation (credential type, reason,
// message) inline in ContractorEligibilityService's own result — no
// separate broader-access read of this configuration list is needed.
contractorComplianceRequirementsRouter.use(authenticate, requireOrgRole(['OWNER', 'ADMIN']));

contractorComplianceRequirementsRouter.get('/', asyncHandler(listComplianceRequirements));
contractorComplianceRequirementsRouter.post('/', asyncHandler(createComplianceRequirement));
contractorComplianceRequirementsRouter.patch('/:id', asyncHandler(updateComplianceRequirement));
contractorComplianceRequirementsRouter.delete('/:id', asyncHandler(removeComplianceRequirement));
