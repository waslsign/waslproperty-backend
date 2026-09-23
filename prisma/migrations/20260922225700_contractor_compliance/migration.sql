-- CreateEnum
CREATE TYPE "CredentialCategory" AS ENUM ('LICENCE', 'CERTIFICATION', 'INSURANCE', 'QUALIFICATION', 'BUSINESS_REGISTRATION', 'OTHER');

-- CreateEnum
CREATE TYPE "CredentialVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CredentialVerificationSource" AS ENUM ('MANUAL', 'REGISTRY', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "ComplianceEnforcement" AS ENUM ('BLOCK_ASSIGNMENT', 'WARN_ONLY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'CONTRACTOR_CREDENTIAL_ADDED';
ALTER TYPE "ActivityEventType" ADD VALUE 'CONTRACTOR_CREDENTIAL_UPDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'CONTRACTOR_CREDENTIAL_VERIFIED';
ALTER TYPE "ActivityEventType" ADD VALUE 'CONTRACTOR_CREDENTIAL_REJECTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'CONTRACTOR_CREDENTIAL_REMOVED';
ALTER TYPE "ActivityEventType" ADD VALUE 'CONTRACTOR_COMPLIANCE_REQUIREMENTS_UPDATED';

-- AlterTable
ALTER TABLE "contractors" ADD COLUMN     "businessNumber" TEXT,
ADD COLUMN     "tradeCategories" "MaintenanceCategory"[];

-- CreateTable
CREATE TABLE "contractor_credentials" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "category" "CredentialCategory" NOT NULL,
    "type" TEXT NOT NULL,
    "credentialNumber" TEXT,
    "issuer" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "coverageAmount" DECIMAL(12,2),
    "coverageCurrencyCode" TEXT,
    "documentStorageKey" TEXT,
    "documentFileName" TEXT,
    "documentContentType" TEXT,
    "documentFileSize" INTEGER,
    "verificationStatus" "CredentialVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verificationSource" "CredentialVerificationSource",
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_compliance_requirements" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "category" "MaintenanceCategory" NOT NULL,
    "credentialCategory" "CredentialCategory" NOT NULL,
    "credentialType" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "enforcement" "ComplianceEnforcement" NOT NULL DEFAULT 'BLOCK_ASSIGNMENT',
    "mustBeVerified" BOOLEAN NOT NULL DEFAULT true,
    "mustNotBeExpired" BOOLEAN NOT NULL DEFAULT true,
    "minimumCoverageAmount" DECIMAL(12,2),
    "minimumCoverageCurrencyCode" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_compliance_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contractor_credentials_organisationId_idx" ON "contractor_credentials"("organisationId");

-- CreateIndex
CREATE INDEX "contractor_credentials_contractorId_idx" ON "contractor_credentials"("contractorId");

-- CreateIndex
CREATE INDEX "contractor_credentials_contractorId_category_idx" ON "contractor_credentials"("contractorId", "category");

-- CreateIndex
CREATE INDEX "contractor_credentials_expiresAt_idx" ON "contractor_credentials"("expiresAt");

-- CreateIndex
CREATE INDEX "contractor_compliance_requirements_organisationId_idx" ON "contractor_compliance_requirements"("organisationId");

-- CreateIndex
CREATE INDEX "contractor_compliance_requirements_organisationId_category_idx" ON "contractor_compliance_requirements"("organisationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "contractor_compliance_requirements_organisationId_category__key" ON "contractor_compliance_requirements"("organisationId", "category", "credentialType");

-- AddForeignKey
ALTER TABLE "contractor_credentials" ADD CONSTRAINT "contractor_credentials_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_credentials" ADD CONSTRAINT "contractor_credentials_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_credentials" ADD CONSTRAINT "contractor_credentials_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_credentials" ADD CONSTRAINT "contractor_credentials_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_compliance_requirements" ADD CONSTRAINT "contractor_compliance_requirements_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_compliance_requirements" ADD CONSTRAINT "contractor_compliance_requirements_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

