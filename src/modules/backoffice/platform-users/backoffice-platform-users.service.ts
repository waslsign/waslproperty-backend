import type { PlatformRole, PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../../errors/AppError.js';
import { generateTemporaryPassword, hashPassword } from '../../../lib/password.js';
import { recordPlatformActivity } from '../../../platform/audit.js';
import type {
  GrantPlatformAccessInput,
  ResetPlatformUserPasswordInput,
  UpdatePlatformUserInput,
} from './backoffice-platform-users.schemas.js';

/** Every platform-only account created without an existing WaslProperty
 * user gets a placeholder email in this namespace — User.email is NOT
 * NULL + unique in the schema, so something must occupy it, but it's
 * never used to sign in (username is) or to send mail. */
const PLATFORM_ONLY_EMAIL_DOMAIN = 'platform.waslproperty.internal';

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
    const usernameTaken = await this.prisma.platformUser.findFirst({ where: { username: input.username } });
    if (usernameTaken) throw new ConflictError('That username is already taken');

    let user: { id: string };
    let temporaryPassword: string | undefined;
    let createdNewUser = false;

    if (input.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
      if (!existing) throw new NotFoundError('No WaslProperty user exists for that email yet');
      user = existing;
    } else {
      // No existing account to attach to — create a brand-new
      // platform-only User with a generated password, returned once.
      const placeholderEmail = `${input.username}@${PLATFORM_ONLY_EMAIL_DOMAIN}`;
      const collision = await this.prisma.user.findUnique({ where: { email: placeholderEmail } });
      if (collision) throw new ConflictError('A platform account for that username already exists');

      temporaryPassword = generateTemporaryPassword();
      user = await this.prisma.user.create({
        data: {
          email: placeholderEmail,
          passwordHash: await hashPassword(temporaryPassword),
          firstName: input.firstName as string,
          lastName: input.lastName as string,
        },
      });
      createdNewUser = true;
    }

    const platformUser = await this.prisma.$transaction(async (tx) => {
      const created = await tx.platformUser.upsert({
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
        entityId: created.id,
        reason: input.reason,
        // Deliberately never includes temporaryPassword — the audit log
        // must never hold a live credential, even hashed elsewhere.
        after: { userId: user.id, username: input.username, role: input.role, createdNewUser },
      });

      return created;
    });

    return { ...platformUser, temporaryPassword };
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

  /** A Super Admin forcing a reset — distinct from the self-service
   * changePassword on PlatformAuthService, which requires knowing the
   * current password. Returns the new password once; it is never stored
   * in plaintext or written to the audit log. */
  async resetPassword(
    id: string,
    input: ResetPlatformUserPasswordInput,
    actor: { userId: string; platformRole: PlatformRole },
  ) {
    const platformUser = await this.prisma.platformUser.findUnique({ where: { id } });
    if (!platformUser) throw new NotFoundError('Platform user not found');

    const temporaryPassword = generateTemporaryPassword();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: platformUser.userId },
        data: { passwordHash: await hashPassword(temporaryPassword) },
      });

      await recordPlatformActivity(tx, {
        actorUserId: actor.userId,
        platformRole: actor.platformRole,
        action: 'platformUser.passwordReset',
        entityType: 'PlatformUser',
        entityId: id,
        reason: input.reason,
        after: { username: platformUser.username },
      });
    });

    return { username: platformUser.username, temporaryPassword };
  }
}
