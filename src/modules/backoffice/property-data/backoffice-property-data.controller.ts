import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { UnauthorizedError } from '../../../errors/AppError.js';
import { paginationQuerySchema } from '../../../lib/pagination.js';
import { BackofficePropertyDataService } from './backoffice-property-data.service.js';

const service = new BackofficePropertyDataService(getPrismaClient());

export async function listBackofficeProperties(req: Request, res: Response) {
  res.json(await service.listProperties(paginationQuerySchema.parse(req.query)));
}

export async function listBackofficeSpaces(req: Request, res: Response) {
  res.json(await service.listSpaces(paginationQuerySchema.parse(req.query)));
}

export async function listBackofficeMemberships(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  const query = paginationQuerySchema.parse(req.query);
  res.json(await service.listMemberships(query, req.platformAuth.platformCapabilities));
}
