import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { UnauthorizedError } from '../../../errors/AppError.js';
import { getDeliveryScheduler } from '../../../modules/communications/communications.delivery.js';
import { BackofficeJobsService } from './backoffice-jobs.service.js';
import { deliveryStatusQuerySchema } from './backoffice-jobs.schemas.js';

const service = new BackofficeJobsService(getPrismaClient());

export async function getBackofficeJobsOverview(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  const [statusCounts, scheduled] = await Promise.all([
    service.getStatusCounts(),
    service.listScheduledCommunications(),
  ]);
  res.json({
    scheduler: getDeliveryScheduler().getStatus(),
    deliveriesByStatus: statusCounts,
    scheduledCommunications: scheduled,
  });
}

export async function listBackofficeDeliveries(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  const { status } = deliveryStatusQuerySchema.parse(req.query);
  const deliveries = await service.listDeliveries(status, req.platformAuth.platformCapabilities);
  res.json({ items: deliveries, total: deliveries.length });
}

export async function retryBackofficeDelivery(req: Request, res: Response) {
  if (!req.platformAuth) throw new UnauthorizedError();
  const updated = await service.retryDelivery(req.params.id as string, {
    userId: req.platformAuth.userId,
    platformRole: req.platformAuth.platformRole,
  });
  res.json(updated);
}
