import type { Prisma, PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../errors/AppError.js';
import type { PaginatedResult, PaginationQuery } from '../../lib/pagination.js';

export interface ActivityQuery extends PaginationQuery {
  entityId?: string;
}

export class ActivityService {
  constructor(private readonly prisma: PrismaClient) {}

  async listForProperty(organisationId: string, propertyId: string, query: ActivityQuery) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, organisationId },
    });
    if (!property) {
      throw new NotFoundError('Property not found');
    }

    return this.paginate({ organisationId, propertyId }, query);
  }

  async listForSpace(organisationId: string, spaceId: string, query: ActivityQuery) {
    const space = await this.prisma.space.findFirst({ where: { id: spaceId, organisationId } });
    if (!space) {
      throw new NotFoundError('Space not found');
    }

    return this.paginate({ organisationId, spaceId }, query);
  }

  /** Org-wide feed, crossing property boundaries within the same org — used by the dashboard. */
  async listForOrganisation(organisationId: string, query: ActivityQuery) {
    return this.paginate({ organisationId }, query);
  }

  private async paginate(
    where: Prisma.ActivityEventWhereInput,
    query: ActivityQuery,
  ): Promise<PaginatedResult<Prisma.ActivityEventGetPayload<object>>> {
    const fullWhere: Prisma.ActivityEventWhereInput = {
      ...where,
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.activityEvent.findMany({
        where: fullWhere,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.activityEvent.count({ where: fullWhere }),
    ]);

    return { items, page: query.page, pageSize: query.pageSize, total };
  }
}
