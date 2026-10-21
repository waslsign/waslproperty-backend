import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { authorizationService } from '../../middlewares/authorize.middleware.js';
import {
  createAllocationSchema,
  listReceiptsQuerySchema,
  recordReceiptSchema,
  reverseAllocationSchema,
  reverseReceiptSchema,
} from './receipts.schemas.js';
import { ReceiptsService } from './receipts.service.js';

const receiptsService = new ReceiptsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function recordReceipt(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = recordReceiptSchema.parse(req.body);
  const receipt = await receiptsService.recordReceipt(auth.organisationId, auth.userId, req.params.propertyId as string, input);
  res.status(201).json(receipt);
}

export async function listReceipts(req: Request, res: Response) {
  const auth = requireAuth(req);
  const propertyId = req.params.propertyId as string;
  const query = listReceiptsQuerySchema.parse(req.query);
  const includeOwnerNames = await authorizationService.can(auth, 'people.view', propertyId);
  const items = await receiptsService.listReceipts(auth.organisationId, propertyId, query, includeOwnerNames);
  res.json({ items });
}

export async function getReceipt(req: Request, res: Response) {
  const auth = requireAuth(req);
  const propertyId = req.params.propertyId as string;
  const includeOwnerNames = await authorizationService.can(auth, 'people.view', propertyId);
  const receipt = await receiptsService.getReceipt(auth.organisationId, propertyId, req.params.receiptId as string, includeOwnerNames);
  res.json(receipt);
}

export async function reverseReceipt(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = reverseReceiptSchema.parse(req.body);
  const receipt = await receiptsService.reverseReceipt(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.receiptId as string,
    input.reason,
  );
  res.status(201).json(receipt);
}

export async function createAllocation(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createAllocationSchema.parse(req.body);
  const allocation = await receiptsService.createAllocation(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.receiptId as string,
    input,
  );
  res.status(201).json(allocation);
}

export async function reverseAllocation(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = reverseAllocationSchema.parse(req.body);
  const allocation = await receiptsService.reverseAllocation(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    req.params.allocationId as string,
    input.reason,
  );
  res.status(201).json(allocation);
}
