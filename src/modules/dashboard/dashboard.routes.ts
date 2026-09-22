import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireCapability } from '../../middlewares/authorize.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { getDashboard } from './dashboard.controller.js';

export const dashboardRouter = Router();

// Aggregate portfolio/cost/workflow data — never resident-visible. A
// property-scoped manager gets the same dashboard shape, aggregated over
// only their assigned properties — see DashboardService.getDashboard.
dashboardRouter.use(authenticate, requireCapability('analytics.view'));

dashboardRouter.get('/', asyncHandler(getDashboard));
