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
      OR: [{ organisationMemberships: { some: {} } }, { propertyContact: { isNot: null } }],
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
          _count: { select: { organisationMemberships: true } },
          propertyContact: { select: { id: true } },
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
          organisationCount: user._count.organisationMemberships + (user.propertyContact ? 1 : 0),
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
   * Villa 12?" without a raw query. Staff relationships (OrganisationMembership,
   * many) and the resident relationship (PropertyContact, at most one per
   * User — see schema) are genuinely different shapes and shown as such,
   * not forced into one uniform list. */
  async getById(id: string, capabilities: readonly string[]) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        organisationMemberships: {
          include: { organisation: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        propertyContact: {
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
        },
      },
    });
    if (!user) throw new NotFoundError('User not found');

    const masked = maskPiiFields('User', user, capabilities);
    const maskedContact = user.propertyContact
      ? maskPiiFields('PropertyContact', user.propertyContact, capabilities)
      : null;

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
      residentRelationship: user.propertyContact
        ? {
            organisation: user.propertyContact.organisation,
            email: maskedContact?.email ?? user.propertyContact.email,
            phone: maskedContact?.phone ?? user.propertyContact.phone,
            portalAccess: 'Active' as const,
            memberships: user.propertyContact.memberships.map((m) => ({
              id: m.id,
              role: m.role,
              status: m.status,
              property: m.property,
              space: m.space,
              startDate: m.startDate,
              endDate: m.endDate,
            })),
            invites: user.propertyContact.invites.map((invite) => ({
              id: invite.id,
              status: invite.status,
              expiresAt: invite.expiresAt,
              acceptedAt: invite.acceptedAt,
            })),
          }
        : null,
    };
  }
}
