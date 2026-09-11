import type { NextFunction, Request, Response } from 'express';
import type { OrgRole, PlatformRole } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../errors/AppError.js';
import { verifyAccessToken, verifyPlatformAccessToken } from '../lib/tokens.js';

export interface AuthContext {
  userId: string;
  organisationId: string;
  /** null for a resident session. */
  orgRole: OrgRole | null;
  /** Set only for a resident session. */
  propertyContactId?: string | null;
}

/** A WaslProperty employee's Backoffice session — never has an
 * organisationId. Populated only by authenticatePlatform, on
 * `/backoffice/*` routes only; every existing customer route continues to
 * read req.auth exactly as before and never sees this. */
export interface PlatformAuthContext {
  userId: string;
  platformUserId: string;
  username: string;
  platformRole: PlatformRole;
  platformCapabilities: string[];
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }

  const token = header.slice('Bearer '.length);

  try {
    // verifyAccessToken itself rejects any token whose sessionType isn't
    // 'CUSTOMER' — a platform token can never be mistaken for a customer
    // one here, and no legitimate customer token has ever been issued
    // without an organisationId (see AuthService.issueTokens), so this
    // rejects only token shapes that could never have been legitimately
    // issued to a customer session.
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      organisationId: payload.organisationId,
      orgRole: payload.orgRole,
      propertyContactId: payload.propertyContactId,
    };
    next();
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}

export function requireOrgRole(allowedRoles: OrgRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      throw new UnauthorizedError();
    }
    if (!req.auth.orgRole || !allowedRoles.includes(req.auth.orgRole)) {
      throw new ForbiddenError('You do not have permission to perform this action');
    }
    next();
  };
}

/** The Backoffice-only counterpart to `authenticate` — used solely by the
 * `/backoffice` router. A customer token is rejected here the same way a
 * platform token is rejected by `authenticate`: the sessionType discriminant
 * doesn't match what this verifier expects. */
export function authenticatePlatform(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = verifyPlatformAccessToken(token);
    req.platformAuth = {
      userId: payload.sub,
      platformUserId: payload.platformUserId,
      username: payload.username,
      platformRole: payload.platformRole,
      platformCapabilities: payload.platformCapabilities,
    };
    next();
  } catch {
    throw new UnauthorizedError('Invalid or expired Backoffice session');
  }
}

export function requirePlatformCapability(capability: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.platformAuth) {
      throw new UnauthorizedError();
    }
    if (!req.platformAuth.platformCapabilities.includes(capability)) {
      throw new ForbiddenError('You do not have permission to perform this action');
    }
    next();
  };
}
