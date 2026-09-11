import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { paginationQuerySchema } from '../../../lib/pagination.js';
import { BackofficeAuditService } from './backoffice-audit.service.js';

const service = new BackofficeAuditService(getPrismaClient());

export async function listBackofficeAudit(req: Request, res: Response) {
  res.json(await service.list(paginationQuerySchema.parse(req.query)));
}
