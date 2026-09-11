import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { getDeliveryScheduler } from './modules/communications/communications.delivery.js';

const app = createApp();

// The MVP delivery worker for scheduled/queued communications — see
// communications.delivery.ts's doc comment for why this lives behind the
// DeliveryScheduler interface. Only the live server process starts it; tests
// import createApp() directly and never touch this file. The Backoffice
// Jobs module reads the same shared instance's status but never starts it.
getDeliveryScheduler().start();

app.listen(env.PORT, () => {
  logger.info(`waslproperty-backend listening on port ${env.PORT}`);
});
