import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { listMyMemberships, listPeopleDirectory } from './people.controller.js';

export const peopleRouter = Router();

peopleRouter.use(authenticate);

peopleRouter.get('/me', asyncHandler(listMyMemberships));
peopleRouter.get('/', asyncHandler(listPeopleDirectory));
