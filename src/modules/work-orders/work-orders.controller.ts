import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { WorkOrdersService } from './work-orders.service.js';
import {
  assignContractorSchema,
  createWorkOrderSchema,
  updateCostSchema,
  updateStatusSchema,
  workOrderQuerySchema,
} from './work-orders.schemas.js';

const workOrdersService = new WorkOrdersService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function createWorkOrder(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createWorkOrderSchema.parse(req.body);
  const workOrder = await workOrdersService.create(auth.organisationId, auth.userId, input);
  res.status(201).json(workOrder);
}

export async function listWorkOrders(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = workOrderQuerySchema.parse(req.query);
  const result = await workOrdersService.list(auth.organisationId, auth, query);
  res.json(result);
}

export async function getWorkOrder(req: Request, res: Response) {
  const auth = requireAuth(req);
  const workOrder = await workOrdersService.getById(auth.organisationId, req.params.id as string);
  res.json(workOrder);
}

export async function getWorkOrderByMaintenanceRequest(req: Request, res: Response) {
  const auth = requireAuth(req);
  const workOrder = await workOrdersService.findByMaintenanceRequestId(
    auth.organisationId,
    req.params.maintenanceRequestId as string,
  );
  res.json(workOrder);
}

export async function updateWorkOrderStatus(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateStatusSchema.parse(req.body);
  const workOrder = await workOrdersService.updateStatus(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input,
  );
  res.json(workOrder);
}

export async function assignWorkOrderContractor(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = assignContractorSchema.parse(req.body);
  const workOrder = await workOrdersService.assignContractor(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input,
  );
  res.json(workOrder);
}

export async function getWorkOrderContractorEligibility(req: Request, res: Response) {
  const auth = requireAuth(req);
  const result = await workOrdersService.listContractorEligibility(
    auth.organisationId,
    req.params.id as string,
  );
  res.json(result);
}

export async function updateWorkOrderCost(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateCostSchema.parse(req.body);
  const workOrder = await workOrdersService.updateCost(
    auth.organisationId,
    req.params.id as string,
    input,
  );
  res.json(workOrder);
}
