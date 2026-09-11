import type { Request, Response } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { paginationQuerySchema } from '../../lib/pagination.js';
import { ActivityService } from './activity.service.js';

const activityService = new ActivityService(getPrismaClient());

const activityQuerySchema = paginationQuerySchema.extend({
  entityId: z.string().trim().min(1).optional(),
});

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listActivityForProperty(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = activityQuerySchema.parse(req.query);
  const result = await activityService.listForProperty(
    auth.organisationId,
    req.params.propertyId as string,
    query,
  );
  res.json(result);
}

export async function listActivityForSpace(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = activityQuerySchema.parse(req.query);
  const result = await activityService.listForSpace(
    auth.organisationId,
    req.params.id as string,
    query,
  );
  res.json(result);
}
