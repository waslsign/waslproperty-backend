import { Router } from 'express';
import { authenticate, requireOrgRole } from '../../middlewares/auth.middleware.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  approveQuote,
  createQuote,
  getQuote,
  rejectQuote,
  setQuoteWorkflowMode,
  submitQuote,
} from './quotes.controller.js';

export const quotesRouter = Router();

// Quotes carry cost/contractor/workflow data — staff-only, no resident access.
quotesRouter.use(authenticate, requireOrgRole(['OWNER', 'ADMIN']));

quotesRouter.post('/', asyncHandler(createQuote));
quotesRouter.get('/:id', asyncHandler(getQuote));
quotesRouter.patch('/:id/submit', asyncHandler(submitQuote));
quotesRouter.patch('/:id/workflow-mode', asyncHandler(setQuoteWorkflowMode));
quotesRouter.post('/:id/approve', asyncHandler(approveQuote));
quotesRouter.post('/:id/reject', asyncHandler(rejectQuote));
