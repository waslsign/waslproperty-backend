import { Router } from 'express';
import { authRouter } from '../../modules/auth/auth.routes.js';
import { contractorsRouter } from '../../modules/contractors/contractors.routes.js';
import { dashboardRouter } from '../../modules/dashboard/dashboard.routes.js';
import { invitesRouter } from '../../modules/invites/invites.routes.js';
import { maintenanceRouter } from '../../modules/maintenance/maintenance.routes.js';
import { organisationsRouter } from '../../modules/organisations/organisations.routes.js';
import { peopleRouter } from '../../modules/people/people.routes.js';
import { propertiesRouter } from '../../modules/properties/properties.routes.js';
import { quotesRouter } from '../../modules/quotes/quotes.routes.js';
import { spacesRouter } from '../../modules/spaces/spaces.routes.js';
import { workOrdersRouter } from '../../modules/work-orders/work-orders.routes.js';

export const apiV1Router = Router();

apiV1Router.get('/ping', (_req, res) => {
  res.json({ pong: true });
});

apiV1Router.use('/auth', authRouter);
apiV1Router.use('/organisations', organisationsRouter);
apiV1Router.use('/properties', propertiesRouter);
apiV1Router.use('/spaces', spacesRouter);
apiV1Router.use('/people', peopleRouter);
apiV1Router.use('/maintenance-requests', maintenanceRouter);
apiV1Router.use('/invites', invitesRouter);
apiV1Router.use('/work-orders', workOrdersRouter);
apiV1Router.use('/contractors', contractorsRouter);
apiV1Router.use('/quotes', quotesRouter);
apiV1Router.use('/dashboard', dashboardRouter);
