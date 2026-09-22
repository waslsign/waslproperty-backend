-- Configurable property-scoped Roles & Permissions. Purely additive: a new
-- table only, no changes to any existing column. An organisation with no
-- rows here behaves exactly like the WaslProp system defaults (see
-- src/modules/authorization/capabilities.ts) — nothing to backfill.

CREATE TABLE "organisation_role_permissions" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "role" "PropertyRole" NOT NULL,
    "capability" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organisation_role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organisation_role_permissions_organisationId_idx" ON "organisation_role_permissions"("organisationId");

CREATE UNIQUE INDEX "organisation_role_permissions_organisationId_role_capabilit_key" ON "organisation_role_permissions"("organisationId", "role", "capability");

ALTER TABLE "organisation_role_permissions" ADD CONSTRAINT "organisation_role_permissions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
