import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireCapability } from '../../middlewares/authorize.middleware.js';
import { fromVariationParam, fromWorkOrderParam } from '../../middlewares/resolvePropertyId.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import {
  approveVariation,
  cancelVariation,
  createVariation,
  getCommercialSummary,
  listVariationAttachments,
  listVariations,
  presignVariationAttachment,
  registerVariationAttachment,
  rejectVariation,
  setVariationWorkflowMode,
} from './work-order-variations.controller.js';

export const workOrderVariationsRouter = Router();

workOrderVariationsRouter.use(authenticate);

workOrderVariationsRouter.get(
  '/work-order/:workOrderId',
  requireCapability('work_orders.view', fromWorkOrderParam('workOrderId')),
  asyncHandler(listVariations),
);
workOrderVariationsRouter.get(
  '/work-order/:workOrderId/commercial-summary',
  requireCapability('work_orders.view', fromWorkOrderParam('workOrderId')),
  asyncHandler(getCommercialSummary),
);
workOrderVariationsRouter.post(
  '/work-order/:workOrderId',
  requireCapability('work_orders.manage', fromWorkOrderParam('workOrderId')),
  asyncHandler(createVariation),
);
workOrderVariationsRouter.patch(
  '/:id/workflow-mode',
  requireCapability('work_orders.manage', fromVariationParam('id')),
  asyncHandler(setVariationWorkflowMode),
);
workOrderVariationsRouter.post(
  '/:id/approve',
  requireCapability('quotes.approve', fromVariationParam('id')),
  asyncHandler(approveVariation),
);
workOrderVariationsRouter.post(
  '/:id/reject',
  requireCapability('quotes.approve', fromVariationParam('id')),
  asyncHandler(rejectVariation),
);
workOrderVariationsRouter.post(
  '/:id/cancel',
  requireCapability('work_orders.manage', fromVariationParam('id')),
  asyncHandler(cancelVariation),
);
workOrderVariationsRouter.post(
  '/:id/attachments/presign',
  requireCapability('work_orders.manage', fromVariationParam('id')),
  asyncHandler(presignVariationAttachment),
);
workOrderVariationsRouter.post(
  '/:id/attachments',
  requireCapability('work_orders.manage', fromVariationParam('id')),
  asyncHandler(registerVariationAttachment),
);
workOrderVariationsRouter.get(
  '/:id/attachments',
  requireCapability('work_orders.view', fromVariationParam('id')),
  asyncHandler(listVariationAttachments),
);
