import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { rolePermissionsRouter } from '../role-permissions/role-permissions.routes.js';
import { getCurrentOrganisation, updateOrganisation } from './organisations.controller.js';

export const organisationsRouter = Router();

organisationsRouter.get('/me', authenticate, asyncHandler(getCurrentOrganisation));
organisationsRouter.patch(
  '/me',
  authenticate,
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(updateOrganisation),
);

// Organisation Settings -> Roles & Permissions.
organisationsRouter.use('/me/role-permissions', rolePermissionsRouter);
