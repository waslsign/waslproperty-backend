import { createApp } from './app.js';
import { env } from './config/env.js';
import { getPrismaClient } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import {
  CommunicationDeliveryService,
  InProcessDeliveryScheduler,
} from './modules/communications/communications.delivery.js';

const app = createApp();

// The MVP delivery worker for scheduled/queued communications — see
// communications.delivery.ts's doc comment for why this lives behind the
// DeliveryScheduler interface. Only the live server process runs it; tests
// import createApp() directly and never touch this file.
const deliveryScheduler = new InProcessDeliveryScheduler(
  new CommunicationDeliveryService(getPrismaClient()),
);
deliveryScheduler.start();

app.listen(env.PORT, () => {
  logger.info(`waslproperty-backend listening on port ${env.PORT}`);
});
