import type { Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import type { PaginatedResult, PaginationQuery } from '../../lib/pagination.js';
import type { CreatePropertyInput, UpdatePropertyInput } from './properties.schemas.js';

export class PropertiesService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(organisationId: string, query: PaginationQuery): PaginatedPropertiesResult {
    const where: Prisma.PropertyWhereInput = {
      organisationId,
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
      this.prisma.property.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { spaces: true } } },
      }),
      this.prisma.property.count({ where }),
    ]);

    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async create(organisationId: string, input: CreatePropertyInput) {
    const clash = await this.prisma.property.findUnique({
      where: { organisationId_code: { organisationId, code: input.code } },
    });
    if (clash) {
      throw new ConflictError(`A property with code "${input.code}" already exists`);
    }

    return this.prisma.property.create({
      data: { organisationId, ...input },
    });
  }

  async getById(organisationId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, organisationId },
      include: { _count: { select: { spaces: true } } },
    });
    if (!property) {
      throw new NotFoundError('Property not found');
    }
    return property;
  }

  async update(organisationId: string, propertyId: string, input: UpdatePropertyInput) {
    await this.getById(organisationId, propertyId);

    if (input.code) {
      const clash = await this.prisma.property.findFirst({
        where: { organisationId, code: input.code, NOT: { id: propertyId } },
      });
      if (clash) {
        throw new ConflictError(`A property with code "${input.code}" already exists`);
      }
    }

    return this.prisma.property.update({
      where: { id: propertyId },
      data: input,
    });
  }
}

type PaginatedPropertiesResult = Promise<
  PaginatedResult<Prisma.PropertyGetPayload<{ include: { _count: { select: { spaces: true } } } }>>
>;
