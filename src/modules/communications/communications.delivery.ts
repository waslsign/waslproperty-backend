import type { Communication, PrismaClient } from '@prisma/client';
import { recordActivity } from '../activity/activity.js';
import { emailService } from '../../lib/email.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { notifyUser } from '../notifications/notifications.js';
import { AudienceResolver, type AudienceCriteria, type ResolvedRecipient } from './communications.audience.js';
import { renderAnnouncementEmail } from './communications.email.js';

/**
 * The processing side of communication delivery, deliberately behind this
 * interface so the MVP in-process poller (InProcessDeliveryScheduler below)
 * can later be swapped for SQS/EventBridge/Lambda or another worker without
 * the Communication/CommunicationRecipient/CommunicationDelivery domain
 * model — or the CommunicationDeliveryService that does the actual work —
 * changing at all. Whatever triggers it, delivery always goes through
 * CommunicationDeliveryService.processDue / .deliverOne.
 */
export interface DeliveryScheduler {
  start(): void;
  stop(): void;
}

/**
 * Resolves the audience, creates the per-recipient/per-channel rows
 * (idempotently — safe to re-run against a partially-processed
 * communication after a crash or restart), sends in-app notifications and
 * emails, and marks the communication SENT. Email sending happens only
 * after the DB transaction committing recipients/deliveries/SENT status —
 * an SMTP failure updates that one recipient's delivery row, never the
 * announcement itself (same "never let mail failure corrupt the record"
 * principle as invites.service.ts).
 */
export class CommunicationDeliveryService {
  private readonly audience: AudienceResolver;

  constructor(private readonly prisma: PrismaClient) {
    this.audience = new AudienceResolver(prisma);
  }

  /** Atomically claims up to `batchSize` due communications so a second
   * concurrent caller (e.g. a rolling deploy with two instances briefly
   * overlapping) can never double-process the same one. */
  async processDue(now = new Date(), batchSize = 10): Promise<{ processed: number }> {
    const due = await this.prisma.communication.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      take: batchSize,
      select: { id: true },
    });

    let processed = 0;
    for (const { id } of due) {
      const claim = await this.prisma.communication.updateMany({
        where: { id, status: 'SCHEDULED' },
        data: { status: 'SENDING' },
      });
      if (claim.count === 0) continue; // already claimed elsewhere

      await this.deliverOne(id);
      processed++;
    }
    return { processed };
  }

  async deliverOne(communicationId: string): Promise<void> {
    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
    });
    if (!communication) return;

    try {
      const criteria = communication.audienceCriteria as unknown as AudienceCriteria;
      const recipients = await this.audience.resolve(communication.organisationId, criteria);

      await this.prisma.$transaction(async (tx) => {
        for (const recipient of recipients) {
          const recipientRow = await tx.communicationRecipient.upsert({
            where: {
              communicationId_contactId: { communicationId, contactId: recipient.contactId },
            },
            update: {},
            create: {
              communicationId,
              contactId: recipient.contactId,
              userId: recipient.userId,
              propertyId: recipient.propertyId,
              spaceId: recipient.spaceId,
            },
          });

          for (const channel of communication.channels) {
            if (channel === 'WHATSAPP') continue; // never attempted — not live yet
            // An IN_APP delivery is only meaningful for a recipient who
            // actually has portal access — with no userId there is no
            // inbox to deliver to, so no placeholder row is created for
            // that channel rather than leaving a permanently-PENDING one.
            if (channel === 'IN_APP' && !recipient.userId) continue;
            await tx.communicationDelivery.upsert({
              where: {
                communicationRecipientId_channel: {
                  communicationRecipientId: recipientRow.id,
                  channel,
                },
              },
              update: {},
              create: { communicationRecipientId: recipientRow.id, channel, status: 'PENDING' },
            });
          }

          if (communication.channels.includes('IN_APP') && recipient.userId) {
            await notifyUser(tx, {
              organisationId: communication.organisationId,
              userId: recipient.userId,
              title: communication.title,
              body: communication.body,
              entityType: 'Communication',
              entityId: communication.id,
              sourceCommunicationId: communication.id,
            });
            await tx.communicationDelivery.update({
              where: {
                communicationRecipientId_channel: {
                  communicationRecipientId: recipientRow.id,
                  channel: 'IN_APP',
                },
              },
              data: { status: 'DELIVERED', sentAt: new Date(), deliveredAt: new Date() },
            });
          }
        }

        await recordActivity(tx, {
          organisationId: communication.organisationId,
          actorUserId: communication.createdByUserId,
          eventType: 'ANNOUNCEMENT_SENT',
          entityType: 'Communication',
          entityId: communication.id,
          title: `Announcement sent: ${communication.title}`,
          description: `${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`,
        });

        await tx.communication.update({
          where: { id: communicationId },
          data: { status: 'SENT', sentAt: new Date() },
        });
      });

      if (communication.channels.includes('EMAIL')) {
        await this.sendEmails(communication, recipients);
      }
    } catch (err) {
      await this.prisma.communication.update({
        where: { id: communicationId },
        data: { status: 'FAILED' },
      });
      logger.error({ err, communicationId }, 'Failed to process communication delivery');
    }
  }

  private async sendEmails(communication: Communication, recipients: ResolvedRecipient[]) {
    const organisation = await this.prisma.organisation.findUnique({
      where: { id: communication.organisationId },
      select: { name: true },
    });

    await Promise.allSettled(
      recipients.map(async (recipient) => {
        const recipientRow = await this.prisma.communicationRecipient.findUnique({
          where: {
            communicationId_contactId: {
              communicationId: communication.id,
              contactId: recipient.contactId,
            },
          },
        });
        if (!recipientRow) return;

        try {
          const rendered = renderAnnouncementEmail({
            title: communication.title,
            body: communication.body,
            organisationName: organisation?.name ?? 'Wasl Property',
            recipientFirstName: recipient.firstName,
          });
          await emailService.send({
            to: recipient.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          });
          await this.prisma.communicationDelivery.update({
            where: {
              communicationRecipientId_channel: {
                communicationRecipientId: recipientRow.id,
                channel: 'EMAIL',
              },
            },
            data: { status: 'SENT', attemptedAt: new Date(), sentAt: new Date() },
          });
        } catch (err) {
          logger.error(
            { err, communicationId: communication.id, contactId: recipient.contactId },
            'Failed to send announcement email',
          );
          await this.prisma.communicationDelivery.update({
            where: {
              communicationRecipientId_channel: {
                communicationRecipientId: recipientRow.id,
                channel: 'EMAIL',
              },
            },
            data: {
              status: 'FAILED',
              attemptedAt: new Date(),
              failedAt: new Date(),
              failureReason: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }),
    );
  }
}

/**
 * MVP scheduler: a plain in-process interval poller. Deliberately the
 * *only* thing that knows delivery is triggered on a timer — swapping this
 * for an SQS-consumer or EventBridge-scheduled Lambda later means writing a
 * new DeliveryScheduler and calling the same CommunicationDeliveryService,
 * not touching the domain model or the service itself.
 */
export interface DeliverySchedulerStatus {
  running: boolean;
  intervalMs: number;
  lastTickAt: Date | null;
}

export class InProcessDeliveryScheduler implements DeliveryScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTickAt: Date | null = null;

  constructor(
    private readonly deliveryService: CommunicationDeliveryService,
    private readonly intervalMs = 20_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.lastTickAt = new Date();
      this.deliveryService.processDue().catch((err) => {
        logger.error({ err }, 'Communication delivery poll failed');
      });
    }, this.intervalMs);
    // Don't hold the process open just for this timer in tests/scripts.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Real, genuinely-knowable state only — never a fabricated worker-pool
   * or cluster metric. The Backoffice Jobs screen reads this directly. */
  getStatus(): DeliverySchedulerStatus {
    return { running: this.timer !== undefined, intervalMs: this.intervalMs, lastTickAt: this.lastTickAt };
  }
}

let scheduler: InProcessDeliveryScheduler | undefined;

/** One scheduler instance per process, shared between main.ts (which
 * starts it) and the Backoffice Jobs module (which only reads its status
 * — it never starts a second poller). */
export function getDeliveryScheduler(): InProcessDeliveryScheduler {
  if (!scheduler) {
    scheduler = new InProcessDeliveryScheduler(new CommunicationDeliveryService(getPrismaClient()));
  }
  return scheduler;
}
