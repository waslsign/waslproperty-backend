import type { Request, Response } from 'express';
import { NotFoundError, UnauthorizedError } from '../../errors/AppError.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { updateOrganisationCurrencySchema } from './organisations.schemas.js';

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
    currencyCode: organisation.currencyCode,
    orgRole: req.auth.orgRole,
    accountType: req.auth.orgRole ? 'staff' : 'resident',
    propertyContactId: req.auth.propertyContactId ?? null,
  });
}

/** OWNER/ADMIN only (see organisations.routes.ts) — changing this only
 * affects the default new financial records are created with going
 * forward; it never mutates an existing WorkOrder/ContractorQuote's own
 * currencyCode. */
export async function updateOrganisationCurrency(req: Request, res: Response) {
  if (!req.auth) {
    throw new UnauthorizedError();
  }
  const input = updateOrganisationCurrencySchema.parse(req.body);

  const organisation = await prisma.organisation.update({
    where: { id: req.auth.organisationId },
    data: { currencyCode: input.currencyCode },
  });

  res.json({
    id: organisation.id,
    name: organisation.name,
    slug: organisation.slug,
    status: organisation.status,
    currencyCode: organisation.currencyCode,
  });
}
