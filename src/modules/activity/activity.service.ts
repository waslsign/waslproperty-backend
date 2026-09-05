import type { Prisma, PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../errors/AppError.js';
import type { PaginatedResult, PaginationQuery } from '../../lib/pagination.js';

export class ActivityService {
  constructor(private readonly prisma: PrismaClient) {}

  async listForProperty(organisationId: string, propertyId: string, query: PaginationQuery) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, organisationId },
    });
    if (!property) {
      throw new NotFoundError('Property not found');
    }

    return this.paginate({ organisationId, propertyId }, query);
  }

  async listForSpace(organisationId: string, spaceId: string, query: PaginationQuery) {
    const space = await this.prisma.space.findFirst({ where: { id: spaceId, organisationId } });
    if (!space) {
      throw new NotFoundError('Space not found');
    }

    return this.paginate({ organisationId, spaceId }, query);
  }

  private async paginate(
    where: Prisma.ActivityEventWhereInput,
    query: PaginationQuery,
  ): Promise<PaginatedResult<Prisma.ActivityEventGetPayload<object>>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.activityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.activityEvent.count({ where }),
    ]);

    return { items, page: query.page, pageSize: query.pageSize, total };
  }
}
