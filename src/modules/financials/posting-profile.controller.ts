import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { upsertPostingProfileRuleSchema } from './posting-profile.schemas.js';
import { PostingProfileService } from './posting-profile.service.js';

const postingProfileService = new PostingProfileService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listPostingProfileRules(req: Request, res: Response) {
  const auth = requireAuth(req);
  const items = await postingProfileService.list(auth.organisationId, req.params.propertyId as string);
  res.json({ items });
}

export async function upsertPostingProfileRule(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = upsertPostingProfileRuleSchema.parse(req.body);
  const rule = await postingProfileService.upsert(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.status(201).json(rule);
}
