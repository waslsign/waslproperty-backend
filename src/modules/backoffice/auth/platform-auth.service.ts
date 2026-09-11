import type { PlatformRole, PlatformUser, PrismaClient, User } from '@prisma/client';
import { UnauthorizedError } from '../../../errors/AppError.js';
import { hashPassword, verifyPassword } from '../../../lib/password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
  signPlatformAccessToken,
} from '../../../lib/tokens.js';
import { recordPlatformActivity } from '../../../platform/audit.js';
import { resolvePlatformCapabilities } from '../../../platform/capabilities.js';
import type { PlatformChangePasswordInput, PlatformLoginInput } from './platform-auth.schemas.js';

export interface PlatformAuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface PlatformAuthResult {
  user: { id: string; email: string; firstName: string; lastName: string };
  platformUserId: string;
  username: string;
  platformRole: PlatformRole;
  platformCapabilities: string[];
  tokens: PlatformAuthTokens;
}

type BasicUser = Pick<User, 'id' | 'email' | 'firstName' | 'lastName'>;

/**
 * Entirely separate from AuthService — a WaslProperty employee is not a
 * customer organisation member, so this never touches
 * OrganisationMembership/PropertyContact/listAccessOptions. Reuses only the
 * low-level password/token utilities.
 */
export class PlatformAuthService {
  constructor(private readonly prisma: PrismaClient) {}

  async login(input: PlatformLoginInput): Promise<PlatformAuthResult> {
    // Looked up by username, never email — the Backoffice login identifier
    // is deliberately separate from the underlying User's email.
    const platformUser = await this.prisma.platformUser.findUnique({
      where: { username: input.username },
      include: { user: true },
    });
    if (!platformUser || !platformUser.isActive || platformUser.user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Invalid username or password');
    }

    const validPassword = await verifyPassword(platformUser.user.passwordHash, input.password);
    if (!validPassword) {
      throw new UnauthorizedError('Invalid username or password');
    }

    return this.issueAuthResult(platformUser.user, platformUser);
  }

  async refresh(rawRefreshToken: string): Promise<PlatformAuthTokens> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: tokenHash, revokedAt: null, sessionType: 'PLATFORM' },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedError('Session expired, please sign in again');
    }

    // Re-checked on every refresh, not just at login — access revoked
    // mid-session (isActive: false) must take effect immediately, not
    // merely block the next fresh login.
    const platformUser = await this.prisma.platformUser.findUnique({
      where: { userId: session.userId },
    });
    if (!platformUser || !platformUser.isActive) {
      throw new UnauthorizedError('Session expired, please sign in again');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(session.userId, platformUser);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: tokenHash, revokedAt: null, sessionType: 'PLATFORM' },
      data: { revokedAt: new Date() },
    });
  }

  /** Self-service — requires knowing the current password, unlike
   * BackofficePlatformUsersService.resetPassword (a Super Admin forcing a
   * reset on someone else's account, no current password needed). */
  async changePassword(
    actor: { userId: string; platformUserId: string; platformRole: PlatformRole },
    input: PlatformChangePasswordInput,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const valid = await verifyPassword(user.passwordHash, input.currentPassword);
    if (!valid) throw new UnauthorizedError('Current password is incorrect');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actor.userId },
        data: { passwordHash: await hashPassword(input.newPassword) },
      });

      await recordPlatformActivity(tx, {
        actorUserId: actor.userId,
        platformRole: actor.platformRole,
        action: 'platformUser.passwordChanged',
        entityType: 'PlatformUser',
        entityId: actor.platformUserId,
        reason: 'Self-service password change',
      });
    });
  }

  private async issueAuthResult(
    user: BasicUser,
    platformUser: PlatformUser,
  ): Promise<PlatformAuthResult> {
    const tokens = await this.issueTokens(user.id, platformUser);
    return {
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      platformUserId: platformUser.id,
      username: platformUser.username,
      platformRole: platformUser.role,
      platformCapabilities: resolvePlatformCapabilities(platformUser.role),
      tokens,
    };
  }

  private async issueTokens(
    userId: string,
    platformUser: PlatformUser,
  ): Promise<PlatformAuthTokens> {
    const capabilities = resolvePlatformCapabilities(platformUser.role);
    const accessToken = signPlatformAccessToken({
      sub: userId,
      sessionType: 'PLATFORM',
      platformUserId: platformUser.id,
      username: platformUser.username,
      platformRole: platformUser.role,
      platformCapabilities: capabilities,
    });
    const refreshToken = generateRefreshToken();
    const expiresAt = refreshTokenExpiresAt();

    await this.prisma.session.create({
      data: {
        userId,
        sessionType: 'PLATFORM',
        organisationId: null,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt };
  }
}
