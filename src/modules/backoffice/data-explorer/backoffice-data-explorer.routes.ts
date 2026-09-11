import { Router } from 'express';
import { asyncHandler } from '../../../middlewares/asyncHandler.js';
import { authenticatePlatform, requirePlatformCapability } from '../../../middlewares/auth.middleware.js';
import {
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
