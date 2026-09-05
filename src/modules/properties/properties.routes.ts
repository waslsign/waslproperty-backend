import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { createSpaceForProperty, listSpacesForProperty } from '../spaces/spaces.controller.js';
import {
  createProperty,
  getProperty,
  listProperties,
  updateProperty,
} from './properties.controller.js';

export const propertiesRouter = Router();

propertiesRouter.use(authenticate);

propertiesRouter.get('/', asyncHandler(listProperties));
propertiesRouter.post('/', requireOrgRole(['OWNER', 'ADMIN']), asyncHandler(createProperty));
propertiesRouter.get('/:id', asyncHandler(getProperty));
propertiesRouter.patch('/:id', requireOrgRole(['OWNER', 'ADMIN']), asyncHandler(updateProperty));

propertiesRouter.get('/:propertyId/spaces', asyncHandler(listSpacesForProperty));
propertiesRouter.post(
  '/:propertyId/spaces',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(createSpaceForProperty),
);
