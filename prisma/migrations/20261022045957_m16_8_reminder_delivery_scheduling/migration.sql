-- CreateEnum
CREATE TYPE "PaymentReminderDeliveryOutcome" AS ENUM ('SENT', 'FAILED', 'AMBIGUOUS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_POLICY_UPDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_CANDIDATE_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_CANDIDATE_SUPPRESSED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_APPROVED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_APPROVAL_INVALIDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_DISPATCH_SUPPRESSED_BY_KILL_SWITCH';
ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_SENT';
ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_DELIVERY_CONFIRMED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_DELIVERY_FAILED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_DELIVERY_QUARANTINED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_DELIVERY_QUARANTINE_RESOLVED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REMINDER_DELIVERY_RETRIED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CollectionCaseStatus" ADD VALUE 'DISPUTED';
ALTER TYPE "CollectionCaseStatus" ADD VALUE 'PAUSED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentReminderStatus" ADD VALUE 'READY_FOR_REVIEW';
ALTER TYPE "PaymentReminderStatus" ADD VALUE 'APPROVED';
ALTER TYPE "PaymentReminderStatus" ADD VALUE 'QUEUED';
ALTER TYPE "PaymentReminderStatus" ADD VALUE 'SENDING';
ALTER TYPE "PaymentReminderStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "PaymentReminderStatus" ADD VALUE 'SUPPRESSED';
ALTER TYPE "PaymentReminderStatus" ADD VALUE 'QUARANTINED';

-- DropForeignKey
ALTER TABLE "payment_reminders" DROP CONSTRAINT "payment_reminders_generatedByUserId_fkey";

-- AlterTable
ALTER TABLE "payment_reminders" ADD COLUMN     "approvalSnapshot" JSONB,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "dispatchAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "eligibilityReason" TEXT,
ADD COLUMN     "lastAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorCategory" TEXT,
ADD COLUMN     "policyVersion" INTEGER,
ADD COLUMN     "providerMessageId" TEXT,
ADD COLUMN     "recipientContactId" TEXT,
ADD COLUMN     "recipientEmail" TEXT,
ADD COLUMN     "recipientResolutionNote" TEXT,
ADD COLUMN     "reminderStage" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "templateVersion" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "generatedByUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "reminder_policies" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "initialDelayDays" INTEGER NOT NULL DEFAULT 14,
    "followUpIntervalDays" INTEGER NOT NULL DEFAULT 14,
    "minimumOutstandingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "maxRemindersPerCase" INTEGER,
    "maxRemindersInRollingWindow" INTEGER,
    "rollingWindowDays" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Sydney',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastEvaluationNote" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reminder_delivery_attempts" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "paymentReminderId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "outcome" "PaymentReminderDeliveryOutcome",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "errorCategory" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "payment_reminder_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminder_policies_publicReference_key" ON "reminder_policies"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_policies_propertyId_key" ON "reminder_policies"("propertyId");

-- CreateIndex
CREATE INDEX "reminder_policies_organisationId_idx" ON "reminder_policies"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reminder_delivery_attempts_publicReference_key" ON "payment_reminder_delivery_attempts"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reminder_delivery_attempts_idempotencyKey_key" ON "payment_reminder_delivery_attempts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_reminder_delivery_attempts_paymentReminderId_idx" ON "payment_reminder_delivery_attempts"("paymentReminderId");

-- CreateIndex
CREATE INDEX "payment_reminder_delivery_attempts_organisationId_idx" ON "payment_reminder_delivery_attempts"("organisationId");

-- CreateIndex
CREATE INDEX "payment_reminder_delivery_attempts_propertyId_idx" ON "payment_reminder_delivery_attempts"("propertyId");

-- CreateIndex
CREATE INDEX "payment_reminders_recipientContactId_idx" ON "payment_reminders"("recipientContactId");

-- CreateIndex
CREATE INDEX "payment_reminders_status_idx" ON "payment_reminders"("status");

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_recipientContactId_fkey" FOREIGN KEY ("recipientContactId") REFERENCES "property_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_policies" ADD CONSTRAINT "reminder_policies_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_policies" ADD CONSTRAINT "reminder_policies_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_policies" ADD CONSTRAINT "reminder_policies_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminder_delivery_attempts" ADD CONSTRAINT "payment_reminder_delivery_attempts_paymentReminderId_fkey" FOREIGN KEY ("paymentReminderId") REFERENCES "payment_reminders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminder_delivery_attempts" ADD CONSTRAINT "payment_reminder_delivery_attempts_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminder_delivery_attempts" ADD CONSTRAINT "payment_reminder_delivery_attempts_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
