import { getPrismaClient } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { ReminderDispatchService } from './reminder-dispatch.service.js';
import { ReminderEligibilityService } from './reminder-eligibility.service.js';

/**
 * M16.8 — two in-process schedulers, same `setInterval` + `.unref()`
 * pattern as InProcessComplianceScheduler/InProcessDeliveryScheduler
 * elsewhere in this codebase (a durable job/outbox table would be the
 * production-grade choice, but this MVP follows the existing in-process
 * convention rather than introducing a new mechanism). Both are idempotent
 * across repeated/concurrent runs — see ReminderEligibilityService.evaluate
 * (per-(lot,stage) dedup check) and ReminderDispatchService.processDue
 * (atomic APPROVED -> QUEUED claim) — and neither ever auto-approves or
 * auto-dispatches on its own: the eligibility scheduler only ever produces
 * reviewable candidates, and the dispatch scheduler only ever processes
 * reminders a human has already approved, with deliveryEnabled explicitly
 * on for that property (and EMAIL_SEND_DISABLED respected as a hard stop
 * inside dispatchOne). No catch-up mass dispatch after downtime — each
 * tick only processes what is currently APPROVED/due, nothing is queued
 * retroactively for missed ticks.
 */

export interface ReminderScheduler {
  start(): void;
  stop(): void;
}

/** Daily-ish eligibility evaluation across every property with a
 * `ReminderPolicy.enabled` row — a long interval is appropriate since
 * eligibility is evaluated once per property-local day (ADR-029), not a
 * near-real-time concern. */
export class InProcessReminderEligibilityScheduler implements ReminderScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly service: ReminderEligibilityService,
    private readonly intervalMs = 6 * 60 * 60 * 1000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.service.evaluateAllEnabledProperties().catch((err) => {
        logger.error({ err }, 'Reminder eligibility evaluation failed');
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

/** Dispatch worker poll — mirrors InProcessDeliveryScheduler's shorter
 * interval, since an approved reminder should go out reasonably promptly
 * once a manager has approved it (subject to EMAIL_SEND_DISABLED and each
 * property's own deliveryEnabled switch). */
export class InProcessReminderDispatchScheduler implements ReminderScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly service: ReminderDispatchService,
    private readonly intervalMs = 30_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.service.processDue().catch((err) => {
        logger.error({ err }, 'Reminder dispatch processing failed');
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

let eligibilityScheduler: InProcessReminderEligibilityScheduler | undefined;
let dispatchScheduler: InProcessReminderDispatchScheduler | undefined;

export function getReminderEligibilityScheduler(): InProcessReminderEligibilityScheduler {
  if (!eligibilityScheduler) {
    eligibilityScheduler = new InProcessReminderEligibilityScheduler(
      new ReminderEligibilityService(getPrismaClient()),
    );
  }
  return eligibilityScheduler;
}

export function getReminderDispatchScheduler(): InProcessReminderDispatchScheduler {
  if (!dispatchScheduler) {
    dispatchScheduler = new InProcessReminderDispatchScheduler(new ReminderDispatchService(getPrismaClient()));
  }
  return dispatchScheduler;
}
