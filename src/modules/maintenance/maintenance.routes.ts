import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  listMaintenanceAttachments,
  presignMaintenanceAttachments,
  registerMaintenanceAttachments,
} from './attachments.controller.js';
import {
  createMaintenanceRequest,
  getMaintenanceRequest,
  listMaintenanceRequests,
  updateMaintenanceRequest,
  updateMaintenanceRequestStatus,
} from './maintenance.controller.js';

export const maintenanceRouter = Router();

maintenanceRouter.use(authenticate);

maintenanceRouter.get('/', asyncHandler(listMaintenanceRequests));
maintenanceRouter.post('/', asyncHandler(createMaintenanceRequest));
maintenanceRouter.get('/:id', asyncHandler(getMaintenanceRequest));
maintenanceRouter.patch(
  '/:id/status',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(updateMaintenanceRequestStatus),
);
maintenanceRouter.patch(
  '/:id',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(updateMaintenanceRequest),
);

maintenanceRouter.post('/:id/attachments/presign', asyncHandler(presignMaintenanceAttachments));
maintenanceRouter.post('/:id/attachments', asyncHandler(registerMaintenanceAttachments));
maintenanceRouter.get('/:id/attachments', asyncHandler(listMaintenanceAttachments));
