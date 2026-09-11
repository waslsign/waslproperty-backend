import { Router } from 'express';
import { asyncHandler } from '../../../middlewares/asyncHandler.js';
import {
  authenticatePlatform,
  requirePlatformCapability,
  requirePlatformSuperAdmin,
} from '../../../middlewares/auth.middleware.js';
import {
  deleteDataExplorerRecord,
  getDataExplorerRecord,
  listDataExplorerModels,
  listDataExplorerRecords,
  updateDataExplorerRecord,
} from './backoffice-data-explorer.controller.js';

export const backofficeDataExplorerRouter = Router();

backofficeDataExplorerRouter.use(authenticatePlatform);

backofficeDataExplorerRouter.get(
  '/models',
  requirePlatformCapability('database.view'),
  asyncHandler(listDataExplorerModels),
);
backofficeDataExplorerRouter.get(
  '/:model/records',
  requirePlatformCapability('database.view'),
  asyncHandler(listDataExplorerRecords),
);
backofficeDataExplorerRouter.get(
  '/:model/records/:id',
  requirePlatformCapability('database.view'),
  asyncHandler(getDataExplorerRecord),
);
backofficeDataExplorerRouter.patch(
  '/:model/records/:id',
  requirePlatformCapability('database.edit'),
  asyncHandler(updateDataExplorerRecord),
);
// Delete is PLATFORM_SUPER_ADMIN-exclusive, on top of database.edit — a
// stronger, deliberately narrower gate than the general edit capability,
// matching the SQL Console's precedent for irreversible operations.
backofficeDataExplorerRouter.delete(
  '/:model/records/:id',
  requirePlatformCapability('database.edit'),
  requirePlatformSuperAdmin,
  asyncHandler(deleteDataExplorerRecord),
);
