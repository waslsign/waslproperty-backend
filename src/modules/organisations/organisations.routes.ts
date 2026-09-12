import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { getCurrentOrganisation, updateOrganisation } from './organisations.controller.js';

export const organisationsRouter = Router();

organisationsRouter.get('/me', authenticate, asyncHandler(getCurrentOrganisation));
organisationsRouter.patch(
  '/me',
  authenticate,
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(updateOrganisation),
);
