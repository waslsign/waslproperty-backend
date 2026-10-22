import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { getDeliveryScheduler } from './modules/communications/communications.delivery.js';
import { getComplianceScheduler } from './modules/contractors/compliance/complianceNotifications.service.js';
import {
  getReminderDispatchScheduler,
  getReminderEligibilityScheduler,
} from './modules/financials/reminder-scheduler.js';

const app = createApp();

// The MVP delivery worker for scheduled/queued communications — see
// communications.delivery.ts's doc comment for why this lives behind the
// DeliveryScheduler interface. Only the live server process starts it; tests
// import createApp() directly and never touch this file. The Backoffice
// Jobs module reads the same shared instance's status but never starts it.
getDeliveryScheduler().start();

// Same in-process pattern for contractor credential expiry notifications —
// see complianceNotifications.service.ts.
getComplianceScheduler().start();

// M16.8 — arrears reminder eligibility evaluation and dispatch worker. Both
// default to effectively inert (ReminderPolicy.enabled/deliveryEnabled are
// false until a manager explicitly turns them on for a property) — see
// reminder-scheduler.ts's doc comment.
getReminderEligibilityScheduler().start();
getReminderDispatchScheduler().start();

app.listen(env.PORT, () => {
  logger.info(`waslproperty-backend listening on port ${env.PORT}`);
});
