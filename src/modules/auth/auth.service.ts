import type { PrismaClient } from '@prisma/client';
import { ConflictError, UnauthorizedError } from '../../errors/AppError.js';
import { slugify, withRandomSuffix } from '../../lib/slug.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
  signAccessToken,
} from '../../lib/tokens.js';
import type { RegisterInput, LoginInput } from './auth.schemas.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface AuthResult {
  user: { id: string; email: string; firstName: string; lastName: string };
  organisation: { id: string; name: string; slug: string };
  orgRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  tokens: AuthTokens;
}

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictError('An account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const baseSlug = slugify(input.organisationName) || 'organisation';

    const { user, organisation, membership } = await this.prisma.$transaction(async (tx) => {
      let slug = baseSlug;
      let clash = await tx.organisation.findUnique({ where: { slug } });
      while (clash) {
        slug = withRandomSuffix(baseSlug);
        clash = await tx.organisation.findUnique({ where: { slug } });
      }

      const organisation = await tx.organisation.create({
        data: { name: input.organisationName, slug },
      });

      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
        },
      });

      const membership = await tx.organisationMembership.create({
        data: { organisationId: organisation.id, userId: user.id, role: 'OWNER' },
      });

      return { user, organisation, membership };
    });

    const tokens = await this.issueTokens(user.id, organisation.id, membership.role);

    return {
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      organisation: { id: organisation.id, name: organisation.name, slug: organisation.slug },
      orgRole: membership.role,
      tokens,
    };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Invalid email or password');
    }

    const validPassword = await verifyPassword(user.passwordHash, input.password);
    if (!validPassword) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const membership = await this.prisma.organisationMembership.findFirst({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { organisation: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) {
      throw new UnauthorizedError('No active organisation membership found for this account');
    }

    const tokens = await this.issueTokens(user.id, membership.organisationId, membership.role);

    return {
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      organisation: {
        id: membership.organisation.id,
        name: membership.organisation.name,
        slug: membership.organisation.slug,
      },
      orgRole: membership.role,
      tokens,
    };
  }

  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: tokenHash, revokedAt: null },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedError('Session expired, please log in again');
    }

    const membership = await this.prisma.organisationMembership.findFirst({
      where: { userId: session.userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) {
      throw new UnauthorizedError('No active organisation membership found for this account');
    }

    // Rotate: revoke the old session, issue a new one.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(session.userId, membership.organisationId, membership.role);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    organisationId: string,
    orgRole: 'OWNER' | 'ADMIN' | 'MEMBER',
  ): Promise<AuthTokens> {
    const accessToken = signAccessToken({ sub: userId, organisationId, orgRole });
    const refreshToken = generateRefreshToken();
    const expiresAt = refreshTokenExpiresAt();

    await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt };
  }
}
