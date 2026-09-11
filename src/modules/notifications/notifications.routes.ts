import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  getNotification,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications.controller.js';

// A user's own notification inbox — staff and residents alike, scoped to
// the caller's own userId at every route. No requireOrgRole gate: a
// notification is per-person, not a staff management surface.
export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

notificationsRouter.get('/', asyncHandler(listNotifications));
notificationsRouter.get('/unread-count', asyncHandler(getUnreadNotificationCount));
notificationsRouter.post('/read-all', asyncHandler(markAllNotificationsRead));
notificationsRouter.get('/:id', asyncHandler(getNotification));
notificationsRouter.post('/:id/read', asyncHandler(markNotificationRead));
