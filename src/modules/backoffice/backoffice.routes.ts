import { Router } from 'express';
import { platformAuthRouter } from './auth/platform-auth.routes.js';
import { backofficeDashboardRouter } from './dashboard/backoffice-dashboard.routes.js';
import { backofficeSearchRouter } from './search/backoffice-search.routes.js';
import { backofficeOrganisationsRouter } from './organisations/backoffice-organisations.routes.js';
import { backofficeUsersRouter } from './users/backoffice-users.routes.js';
import { backofficePropertyDataRouter } from './property-data/backoffice-property-data.routes.js';
import { backofficeOperationsRouter } from './operations/backoffice-operations.routes.js';
import { backofficeCommunicationsRouter } from './communications/backoffice-communications.routes.js';
import { backofficeJobsRouter } from './jobs/backoffice-jobs.routes.js';
import { backofficeIntegrationsRouter } from './integrations/backoffice-integrations.routes.js';
import { backofficeAuditRouter } from './audit/backoffice-audit.routes.js';
import { backofficePlatformUsersRouter } from './platform-users/backoffice-platform-users.routes.js';
import { backofficeDataExplorerRouter } from './data-explorer/backoffice-data-explorer.routes.js';
import { backofficeSqlConsoleRouter } from './sql-console/backoffice-sql-console.routes.js';

/** Everything under /api/v1/backoffice — a boundary completely separate
 * from customer-facing routes. Every sub-router is guarded by
 * authenticatePlatform + requirePlatformCapability, never requireOrgRole. */
export const backofficeRouter = Router();

backofficeRouter.use('/auth', platformAuthRouter);
backofficeRouter.use('/dashboard', backofficeDashboardRouter);
backofficeRouter.use('/search', backofficeSearchRouter);
backofficeRouter.use('/organisations', backofficeOrganisationsRouter);
backofficeRouter.use('/users', backofficeUsersRouter);
backofficeRouter.use('/property-data', backofficePropertyDataRouter);
backofficeRouter.use('/operations', backofficeOperationsRouter);
backofficeRouter.use('/communications', backofficeCommunicationsRouter);
backofficeRouter.use('/jobs', backofficeJobsRouter);
backofficeRouter.use('/integrations', backofficeIntegrationsRouter);
backofficeRouter.use('/audit', backofficeAuditRouter);
backofficeRouter.use('/platform-users', backofficePlatformUsersRouter);
backofficeRouter.use('/data-explorer', backofficeDataExplorerRouter);
backofficeRouter.use('/sql-console', backofficeSqlConsoleRouter);
