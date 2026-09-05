import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { getSpace, updateSpace } from './spaces.controller.js';

export const spacesRouter = Router();

spacesRouter.use(authenticate);

spacesRouter.get('/:id', asyncHandler(getSpace));
spacesRouter.patch('/:id', requireOrgRole(['OWNER', 'ADMIN']), asyncHandler(updateSpace));
