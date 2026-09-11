import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  cancelCommunication,
  createCommunication,
  duplicateCommunication,
  getCommunication,
  getCommunicationDelivery,
  listCommunications,
  previewCommunicationAudience,
  sendCommunication,
  updateCommunication,
} from './communications.controller.js';

// Manager communications — staff-only end to end, same bar as every other
// staff-write module (requireOrgRole(['OWNER','ADMIN'])). Residents only
// ever see the *result* of a sent communication, via their own
// notifications inbox — never this router.
export const communicationsRouter = Router();

communicationsRouter.use(authenticate, requireOrgRole(['OWNER', 'ADMIN']));

communicationsRouter.get('/', asyncHandler(listCommunications));
communicationsRouter.post('/', asyncHandler(createCommunication));
communicationsRouter.post('/preview-audience', asyncHandler(previewCommunicationAudience));
communicationsRouter.get('/:id', asyncHandler(getCommunication));
communicationsRouter.patch('/:id', asyncHandler(updateCommunication));
communicationsRouter.post('/:id/send', asyncHandler(sendCommunication));
communicationsRouter.post('/:id/cancel', asyncHandler(cancelCommunication));
communicationsRouter.post('/:id/duplicate', asyncHandler(duplicateCommunication));
communicationsRouter.get('/:id/delivery', asyncHandler(getCommunicationDelivery));
