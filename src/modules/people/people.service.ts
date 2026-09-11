import type { Prisma, PrismaClient } from '@prisma/client';
import { recordActivity } from '../activity/activity.js';
import { ConflictError, NotFoundError } from '../../errors/AppError.js';
import { notifyUser } from '../notifications/notifications.js';
import type { PaginatedResult, PaginationQuery } from '../../lib/pagination.js';
import type {
  AddPersonInput,
  AssignExistingPersonInput,
  PeopleDirectoryQuery,
  UpdateMembershipInput,
} from './people.schemas.js';

const membershipInclude = {
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
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

  /** Attaches a contact that already exists in the organisation's directory
   * to this property/space — the counterpart to addPerson, which always
   * creates a brand-new contact. Never lets a manager recreate a person
   * just to associate them elsewhere. */
  async assignExistingPerson(
    organisationId: string,
    actorUserId: string,
    propertyId: string,
    input: AssignExistingPersonInput,
  ) {
    const property = await this.assertPropertyInOrg(organisationId, propertyId);
    const contact = await this.prisma.propertyContact.findFirst({
      where: { id: input.contactId, organisationId },
    });
    if (!contact) {
      throw new NotFoundError('Person not found');
    }

    const space = input.spaceId
      ? await this.assertSpaceInProperty(organisationId, propertyId, input.spaceId)
      : null;

    return this.prisma.$transaction(async (tx) => {
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

      if (contact.userId) {
        await notifyUser(tx, {
          organisationId,
          userId: contact.userId,
          title: `You've been added to ${property.name}${space ? ` · ${space.name}` : ''}`,
          entityType: 'Property',
          entityId: propertyId,
        });
      }

      return membership;
    });
  }

  /** Free-text search across the organisation's contact directory —
   * independent of any existing membership, so a person with zero current
   * memberships is still findable (e.g. to assign them somewhere new). */
  async searchContacts(organisationId: string, search: string) {
    return this.prisma.propertyContact.findMany({
      where: {
        organisationId,
        status: 'ACTIVE',
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
      take: 20,
      orderBy: { firstName: 'asc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        memberships: {
          where: { status: 'ACTIVE' },
          take: 1,
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            property: { select: { id: true, name: true } },
            space: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /** Changes a membership's role and/or space assignment. The property and
   * the person it belongs to never change here — that's a different
   * membership, not an edit of this one. */
  async updateMembership(
    organisationId: string,
    actorUserId: string,
    membershipId: string,
    input: UpdateMembershipInput,
  ) {
    const membership = await this.prisma.propertyMembership.findFirst({
      where: { id: membershipId, organisationId },
      include: { contact: true },
    });
    if (!membership) {
      throw new NotFoundError('Membership not found');
    }
    if (membership.status !== 'ACTIVE') {
      throw new ConflictError('Cannot change a membership that has already ended');
    }
    if (input.spaceId) {
      await this.assertSpaceInProperty(organisationId, membership.propertyId, input.spaceId);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.propertyMembership.update({
        where: { id: membershipId },
        data: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.spaceId !== undefined ? { spaceId: input.spaceId } : {}),
        },
        include: membershipInclude,
      });

      const fullName = `${membership.contact.firstName} ${membership.contact.lastName}`;
      await recordActivity(tx, {
        organisationId,
        propertyId: membership.propertyId,
        spaceId: updated.spaceId,
        actorUserId,
        eventType: 'MEMBERSHIP_UPDATED',
        entityType: 'PropertyMembership',
        entityId: membershipId,
        title: `${fullName}'s membership updated`,
        metadata: { role: updated.role, spaceId: updated.spaceId },
      });

      return updated;
    });
  }

  /** Ends a membership — never a hard delete, so the relationship's history
   * stays knowable (important later for tenancy/ownership history). Every
   * resident-facing query already filters to status: 'ACTIVE', so this is
   * enough on its own to remove the person's access to this specific
   * property/space — without touching their account or any other,
   * still-valid membership they may separately hold. */
  async endMembership(organisationId: string, actorUserId: string, membershipId: string) {
    const membership = await this.prisma.propertyMembership.findFirst({
      where: { id: membershipId, organisationId },
      include: {
        contact: true,
        property: { select: { id: true, name: true } },
        space: { select: { id: true, name: true } },
      },
    });
    if (!membership) {
      throw new NotFoundError('Membership not found');
    }
    if (membership.status === 'ENDED') {
      throw new ConflictError('This membership has already ended');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.propertyMembership.update({
        where: { id: membershipId },
        data: { status: 'ENDED', endDate: new Date() },
        include: membershipInclude,
      });

      const fullName = `${membership.contact.firstName} ${membership.contact.lastName}`;
      await recordActivity(tx, {
        organisationId,
        propertyId: membership.propertyId,
        spaceId: membership.spaceId,
        actorUserId,
        eventType: 'MEMBERSHIP_ENDED',
        entityType: 'PropertyMembership',
        entityId: membershipId,
        title: `${fullName}'s membership ended`,
        metadata: { role: membership.role },
      });

      if (membership.contact.userId) {
        await notifyUser(tx, {
          organisationId,
          userId: membership.contact.userId,
          title: `Your access to ${membership.property.name}${membership.space ? ` · ${membership.space.name}` : ''} has ended`,
          entityType: 'Property',
          entityId: membership.propertyId,
        });
      }

      return updated;
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
