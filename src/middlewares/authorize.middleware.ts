import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../errors/AppError.js';
import { getPrismaClient } from '../lib/prisma.js';
import { AuthorizationService } from '../modules/authorization/authorization.service.js';
import type { Capability } from '../modules/authorization/capabilities.js';

export const authorizationService = new AuthorizationService(getPrismaClient());

/**
 * Backend-authoritative capability gate — replaces `requireOrgRole(['OWNER',
 * 'ADMIN'])` on routes that must also admit property-scoped users (see the
 * property-role-authorization milestone). OWNER/ADMIN and MEMBER's existing
 * access are unaffected (AuthorizationService.can handles that); this
 * middleware is only the entry check — every list/aggregate endpoint must
 * ADDITIONALLY scope its own query via
 * `authorizationService.getAccessiblePropertyIds`, since a user can be
 * authorized for the route while only being allowed to see a subset of the
 * organisation's rows.
 *
 * `resolvePropertyId` is required for any route that names a specific
 * resource — without it, this only checks "does the user have this
 * capability on ANY property" (correct for collection routes like `GET
 * /work-orders`, where the service does the real per-row filtering
 * afterwards; NEVER sufficient on its own for a route that reads/writes one
 * specific resource by id).
 */
export function requireCapability(
  capability: Capability,
  resolvePropertyId?: (req: Request) => Promise<string | undefined>,
) {
  // Express 4 does not catch rejected promises from async middleware — an
  // uncaught throw here would leave the request hanging (no response, no
  // error handler invoked) rather than producing a 403. Every exit path
  // routes through `next`, matching the codebase's existing `asyncHandler`
  // convention for the same reason.
  return (req: Request, _res: Response, next: NextFunction) => {
    void (async () => {
      if (!req.auth) throw new UnauthorizedError();
      const propertyId = resolvePropertyId ? await resolvePropertyId(req) : undefined;
      const allowed = await authorizationService.can(req.auth, capability, propertyId);
      if (!allowed) {
        // A resolver was given but couldn't resolve the named resource
        // (wrong organisation, or it genuinely doesn't exist) — 404, never
        // 403, so a cross-organisation id can't be distinguished from a
        // nonexistent one. A resolved, real propertyId the caller simply
        // lacks the capability on (or no resolver at all — a coarse
        // collection-level check) is a genuine 403.
        if (resolvePropertyId && propertyId === undefined) {
          throw new NotFoundError('Resource not found');
        }
        throw new ForbiddenError(`Missing required capability: ${capability}`);
      }
      next();
    })().catch(next);
  };
}
