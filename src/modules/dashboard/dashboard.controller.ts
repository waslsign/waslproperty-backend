import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { DashboardService } from './dashboard.service.js';
import { dashboardQuerySchema } from './dashboard.schemas.js';

const dashboardService = new DashboardService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function getDashboard(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = dashboardQuerySchema.parse(req.query);
  const result = await dashboardService.getDashboard(auth.organisationId, auth, query);
  res.json(result);
}
