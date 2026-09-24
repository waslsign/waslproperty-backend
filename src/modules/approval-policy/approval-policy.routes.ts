import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  disableApprovalPolicy,
  getApprovalPolicy,
  upsertApprovalPolicy,
} from './approval-policy.controller.js';

export const approvalPolicyRouter = Router();

// Organisation Settings -> Approval & Acceptance. Genuinely organisation-
// wide business policy with no property to scope against — same bar as
// Roles & Permissions and Contractor Compliance configuration: OWNER/ADMIN
// only, not a capability. A manager who needs to know *why* a specific
// quote requires a given workflow already gets that inline on the quote
// itself (ContractorQuote.approvalPolicySnapshot) — no separate broader
// read access to the raw policy configuration is needed.
approvalPolicyRouter.use(authenticate, requireOrgRole(['OWNER', 'ADMIN']));

approvalPolicyRouter.get('/', asyncHandler(getApprovalPolicy));
approvalPolicyRouter.put('/', asyncHandler(upsertApprovalPolicy));
approvalPolicyRouter.post('/disable', asyncHandler(disableApprovalPolicy));
