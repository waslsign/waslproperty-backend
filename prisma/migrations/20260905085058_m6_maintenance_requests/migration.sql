-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('PLUMBING', 'ELECTRICAL', 'HVAC', 'APPLIANCE', 'STRUCTURAL', 'COMMON_AREA', 'SECURITY', 'CLEANING', 'PEST_CONTROL', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MaintenanceRequestStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'MAINTENANCE_REQUEST_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'MAINTENANCE_REQUEST_STATUS_CHANGED';
ALTER TYPE "ActivityEventType" ADD VALUE 'MAINTENANCE_REQUEST_UPDATED';

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "spaceId" TEXT,
    "reportedByUserId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "MaintenanceCategory" NOT NULL,
    "priority" "MaintenancePriority" NOT NULL,
    "status" "MaintenanceRequestStatus" NOT NULL DEFAULT 'NEW',
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_requests_organisationId_idx" ON "maintenance_requests"("organisationId");

-- CreateIndex
CREATE INDEX "maintenance_requests_propertyId_idx" ON "maintenance_requests"("propertyId");

-- CreateIndex
CREATE INDEX "maintenance_requests_spaceId_idx" ON "maintenance_requests"("spaceId");

-- CreateIndex
CREATE INDEX "maintenance_requests_reportedByUserId_idx" ON "maintenance_requests"("reportedByUserId");

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

