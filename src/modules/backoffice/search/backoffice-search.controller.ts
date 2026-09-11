import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { UnauthorizedError } from '../../../errors/AppError.js';
import { BackofficeSearchService } from './backoffice-search.service.js';
import { backofficeSearchQuerySchema } from './backoffice-search.schemas.js';

const searchService = new BackofficeSearchService(getPrismaClient());

export async function searchBackoffice(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  const { q } = backofficeSearchQuerySchema.parse(req.query);
  const results = await searchService.search(q, req.platformAuth.platformCapabilities);
  res.json({ items: results, total: results.length });
}
