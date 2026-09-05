import type { Prisma, PrismaClient } from '@prisma/client';
import { recordActivity } from '../activity/activity.js';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { getOccupiedSpaceIds, type Occupancy } from '../../lib/occupancy.js';
import type { PaginatedResult, PaginationQuery } from '../../lib/pagination.js';
import type { CreateSpaceInput, UpdateSpaceInput } from './spaces.schemas.js';

export interface SpaceKeyPerson {
  id: string;
  firstName: string;
  lastName: string;
}

export interface SpaceKeyPeople {
  owners: SpaceKeyPerson[];
  tenants: SpaceKeyPerson[];
  residents: SpaceKeyPerson[];
}

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
  ): Promise<PaginatedResult<Prisma.SpaceGetPayload<object> & { occupancy: Occupancy }>> {
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

    const occupiedIds = await getOccupiedSpaceIds(
      this.prisma,
      items.map((space) => space.id),
    );

    return {
      items: items.map((space) => ({
        ...space,
        occupancy: occupiedIds.has(space.id) ? 'OCCUPIED' : ('VACANT' as Occupancy),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async create(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: CreateSpaceInput,
  ) {
    await this.assertPropertyInOrg(organisationId, propertyId);

    const clash = await this.prisma.space.findUnique({
      where: { propertyId_code: { propertyId, code: input.code } },
    });
    if (clash) {
      throw new ConflictError(`A space with code "${input.code}" already exists on this property`);
    }

    return this.prisma.$transaction(async (tx) => {
      const space = await tx.space.create({
        data: { organisationId, propertyId, ...input },
      });

      await recordActivity(tx, {
        organisationId,
        propertyId,
        spaceId: space.id,
        actorUserId,
        eventType: 'SPACE_CREATED',
        entityType: 'Space',
        entityId: space.id,
        title: `${space.name} created`,
      });

      return space;
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

    const activeMemberships = await this.prisma.propertyMembership.findMany({
      where: { spaceId, status: 'ACTIVE', role: { in: ['OWNER', 'TENANT', 'RESIDENT'] } },
      include: { contact: { select: { id: true, firstName: true, lastName: true } } },
    });

    const keyPeople: SpaceKeyPeople = { owners: [], tenants: [], residents: [] };
    for (const membership of activeMemberships) {
      const person: SpaceKeyPerson = {
        id: membership.contact.id,
        firstName: membership.contact.firstName,
        lastName: membership.contact.lastName,
      };
      if (membership.role === 'OWNER') keyPeople.owners.push(person);
      else if (membership.role === 'TENANT') keyPeople.tenants.push(person);
      else if (membership.role === 'RESIDENT') keyPeople.residents.push(person);
    }

    const occupancy: Occupancy =
      keyPeople.tenants.length > 0 || keyPeople.residents.length > 0 ? 'OCCUPIED' : 'VACANT';

    return { ...space, occupancy, ...keyPeople };
  }

  async update(
    organisationId: string,
    actorUserId: string,
    spaceId: string,
    input: UpdateSpaceInput,
  ) {
    const existing = await this.prisma.space.findFirst({ where: { id: spaceId, organisationId } });
    if (!existing) {
      throw new NotFoundError('Space not found');
    }

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

    return this.prisma.$transaction(async (tx) => {
      const space = await tx.space.update({
        where: { id: spaceId },
        data: input,
      });

      await recordActivity(tx, {
        organisationId,
        propertyId: space.propertyId,
        spaceId: space.id,
        actorUserId,
        eventType: 'SPACE_UPDATED',
        entityType: 'Space',
        entityId: space.id,
        title: `${space.name} updated`,
        description: `Updated: ${Object.keys(input).join(', ')}`,
      });

      return space;
    });
  }
}
