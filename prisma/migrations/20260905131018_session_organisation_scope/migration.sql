-- Sessions are pinned to exactly one organisation for their whole lifetime.
-- Add the column nullable first so existing rows can be backfilled before
-- the NOT NULL constraint is enforced.
ALTER TABLE "sessions" ADD COLUMN "organisationId" TEXT;

-- Backfill: prefer an active staff membership, else an active resident
-- contact — mirrors the historical (pre-multi-org) resolution order so
-- existing sessions keep pointing at the same organisation they were
-- actually issued for in the common (single-org) case.
UPDATE "sessions" s
SET "organisationId" = COALESCE(
  (
    SELECT om."organisationId"
    FROM "organisation_memberships" om
    WHERE om."userId" = s."userId" AND om.status = 'ACTIVE'
    ORDER BY om."createdAt" ASC
    LIMIT 1
  ),
  (
    SELECT pc."organisationId"
    FROM "property_contacts" pc
    WHERE pc."userId" = s."userId" AND pc.status = 'ACTIVE'
    LIMIT 1
  )
);

-- Any session that can't be resolved to an organisation (the user has no
-- current active relationship anywhere) is stale — drop it rather than
-- leave a NULL that the NOT NULL constraint below would reject. The
-- affected user simply logs in again.
DELETE FROM "sessions" WHERE "organisationId" IS NULL;

ALTER TABLE "sessions" ALTER COLUMN "organisationId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "sessions_organisationId_idx" ON "sessions"("organisationId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
