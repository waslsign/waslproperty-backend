import type { PrismaClient } from '@prisma/client';
import type { PaginatedResult, PaginationQuery } from '../../../lib/pagination.js';

/** Read-only — PlatformAuditEvent has no update/delete endpoint anywhere,
 * which is what makes it immutable, not a flag on this service. */
export class BackofficeAuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(query: PaginationQuery): Promise<PaginatedResult<unknown>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.platformAuditEvent.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actorEmployee: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.platformAuditEvent.count(),
    ]);

    return {
      items: items.map((e) => ({
        id: e.id,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        organisationId: e.organisationId,
        reason: e.reason,
        environment: e.environment,
        platformRole: e.platformRole,
        actor: `${e.actorEmployee.firstName} ${e.actorEmployee.lastName}`,
        before: e.before,
        after: e.after,
        createdAt: e.createdAt,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}
