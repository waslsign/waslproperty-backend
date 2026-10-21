-- CreateEnum
CREATE TYPE "CollectionCaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'AWAITING_PAYMENT', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PaymentReminderStatus" AS ENUM ('DRAFT', 'CANCELLED', 'SENT', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'COLLECTION_CASE_OPENED';
ALTER TYPE "ActivityEventType" ADD VALUE 'COLLECTION_CASE_UPDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'COLLECTION_CASE_CLOSED';
ALTER TYPE "ActivityEventType" ADD VALUE 'COLLECTION_NOTE_ADDED';
ALTER TYPE "ActivityEventType" ADD VALUE 'PAYMENT_REMINDER_DRAFTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'PAYMENT_REMINDER_CANCELLED';

-- CreateTable
CREATE TABLE "collection_cases" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "status" "CollectionCaseStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" TEXT,
    "nextFollowUpDate" DATE,
    "openedByUserId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_notes" (
    "id" TEXT NOT NULL,
    "collectionCaseId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "contactAttempted" BOOLEAN NOT NULL DEFAULT false,
    "contactMethod" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reminders" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "collectionCaseId" TEXT,
    "status" "PaymentReminderStatus" NOT NULL DEFAULT 'DRAFT',
    "asOfDate" DATE NOT NULL,
    "totalAmountOwing" DECIMAL(14,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "payment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collection_cases_publicReference_key" ON "collection_cases"("publicReference");

-- CreateIndex
CREATE INDEX "collection_cases_organisationId_idx" ON "collection_cases"("organisationId");

-- CreateIndex
CREATE INDEX "collection_cases_propertyId_idx" ON "collection_cases"("propertyId");

-- CreateIndex
CREATE INDEX "collection_cases_spaceId_idx" ON "collection_cases"("spaceId");

-- CreateIndex
CREATE INDEX "collection_notes_collectionCaseId_idx" ON "collection_notes"("collectionCaseId");

-- CreateIndex
CREATE INDEX "collection_notes_organisationId_idx" ON "collection_notes"("organisationId");

-- CreateIndex
CREATE INDEX "collection_notes_propertyId_idx" ON "collection_notes"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reminders_publicReference_key" ON "payment_reminders"("publicReference");

-- CreateIndex
CREATE INDEX "payment_reminders_organisationId_idx" ON "payment_reminders"("organisationId");

-- CreateIndex
CREATE INDEX "payment_reminders_propertyId_idx" ON "payment_reminders"("propertyId");

-- CreateIndex
CREATE INDEX "payment_reminders_spaceId_idx" ON "payment_reminders"("spaceId");

-- CreateIndex
CREATE INDEX "payment_reminders_collectionCaseId_idx" ON "payment_reminders"("collectionCaseId");

-- AddForeignKey
ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_notes" ADD CONSTRAINT "collection_notes_collectionCaseId_fkey" FOREIGN KEY ("collectionCaseId") REFERENCES "collection_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_notes" ADD CONSTRAINT "collection_notes_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_notes" ADD CONSTRAINT "collection_notes_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_notes" ADD CONSTRAINT "collection_notes_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_collectionCaseId_fkey" FOREIGN KEY ("collectionCaseId") REFERENCES "collection_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
