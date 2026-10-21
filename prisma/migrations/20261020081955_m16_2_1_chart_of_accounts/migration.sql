-- CreateEnum
CREATE TYPE "FinancialBudgetLineType" AS ENUM ('REVENUE', 'EXPENDITURE', 'TRANSFER', 'RESERVE_CONTRIBUTION', 'OTHER');

-- CreateEnum
CREATE TYPE "AccountClassification" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_ACCOUNT_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_ACCOUNT_UPDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_ACCOUNT_DEACTIVATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_ACCOUNTS_IMPORTED';

-- AlterTable
ALTER TABLE "financial_budget_lines" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "lineType" "FinancialBudgetLineType" NOT NULL DEFAULT 'EXPENDITURE';

-- CreateTable
CREATE TABLE "accounting_accounts" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialConfigurationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "classification" "AccountClassification" NOT NULL,
    "parentAccountId" TEXT,
    "restrictedToFundId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceTemplateLineId" TEXT,
    "sourceImportBatchId" TEXT,
    "externalCode" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_templates" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_template_lines" (
    "id" TEXT NOT NULL,
    "accountTemplateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classification" "AccountClassification" NOT NULL,
    "parentCode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_template_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_import_batches" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "appliedByUserId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_accounts_publicReference_key" ON "accounting_accounts"("publicReference");

-- CreateIndex
CREATE INDEX "accounting_accounts_organisationId_idx" ON "accounting_accounts"("organisationId");

-- CreateIndex
CREATE INDEX "accounting_accounts_propertyId_idx" ON "accounting_accounts"("propertyId");

-- CreateIndex
CREATE INDEX "accounting_accounts_parentAccountId_idx" ON "accounting_accounts"("parentAccountId");

-- CreateIndex
CREATE INDEX "accounting_accounts_restrictedToFundId_idx" ON "accounting_accounts"("restrictedToFundId");

-- CreateIndex
CREATE INDEX "accounting_accounts_sourceImportBatchId_idx" ON "accounting_accounts"("sourceImportBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_accounts_propertyId_code_key" ON "accounting_accounts"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "account_templates_publicReference_key" ON "account_templates"("publicReference");

-- CreateIndex
CREATE INDEX "account_templates_organisationId_idx" ON "account_templates"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "account_templates_organisationId_name_version_key" ON "account_templates"("organisationId", "name", "version");

-- CreateIndex
CREATE INDEX "account_template_lines_accountTemplateId_idx" ON "account_template_lines"("accountTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "account_template_lines_accountTemplateId_code_key" ON "account_template_lines"("accountTemplateId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "account_import_batches_publicReference_key" ON "account_import_batches"("publicReference");

-- CreateIndex
CREATE INDEX "account_import_batches_propertyId_idx" ON "account_import_batches"("propertyId");

-- CreateIndex
CREATE INDEX "financial_budget_lines_accountId_idx" ON "financial_budget_lines"("accountId");

-- AddForeignKey
ALTER TABLE "financial_budget_lines" ADD CONSTRAINT "financial_budget_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_financialConfigurationId_fkey" FOREIGN KEY ("financialConfigurationId") REFERENCES "financial_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "accounting_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_restrictedToFundId_fkey" FOREIGN KEY ("restrictedToFundId") REFERENCES "financial_funds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_sourceImportBatchId_fkey" FOREIGN KEY ("sourceImportBatchId") REFERENCES "account_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_templates" ADD CONSTRAINT "account_templates_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_templates" ADD CONSTRAINT "account_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_template_lines" ADD CONSTRAINT "account_template_lines_accountTemplateId_fkey" FOREIGN KEY ("accountTemplateId") REFERENCES "account_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_import_batches" ADD CONSTRAINT "account_import_batches_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_import_batches" ADD CONSTRAINT "account_import_batches_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_import_batches" ADD CONSTRAINT "account_import_batches_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
