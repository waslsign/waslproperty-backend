import type { Request, Response } from 'express';
import { NotFoundError, UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';

const prisma = getPrismaClient();

export async function getCurrentOrganisation(req: Request, res: Response) {
  if (!req.auth) {
    throw new UnauthorizedError();
  }

  const organisation = await prisma.organisation.findUnique({
    where: { id: req.auth.organisationId },
  });
  if (!organisation) {
    throw new NotFoundError('Organisation not found');
  }

  res.json({
    id: organisation.id,
    name: organisation.name,
    slug: organisation.slug,
    status: organisation.status,
    orgRole: req.auth.orgRole,
  });
}
