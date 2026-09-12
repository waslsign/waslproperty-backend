-- M11-A Strata Foundation. Purely additive: every new column is nullable or
-- defaulted, so every existing organisation/property/space keeps working
-- unchanged. Organisation.countryCode defaults to NULL (unknown jurisdiction)
-- for every existing organisation, which resolves to zero jurisdiction
-- features (see organisation-features.ts) — existing organisations are never
-- silently opted into Australian strata functionality by this migration.

ALTER TABLE "organisations" ADD COLUMN     "countryCode" TEXT;

ALTER TABLE "properties" ADD COLUMN     "isStrataManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "strataPlanNumber" TEXT,
ADD COLUMN     "strataSchemeName" TEXT;

ALTER TABLE "spaces" ADD COLUMN     "entitlementValue" DECIMAL(12,2),
ADD COLUMN     "isStrataLot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lotNumber" TEXT;
