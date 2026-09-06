import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { ContractorsService } from './contractors.service.js';
import {
  contractorQuerySchema,
  createContractorSchema,
  updateContractorSchema,
} from './contractors.schemas.js';

const contractorsService = new ContractorsService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function createContractor(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createContractorSchema.parse(req.body);
  const contractor = await contractorsService.create(auth.organisationId, input);
  res.status(201).json(contractor);
}

export async function listContractors(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = contractorQuerySchema.parse(req.query);
  const result = await contractorsService.list(auth.organisationId, query);
  res.json(result);
}

export async function getContractor(req: Request, res: Response) {
  const auth = requireAuth(req);
  const contractor = await contractorsService.getById(auth.organisationId, req.params.id as string);
  res.json(contractor);
}

export async function updateContractor(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateContractorSchema.parse(req.body);
  const contractor = await contractorsService.update(
    auth.organisationId,
    req.params.id as string,
    input,
  );
  res.json(contractor);
}
