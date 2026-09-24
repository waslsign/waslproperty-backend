-- CreateEnum
CREATE TYPE "ContractorQuoteSource" AS ENUM ('MANUAL', 'CONTRACTOR_PORTAL');

-- CreateEnum
CREATE TYPE "ProcurementPath" AS ENUM ('REQUEST_QUOTES', 'DIRECT_WORK', 'EMERGENCY_WORK');

-- CreateEnum
CREATE TYPE "QuoteRoundStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED', 'AWARDED');

-- CreateEnum
CREATE TYPE "WorkOrderVariationStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'PROCUREMENT_PATH_CHOSEN';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_ROUND_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_ROUND_CONTRACTOR_INVITED';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_ROUND_QUOTE_WITHDRAWN';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_SELECTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_ROUND_AWARDED';
ALTER TYPE "ActivityEventType" ADD VALUE 'QUOTE_ROUND_CANCELLED';
ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_AUTHORISED';
ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_VARIATION_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_VARIATION_APPROVED';
ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_VARIATION_REJECTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_VARIATION_CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContractorQuoteStatus" ADD VALUE 'DECLINED';
ALTER TYPE "ContractorQuoteStatus" ADD VALUE 'WITHDRAWN';
ALTER TYPE "ContractorQuoteStatus" ADD VALUE 'NOT_SELECTED';

-- DropForeignKey
ALTER TABLE "contractor_quotes" DROP CONSTRAINT "contractor_quotes_workOrderId_fkey";

-- AlterTable
ALTER TABLE "contractor_quotes" ADD COLUMN     "declinedAt" TIMESTAMP(3),
ADD COLUMN     "estimatedDuration" TEXT,
ADD COLUMN     "exclusions" TEXT,
ADD COLUMN     "inclusions" TEXT,
ADD COLUMN     "proposedStartAt" TIMESTAMP(3),
ADD COLUMN     "quoteRoundId" TEXT,
ADD COLUMN     "selectedAt" TIMESTAMP(3),
ADD COLUMN     "selectedByUserId" TEXT,
ADD COLUMN     "source" "ContractorQuoteSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "warrantyInfo" TEXT,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3),
ALTER COLUMN "workOrderId" DROP NOT NULL,
ALTER COLUMN "amount" DROP NOT NULL;

-- AlterTable
ALTER TABLE "maintenance_requests" ADD COLUMN     "procurementPath" "ProcurementPath";

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "quoteRoundId" TEXT,
ADD COLUMN     "selectedQuoteId" TEXT;

-- CreateTable
CREATE TABLE "quote_rounds" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "spaceId" TEXT,
    "maintenanceRequestId" TEXT NOT NULL,
    "category" "MaintenanceCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "scopeDescription" TEXT NOT NULL,
    "priority" "MaintenancePriority" NOT NULL,
    "accessInstructions" TEXT,
    "desiredStartAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "currencyCode" TEXT NOT NULL,
    "status" "QuoteRoundStatus" NOT NULL DEFAULT 'OPEN',
    "cancelledAt" TIMESTAMP(3),
    "awardedQuoteId" TEXT,
    "awardedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_round_invitations" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "quoteRoundId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_round_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_quote_attachments" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "contractorQuoteId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_quote_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_variations" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountDelta" DECIMAL(10,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "status" "WorkOrderVariationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "recordedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_order_variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_variation_attachments" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workOrderVariationId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_variation_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quote_rounds_awardedQuoteId_key" ON "quote_rounds"("awardedQuoteId");

-- CreateIndex
CREATE INDEX "quote_rounds_organisationId_idx" ON "quote_rounds"("organisationId");

-- CreateIndex
CREATE INDEX "quote_rounds_propertyId_idx" ON "quote_rounds"("propertyId");

-- CreateIndex
CREATE INDEX "quote_rounds_maintenanceRequestId_idx" ON "quote_rounds"("maintenanceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_round_invitations_quoteId_key" ON "quote_round_invitations"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_round_invitations_tokenHash_key" ON "quote_round_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "quote_round_invitations_organisationId_idx" ON "quote_round_invitations"("organisationId");

-- CreateIndex
CREATE INDEX "quote_round_invitations_quoteRoundId_idx" ON "quote_round_invitations"("quoteRoundId");

-- CreateIndex
CREATE INDEX "quote_round_invitations_contractorId_idx" ON "quote_round_invitations"("contractorId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_round_invitations_quoteRoundId_contractorId_key" ON "quote_round_invitations"("quoteRoundId", "contractorId");

-- CreateIndex
CREATE INDEX "contractor_quote_attachments_organisationId_idx" ON "contractor_quote_attachments"("organisationId");

-- CreateIndex
CREATE INDEX "contractor_quote_attachments_contractorQuoteId_idx" ON "contractor_quote_attachments"("contractorQuoteId");

-- CreateIndex
CREATE INDEX "work_order_variations_organisationId_idx" ON "work_order_variations"("organisationId");

-- CreateIndex
CREATE INDEX "work_order_variations_workOrderId_idx" ON "work_order_variations"("workOrderId");

-- CreateIndex
CREATE INDEX "work_order_variation_attachments_organisationId_idx" ON "work_order_variation_attachments"("organisationId");

-- CreateIndex
CREATE INDEX "work_order_variation_attachments_workOrderVariationId_idx" ON "work_order_variation_attachments"("workOrderVariationId");

-- CreateIndex
CREATE INDEX "contractor_quotes_quoteRoundId_idx" ON "contractor_quotes"("quoteRoundId");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_selectedQuoteId_key" ON "work_orders"("selectedQuoteId");

-- CreateIndex
CREATE INDEX "work_orders_quoteRoundId_idx" ON "work_orders"("quoteRoundId");

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_selectedQuoteId_fkey" FOREIGN KEY ("selectedQuoteId") REFERENCES "contractor_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_quoteRoundId_fkey" FOREIGN KEY ("quoteRoundId") REFERENCES "quote_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_quotes" ADD CONSTRAINT "contractor_quotes_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_quotes" ADD CONSTRAINT "contractor_quotes_quoteRoundId_fkey" FOREIGN KEY ("quoteRoundId") REFERENCES "quote_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_quotes" ADD CONSTRAINT "contractor_quotes_selectedByUserId_fkey" FOREIGN KEY ("selectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_rounds" ADD CONSTRAINT "quote_rounds_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_rounds" ADD CONSTRAINT "quote_rounds_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_rounds" ADD CONSTRAINT "quote_rounds_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_rounds" ADD CONSTRAINT "quote_rounds_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "maintenance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_rounds" ADD CONSTRAINT "quote_rounds_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_rounds" ADD CONSTRAINT "quote_rounds_awardedQuoteId_fkey" FOREIGN KEY ("awardedQuoteId") REFERENCES "contractor_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_round_invitations" ADD CONSTRAINT "quote_round_invitations_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_round_invitations" ADD CONSTRAINT "quote_round_invitations_quoteRoundId_fkey" FOREIGN KEY ("quoteRoundId") REFERENCES "quote_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_round_invitations" ADD CONSTRAINT "quote_round_invitations_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_round_invitations" ADD CONSTRAINT "quote_round_invitations_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "contractor_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_round_invitations" ADD CONSTRAINT "quote_round_invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_quote_attachments" ADD CONSTRAINT "contractor_quote_attachments_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_quote_attachments" ADD CONSTRAINT "contractor_quote_attachments_contractorQuoteId_fkey" FOREIGN KEY ("contractorQuoteId") REFERENCES "contractor_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_quote_attachments" ADD CONSTRAINT "contractor_quote_attachments_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_variations" ADD CONSTRAINT "work_order_variations_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_variations" ADD CONSTRAINT "work_order_variations_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_variations" ADD CONSTRAINT "work_order_variations_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_variations" ADD CONSTRAINT "work_order_variations_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_variation_attachments" ADD CONSTRAINT "work_order_variation_attachments_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_variation_attachments" ADD CONSTRAINT "work_order_variation_attachments_workOrderVariationId_fkey" FOREIGN KEY ("workOrderVariationId") REFERENCES "work_order_variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_variation_attachments" ADD CONSTRAINT "work_order_variation_attachments_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

