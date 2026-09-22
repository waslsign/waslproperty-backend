import type { OrgRole, PrismaClient, PropertyRole } from '@prisma/client';
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
  organisation: { id: string; name: string; slug: string; currencyCode?: string };
  orgRole: OrgRole | null;
  accountType: 'staff' | 'resident';
  tokens: AuthTokens;
}

/**
 * One of a user's organisation relationships. A single User may have a
 * different, fully independent relationship in each organisation — staff
 * in one, a resident in another — and neither suppresses the other. Every
 * option here is resolved strictly within its own organisationId; see
 * resolveAccessInOrg.
 */
export interface OrganisationAccessOption {
  organisationId: string;
  organisationName: string;
  organisationSlug: string;
  orgRole: OrgRole | null;
  propertyContactId: string | null;
  accountType: 'staff' | 'resident';
  /** Distinct ACTIVE PropertyRole(s) this contact holds anywhere in this
   * organisation — e.g. ['PROPERTY_MANAGER'], or ['TENANT', 'PROPERTY_MANAGER']
   * for someone who is both. accountType is a login-mechanism distinction
   * (OrganisationMembership vs PropertyContact), not a role — this is what
   * the organisation-picker actually shows, so a property-scoped operational
   * manager is never mislabelled "resident". Always empty for staff options. */
  propertyRoles: PropertyRole[];
}

export type LoginOutcome =
  | { kind: 'signedIn'; result: AuthResult }
  | { kind: 'chooseOrganisation'; options: OrganisationAccessOption[] };

type BasicUser = { id: string; email: string; firstName: string; lastName: string };

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
        data: { name: input.organisationName, slug, currencyCode: input.currencyCode },
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
      organisation: {
        id: organisation.id,
        name: organisation.name,
        slug: organisation.slug,
        currencyCode: organisation.currencyCode,
      },
      orgRole: membership.role,
      accountType: 'staff',
      tokens,
    };
  }

  /**
   * Returns either a completed sign-in (the common case — a user with
   * exactly one organisation relationship, or one that matched
   * input.organisationId) or, for the rare user with more than one
   * relationship and no organisationId hint, the list to choose from. Never
   * guesses between two live relationships.
   */
  async login(input: LoginInput): Promise<LoginOutcome> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Invalid email or password');
    }

    const validPassword = await verifyPassword(user.passwordHash, input.password);
    if (!validPassword) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const options = await this.listAccessOptions(user.id);
    if (options.length === 0) {
      throw new UnauthorizedError('This account is not associated with any organisation yet');
    }

    if (input.organisationId) {
      const candidates = options.filter((o) => o.organisationId === input.organisationId);
      if (candidates.length === 0) {
        throw new UnauthorizedError('You do not have access to that organisation');
      }
      // Same organisationId can now match two options — staff and resident
      // — when the user holds both relationships in that one organisation.
      // Never guess between them: accountType must disambiguate.
      const chosen =
        candidates.length === 1
          ? candidates[0]
          : candidates.find((o) => o.accountType === input.accountType);
      if (!chosen) {
        throw new UnauthorizedError('You do not have access to that organisation');
      }
      return { kind: 'signedIn', result: await this.issueAuthResult(user, chosen) };
    }

    if (options.length > 1) {
      return { kind: 'chooseOrganisation', options };
    }

    return {
      kind: 'signedIn',
      result: await this.issueAuthResult(user, options[0] as OrganisationAccessOption),
    };
  }

  /**
   * Issues a full session for a user we've already authenticated by some
   * other means (e.g. accepting a resident invite) — no password check
   * here, the caller is responsible for having established trust first.
   * Signs into the relationship just created by that action (the most
   * recently established one), not an arbitrary/older one.
   */
  async signInAfterActivation(userId: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const options = await this.listAccessOptions(userId);
    const chosen = options.at(-1);
    if (!chosen) {
      throw new UnauthorizedError('This account is not associated with any organisation yet');
    }

    return this.issueAuthResult(user, chosen);
  }

  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: tokenHash, revokedAt: null, sessionType: 'CUSTOMER' },
    });

    if (!session || session.expiresAt < new Date() || !session.organisationId) {
      throw new UnauthorizedError('Session expired, please log in again');
    }

    // Pinned to the organisation *and* the specific relationship (staff vs.
    // this exact resident contact) the session was originally issued for —
    // refreshing never moves a user into a different organisation, or a
    // different relationship within the same one, even if they've since
    // gained (or lost) access elsewhere.
    const access = await this.resolveAccessInOrg(
      session.userId,
      session.organisationId,
      session.propertyContactId,
    );
    if (!access) {
      throw new UnauthorizedError('Session expired, please log in again');
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

  private async issueAuthResult(
    user: BasicUser,
    option: OrganisationAccessOption,
  ): Promise<AuthResult> {
    const tokens = await this.issueTokens(user.id, {
      organisationId: option.organisationId,
      orgRole: option.orgRole,
      propertyContactId: option.propertyContactId,
    });

    return {
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      organisation: {
        id: option.organisationId,
        name: option.organisationName,
        slug: option.organisationSlug,
      },
      orgRole: option.orgRole,
      accountType: option.accountType,
      tokens,
    };
  }

  /**
   * Resolves access strictly within one organisation *and* one specific
   * relationship — never falls back to a different organisation, and never
   * silently switches from the resident relationship a session was issued
   * for to a staff one the user has since gained in the same organisation
   * (or vice versa). pinnedPropertyContactId is the session's own stored
   * value: null means "this session was issued as staff", a set value means
   * "this session was issued as that exact resident contact" — see the
   * Session.propertyContactId doc comment in schema.prisma.
   */
  private async resolveAccessInOrg(
    userId: string,
    organisationId: string,
    pinnedPropertyContactId: string | null,
  ): Promise<AuthAccessContext | null> {
    if (pinnedPropertyContactId) {
      const contact = await this.prisma.propertyContact.findFirst({
        where: { id: pinnedPropertyContactId, userId, organisationId, status: 'ACTIVE' },
      });
      return contact ? { organisationId, orgRole: null, propertyContactId: contact.id } : null;
    }

    const membership = await this.prisma.organisationMembership.findFirst({
      where: { userId, organisationId, status: 'ACTIVE' },
    });
    return membership
      ? { organisationId, orgRole: membership.role, propertyContactId: null }
      : null;
  }

  /**
   * Every independent relationship this user has, across every
   * organisation. A staff membership and a resident contact in the *same*
   * organisation are both listed as separate options now — a user who
   * manages a portfolio and also rents a unit in it gets a switcher for
   * that one organisation, exactly like a user with relationships across
   * two different organisations always has. Neither ever suppresses the
   * other; disambiguating between two same-organisation options is
   * AuthService.login's job (via accountType), not this method's.
   */
  private async listAccessOptions(userId: string): Promise<OrganisationAccessOption[]> {
    const [memberships, contacts] = await Promise.all([
      this.prisma.organisationMembership.findMany({
        where: { userId, status: 'ACTIVE' },
        include: { organisation: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.propertyContact.findMany({
        where: { userId, status: 'ACTIVE' },
        include: {
          organisation: { select: { id: true, name: true, slug: true } },
          memberships: { where: { status: 'ACTIVE' }, select: { role: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const staffOptions: OrganisationAccessOption[] = memberships.map((m) => ({
      organisationId: m.organisationId,
      organisationName: m.organisation.name,
      organisationSlug: m.organisation.slug,
      orgRole: m.role,
      propertyContactId: null,
      accountType: 'staff',
      propertyRoles: [],
    }));

    const residentOptions: OrganisationAccessOption[] = contacts.map((c) => ({
      organisationId: c.organisationId,
      organisationName: c.organisation.name,
      organisationSlug: c.organisation.slug,
      orgRole: null,
      propertyContactId: c.id,
      accountType: 'resident',
      propertyRoles: [...new Set(c.memberships.map((m) => m.role))],
    }));

    return [...staffOptions, ...residentOptions];
  }

  private async issueTokens(userId: string, access: AuthAccessContext): Promise<AuthTokens> {
    const accessToken = signAccessToken({
      sub: userId,
      sessionType: 'CUSTOMER',
      organisationId: access.organisationId,
      orgRole: access.orgRole,
      propertyContactId: access.propertyContactId,
    });
    const refreshToken = generateRefreshToken();
    const expiresAt = refreshTokenExpiresAt();

    await this.prisma.session.create({
      data: {
        userId,
        organisationId: access.organisationId,
        // Pins the session to the exact relationship it was issued for —
        // required so refresh() can never resolve to the *other* one when
        // a user holds both a staff and a resident relationship in this
        // same organisation.
        propertyContactId: access.propertyContactId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt };
  }
}
