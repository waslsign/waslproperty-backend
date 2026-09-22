import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { paginationQuerySchema } from '../../lib/pagination.js';
import { AuthService } from '../auth/auth.service.js';
import { InvitesService } from '../invites/invites.service.js';
import { PeopleService } from './people.service.js';
import {
  addPersonSchema,
  assignExistingPersonSchema,
  peopleDirectoryQuerySchema,
  searchContactsQuerySchema,
  updateMembershipSchema,
} from './people.schemas.js';

const peopleService = new PeopleService(getPrismaClient());
const invitesService = new InvitesService(getPrismaClient(), new AuthService(getPrismaClient()));

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

export async function assignExistingPerson(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = assignExistingPersonSchema.parse(req.body);
  const membership = await peopleService.assignExistingPerson(
    auth.organisationId,
    auth.userId,
    req.params.propertyId as string,
    input,
  );
  res.status(201).json(membership);
}

export async function searchContacts(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = searchContactsQuerySchema.parse(req.query);
  const items = await peopleService.searchContacts(auth.organisationId, query.search);
  res.json({ items });
}

export async function updateMembership(req: Request, res: Response) {
  const auth = requireAuth(req);
  const input = updateMembershipSchema.parse(req.body);
  const membership = await peopleService.updateMembership(
    auth.organisationId,
    auth.userId,
    req.params.membershipId as string,
    input,
  );
  res.json(membership);
}

export async function endMembership(req: Request, res: Response) {
  const auth = requireAuth(req);
  const membership = await peopleService.endMembership(
    auth.organisationId,
    auth.userId,
    req.params.membershipId as string,
  );
  res.json(membership);
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

export async function listMyMemberships(req: Request, res: Response) {
  const auth = requireAuth(req);
  const memberships = await peopleService.listMyMemberships(auth.organisationId, auth.userId);
  res.json({ items: memberships });
}

export async function listPeopleDirectory(req: Request, res: Response) {
  const auth = requireAuth(req);
  const query = peopleDirectoryQuerySchema.parse(req.query);
  const result = await peopleService.listDirectory(auth.organisationId, auth, query);
  res.json(result);
}

export async function inviteContact(req: Request, res: Response) {
  const auth = requireAuth(req);
  const invite = await invitesService.createInvite(
    auth.organisationId,
    auth.userId,
    req.params.contactId as string,
  );
  res.status(201).json(invite);
}

export async function resendContactInvite(req: Request, res: Response) {
  const auth = requireAuth(req);
  const invite = await invitesService.resendInvite(
    auth.organisationId,
    auth.userId,
    req.params.contactId as string,
  );
  res.json(invite);
}

export async function revokeContactInvite(req: Request, res: Response) {
  const auth = requireAuth(req);
  const invite = await invitesService.revokeInvite(
    auth.organisationId,
    req.params.contactId as string,
  );
  res.json(invite);
}
