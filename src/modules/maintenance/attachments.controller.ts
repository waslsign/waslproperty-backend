import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { MaintenanceAttachmentsService } from './attachments.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { presignAttachmentsSchema, registerAttachmentsSchema } from './attachments.schemas.js';

const maintenanceService = new MaintenanceService(getPrismaClient());
const attachmentsService = new MaintenanceAttachmentsService(getPrismaClient(), maintenanceService);

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function presignMaintenanceAttachments(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = presignAttachmentsSchema.parse(req.body);
  const result = await attachmentsService.presign(
    auth.organisationId,
    auth,
    req.params.id as string,
    input,
  );
  res.json(result);
}

export async function registerMaintenanceAttachments(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = registerAttachmentsSchema.parse(req.body);
  const result = await attachmentsService.register(
    auth.organisationId,
    auth,
    req.params.id as string,
    input,
  );
  res.status(201).json({ items: result });
}

export async function listMaintenanceAttachments(req: Request, res: Response) {
  const auth = requireAuth(req);
  const result = await attachmentsService.list(auth.organisationId, auth, req.params.id as string);
  res.json({ items: result });
}
