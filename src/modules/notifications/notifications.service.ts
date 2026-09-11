import type { Prisma, PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../errors/AppError.js';
import type { PaginatedResult } from '../../lib/pagination.js';
import type { NotificationsQuery } from './notifications.schemas.js';

export class NotificationsService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(
    organisationId: string,
    userId: string,
    query: NotificationsQuery,
  ): Promise<PaginatedResult<Prisma.NotificationGetPayload<object>>> {
    const where: Prisma.NotificationWhereInput = {
      organisationId,
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async getById(organisationId: string, userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, organisationId, userId },
    });
    if (!notification) {
      throw new NotFoundError('Notification not found');
    }
    return notification;
  }

  async unreadCount(organisationId: string, userId: string) {
    const count = await this.prisma.notification.count({
      where: { organisationId, userId, readAt: null },
    });
    return { count };
  }

  async markRead(organisationId: string, userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, organisationId, userId },
    });
    if (!notification) {
      throw new NotFoundError('Notification not found');
    }
    if (notification.readAt) {
      return notification;
    }
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(organisationId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { organisationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }
}
