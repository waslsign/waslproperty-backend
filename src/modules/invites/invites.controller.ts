import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { setRefreshCookie } from '../../lib/cookies.js';
import { AuthService, type AuthResult } from '../auth/auth.service.js';
import { InvitesService } from './invites.service.js';
import { acceptInviteSchema, inviteTokenParamSchema } from './invites.schemas.js';

const authService = new AuthService(getPrismaClient());
const invitesService = new InvitesService(getPrismaClient(), authService);

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

function respondWithAuthResult(res: Response, result: AuthResult) {
  setRefreshCookie(res, result.tokens.refreshToken, result.tokens.refreshTokenExpiresAt);
  res.status(200).json({
    user: result.user,
    organisation: result.organisation,
    orgRole: result.orgRole,
    accountType: result.accountType,
    accessToken: result.tokens.accessToken,
  });
}

export async function getInvitePreview(req: Request, res: Response) {
  const { token } = inviteTokenParamSchema.parse(req.params);
  const preview = await invitesService.previewInvite(token);
  res.json(preview);
}

export async function acceptInvite(req: Request, res: Response) {
  const { token } = inviteTokenParamSchema.parse(req.params);
  const input = acceptInviteSchema.parse(req.body);
  const result = await invitesService.acceptInvite(token, input.password);
  respondWithAuthResult(res, result);
}

export async function acceptInviteForExistingUser(req: Request, res: Response) {
  const auth = requireAuth(req);
  const { token } = inviteTokenParamSchema.parse(req.params);
  await invitesService.acceptInviteForExistingUser(token, auth.userId);
  res.status(204).send();
}
