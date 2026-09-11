import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  endMembership,
  inviteContact,
  listMyMemberships,
  listPeopleDirectory,
  resendContactInvite,
  revokeContactInvite,
  searchContacts,
  updateMembership,
} from './people.controller.js';

export const peopleRouter = Router();

peopleRouter.use(authenticate);

peopleRouter.get('/me', asyncHandler(listMyMemberships));
peopleRouter.get('/', asyncHandler(listPeopleDirectory));

peopleRouter.get(
  '/contacts/search',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(searchContacts),
);
peopleRouter.patch(
  '/memberships/:membershipId',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(updateMembership),
);
peopleRouter.post(
  '/memberships/:membershipId/end',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(endMembership),
);

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
