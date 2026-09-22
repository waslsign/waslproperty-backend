import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireCapability } from '../../middlewares/authorize.middleware.js';
import { fromContactParam, fromMembershipParam } from '../../middlewares/resolvePropertyId.js';
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
// Portfolio scoping happens inside the service (PeopleService.listDirectory)
// via AuthorizationService.getAccessiblePropertyIds.
peopleRouter.get('/', asyncHandler(listPeopleDirectory));

// Search-to-link has no single property to scope against (it's how a
// manager finds an existing person before attaching them to one of their
// properties) — gated on holding people.manage anywhere, same bar as
// before (was OWNER/ADMIN only).
peopleRouter.get(
  '/contacts/search',
  requireCapability('people.manage'),
  asyncHandler(searchContacts),
);
peopleRouter.patch(
  '/memberships/:membershipId',
  requireCapability('people.manage', fromMembershipParam('membershipId')),
  asyncHandler(updateMembership),
);
peopleRouter.post(
  '/memberships/:membershipId/end',
  requireCapability('people.manage', fromMembershipParam('membershipId')),
  asyncHandler(endMembership),
);

peopleRouter.post(
  '/:contactId/invite',
  requireCapability('people.manage', fromContactParam('contactId')),
  asyncHandler(inviteContact),
);
peopleRouter.post(
  '/:contactId/invite/resend',
  requireCapability('people.manage', fromContactParam('contactId')),
  asyncHandler(resendContactInvite),
);
peopleRouter.post(
  '/:contactId/invite/revoke',
  requireCapability('people.manage', fromContactParam('contactId')),
  asyncHandler(revokeContactInvite),
);
