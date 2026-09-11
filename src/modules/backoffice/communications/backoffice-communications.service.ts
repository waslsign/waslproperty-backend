import type { PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../../errors/AppError.js';
import type { PaginatedResult, PaginationQuery } from '../../../lib/pagination.js';
import { maskPiiFields } from '../../../platform/privacy-policy.js';

export class BackofficeCommunicationsService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(query: PaginationQuery): Promise<PaginatedResult<unknown>> {
    const where = query.search
      ? { title: { contains: query.search, mode: 'insensitive' as const } }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.communication.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          organisation: { select: { id: true, name: true } },
          _count: { select: { recipients: true } },
        },
      }),
      this.prisma.communication.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async getDeliveries(communicationId: string, capabilities: readonly string[]) {
    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      include: { organisation: { select: { id: true, name: true } } },
    });
    if (!communication) throw new NotFoundError('Communication not found');

    const deliveries = await this.prisma.communicationDelivery.findMany({
      where: { communicationRecipient: { communicationId } },
      orderBy: { createdAt: 'desc' },
      include: {
        communicationRecipient: {
          include: { contact: { select: { firstName: true, lastName: true, email: true } } },
        },
      },
    });

    return {
      communication: {
        id: communication.id,
        title: communication.title,
        status: communication.status,
        organisation: communication.organisation,
      },
      deliveries: deliveries.map((d) => ({
        id: d.id,
        channel: d.channel,
        status: d.status,
        attemptedAt: d.attemptedAt,
        deliveredAt: d.deliveredAt,
        failureReason: d.failureReason,
        recipient: maskPiiFields('PropertyContact', d.communicationRecipient.contact, capabilities),
      })),
    };
  }
}
