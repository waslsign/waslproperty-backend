import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { BackofficeIntegrationsService } from './backoffice-integrations.service.js';

const service = new BackofficeIntegrationsService(getPrismaClient());

export async function getBackofficeIntegrations(_req: Request, res: Response) {
  res.json({ checks: await service.getChecks() });
}
