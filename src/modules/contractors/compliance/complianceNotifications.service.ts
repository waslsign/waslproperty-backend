import type { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { env } from '../../../config/env.js';
import { notifyOrgStaff } from '../../notifications/notifications.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The time-based half of contractor compliance notifications — credential
 * rejection is notified immediately at the point of action (see
 * ContractorCredentialsService.reject); expiring-soon/expired are facts
 * about the clock, not an action, so they need a periodic check instead.
 * Each credential is notified at most once per expiry-cycle-per-state (see
 * expiringSoonNotifiedAt/expiredNotifiedAt's own schema doc comment) — this
 * is the only thing that makes repeat ticks safe to run without spamming
 * the same "expires in 12 days" message every few hours.
 */
export class ContractorComplianceNotificationService {
  constructor(private readonly prisma: PrismaClient) {}

  async checkExpiringAndExpiredCredentials(now = new Date()): Promise<{ notified: number }> {
    let notified = 0;
    notified += await this.notifyExpiringSoon(now);
    notified += await this.notifyExpired(now);
    return { notified };
  }

  private async notifyExpiringSoon(now: Date): Promise<number> {
    const warnAt = new Date(now.getTime() + env.CREDENTIAL_EXPIRING_SOON_DAYS * DAY_MS);
    const rows = await this.prisma.contractorCredential.findMany({
      where: {
        verificationStatus: 'VERIFIED',
        expiresAt: { gte: now, lte: warnAt },
        expiringSoonNotifiedAt: null,
      },
      select: {
        id: true,
        type: true,
        expiresAt: true,
        contractor: { select: { id: true, name: true, organisationId: true } },
      },
    });

    for (const credential of rows) {
      const daysLeft = Math.max(
        0,
        Math.round(((credential.expiresAt as Date).getTime() - now.getTime()) / DAY_MS),
      );
      await this.prisma.$transaction(async (tx) => {
        await notifyOrgStaff(tx, credential.contractor.organisationId, {
          title: `${credential.contractor.name}'s ${credential.type} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
          entityType: 'Contractor',
          entityId: credential.contractor.id,
        });
        await tx.contractorCredential.update({
          where: { id: credential.id },
          data: { expiringSoonNotifiedAt: now },
        });
      });
    }
    return rows.length;
  }

  private async notifyExpired(now: Date): Promise<number> {
    const rows = await this.prisma.contractorCredential.findMany({
      where: {
        verificationStatus: 'VERIFIED',
        expiresAt: { lt: now },
        expiredNotifiedAt: null,
      },
      select: {
        id: true,
        type: true,
        contractor: { select: { id: true, name: true, organisationId: true } },
      },
    });

    for (const credential of rows) {
      await this.prisma.$transaction(async (tx) => {
        await notifyOrgStaff(tx, credential.contractor.organisationId, {
          title: `${credential.contractor.name}'s ${credential.type} has expired`,
          entityType: 'Contractor',
          entityId: credential.contractor.id,
        });
        await tx.contractorCredential.update({
          where: { id: credential.id },
          data: { expiredNotifiedAt: now },
        });
      });
    }
    return rows.length;
  }
}

export interface ComplianceScheduler {
  start(): void;
  stop(): void;
}

/** Same in-process setInterval pattern as
 * communications.delivery.ts's InProcessDeliveryScheduler — deliberately
 * a much longer interval, since credential expiry is a slow-moving fact
 * (checked in days, not seconds) and nothing here needs near-real-time
 * delivery the way scheduled announcements do. */
export class InProcessComplianceScheduler implements ComplianceScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly service: ContractorComplianceNotificationService,
    private readonly intervalMs = 6 * 60 * 60 * 1000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.service.checkExpiringAndExpiredCredentials().catch((err) => {
        logger.error({ err }, 'Contractor compliance notification check failed');
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

let scheduler: InProcessComplianceScheduler | undefined;

export function getComplianceScheduler(): InProcessComplianceScheduler {
  if (!scheduler) {
    scheduler = new InProcessComplianceScheduler(
      new ContractorComplianceNotificationService(getPrismaClient()),
    );
  }
  return scheduler;
}
