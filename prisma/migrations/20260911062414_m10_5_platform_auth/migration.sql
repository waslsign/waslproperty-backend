-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('CUSTOMER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'PLATFORM_DEVELOPER');

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_organisationId_fkey";

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "sessionType" "SessionType" NOT NULL DEFAULT 'CUSTOMER',
ALTER COLUMN "organisationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "platform_users" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "grantedByUserId" TEXT,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_events" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "platformRole" "PlatformRole" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "organisationId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "environment" TEXT NOT NULL,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_userId_key" ON "platform_users"("userId");

-- CreateIndex
CREATE INDEX "platform_audit_events_actorUserId_idx" ON "platform_audit_events"("actorUserId");

-- CreateIndex
CREATE INDEX "platform_audit_events_entityType_entityId_idx" ON "platform_audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "platform_audit_events_organisationId_idx" ON "platform_audit_events"("organisationId");

-- CreateIndex
CREATE INDEX "platform_audit_events_createdAt_idx" ON "platform_audit_events"("createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: a CUSTOMER session must carry an organisationId; a
-- PLATFORM session must not. Enforced at the DB, not just in application
-- code, so a bug in token-issuing code can never produce an inconsistent
-- session row.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_type_organisation_consistency" CHECK (
    ("sessionType" = 'CUSTOMER' AND "organisationId" IS NOT NULL)
    OR
    ("sessionType" = 'PLATFORM' AND "organisationId" IS NULL)
);
