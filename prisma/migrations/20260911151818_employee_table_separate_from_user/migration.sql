-- Introduces Employee as a fully separate identity from User (no email,
-- username-only login) and EmployeeSession as its own session table,
-- replacing PlatformUser. Existing platform_audit_events rows reference the
-- old User-based actor identity, which no longer exists once PlatformUser
-- is dropped — per explicit product decision, all existing Backoffice
-- users and their audit history are cleared as part of this migration.

-- DropForeignKey
ALTER TABLE "platform_audit_events" DROP CONSTRAINT "platform_audit_events_actorUserId_fkey";

-- DropForeignKey
ALTER TABLE "platform_users" DROP CONSTRAINT "platform_users_grantedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "platform_users" DROP CONSTRAINT "platform_users_userId_fkey";

-- DropIndex
DROP INDEX "platform_audit_events_actorUserId_idx";

-- Clear existing Backoffice audit history — it referenced the old
-- User-based actor identity, which is being removed below.
TRUNCATE TABLE "platform_audit_events";

-- AlterTable
ALTER TABLE "platform_audit_events" DROP COLUMN "actorUserId",
ADD COLUMN     "actorEmployeeId" TEXT NOT NULL;

-- DropTable
DROP TABLE "platform_users";

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "grantedByEmployeeId" TEXT,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_sessions" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "employee_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_username_key" ON "employees"("username");

-- CreateIndex
CREATE INDEX "employee_sessions_employeeId_idx" ON "employee_sessions"("employeeId");

-- CreateIndex
CREATE INDEX "platform_audit_events_actorEmployeeId_idx" ON "platform_audit_events"("actorEmployeeId");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_grantedByEmployeeId_fkey" FOREIGN KEY ("grantedByEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_sessions" ADD CONSTRAINT "employee_sessions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actorEmployeeId_fkey" FOREIGN KEY ("actorEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
