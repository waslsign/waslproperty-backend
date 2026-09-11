-- CreateEnum
CREATE TYPE "ContactInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- AlterEnum
ALTER TYPE "ActivityEventType" ADD VALUE 'MAINTENANCE_REQUEST_ATTACHMENTS_ADDED';

-- CreateTable
CREATE TABLE "contact_invites" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyContactId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "ContactInviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "contact_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_request_attachments" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "maintenanceRequestId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_request_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_invites_tokenHash_key" ON "contact_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "contact_invites_organisationId_idx" ON "contact_invites"("organisationId");

-- CreateIndex
CREATE INDEX "contact_invites_propertyContactId_idx" ON "contact_invites"("propertyContactId");

-- CreateIndex
CREATE INDEX "maintenance_request_attachments_organisationId_idx" ON "maintenance_request_attachments"("organisationId");

-- CreateIndex
CREATE INDEX "maintenance_request_attachments_maintenanceRequestId_idx" ON "maintenance_request_attachments"("maintenanceRequestId");

-- AddForeignKey
ALTER TABLE "contact_invites" ADD CONSTRAINT "contact_invites_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_invites" ADD CONSTRAINT "contact_invites_propertyContactId_fkey" FOREIGN KEY ("propertyContactId") REFERENCES "property_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_invites" ADD CONSTRAINT "contact_invites_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_request_attachments" ADD CONSTRAINT "maintenance_request_attachments_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_request_attachments" ADD CONSTRAINT "maintenance_request_attachments_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "maintenance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_request_attachments" ADD CONSTRAINT "maintenance_request_attachments_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

