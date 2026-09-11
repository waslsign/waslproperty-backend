-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'MEMBERSHIP_UPDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'MEMBERSHIP_ENDED';
ALTER TYPE "ActivityEventType" ADD VALUE 'ANNOUNCEMENT_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'ANNOUNCEMENT_SENT';
ALTER TYPE "ActivityEventType" ADD VALUE 'ANNOUNCEMENT_CANCELLED';

-- DropForeignKey
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_propertyId_fkey";

-- AlterTable
ALTER TABLE "activity_events" ALTER COLUMN "propertyId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "communications" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommunicationStatus" NOT NULL DEFAULT 'DRAFT',
    "channels" "CommunicationChannel"[],
    "audienceCriteria" JSONB NOT NULL,
    "savedAudienceId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_recipients" (
    "id" TEXT NOT NULL,
    "communicationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT,
    "propertyId" TEXT,
    "spaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_deliveries" (
    "id" TEXT NOT NULL,
    "communicationRecipientId" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "attemptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_audiences" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "sourceCommunicationId" TEXT,
    "sourceActivityEventId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "communications_organisationId_status_idx" ON "communications"("organisationId", "status");

-- CreateIndex
CREATE INDEX "communications_organisationId_scheduledAt_idx" ON "communications"("organisationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "communication_recipients_communicationId_idx" ON "communication_recipients"("communicationId");

-- CreateIndex
CREATE INDEX "communication_recipients_contactId_idx" ON "communication_recipients"("contactId");

-- CreateIndex
CREATE INDEX "communication_recipients_userId_idx" ON "communication_recipients"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "communication_recipients_communicationId_contactId_key" ON "communication_recipients"("communicationId", "contactId");

-- CreateIndex
CREATE INDEX "communication_deliveries_status_idx" ON "communication_deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "communication_deliveries_communicationRecipientId_channel_key" ON "communication_deliveries"("communicationRecipientId", "channel");

-- CreateIndex
CREATE INDEX "saved_audiences_organisationId_idx" ON "saved_audiences"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_audiences_organisationId_name_key" ON "saved_audiences"("organisationId", "name");

-- CreateIndex
CREATE INDEX "notifications_organisationId_userId_readAt_idx" ON "notifications"("organisationId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_savedAudienceId_fkey" FOREIGN KEY ("savedAudienceId") REFERENCES "saved_audiences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "communications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "property_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_deliveries" ADD CONSTRAINT "communication_deliveries_communicationRecipientId_fkey" FOREIGN KEY ("communicationRecipientId") REFERENCES "communication_recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_audiences" ADD CONSTRAINT "saved_audiences_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_audiences" ADD CONSTRAINT "saved_audiences_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
