import { Router } from 'express';

export const apiV1Router = Router();

apiV1Router.get('/ping', (_req, res) => {
  res.json({ pong: true });
});
