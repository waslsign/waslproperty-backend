import type { PlatformRole, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../../errors/AppError.js';
import { recordPlatformActivity } from '../../../platform/audit.js';
import type { GrantPlatformAccessInput, UpdatePlatformUserInput } from './backoffice-platform-users.schemas.js';

export class BackofficePlatformUsersService {
  constructor(private readonly prisma: PrismaClient) {}

  async list() {
    const platformUsers = await this.prisma.platformUser.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        grantedByUser: { select: { firstName: true, lastName: true } },
      },
    });

    return platformUsers.map((pu) => ({
      id: pu.id,
      userId: pu.userId,
      username: pu.username,
      name: `${pu.user.firstName} ${pu.user.lastName}`,
      email: pu.user.email,
      role: pu.role,
      isActive: pu.isActive,
      grantedBy: pu.grantedByUser ? `${pu.grantedByUser.firstName} ${pu.grantedByUser.lastName}` : null,
      createdAt: pu.createdAt,
      updatedAt: pu.updatedAt,
    }));
  }

  async searchUser(email: string) {
    const users = await this.prisma.user.findMany({
      where: { email: { contains: email, mode: 'insensitive' } },
      take: 10,
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return users;
  }

  async grant(
    input: GrantPlatformAccessInput,
    actor: { userId: string; platformRole: PlatformRole },
  ) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw new NotFoundError('No WaslProperty user exists for that email yet');

    const usernameTaken = await this.prisma.platformUser.findFirst({
      where: { username: input.username, userId: { not: user.id } },
    });
    if (usernameTaken) throw new ConflictError('That username is already taken');

    return this.prisma.$transaction(async (tx) => {
      const platformUser = await tx.platformUser.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          username: input.username,
          role: input.role,
          isActive: true,
          grantedByUserId: actor.userId,
        },
        update: { username: input.username, role: input.role, isActive: true, grantedByUserId: actor.userId },
      });

      await recordPlatformActivity(tx, {
        actorUserId: actor.userId,
        platformRole: actor.platformRole,
        action: 'platformUser.granted',
        entityType: 'PlatformUser',
        entityId: platformUser.id,
        reason: input.reason,
        after: { userId: user.id, username: input.username, role: input.role },
      });

      return platformUser;
    });
  }

  async update(
    id: string,
    input: UpdatePlatformUserInput,
    actor: { userId: string; platformRole: PlatformRole },
  ) {
    const existing = await this.prisma.platformUser.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Platform user not found');

    if (input.username && input.username !== existing.username) {
      const usernameTaken = await this.prisma.platformUser.findFirst({
        where: { username: input.username, id: { not: id } },
      });
      if (usernameTaken) throw new ConflictError('That username is already taken');
    }

    const deactivating = input.isActive === false;
    const demoting =
      input.role !== undefined &&
      existing.role === 'PLATFORM_SUPER_ADMIN' &&
      input.role !== 'PLATFORM_SUPER_ADMIN';

    if ((deactivating || demoting) && existing.role === 'PLATFORM_SUPER_ADMIN') {
      const activeSuperAdmins = await this.prisma.platformUser.count({
        where: { role: 'PLATFORM_SUPER_ADMIN', isActive: true },
      });
      if (activeSuperAdmins <= 1) {
        throw new ConflictError('Cannot remove the last active Super Admin');
      }
    }

    const { reason, ...changes } = input;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.platformUser.update({ where: { id }, data: changes });

      await recordPlatformActivity(tx, {
        actorUserId: actor.userId,
        platformRole: actor.platformRole,
        action: 'platformUser.updated',
        entityType: 'PlatformUser',
        entityId: id,
        reason,
        before: { role: existing.role, isActive: existing.isActive },
        after: { role: updated.role, isActive: updated.isActive },
      });

      return updated;
    });
  }
}
