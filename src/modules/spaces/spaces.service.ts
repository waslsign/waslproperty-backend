import type { Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import type { PaginatedResult, PaginationQuery } from '../../lib/pagination.js';
import type { CreateSpaceInput, UpdateSpaceInput } from './spaces.schemas.js';

export class SpacesService {
  constructor(private readonly prisma: PrismaClient) {}

  private async assertPropertyInOrg(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, organisationId },
    });
    if (!property) {
      throw new NotFoundError('Property not found');
    }
    return property;
  }

  async listByProperty(
    organisationId: string,
    propertyId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResult<Prisma.SpaceGetPayload<object>>> {
    await this.assertPropertyInOrg(organisationId, propertyId);

    const where: Prisma.SpaceWhereInput = {
      propertyId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.space.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.space.count({ where }),
    ]);

    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async create(organisationId: string, propertyId: string, input: CreateSpaceInput) {
    await this.assertPropertyInOrg(organisationId, propertyId);

    const clash = await this.prisma.space.findUnique({
      where: { propertyId_code: { propertyId, code: input.code } },
    });
    if (clash) {
      throw new ConflictError(`A space with code "${input.code}" already exists on this property`);
    }

    return this.prisma.space.create({
      data: { organisationId, propertyId, ...input },
    });
  }

  async getById(organisationId: string, spaceId: string) {
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, organisationId },
      include: { property: { select: { id: true, name: true, code: true } } },
    });
    if (!space) {
      throw new NotFoundError('Space not found');
    }
    return space;
  }

  async update(organisationId: string, spaceId: string, input: UpdateSpaceInput) {
    const existing = await this.getById(organisationId, spaceId);

    if (input.code) {
      const clash = await this.prisma.space.findFirst({
        where: { propertyId: existing.propertyId, code: input.code, NOT: { id: spaceId } },
      });
      if (clash) {
        throw new ConflictError(
          `A space with code "${input.code}" already exists on this property`,
        );
      }
    }

    return this.prisma.space.update({
      where: { id: spaceId },
      data: input,
    });
  }
}
