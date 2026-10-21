import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { AccountTemplateService } from './account-templates.service.js';
import { createAccountTemplateSchema, provisionFromTemplateSchema } from './accounts.schemas.js';

const accountTemplateService = new AccountTemplateService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listAccountTemplates(req: Request, res: Response) {
  const auth = requireAuth(req);
  const items = await accountTemplateService.list(auth.organisationId);
  res.json({ items });
}

export async function createAccountTemplate(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createAccountTemplateSchema.parse(req.body);
  const template = await accountTemplateService.create(auth.organisationId, auth.userId, input);
  res.status(201).json(template);
}

export async function provisionAccountsFromTemplate(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = provisionFromTemplateSchema.parse(req.body);
  const result = await accountTemplateService.provision(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input.accountTemplateId,
  );
  res.status(201).json(result);
}
