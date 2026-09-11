import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  createSavedAudience,
  deleteSavedAudience,
  listSavedAudiences,
  updateSavedAudience,
} from './saved-audiences.controller.js';

export const savedAudiencesRouter = Router();

savedAudiencesRouter.use(authenticate, requireOrgRole(['OWNER', 'ADMIN']));

savedAudiencesRouter.get('/', asyncHandler(listSavedAudiences));
savedAudiencesRouter.post('/', asyncHandler(createSavedAudience));
savedAudiencesRouter.patch('/:id', asyncHandler(updateSavedAudience));
savedAudiencesRouter.delete('/:id', asyncHandler(deleteSavedAudience));
