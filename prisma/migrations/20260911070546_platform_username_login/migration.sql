-- AlterTable: add the Backoffice login identifier. The table has no rows
-- at migration time in every environment this has been applied to so far,
-- so this is safe as NOT NULL with no backfill step; if that's ever not
-- true, deactivate/backfill affected rows before re-running.
ALTER TABLE "platform_users" ADD COLUMN "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_username_key" ON "platform_users"("username");

ALTER TABLE "platform_users" ALTER COLUMN "username" SET NOT NULL;
