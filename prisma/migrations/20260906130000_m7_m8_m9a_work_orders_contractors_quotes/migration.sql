-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ContractorQuoteStatus" AS ENUM ('REQUESTED', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WorkflowMode" AS ENUM ('NONE', 'APPROVAL_ONLY', 'SIGNATURE_ONLY', 'APPROVAL_THEN_SIGNATURE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('PENDING', 'PARTIALLY_SIGNED', 'SIGNED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_STATUS_CHANGED';
ALTER TYPE "ActivityEventType" ADD VALUE 'CONTRACTOR_ASSIGNED';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_SUBMITTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_WORKFLOW_REQUESTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_APPROVED';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_REJECTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_SIGNING_STARTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_SIGNED';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_DECLINED';

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "spaceId" TEXT,
    "maintenanceRequestId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "MaintenancePriority" NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "estimatedCost" DECIMAL(10,2),
    "actualCost" DECIMAL(10,2),
    "contractorId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractors" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "status" "ContractorStatus" NOT NULL DEFAULT 'ACTIVE',
    "tradeTypes" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_quotes" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "description" TEXT,
    "status" "ContractorQuoteStatus" NOT NULL DEFAULT 'REQUESTED',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "workflowMode" "WorkflowMode",
    "approvalStatus" "ApprovalStatus",
    "approvedByUserId" TEXT,
    "signatureStatus" "SignatureStatus",
    "signedAt" TIMESTAMP(3),
    "waslSignAgreementId" TEXT,
    "waslSignStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waslsign_webhook_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "waslsign_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_orders_organisationId_idx" ON "work_orders"("organisationId");

-- CreateIndex
CREATE INDEX "work_orders_propertyId_idx" ON "work_orders"("propertyId");

-- CreateIndex
CREATE INDEX "work_orders_spaceId_idx" ON "work_orders"("spaceId");

-- CreateIndex
CREATE INDEX "work_orders_maintenanceRequestId_idx" ON "work_orders"("maintenanceRequestId");

-- CreateIndex
CREATE INDEX "work_orders_contractorId_idx" ON "work_orders"("contractorId");

-- CreateIndex
CREATE INDEX "contractors_organisationId_idx" ON "contractors"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "contractors_organisationId_email_key" ON "contractors"("organisationId", "email");

-- CreateIndex
CREATE INDEX "contractor_quotes_organisationId_idx" ON "contractor_quotes"("organisationId");

-- CreateIndex
CREATE INDEX "contractor_quotes_workOrderId_idx" ON "contractor_quotes"("workOrderId");

-- CreateIndex
CREATE INDEX "contractor_quotes_contractorId_idx" ON "contractor_quotes"("contractorId");

-- CreateIndex
CREATE INDEX "contractor_quotes_waslSignAgreementId_idx" ON "contractor_quotes"("waslSignAgreementId");

-- CreateIndex
CREATE UNIQUE INDEX "waslsign_webhook_events_eventId_key" ON "waslsign_webhook_events"("eventId");

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "maintenance_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_quotes" ADD CONSTRAINT "contractor_quotes_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_quotes" ADD CONSTRAINT "contractor_quotes_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_quotes" ADD CONSTRAINT "contractor_quotes_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_quotes" ADD CONSTRAINT "contractor_quotes_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

