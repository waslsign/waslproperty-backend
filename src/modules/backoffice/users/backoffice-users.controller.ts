import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { UnauthorizedError } from '../../../errors/AppError.js';
import { BackofficeUsersService } from './backoffice-users.service.js';
import { backofficeUsersQuerySchema } from './backoffice-users.schemas.js';

const service = new BackofficeUsersService(getPrismaClient());

export async function listBackofficeUsers(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  const query = backofficeUsersQuerySchema.parse(req.query);
  res.json(await service.list(query, req.platformAuth.platformCapabilities));
}

export async function getBackofficeUser(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  res.json(await service.getById(req.params.id as string, req.platformAuth.platformCapabilities));
}
