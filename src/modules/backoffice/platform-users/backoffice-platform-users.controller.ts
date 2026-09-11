import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { UnauthorizedError } from '../../../errors/AppError.js';
import { BackofficePlatformUsersService } from './backoffice-platform-users.service.js';
import {
  grantPlatformAccessSchema,
  searchUserQuerySchema,
  updatePlatformUserSchema,
} from './backoffice-platform-users.schemas.js';

const service = new BackofficePlatformUsersService(getPrismaClient());

export async function listBackofficePlatformUsers(_req: Request, res: Response) {
  res.json({ items: await service.list() });
}

export async function searchBackofficeUserByEmail(req: Request, res: Response) {
  const { email } = searchUserQuerySchema.parse(req.query);
  res.json({ items: await service.searchUser(email) });
}

export async function grantBackofficePlatformAccess(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  const input = grantPlatformAccessSchema.parse(req.body);
  const result = await service.grant(input, {
    userId: req.platformAuth.userId,
    platformRole: req.platformAuth.platformRole,
  });
  res.status(201).json(result);
}

export async function updateBackofficePlatformUser(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  const input = updatePlatformUserSchema.parse(req.body);
  const result = await service.update(req.params.id as string, input, {
    userId: req.platformAuth.userId,
    platformRole: req.platformAuth.platformRole,
  });
  res.json(result);
}
