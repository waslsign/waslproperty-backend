import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { NotificationsService } from './notifications.service.js';
import { notificationsQuerySchema } from './notifications.schemas.js';

const notificationsService = new NotificationsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listNotifications(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = notificationsQuerySchema.parse(req.query);
  const result = await notificationsService.list(auth.organisationId, auth.userId, query);
  res.json(result);
}

export async function getNotification(req: Request, res: Response) {
  const auth = requireAuth(req);
  const notification = await notificationsService.getById(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
  );
  res.json(notification);
}

export async function getUnreadNotificationCount(req: Request, res: Response) {
  const auth = requireAuth(req);
  const result = await notificationsService.unreadCount(auth.organisationId, auth.userId);
  res.json(result);
}

export async function markNotificationRead(req: Request, res: Response) {
  const auth = requireAuth(req);
  const notification = await notificationsService.markRead(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
  );
  res.json(notification);
}

export async function markAllNotificationsRead(req: Request, res: Response) {
  const auth = requireAuth(req);
  const result = await notificationsService.markAllRead(auth.organisationId, auth.userId);
  res.json(result);
}
