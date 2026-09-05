import type { NextFunction, Request, Response } from 'express';
import type { OrgRole } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../errors/AppError.js';
import { verifyAccessToken } from '../lib/tokens.js';

export interface AuthContext {
  userId: string;
  organisationId: string;
  orgRole: OrgRole;
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      organisationId: payload.organisationId,
      orgRole: payload.orgRole,
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
    if (!allowedRoles.includes(req.auth.orgRole)) {
      throw new ForbiddenError('You do not have permission to perform this action');
    }
    next();
  };
}
