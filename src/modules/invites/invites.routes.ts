import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  acceptInvite,
  acceptInviteForExistingUser,
  getInvitePreview,
} from './invites.controller.js';

export const invitesRouter = Router();

// Public — the activation screen must work before the resident has any
// session at all.
invitesRouter.get('/:token', asyncHandler(getInvitePreview));
invitesRouter.post('/:token/accept', asyncHandler(acceptInvite));

// Requires the caller to already be signed in as the account the invite's
// email belongs to — see InvitesService.acceptInviteForExistingUser.
invitesRouter.post(
  '/:token/accept-existing',
  authenticate,
  asyncHandler(acceptInviteForExistingUser),
);
