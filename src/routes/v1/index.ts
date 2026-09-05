import { Router } from 'express';
import { authRouter } from '../../modules/auth/auth.routes.js';
import { organisationsRouter } from '../../modules/organisations/organisations.routes.js';
import { propertiesRouter } from '../../modules/properties/properties.routes.js';
import { spacesRouter } from '../../modules/spaces/spaces.routes.js';

export const apiV1Router = Router();

apiV1Router.get('/ping', (_req, res) => {
  res.json({ pong: true });
});

apiV1Router.use('/auth', authRouter);
apiV1Router.use('/organisations', organisationsRouter);
apiV1Router.use('/properties', propertiesRouter);
apiV1Router.use('/spaces', spacesRouter);
