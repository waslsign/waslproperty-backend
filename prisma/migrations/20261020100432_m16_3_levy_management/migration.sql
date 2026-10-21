-- CreateEnum
CREATE TYPE "LevyKind" AS ENUM ('REGULAR', 'SPECIAL');

-- CreateEnum
CREATE TYPE "LevyScheduleStatus" AS ENUM ('DRAFT', 'APPROVED', 'ISSUED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "LevyChargeStatus" AS ENUM ('ISSUED', 'PART_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'LEVY_SCHEDULE_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'LEVY_SCHEDULE_APPROVED';
ALTER TYPE "ActivityEventType" ADD VALUE 'LEVY_SCHEDULE_ISSUED';
ALTER TYPE "ActivityEventType" ADD VALUE 'LEVY_SCHEDULE_CANCELLED';
ALTER TYPE "ActivityEventType" ADD VALUE 'LEVY_SCHEDULE_REVERSED';
ALTER TYPE "ActivityEventType" ADD VALUE 'LEVY_CHARGE_ADJUSTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'LEVY_NOTICE_SENT';

-- CreateTable
CREATE TABLE "levy_schedules" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialConfigurationId" TEXT NOT NULL,
    "financialFundId" TEXT NOT NULL,
    "financialBudgetId" TEXT,
    "kind" "LevyKind" NOT NULL,
    "name" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "status" "LevyScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "rationale" TEXT,
    "externalApprovalDate" DATE,
    "externalApprovalReference" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "reversedByUserId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "levy_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "levy_installments" (
    "id" TEXT NOT NULL,
    "levyScheduleId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "levy_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_levy_charges" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "levyScheduleId" TEXT NOT NULL,
    "levyInstallmentId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "financialFundId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "LevyChargeStatus" NOT NULL DEFAULT 'ISSUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_levy_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "levy_adjustments" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "lotLevyChargeId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "levy_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "levy_schedules_publicReference_key" ON "levy_schedules"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "levy_schedules_journalEntryId_key" ON "levy_schedules"("journalEntryId");

-- CreateIndex
CREATE INDEX "levy_schedules_organisationId_idx" ON "levy_schedules"("organisationId");

-- CreateIndex
CREATE INDEX "levy_schedules_propertyId_idx" ON "levy_schedules"("propertyId");

-- CreateIndex
CREATE INDEX "levy_schedules_financialFundId_idx" ON "levy_schedules"("financialFundId");

-- CreateIndex
CREATE INDEX "levy_schedules_financialBudgetId_idx" ON "levy_schedules"("financialBudgetId");

-- CreateIndex
CREATE INDEX "levy_installments_levyScheduleId_idx" ON "levy_installments"("levyScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "lot_levy_charges_publicReference_key" ON "lot_levy_charges"("publicReference");

-- CreateIndex
CREATE INDEX "lot_levy_charges_organisationId_idx" ON "lot_levy_charges"("organisationId");

-- CreateIndex
CREATE INDEX "lot_levy_charges_propertyId_idx" ON "lot_levy_charges"("propertyId");

-- CreateIndex
CREATE INDEX "lot_levy_charges_levyScheduleId_idx" ON "lot_levy_charges"("levyScheduleId");

-- CreateIndex
CREATE INDEX "lot_levy_charges_levyInstallmentId_idx" ON "lot_levy_charges"("levyInstallmentId");

-- CreateIndex
CREATE INDEX "lot_levy_charges_spaceId_idx" ON "lot_levy_charges"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "levy_adjustments_publicReference_key" ON "levy_adjustments"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "levy_adjustments_journalEntryId_key" ON "levy_adjustments"("journalEntryId");

-- CreateIndex
CREATE INDEX "levy_adjustments_lotLevyChargeId_idx" ON "levy_adjustments"("lotLevyChargeId");

-- CreateIndex
CREATE INDEX "levy_adjustments_propertyId_idx" ON "levy_adjustments"("propertyId");

-- AddForeignKey
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_financialConfigurationId_fkey" FOREIGN KEY ("financialConfigurationId") REFERENCES "financial_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_financialFundId_fkey" FOREIGN KEY ("financialFundId") REFERENCES "financial_funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_financialBudgetId_fkey" FOREIGN KEY ("financialBudgetId") REFERENCES "financial_budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_installments" ADD CONSTRAINT "levy_installments_levyScheduleId_fkey" FOREIGN KEY ("levyScheduleId") REFERENCES "levy_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_levy_charges" ADD CONSTRAINT "lot_levy_charges_levyScheduleId_fkey" FOREIGN KEY ("levyScheduleId") REFERENCES "levy_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_levy_charges" ADD CONSTRAINT "lot_levy_charges_levyInstallmentId_fkey" FOREIGN KEY ("levyInstallmentId") REFERENCES "levy_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_levy_charges" ADD CONSTRAINT "lot_levy_charges_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_levy_charges" ADD CONSTRAINT "lot_levy_charges_financialFundId_fkey" FOREIGN KEY ("financialFundId") REFERENCES "financial_funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_levy_charges" ADD CONSTRAINT "lot_levy_charges_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_levy_charges" ADD CONSTRAINT "lot_levy_charges_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_adjustments" ADD CONSTRAINT "levy_adjustments_lotLevyChargeId_fkey" FOREIGN KEY ("lotLevyChargeId") REFERENCES "lot_levy_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_adjustments" ADD CONSTRAINT "levy_adjustments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_adjustments" ADD CONSTRAINT "levy_adjustments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_adjustments" ADD CONSTRAINT "levy_adjustments_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_adjustments" ADD CONSTRAINT "levy_adjustments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
