import { Router } from 'express';
import { asyncHandler } from '../../../middlewares/asyncHandler.js';
import {
  authenticatePlatform,
  requirePlatformCapability,
  requirePlatformSuperAdmin,
} from '../../../middlewares/auth.middleware.js';
import {
  executeSqlStatement,
  getSqlConsoleConfig,
  listSqlConsoleHistory,
} from './backoffice-sql-console.controller.js';

/** Every route here is PLATFORM_SUPER_ADMIN-exclusive by explicit product
 * requirement — requirePlatformSuperAdmin is stacked in front of the normal
 * capability checks (which a broader set of roles may nominally still
 * hold) specifically so that fact can never regress silently. */
export const backofficeSqlConsoleRouter = Router();

backofficeSqlConsoleRouter.use(authenticatePlatform);
backofficeSqlConsoleRouter.use(requirePlatformSuperAdmin);

backofficeSqlConsoleRouter.get(
  '/config',
  requirePlatformCapability('database.sql.read'),
  asyncHandler(getSqlConsoleConfig),
);
backofficeSqlConsoleRouter.post(
  '/execute',
  requirePlatformCapability('database.sql.read'),
  asyncHandler(executeSqlStatement),
);
backofficeSqlConsoleRouter.get(
  '/history',
  requirePlatformCapability('database.sql.read'),
  asyncHandler(listSqlConsoleHistory),
);
