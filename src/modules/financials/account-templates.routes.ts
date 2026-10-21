import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { createAccountTemplate, listAccountTemplates } from './account-templates.controller.js';

export const accountTemplatesRouter = Router();

// Organisation Settings -> Chart of Accounts Templates (M16.2.1). Same bar
// as Roles & Permissions / Approval & Acceptance: OWNER/ADMIN only — this
// is an organisation-wide starting point for every scheme's chart of
// accounts, not a per-property operational action (provisioning a
// property FROM a template is financials.manage, under
// /properties/:propertyId/financials/accounts/provision-from-template).
accountTemplatesRouter.use(authenticate, requireOrgRole(['OWNER', 'ADMIN']));

accountTemplatesRouter.get('/', asyncHandler(listAccountTemplates));
accountTemplatesRouter.post('/', asyncHandler(createAccountTemplate));
