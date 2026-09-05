import type { Prisma, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import type { PaginatedResult, PaginationQuery } from '../../lib/pagination.js';
import type { AddPersonInput, PeopleDirectoryQuery } from './people.schemas.js';

const membershipInclude = {
  contact: {
    select: { id: true, firstName: true, lastName: true, email: true, status: true },
  },
  property: { select: { id: true, name: true, code: true } },
  space: { select: { id: true, name: true, code: true } },
} satisfies Prisma.PropertyMembershipInclude;

export class PeopleService {
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

  private async assertSpaceInProperty(organisationId: string, propertyId: string, spaceId: string) {
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, propertyId, organisationId },
    });
    if (!space) {
      throw new NotFoundError('Space not found on this property');
    }
    return space;
  }

  private async findOrCreateContact(
    tx: Prisma.TransactionClient,
    organisationId: string,
    email: string,
    firstName: string,
    lastName: string,
  ) {
    const existing = await tx.propertyContact.findUnique({
      where: { organisationId_email: { organisationId, email } },
    });
    if (existing) {
      return existing;
    }

    const matchingUser = await tx.user.findUnique({ where: { email } });

    return tx.propertyContact.create({
      data: {
        organisationId,
        email,
        firstName,
        lastName,
        userId: matchingUser?.id,
      },
    });
  }

  async addPerson(organisationId: string, propertyId: string, input: AddPersonInput) {
    await this.assertPropertyInOrg(organisationId, propertyId);

    if (input.spaceId) {
      await this.assertSpaceInProperty(organisationId, propertyId, input.spaceId);
    }

    return this.prisma.$transaction(async (tx) => {
      const contact = await this.findOrCreateContact(
        tx,
        organisationId,
        input.email,
        input.firstName,
        input.lastName,
      );

      const existingActive = await tx.propertyMembership.findFirst({
        where: {
          contactId: contact.id,
          propertyId,
          spaceId: input.spaceId ?? null,
          role: input.role,
          status: 'ACTIVE',
        },
      });
      if (existingActive) {
        throw new ConflictError('This person already has this role for this property or space');
      }

      return tx.propertyMembership.create({
        data: {
          organisationId,
          propertyId,
          spaceId: input.spaceId ?? null,
          contactId: contact.id,
          role: input.role,
          status: 'ACTIVE',
          startDate: new Date(),
        },
        include: membershipInclude,
      });
    });
  }

  async listForProperty(organisationId: string, propertyId: string, query: PaginationQuery) {
    await this.assertPropertyInOrg(organisationId, propertyId);
    return this.paginateMemberships({ organisationId, propertyId }, query);
  }

  async listForSpace(organisationId: string, spaceId: string, query: PaginationQuery) {
    const space = await this.prisma.space.findFirst({ where: { id: spaceId, organisationId } });
    if (!space) {
      throw new NotFoundError('Space not found');
    }
    return this.paginateMemberships({ organisationId, spaceId }, query);
  }

  async listDirectory(organisationId: string, query: PeopleDirectoryQuery) {
    if (query.propertyId) {
      await this.assertPropertyInOrg(organisationId, query.propertyId);
    }

    const where: Prisma.PropertyMembershipWhereInput = {
      organisationId,
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.search
        ? {
            contact: {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    return this.paginateMemberships(where, query);
  }

  private async paginateMemberships(
    where: Prisma.PropertyMembershipWhereInput,
    query: PaginationQuery,
  ): Promise<
    PaginatedResult<Prisma.PropertyMembershipGetPayload<{ include: typeof membershipInclude }>>
  > {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.propertyMembership.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: membershipInclude,
      }),
      this.prisma.propertyMembership.count({ where }),
    ]);

    return { items, page: query.page, pageSize: query.pageSize, total };
  }
}
