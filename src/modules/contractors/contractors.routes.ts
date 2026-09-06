import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  createContractor,
  getContractor,
  listContractors,
  updateContractor,
} from './contractors.controller.js';

export const contractorsRouter = Router();

// Contractors are operational/vendor data — staff-only, no resident access at all.
contractorsRouter.use(authenticate, requireOrgRole(['OWNER', 'ADMIN']));

contractorsRouter.get('/', asyncHandler(listContractors));
contractorsRouter.post('/', asyncHandler(createContractor));
contractorsRouter.get('/:id', asyncHandler(getContractor));
contractorsRouter.patch('/:id', asyncHandler(updateContractor));
