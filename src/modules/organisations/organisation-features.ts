import type { PrismaClient } from '@prisma/client';
import { ForbiddenError } from '../../errors/AppError.js';

/**
 * Every jurisdiction-specific organisation feature, in one place. Frontend
 * and backend both check these — never `organisation.countryCode === 'AU'`
 * scattered through route/component code — so a jurisdiction's feature set
 * can change without touching call sites. Mirrors the shape of
 * src/platform/capabilities.ts (PLATFORM_CAPABILITIES), the existing
 * precedent for this "named grant, centrally resolved" pattern.
 *
 * Add new features here (e.g. LEVY_MANAGEMENT, FUND_MANAGEMENT) once their
 * business rules are confirmed — see docs/m11-strata-requirements.md.
 */
export const ORGANISATION_FEATURES = ['STRATA_MANAGEMENT'] as const;

export type OrganisationFeature = (typeof ORGANISATION_FEATURES)[number];

/**
 * The default feature set granted by each jurisdiction. Currency is
 * deliberately not consulted here — jurisdiction and currency are
 * independent organisation properties (see Organisation.countryCode's own
 * doc comment) and must never be conflated.
 */
const COUNTRY_FEATURES: Partial<Record<string, OrganisationFeature[]>> = {
  AU: ['STRATA_MANAGEMENT'],
};

/** No countryCode set (the default for every existing/unmigrated
 * organisation) resolves to zero features — never assume a jurisdiction. */
export function resolveOrganisationFeatures(
  countryCode: string | null | undefined,
): OrganisationFeature[] {
  if (!countryCode) return [];
  return COUNTRY_FEATURES[countryCode] ?? [];
}

export function organisationHasFeature(
  countryCode: string | null | undefined,
  feature: OrganisationFeature,
): boolean {
  return resolveOrganisationFeatures(countryCode).includes(feature);
}

/**
 * The backend-enforcement half of feature gating — hiding UI alone is never
 * sufficient. Call this from any service method that writes data gated
 * behind a jurisdiction feature (e.g. setting Property.isStrataManaged).
 * Throws ForbiddenError, never silently no-ops, so a caller that races past
 * a hidden UI control still gets a clear rejection.
 */
export async function assertOrganisationFeature(
  prisma: PrismaClient,
  organisationId: string,
  feature: OrganisationFeature,
): Promise<void> {
  const organisation = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: { countryCode: true },
  });
  if (!organisation || !organisationHasFeature(organisation.countryCode, feature)) {
    throw new ForbiddenError(`This organisation does not have ${feature} enabled`);
  }
}
