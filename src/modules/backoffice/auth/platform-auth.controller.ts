import type { Request, Response } from 'express';
import { env } from '../../../config/env.js';
import { getPrismaClient } from '../../../lib/prisma.js';
import {
  clearPlatformRefreshCookie,
  getPlatformRefreshCookie,
  setPlatformRefreshCookie,
} from '../../../lib/cookies.js';
import { UnauthorizedError } from '../../../errors/AppError.js';
import { PlatformAuthService, type PlatformAuthResult } from './platform-auth.service.js';
import { platformChangePasswordSchema, platformLoginSchema } from './platform-auth.schemas.js';

const platformAuthService = new PlatformAuthService(getPrismaClient());

function respondWithAuthResult(res: Response, result: PlatformAuthResult, status: number) {
  setPlatformRefreshCookie(res, result.tokens.refreshToken, result.tokens.refreshTokenExpiresAt);
  res.status(status).json({
    user: result.user,
    username: result.username,
    platformRole: result.platformRole,
    platformCapabilities: result.platformCapabilities,
    // Backend-reported, not a frontend build var — the environment badge
    // must reflect what the server is actually running as, never a
    // possibly-stale frontend deployment label.
    environment: env.NODE_ENV,
    accessToken: result.tokens.accessToken,
  });
}

/** Public, unauthenticated — the environment badge must be visible on the
 * login screen itself, before anyone has signed in. */
export async function getBackofficeEnvironment(_req: Request, res: Response) {
  res.json({ environment: env.NODE_ENV });
}

export async function platformLogin(req: Request, res: Response) {
  const input = platformLoginSchema.parse(req.body);
  const result = await platformAuthService.login(input);
  respondWithAuthResult(res, result, 200);
}

export async function platformRefresh(req: Request, res: Response) {
  const token = getPlatformRefreshCookie(req.cookies);
  if (!token) {
    throw new UnauthorizedError('Missing refresh token');
  }
  const tokens = await platformAuthService.refresh(token);
  setPlatformRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.json({ accessToken: tokens.accessToken });
}

export async function platformLogout(req: Request, res: Response) {
  const token = getPlatformRefreshCookie(req.cookies);
  if (token) {
    await platformAuthService.logout(token);
  }
  clearPlatformRefreshCookie(res);
  res.status(204).send();
}

export async function changePlatformPassword(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  const input = platformChangePasswordSchema.parse(req.body);
  await platformAuthService.changePassword(
    {
      employeeId: req.platformAuth.employeeId,
      platformRole: req.platformAuth.platformRole,
    },
    input,
  );
  res.status(204).send();
}

export async function getCurrentPlatformUser(req: Request, res: Response) {
  if (!req.platformAuth) {
    throw new UnauthorizedError();
  }
  const employee = await getPrismaClient().employee.findUniqueOrThrow({
    where: { id: req.platformAuth.employeeId },
    select: { id: true, firstName: true, lastName: true },
  });
  res.json({
    user: employee,
    username: req.platformAuth.username,
    platformRole: req.platformAuth.platformRole,
    platformCapabilities: req.platformAuth.platformCapabilities,
    environment: env.NODE_ENV,
  });
}
