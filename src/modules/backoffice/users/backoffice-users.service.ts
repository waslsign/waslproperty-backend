import type { PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../../errors/AppError.js';
import type { PaginatedResult } from '../../../lib/pagination.js';
import { maskPiiFields } from '../../../platform/privacy-policy.js';
import type { BackofficeUsersQuery } from './backoffice-users.schemas.js';

export class BackofficeUsersService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(
    query: BackofficeUsersQuery,
    capabilities: readonly string[],
  ): Promise<PaginatedResult<unknown>> {
    // This directory is customer people-tracing (staff + residents) per its
    // spec — a pure WaslProperty employee with neither an OrganisationMembership
    // nor a PropertyContact belongs to Internal Users/Platform Roles instead,
    // not this list.
    const hasCustomerRelationship = {
      OR: [{ organisationMemberships: { some: {} } }, { propertyContacts: { some: {} } }],
    };
    const where = query.search
      ? {
          AND: [
            hasCustomerRelationship,
            {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' as const } },
                { lastName: { contains: query.search, mode: 'insensitive' as const } },
                { email: { contains: query.search, mode: 'insensitive' as const } },
              ],
            },
          ],
        }
      : hasCustomerRelationship;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          _count: { select: { organisationMemberships: true, propertyContacts: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((user) => {
        const masked = maskPiiFields('User', user, capabilities);
        return {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: masked.email,
          status: user.status,
          organisationCount: user._count.organisationMemberships + user._count.propertyContacts,
          createdAt: user.createdAt,
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Traces User -> Organisation -> Membership -> Property -> Space ->
   * Portal access, so support can answer "why can't this person access
   * Villa 12?" without a raw query. Staff relationships
   * (OrganisationMembership) and resident relationships (PropertyContact)
   * are both genuinely many-per-user — one User can be staff in several
   * organisations, and separately a property-scoped identity (resident or
   * operational role) in several others, at most one such identity per
   * organisation (see schema) — shown as parallel lists, not forced into
   * one uniform shape. */
  async getById(id: string, capabilities: readonly string[]) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        organisationMemberships: {
          include: { organisation: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        propertyContacts: {
          include: {
            organisation: { select: { id: true, name: true } },
            memberships: {
              include: {
                property: { select: { id: true, name: true } },
                space: { select: { id: true, name: true } },
              },
              orderBy: { startDate: 'asc' },
            },
            invites: { orderBy: { createdAt: 'desc' }, take: 5 },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) throw new NotFoundError('User not found');

    const masked = maskPiiFields('User', user, capabilities);

    return {
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: masked.email,
        status: user.status,
        createdAt: user.createdAt,
      },
      staffOrganisations: user.organisationMemberships.map((m) => ({
        organisation: m.organisation,
        role: m.role,
        status: m.status,
        joinedAt: m.createdAt,
      })),
      residentRelationships: user.propertyContacts.map((contact) => {
        const maskedContact = maskPiiFields('PropertyContact', contact, capabilities);
        return {
          organisation: contact.organisation,
          email: maskedContact.email ?? contact.email,
          phone: maskedContact.phone ?? contact.phone,
          portalAccess: 'Active' as const,
          memberships: contact.memberships.map((m) => ({
            id: m.id,
            role: m.role,
            status: m.status,
            property: m.property,
            space: m.space,
            startDate: m.startDate,
            endDate: m.endDate,
          })),
          invites: contact.invites.map((invite) => ({
            id: invite.id,
            status: invite.status,
            expiresAt: invite.expiresAt,
            acceptedAt: invite.acceptedAt,
          })),
        };
      }),
    };
  }
}
