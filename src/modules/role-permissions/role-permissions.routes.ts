import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  getRolePermissions,
  resetRolePermissions,
  updateRolePermissions,
} from './role-permissions.controller.js';

export const rolePermissionsRouter = Router();

// Organisation Settings -> Roles & Permissions. Only organisation-level
// administrators may view or change role configuration — never a
// property-scoped manager, and never a resident. This is a genuinely
// organisation-wide setting with no propertyId to scope against, so
// requireOrgRole (not requireCapability) is correct here, same as
// creating a brand-new property.
rolePermissionsRouter.use(authenticate, requireOrgRole(['OWNER', 'ADMIN']));

rolePermissionsRouter.get('/', asyncHandler(getRolePermissions));
rolePermissionsRouter.put('/:role', asyncHandler(updateRolePermissions));
rolePermissionsRouter.post('/:role/reset', asyncHandler(resetRolePermissions));
