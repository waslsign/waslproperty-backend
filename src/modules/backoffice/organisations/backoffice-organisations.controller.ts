import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { UnauthorizedError } from '../../../errors/AppError.js';
import { BackofficeOrganisationsService } from './backoffice-organisations.service.js';
import {
  backofficeOrganisationsQuerySchema,
  updateOrganisationSchema,
} from './backoffice-organisations.schemas.js';

const service = new BackofficeOrganisationsService(getPrismaClient());

export async function listBackofficeOrganisations(req: Request, res: Response) {
  const query = backofficeOrganisationsQuerySchema.parse(req.query);
  res.json(await service.list(query));
}

export async function getBackofficeOrganisation(req: Request, res: Response) {
  res.json(await service.getById(req.params.id as string));
}

export async function updateBackofficeOrganisation(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  const input = updateOrganisationSchema.parse(req.body);
  const updated = await service.update(req.params.id as string, input, {
    employeeId: req.platformAuth.employeeId,
    platformRole: req.platformAuth.platformRole,
  });
  res.json(updated);
}
