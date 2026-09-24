import { Router } from 'express';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  declineRfqResponse,
  getRfqInvitation,
  presignRfqAttachment,
  registerRfqAttachment,
  submitRfqResponse,
} from './rfq-public.controller.js';

/**
 * Public — a contractor responding to an RFQ has no WaslProp account and
 * never needs one. Every handler here resolves access purely from the
 * high-entropy token in the URL (see QuoteRoundsService.getInvitationByRawToken):
 * no organisationId, no session, no way to reach any other invitation's
 * data. Mirrors invitesRouter's own public/token-based shape exactly.
 */
export const rfqPublicRouter = Router();

rfqPublicRouter.get('/:token', asyncHandler(getRfqInvitation));
rfqPublicRouter.post('/:token/submit', asyncHandler(submitRfqResponse));
rfqPublicRouter.post('/:token/decline', asyncHandler(declineRfqResponse));
rfqPublicRouter.post('/:token/attachments/presign', asyncHandler(presignRfqAttachment));
rfqPublicRouter.post('/:token/attachments', asyncHandler(registerRfqAttachment));
