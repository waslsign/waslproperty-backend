import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { listActivityForProperty } from '../activity/activity.controller.js';
import { addPersonToProperty, listPeopleForProperty } from '../people/people.controller.js';
import { createSpaceForProperty, listSpacesForProperty } from '../spaces/spaces.controller.js';
import {
  createProperty,
  getProperty,
  getPropertyInsights,
  listProperties,
  updateProperty,
} from './properties.controller.js';

export const propertiesRouter = Router();

propertiesRouter.use(authenticate);

propertiesRouter.get('/', asyncHandler(listProperties));
propertiesRouter.post('/', requireOrgRole(['OWNER', 'ADMIN']), asyncHandler(createProperty));
propertiesRouter.get('/:id', asyncHandler(getProperty));
propertiesRouter.patch('/:id', requireOrgRole(['OWNER', 'ADMIN']), asyncHandler(updateProperty));
// Attention/operational data — same staff-only sensitivity as the org-wide
// dashboard (quote/work-order context residents must never see).
propertiesRouter.get(
  '/:id/insights',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(getPropertyInsights),
);

propertiesRouter.get('/:propertyId/spaces', asyncHandler(listSpacesForProperty));
propertiesRouter.post(
  '/:propertyId/spaces',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(createSpaceForProperty),
);

propertiesRouter.get('/:propertyId/memberships', asyncHandler(listPeopleForProperty));
propertiesRouter.post(
  '/:propertyId/memberships',
  requireOrgRole(['OWNER', 'ADMIN']),
  asyncHandler(addPersonToProperty),
);

propertiesRouter.get('/:propertyId/activity', asyncHandler(listActivityForProperty));
