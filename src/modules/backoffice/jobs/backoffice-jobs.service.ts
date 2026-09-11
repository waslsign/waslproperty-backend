import type { DeliveryStatus, PlatformRole, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../../errors/AppError.js';
import { recordPlatformActivity } from '../../../platform/audit.js';
import { maskPiiFields } from '../../../platform/privacy-policy.js';

const DELIVERY_STATUSES: DeliveryStatus[] = ['PENDING', 'SENDING', 'SENT', 'DELIVERED', 'FAILED'];

/** The operational view of the real M10 communication delivery pipeline —
 * not a generic job queue. The only asynchronous work this application has
 * today is CommunicationDelivery processing, run by the in-process
 * scheduler (see communications.delivery.ts). */
export class BackofficeJobsService {
  constructor(private readonly prisma: PrismaClient) {}

  async getStatusCounts() {
    const counts = await this.prisma.communicationDelivery.groupBy({
      by: ['status'],
      _count: true,
    });
    const byStatus: Record<string, number> = Object.fromEntries(
      DELIVERY_STATUSES.map((s) => [s, 0]),
    );
    for (const row of counts) {
      byStatus[row.status] = row._count;
    }
    return byStatus;
  }

  async listDeliveries(status: DeliveryStatus, capabilities: readonly string[], limit = 50) {
    const deliveries = await this.prisma.communicationDelivery.findMany({
      where: { status },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        communicationRecipient: {
          include: {
            communication: {
              select: {
                id: true,
                title: true,
                organisation: { select: { id: true, name: true } },
              },
            },
            contact: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    return deliveries.map((d) => ({
      id: d.id,
      channel: d.channel,
      status: d.status,
      attemptedAt: d.attemptedAt,
      failureReason: d.failureReason,
      communication: d.communicationRecipient.communication,
      recipient: maskPiiFields('PropertyContact', d.communicationRecipient.contact, capabilities),
    }));
  }

  async listScheduledCommunications(limit = 50) {
    return this.prisma.communication.findMany({
      where: { status: 'SCHEDULED' },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
      include: {
        organisation: { select: { id: true, name: true } },
        _count: { select: { recipients: true } },
      },
    });
  }

  /** Re-queues a failed delivery by resetting it to PENDING for the
   * scheduler's next tick — the same mechanism a fresh delivery uses, not a
   * separate "retry" code path. */
  async retryDelivery(
    deliveryId: string,
    actor: { userId: string; platformRole: PlatformRole },
  ) {
    const delivery = await this.prisma.communicationDelivery.findUnique({
      where: { id: deliveryId },
      include: { communicationRecipient: { select: { communicationId: true } } },
    });
    if (!delivery) throw new NotFoundError('Delivery not found');
    if (delivery.status !== 'FAILED') {
      throw new ConflictError('Only a failed delivery can be retried');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.communicationDelivery.update({
        where: { id: deliveryId },
        data: { status: 'PENDING', failureReason: null, attemptedAt: null, failedAt: null },
      });

      await recordPlatformActivity(tx, {
        actorUserId: actor.userId,
        platformRole: actor.platformRole,
        action: 'delivery.retried',
        entityType: 'CommunicationDelivery',
        entityId: deliveryId,
        reason: 'Manual retry from Backoffice Jobs',
      });

      return updated;
    });
  }
}
