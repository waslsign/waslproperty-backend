-- CreateEnum
CREATE TYPE "FinancialSetupStatus" AS ENUM ('NOT_CONFIGURED', 'SETUP_IN_PROGRESS', 'ACTIVE');

-- CreateEnum
CREATE TYPE "FinancialFundType" AS ENUM ('ADMINISTRATION', 'CAPITAL_WORKS', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_SETUP_STARTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_YEAR_CONFIGURED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_FUNDS_CONFIGURED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_LOT_POSITIONS_CONFIGURED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_SETUP_ACTIVATED';

-- CreateTable
CREATE TABLE "financial_configurations" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" "FinancialSetupStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "currencyCode" TEXT,
    "financialYearStartDate" DATE,
    "financialYearEndDate" DATE,
    "cutoverDate" DATE,
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_funds" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialConfigurationId" TEXT NOT NULL,
    "fundType" "FinancialFundType" NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_opening_balances" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialFundId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "asOfDate" DATE NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "referenceNote" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_opening_positions" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialConfigurationId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "amountOwing" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "creditBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "asOfDate" DATE NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "referenceNote" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lot_opening_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_configurations_publicReference_key" ON "financial_configurations"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "financial_configurations_propertyId_key" ON "financial_configurations"("propertyId");

-- CreateIndex
CREATE INDEX "financial_configurations_organisationId_idx" ON "financial_configurations"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_funds_publicReference_key" ON "financial_funds"("publicReference");

-- CreateIndex
CREATE INDEX "financial_funds_financialConfigurationId_idx" ON "financial_funds"("financialConfigurationId");

-- CreateIndex
CREATE INDEX "financial_funds_propertyId_idx" ON "financial_funds"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_opening_balances_publicReference_key" ON "financial_opening_balances"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "financial_opening_balances_financialFundId_key" ON "financial_opening_balances"("financialFundId");

-- CreateIndex
CREATE INDEX "financial_opening_balances_propertyId_idx" ON "financial_opening_balances"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "lot_opening_positions_publicReference_key" ON "lot_opening_positions"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "lot_opening_positions_spaceId_key" ON "lot_opening_positions"("spaceId");

-- CreateIndex
CREATE INDEX "lot_opening_positions_financialConfigurationId_idx" ON "lot_opening_positions"("financialConfigurationId");

-- CreateIndex
CREATE INDEX "lot_opening_positions_propertyId_idx" ON "lot_opening_positions"("propertyId");

-- AddForeignKey
ALTER TABLE "financial_configurations" ADD CONSTRAINT "financial_configurations_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_configurations" ADD CONSTRAINT "financial_configurations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_configurations" ADD CONSTRAINT "financial_configurations_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_funds" ADD CONSTRAINT "financial_funds_financialConfigurationId_fkey" FOREIGN KEY ("financialConfigurationId") REFERENCES "financial_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_opening_balances" ADD CONSTRAINT "financial_opening_balances_financialFundId_fkey" FOREIGN KEY ("financialFundId") REFERENCES "financial_funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_opening_balances" ADD CONSTRAINT "financial_opening_balances_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_opening_positions" ADD CONSTRAINT "lot_opening_positions_financialConfigurationId_fkey" FOREIGN KEY ("financialConfigurationId") REFERENCES "financial_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_opening_positions" ADD CONSTRAINT "lot_opening_positions_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_opening_positions" ADD CONSTRAINT "lot_opening_positions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
