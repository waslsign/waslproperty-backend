import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { MaintenanceService } from './maintenance.service.js';
import {
  createMaintenanceRequestSchema,
  maintenanceRequestQuerySchema,
  updateMaintenanceRequestSchema,
  updateStatusSchema,
} from './maintenance.schemas.js';

const maintenanceService = new MaintenanceService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function createMaintenanceRequest(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createMaintenanceRequestSchema.parse(req.body);
  const request = await maintenanceService.create(auth.organisationId, auth, input);
  res.status(201).json(request);
}

export async function listMaintenanceRequests(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = maintenanceRequestQuerySchema.parse(req.query);
  const result = await maintenanceService.list(auth.organisationId, auth, query);
  res.json(result);
}

export async function getMaintenanceRequest(req: Request, res: Response) {
  const auth = requireAuth(req);
  const request = await maintenanceService.getById(
    auth.organisationId,
    auth,
    req.params.id as string,
  );
  res.json(request);
}

export async function updateMaintenanceRequestStatus(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateStatusSchema.parse(req.body);
  const request = await maintenanceService.updateStatus(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input.status,
  );
  res.json(request);
}

export async function updateMaintenanceRequest(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateMaintenanceRequestSchema.parse(req.body);
  const request = await maintenanceService.update(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input,
  );
  res.json(request);
}
