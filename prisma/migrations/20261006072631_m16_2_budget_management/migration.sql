-- CreateEnum
CREATE TYPE "FinancialBudgetStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FinancialBudgetSource" AS ENUM ('CREATED', 'IMPORTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_BUDGET_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_BUDGET_APPROVED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_BUDGET_IMPORT_RECORDED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_BUDGET_ACTIVATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_BUDGET_REVISED';

-- CreateTable
CREATE TABLE "financial_budgets" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialConfigurationId" TEXT NOT NULL,
    "financialYearStartDate" DATE NOT NULL,
    "financialYearEndDate" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "FinancialBudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "FinancialBudgetSource" NOT NULL DEFAULT 'CREATED',
    "currencyCode" TEXT NOT NULL,
    "notes" TEXT,
    "externalApprovalDate" DATE,
    "externalApprovalReference" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "revisionOfBudgetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_budget_lines" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "financialFundId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "plannedAmount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_budgets_publicReference_key" ON "financial_budgets"("publicReference");

-- CreateIndex
CREATE INDEX "financial_budgets_organisationId_idx" ON "financial_budgets"("organisationId");

-- CreateIndex
CREATE INDEX "financial_budgets_propertyId_status_idx" ON "financial_budgets"("propertyId", "status");

-- CreateIndex
CREATE INDEX "financial_budgets_financialConfigurationId_idx" ON "financial_budgets"("financialConfigurationId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_budgets_propertyId_financialYearStartDate_financi_key" ON "financial_budgets"("propertyId", "financialYearStartDate", "financialYearEndDate", "version");

-- CreateIndex
CREATE UNIQUE INDEX "financial_budget_lines_publicReference_key" ON "financial_budget_lines"("publicReference");

-- CreateIndex
CREATE INDEX "financial_budget_lines_budgetId_idx" ON "financial_budget_lines"("budgetId");

-- CreateIndex
CREATE INDEX "financial_budget_lines_financialFundId_idx" ON "financial_budget_lines"("financialFundId");

-- CreateIndex
CREATE INDEX "financial_budget_lines_propertyId_idx" ON "financial_budget_lines"("propertyId");

-- AddForeignKey
ALTER TABLE "financial_budgets" ADD CONSTRAINT "financial_budgets_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_budgets" ADD CONSTRAINT "financial_budgets_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_budgets" ADD CONSTRAINT "financial_budgets_financialConfigurationId_fkey" FOREIGN KEY ("financialConfigurationId") REFERENCES "financial_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_budgets" ADD CONSTRAINT "financial_budgets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_budgets" ADD CONSTRAINT "financial_budgets_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_budgets" ADD CONSTRAINT "financial_budgets_revisionOfBudgetId_fkey" FOREIGN KEY ("revisionOfBudgetId") REFERENCES "financial_budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_budget_lines" ADD CONSTRAINT "financial_budget_lines_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "financial_budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_budget_lines" ADD CONSTRAINT "financial_budget_lines_financialFundId_fkey" FOREIGN KEY ("financialFundId") REFERENCES "financial_funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
