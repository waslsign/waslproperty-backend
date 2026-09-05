import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { paginationQuerySchema } from '../../lib/pagination.js';
import { PeopleService } from './people.service.js';
import { addPersonSchema, peopleDirectoryQuerySchema } from './people.schemas.js';

const peopleService = new PeopleService(getPrismaClient());

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function addPersonToProperty(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = addPersonSchema.parse(req.body);
  const membership = await peopleService.addPerson(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.status(201).json(membership);
}

export async function listPeopleForProperty(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = paginationQuerySchema.parse(req.query);
  const result = await peopleService.listForProperty(
    auth.organisationId,
    req.params.propertyId as string,
    query,
  );
  res.json(result);
}

export async function listPeopleForSpace(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = paginationQuerySchema.parse(req.query);
  const result = await peopleService.listForSpace(
    auth.organisationId,
    req.params.id as string,
    query,
  );
  res.json(result);
}

export async function listPeopleDirectory(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = peopleDirectoryQuerySchema.parse(req.query);
  const result = await peopleService.listDirectory(auth.organisationId, query);
  res.json(result);
}
