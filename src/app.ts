import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { asyncHandler } from './middlewares/asyncHandler.js';
import { handleWaslSignCallback } from './modules/integrations/waslsign/waslsign.controller.js';
import { apiV1Router } from './routes/v1/index.js';

export function createApp() {
  const app = express();

  app.use(requestLogger);
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
    }),
  );

  // WaslSign webhook — MUST be registered before express.json() consumes the
  // raw body stream, same pattern WaslSign itself uses for its Stripe
  // webhook. express.raw() captures the exact bytes needed for HMAC
  // verification; JSON-parsing first and re-serializing to verify would
  // silently accept a tampered payload that happens to re-serialize the same.
  app.post(
    '/api/v1/integrations/waslsign/callback',
    express.raw({ type: 'application/json' }),
    asyncHandler(handleWaslSignCallback),
  );

  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1', apiV1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
