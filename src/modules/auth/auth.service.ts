import type { OrgRole, PrismaClient } from '@prisma/client';
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

export interface AuthAccessContext {
  organisationId: string;
  orgRole: OrgRole | null;
  propertyContactId: string | null;
}

export interface AuthResult {
  user: { id: string; email: string; firstName: string; lastName: string };
  organisation: { id: string; name: string; slug: string };
  orgRole: OrgRole | null;
  accountType: 'staff' | 'resident';
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

    const tokens = await this.issueTokens(user.id, {
      organisationId: organisation.id,
      orgRole: membership.role,
      propertyContactId: null,
    });

    return {
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      organisation: { id: organisation.id, name: organisation.name, slug: organisation.slug },
      orgRole: membership.role,
      accountType: 'staff',
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

    const access = await this.resolveAccess(user.id);
    if (!access) {
      throw new UnauthorizedError('This account is not associated with any organisation yet');
    }

    const organisation = await this.prisma.organisation.findUniqueOrThrow({
      where: { id: access.organisationId },
    });

    const tokens = await this.issueTokens(user.id, access);

    return {
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      organisation: { id: organisation.id, name: organisation.name, slug: organisation.slug },
      orgRole: access.orgRole,
      accountType: access.orgRole ? 'staff' : 'resident',
      tokens,
    };
  }

  /**
   * Issues a full session for a user we've already authenticated by some
   * other means (e.g. accepting a resident invite) — no password check
   * here, the caller is responsible for having established trust first.
   */
  async signInAfterActivation(userId: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const access = await this.resolveAccess(userId);
    if (!access) {
      throw new UnauthorizedError('This account is not associated with any organisation yet');
    }

    const organisation = await this.prisma.organisation.findUniqueOrThrow({
      where: { id: access.organisationId },
    });

    const tokens = await this.issueTokens(user.id, access);

    return {
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      organisation: { id: organisation.id, name: organisation.name, slug: organisation.slug },
      orgRole: access.orgRole,
      accountType: access.orgRole ? 'staff' : 'resident',
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

    const access = await this.resolveAccess(session.userId);
    if (!access) {
      throw new UnauthorizedError('This account is not associated with any organisation yet');
    }

    // Rotate: revoke the old session, issue a new one.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(session.userId, access);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Staff (an active OrganisationMembership) takes precedence when both
   * exist. Otherwise, fall back to a resident session for a User linked to
   * a PropertyContact — see PeopleService for how that link is made (it is
   * never created by a self-service sign-up in this milestone).
   */
  private async resolveAccess(userId: string): Promise<AuthAccessContext | null> {
    const membership = await this.prisma.organisationMembership.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (membership) {
      return {
        organisationId: membership.organisationId,
        orgRole: membership.role,
        propertyContactId: null,
      };
    }

    const contact = await this.prisma.propertyContact.findFirst({
      where: { userId, status: 'ACTIVE' },
    });
    if (contact) {
      return {
        organisationId: contact.organisationId,
        orgRole: null,
        propertyContactId: contact.id,
      };
    }

    return null;
  }

  private async issueTokens(userId: string, access: AuthAccessContext): Promise<AuthTokens> {
    const accessToken = signAccessToken({
      sub: userId,
      organisationId: access.organisationId,
      orgRole: access.orgRole,
      propertyContactId: access.propertyContactId,
    });
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
