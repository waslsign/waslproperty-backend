import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  inviteContact,
  listMyMemberships,
  listPeopleDirectory,
  resendContactInvite,
  revokeContactInvite,
} from './people.controller.js';

export const peopleRouter = Router();

peopleRouter.use(authenticate);

peopleRouter.get('/me', asyncHandler(listMyMemberships));
peopleRouter.get('/', asyncHandler(listPeopleDirectory));

peopleRouter.post(
  '/:contactId/invite',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(inviteContact),
);
peopleRouter.post(
  '/:contactId/invite/resend',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(resendContactInvite),
);
peopleRouter.post(
  '/:contactId/invite/revoke',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(revokeContactInvite),
);
