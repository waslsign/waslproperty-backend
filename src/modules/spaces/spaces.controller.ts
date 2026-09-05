import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { paginationQuerySchema } from '../../lib/pagination.js';
import { SpacesService } from './spaces.service.js';
import { createSpaceSchema, updateSpaceSchema } from './spaces.schemas.js';

const spacesService = new SpacesService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listSpacesForProperty(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = paginationQuerySchema.parse(req.query);
  const result = await spacesService.listByProperty(
    auth.organisationId,
    req.params.propertyId as string,
    query,
  );
  res.json(result);
}

export async function createSpaceForProperty(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = createSpaceSchema.parse(req.body);
  const space = await spacesService.create(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.status(201).json(space);
}

export async function getSpace(req: Request, res: Response) {
  const auth = requireAuth(req);
  const space = await spacesService.getById(auth.organisationId, req.params.id as string);
  res.json(space);
}

export async function updateSpace(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateSpaceSchema.parse(req.body);
  const space = await spacesService.update(
    auth.organisationId,
    auth.userId,
    req.params.id as string,
    input,
  );
  res.json(space);
}
