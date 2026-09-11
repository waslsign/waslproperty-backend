import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  assignWorkOrderContractor,
  createWorkOrder,
  getWorkOrder,
  getWorkOrderByMaintenanceRequest,
  listWorkOrders,
  updateWorkOrderCost,
  updateWorkOrderStatus,
} from './work-orders.controller.js';

export const workOrdersRouter = Router();

// Work orders carry cost/contractor data — staff-only, no resident access at all.
workOrdersRouter.use(authenticate, requireOrgRole(['OWNER', 'ADMIN']));

workOrdersRouter.get('/', asyncHandler(listWorkOrders));
workOrdersRouter.post('/', asyncHandler(createWorkOrder));
workOrdersRouter.get(
  '/by-request/:maintenanceRequestId',
  asyncHandler(getWorkOrderByMaintenanceRequest),
);
workOrdersRouter.get('/:id', asyncHandler(getWorkOrder));
workOrdersRouter.patch('/:id/status', asyncHandler(updateWorkOrderStatus));
workOrdersRouter.patch('/:id/contractor', asyncHandler(assignWorkOrderContractor));
workOrdersRouter.patch('/:id/cost', asyncHandler(updateWorkOrderCost));
