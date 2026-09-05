import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { getCurrentOrganisation } from './organisations.controller.js';

export const organisationsRouter = Router();

organisationsRouter.get('/me', authenticate, asyncHandler(getCurrentOrganisation));
