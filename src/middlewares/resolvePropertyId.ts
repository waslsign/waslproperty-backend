import type { Request } from 'express';
import { getPrismaClient } from '../lib/prisma.js';

const prisma = getPrismaClient();

/** propertyId is a route param directly (e.g. /properties/:id,
 * /properties/:propertyId/...) — still validated against the caller's own
 * organisation before being trusted, exactly like every other resolver
 * here. Undefined if the property doesn't exist or belongs to a different
 * organisation, so a cross-org id can never be distinguished from a
 * genuinely nonexistent one (see requireCapability's NotFoundError
 * handling for an unresolved id). */
export function fromParam(paramName: string) {
  return async (req: Request) => {
    if (!req.auth) return undefined;
    const property = await prisma.property.findFirst({
      where: { id: req.params[paramName], organisationId: req.auth.organisationId },
      select: { id: true },
    });
    return property?.id;
  };
}

/** Resolves via Space.propertyId — for routes addressed by spaceId
 * (e.g. /spaces/:id). Undefined (never a propertyId) if the space doesn't
 * exist or isn't in the caller's organisation — the capability check then
 * correctly fails closed, and the controller's own NotFoundError still
 * fires when it re-fetches. */
export function fromSpaceParam(paramName: string) {
  return async (req: Request) => {
    if (!req.auth) return undefined;
    const space = await prisma.space.findFirst({
      where: { id: req.params[paramName], organisationId: req.auth.organisationId },
      select: { propertyId: true },
    });
    return space?.propertyId;
  };
}

/** Resolves via WorkOrder.propertyId — for routes addressed by
 * workOrderId. */
export function fromWorkOrderParam(paramName: string) {
  return async (req: Request) => {
    if (!req.auth) return undefined;
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: req.params[paramName], organisationId: req.auth.organisationId },
      select: { propertyId: true },
    });
    return workOrder?.propertyId;
  };
}

/** Resolves via ContractorQuote -> WorkOrder.propertyId (once awarded) or
 * -> QuoteRound.propertyId (before award, the RFQ path's only property
 * link) — for routes addressed by quoteId. */
export function fromQuoteParam(paramName: string) {
  return async (req: Request) => {
    if (!req.auth) return undefined;
    const quote = await prisma.contractorQuote.findFirst({
      where: { id: req.params[paramName], organisationId: req.auth.organisationId },
      select: {
        workOrder: { select: { propertyId: true } },
        quoteRound: { select: { propertyId: true } },
      },
    });
    return quote?.workOrder?.propertyId ?? quote?.quoteRound?.propertyId;
  };
}

/** Resolves via WorkOrderVariation -> WorkOrder.propertyId — for routes
 * addressed by variationId. */
export function fromVariationParam(paramName: string) {
  return async (req: Request) => {
    if (!req.auth) return undefined;
    const variation = await prisma.workOrderVariation.findFirst({
      where: { id: req.params[paramName], organisationId: req.auth.organisationId },
      select: { workOrder: { select: { propertyId: true } } },
    });
    return variation?.workOrder.propertyId;
  };
}

/** Resolves via QuoteRound.propertyId — for routes addressed by
 * quoteRoundId. */
export function fromQuoteRoundParam(paramName: string) {
  return async (req: Request) => {
    if (!req.auth) return undefined;
    const round = await prisma.quoteRound.findFirst({
      where: { id: req.params[paramName], organisationId: req.auth.organisationId },
      select: { propertyId: true },
    });
    return round?.propertyId;
  };
}

/** Resolves via MaintenanceRequest.propertyId — for routes addressed by
 * requestId. */
export function fromMaintenanceRequestParam(paramName: string) {
  return async (req: Request) => {
    if (!req.auth) return undefined;
    const request = await prisma.maintenanceRequest.findFirst({
      where: { id: req.params[paramName], organisationId: req.auth.organisationId },
      select: { propertyId: true },
    });
    return request?.propertyId ?? undefined;
  };
}

/** Resolves via PropertyMembership.propertyId — for routes addressed by
 * membershipId. */
export function fromMembershipParam(paramName: string) {
  return async (req: Request) => {
    if (!req.auth) return undefined;
    const membership = await prisma.propertyMembership.findFirst({
      where: { id: req.params[paramName], organisationId: req.auth.organisationId },
      select: { propertyId: true },
    });
    return membership?.propertyId;
  };
}

/** Resolves via PropertyContact's most relevant ACTIVE membership property
 * — for contact-addressed invite routes (a contact can have several
 * memberships; any one of them being manageable is sufficient, since the
 * capability check itself still requires `people.manage` on that specific
 * property). Returns the first active membership's propertyId; if the
 * caller can manage that property, invite/resend/revoke is allowed. */
export function fromContactParam(paramName: string) {
  return async (req: Request) => {
    if (!req.auth) return undefined;
    const membership = await prisma.propertyMembership.findFirst({
      where: {
        contactId: req.params[paramName],
        organisationId: req.auth.organisationId,
        status: 'ACTIVE',
      },
      select: { propertyId: true },
    });
    return membership?.propertyId;
  };
}
