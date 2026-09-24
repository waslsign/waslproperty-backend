import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireCapability } from '../../middlewares/authorize.middleware.js';
import { fromQuoteParam } from '../../middlewares/resolvePropertyId.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  approveQuote,
  createQuote,
  declineQuote,
  getQuote,
  rejectQuote,
  setQuoteWorkflowMode,
  submitQuote,
  withdrawQuote,
} from './quotes.controller.js';

export const quotesRouter = Router();

const prisma = getPrismaClient();

// Quotes carry cost/contractor/workflow data — never resident-visible.
quotesRouter.use(authenticate);

quotesRouter.post(
  '/',
  requireCapability('quotes.manage', async (req) => {
    const workOrderId = req.body?.workOrderId as string | undefined;
    if (!workOrderId || !req.auth) return undefined;
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, organisationId: req.auth.organisationId },
      select: { propertyId: true },
    });
    return workOrder?.propertyId;
  }),
  asyncHandler(createQuote),
);
quotesRouter.get(
  '/:id',
  requireCapability('quotes.view', fromQuoteParam('id')),
  asyncHandler(getQuote),
);
quotesRouter.patch(
  '/:id/submit',
  requireCapability('quotes.manage', fromQuoteParam('id')),
  asyncHandler(submitQuote),
);
quotesRouter.patch(
  '/:id/workflow-mode',
  requireCapability('quotes.manage', fromQuoteParam('id')),
  asyncHandler(setQuoteWorkflowMode),
);
quotesRouter.patch(
  '/:id/decline',
  requireCapability('quotes.manage', fromQuoteParam('id')),
  asyncHandler(declineQuote),
);
quotesRouter.patch(
  '/:id/withdraw',
  requireCapability('quotes.manage', fromQuoteParam('id')),
  asyncHandler(withdrawQuote),
);
quotesRouter.post(
  '/:id/approve',
  requireCapability('quotes.approve', fromQuoteParam('id')),
  asyncHandler(approveQuote),
);
quotesRouter.post(
  '/:id/reject',
  requireCapability('quotes.approve', fromQuoteParam('id')),
  asyncHandler(rejectQuote),
);
