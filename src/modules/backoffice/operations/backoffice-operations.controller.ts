import type { Request, Response } from 'express';
import { getPrismaClient } from '../../../lib/prisma.js';
import { paginationQuerySchema } from '../../../lib/pagination.js';
import { BackofficeOperationsService } from './backoffice-operations.service.js';

const service = new BackofficeOperationsService(getPrismaClient());

export async function listBackofficeRequests(req: Request, res: Response) {
  res.json(await service.listRequests(paginationQuerySchema.parse(req.query)));
}

export async function listBackofficeWorkOrders(req: Request, res: Response) {
  res.json(await service.listWorkOrders(paginationQuerySchema.parse(req.query)));
}

export async function listBackofficeContractors(req: Request, res: Response) {
  res.json(await service.listContractors(paginationQuerySchema.parse(req.query)));
}

export async function listBackofficeQuotes(req: Request, res: Response) {
  res.json(await service.listQuotes(paginationQuerySchema.parse(req.query)));
}
