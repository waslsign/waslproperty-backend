import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { getDashboard } from './dashboard.controller.js';

export const dashboardRouter = Router();

// Aggregate portfolio/cost/workflow data — staff-only, no resident access at all.
dashboardRouter.use(authenticate, requireOrgRole(['OWNER', 'ADMIN']));

dashboardRouter.get('/', asyncHandler(getDashboard));
