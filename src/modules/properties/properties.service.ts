import type { Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { recordActivity } from '../activity/activity.js';
import type { PaginatedResult, PaginationQuery } from '../../lib/pagination.js';
import type { CreatePropertyInput, UpdatePropertyInput } from './properties.schemas.js';

export interface PropertySummary {
  spaces: number;
  occupied: number;
  vacant: number;
  people: number;
}

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

  async create(organisationId: string, actorUserId: string, input: CreatePropertyInput) {
    const clash = await this.prisma.property.findUnique({
      where: { organisationId_code: { organisationId, code: input.code } },
    });
    if (clash) {
      throw new ConflictError(`A property with code "${input.code}" already exists`);
    }

    return this.prisma.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: { organisationId, ...input },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId: property.id,
        actorUserId,
        eventType: 'PROPERTY_CREATED',
        entityType: 'Property',
        entityId: property.id,
        title: `${property.name} created`,
      });

      return property;
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

    const [occupiedSpaces, activeContacts] = await this.prisma.$transaction([
      this.prisma.propertyMembership.findMany({
        where: {
          propertyId,
          role: { in: ['TENANT', 'RESIDENT'] },
          status: 'ACTIVE',
          spaceId: { not: null },
        },
        select: { spaceId: true },
        distinct: ['spaceId'],
      }),
      this.prisma.propertyMembership.findMany({
        where: { propertyId, status: 'ACTIVE' },
        select: { contactId: true },
        distinct: ['contactId'],
      }),
    ]);

    const spaces = property._count.spaces;
    const occupied = occupiedSpaces.length;

    const summary: PropertySummary = {
      spaces,
      occupied,
      vacant: spaces - occupied,
      people: activeContacts.length,
    };

    return { ...property, summary };
  }

  async update(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: UpdatePropertyInput,
  ) {
    const existing = await this.prisma.property.findFirst({
      where: { id: propertyId, organisationId },
    });
    if (!existing) {
      throw new NotFoundError('Property not found');
    }

    if (input.code) {
      const clash = await this.prisma.property.findFirst({
        where: { organisationId, code: input.code, NOT: { id: propertyId } },
      });
      if (clash) {
        throw new ConflictError(`A property with code "${input.code}" already exists`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const property = await tx.property.update({
        where: { id: propertyId },
        data: input,
      });

      await recordActivity(tx, {
        organisationId,
        propertyId: property.id,
        actorUserId,
        eventType: 'PROPERTY_UPDATED',
        entityType: 'Property',
        entityId: property.id,
        title: `${property.name} updated`,
        description: `Updated: ${Object.keys(input).join(', ')}`,
      });

      return property;
    });
  }
}

type PaginatedPropertiesResult = Promise<
  PaginatedResult<Prisma.PropertyGetPayload<{ include: { _count: { select: { spaces: true } } } }>>
>;
