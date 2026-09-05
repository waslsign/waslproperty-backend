import type { Prisma, PrismaClient } from '@prisma/client';
import { recordActivity } from '../activity/activity.js';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import type { PaginatedResult, PaginationQuery } from '../../lib/pagination.js';
import type { AddPersonInput, PeopleDirectoryQuery } from './people.schemas.js';

const membershipInclude = {
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      status: true,
      userId: true,
      invites: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true, expiresAt: true },
      },
    },
  },
  property: { select: { id: true, name: true, code: true } },
  space: { select: { id: true, name: true, code: true } },
} satisfies Prisma.PropertyMembershipInclude;

function formatRoleLabel(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

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

    // PropertyContact.userId is globally unique — a User can be the portal
    // identity for at most one contact, system-wide (they may still be
    // staff in any number of other organisations; see AuthService). If
    // this email's account is already claimed by a contact elsewhere,
    // adding this person must still succeed — it just can't also grant
    // portal access here, so the auto-link is skipped rather than hitting
    // that unique constraint.
    const alreadyLinkedElsewhere =
      matchingUser && (await tx.propertyContact.findUnique({ where: { userId: matchingUser.id } }));

    return tx.propertyContact.create({
      data: {
        organisationId,
        email,
        firstName,
        lastName,
        userId: alreadyLinkedElsewhere ? undefined : matchingUser?.id,
      },
    });
  }

  async addPerson(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: AddPersonInput,
  ) {
    const property = await this.assertPropertyInOrg(organisationId, propertyId);

    const space = input.spaceId
      ? await this.assertSpaceInProperty(organisationId, propertyId, input.spaceId)
      : null;

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

      const membership = await tx.propertyMembership.create({
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

      const fullName = `${contact.firstName} ${contact.lastName}`;
      const title = space
        ? `${fullName} added to ${space.name}`
        : `${fullName} added as ${formatRoleLabel(input.role)} to ${property.name}`;

      await recordActivity(tx, {
        organisationId,
        propertyId,
        spaceId: input.spaceId ?? null,
        actorUserId,
        eventType: 'PERSON_ADDED',
        entityType: 'PropertyMembership',
        entityId: membership.id,
        title,
        metadata: { role: input.role, contactId: contact.id },
      });

      return membership;
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

  /** The caller's own active memberships — used to preselect a resident's property/space. */
  async listMyMemberships(organisationId: string, userId: string) {
    const contact = await this.prisma.propertyContact.findFirst({
      where: { organisationId, userId },
    });
    if (!contact) {
      return [];
    }

    return this.prisma.propertyMembership.findMany({
      where: { contactId: contact.id, status: 'ACTIVE' },
      include: {
        property: { select: { id: true, name: true, code: true } },
        space: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
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
