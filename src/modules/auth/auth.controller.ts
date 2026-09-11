import type { Request, Response } from 'express';
import { getPrismaClient } from '../../lib/prisma.js';
import { clearRefreshCookie, getRefreshCookie, setRefreshCookie } from '../../lib/cookies.js';
import { UnauthorizedError } from '../../errors/AppError.js';
import { AuthService, type AuthResult } from './auth.service.js';
import { loginSchema, registerSchema } from './auth.schemas.js';

const authService = new AuthService(getPrismaClient());

function respondWithAuthResult(res: Response, result: AuthResult, status: number) {
  setRefreshCookie(res, result.tokens.refreshToken, result.tokens.refreshTokenExpiresAt);
  res.status(status).json({
    user: result.user,
    organisation: result.organisation,
    orgRole: result.orgRole,
    accountType: result.accountType,
    accessToken: result.tokens.accessToken,
  });
}

export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  const result = await authService.register(input);
  respondWithAuthResult(res, result, 201);
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const outcome = await authService.login(input);

  if (outcome.kind === 'chooseOrganisation') {
    // Deliberately a distinct shape (no accessToken/user) rather than a
    // guess — a single-organisation account never sees this. The frontend
    // re-submits the same credentials with the chosen organisationId.
    res.status(200).json({
      requiresOrganisationSelection: true,
      organisations: outcome.options.map((option) => ({
        id: option.organisationId,
        name: option.organisationName,
        slug: option.organisationSlug,
        accountType: option.accountType,
      })),
    });
    return;
  }

  respondWithAuthResult(res, outcome.result, 200);
}

export async function refresh(req: Request, res: Response) {
  const token = getRefreshCookie(req.cookies);
  if (!token) {
    throw new UnauthorizedError('Missing refresh token');
  }
  const tokens = await authService.refresh(token);
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.json({ accessToken: tokens.accessToken });
}

export async function logout(req: Request, res: Response) {
  const token = getRefreshCookie(req.cookies);
  if (token) {
    await authService.logout(token);
  }
  clearRefreshCookie(res);
  res.status(204).send();
}
