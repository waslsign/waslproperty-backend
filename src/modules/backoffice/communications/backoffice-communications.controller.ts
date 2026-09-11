import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { UnauthorizedError } from '../../../errors/AppError.js';
import { paginationQuerySchema } from '../../../lib/pagination.js';
import { BackofficeCommunicationsService } from './backoffice-communications.service.js';

const service = new BackofficeCommunicationsService(getPrismaClient());

export async function listBackofficeCommunications(req: Request, res: Response) {
  res.json(await service.list(paginationQuerySchema.parse(req.query)));
}

export async function getBackofficeCommunicationDeliveries(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  res.json(
    await service.getDeliveries(req.params.id as string, req.platformAuth.platformCapabilities),
  );
}
