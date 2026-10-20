-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PostingRole" AS ENUM ('FUND_CASH', 'LOT_LEVY_RECEIVABLE', 'LEVY_INCOME', 'UNAPPLIED_CASH', 'ACCOUNTS_PAYABLE', 'GST_PAYABLE', 'GST_RECEIVABLE', 'SUSPENSE', 'OPENING_BALANCE_EQUITY', 'INTER_FUND_TRANSFER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_PERIOD_OPENED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_PERIOD_CLOSED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_PERIOD_REOPENED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_POSTING_PROFILE_UPDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_JOURNAL_POSTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_JOURNAL_REVERSED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FINANCIAL_OPENING_JOURNAL_POSTED';

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialConfigurationId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_profile_rules" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialConfigurationId" TEXT NOT NULL,
    "role" "PostingRole" NOT NULL,
    "financialFundId" TEXT,
    "accountId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_profile_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialConfigurationId" TEXT NOT NULL,
    "accountingPeriodId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currencyCode" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceEventVersion" INTEGER NOT NULL DEFAULT 1,
    "narration" TEXT NOT NULL,
    "postedByUserId" TEXT NOT NULL,
    "reversalOfJournalId" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "financialFundId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineNarration" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_publicReference_key" ON "accounting_periods"("publicReference");

-- CreateIndex
CREATE INDEX "accounting_periods_organisationId_idx" ON "accounting_periods"("organisationId");

-- CreateIndex
CREATE INDEX "accounting_periods_propertyId_idx" ON "accounting_periods"("propertyId");

-- CreateIndex
CREATE INDEX "posting_profile_rules_organisationId_idx" ON "posting_profile_rules"("organisationId");

-- CreateIndex
CREATE INDEX "posting_profile_rules_propertyId_idx" ON "posting_profile_rules"("propertyId");

-- CreateIndex
CREATE INDEX "posting_profile_rules_accountId_idx" ON "posting_profile_rules"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_publicReference_key" ON "journal_entries"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversalOfJournalId_key" ON "journal_entries"("reversalOfJournalId");

-- CreateIndex
CREATE INDEX "journal_entries_organisationId_idx" ON "journal_entries"("organisationId");

-- CreateIndex
CREATE INDEX "journal_entries_propertyId_idx" ON "journal_entries"("propertyId");

-- CreateIndex
CREATE INDEX "journal_entries_accountingPeriodId_idx" ON "journal_entries"("accountingPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_propertyId_sourceType_sourceId_sourceEventV_key" ON "journal_entries"("propertyId", "sourceType", "sourceId", "sourceEventVersion");

-- CreateIndex
CREATE INDEX "journal_lines_journalEntryId_idx" ON "journal_lines"("journalEntryId");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_idx" ON "journal_lines"("accountId");

-- CreateIndex
CREATE INDEX "journal_lines_financialFundId_idx" ON "journal_lines"("financialFundId");

-- CreateIndex
CREATE INDEX "journal_lines_propertyId_idx" ON "journal_lines"("propertyId");

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_financialConfigurationId_fkey" FOREIGN KEY ("financialConfigurationId") REFERENCES "financial_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_reopenedByUserId_fkey" FOREIGN KEY ("reopenedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_profile_rules" ADD CONSTRAINT "posting_profile_rules_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_profile_rules" ADD CONSTRAINT "posting_profile_rules_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_profile_rules" ADD CONSTRAINT "posting_profile_rules_financialConfigurationId_fkey" FOREIGN KEY ("financialConfigurationId") REFERENCES "financial_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_profile_rules" ADD CONSTRAINT "posting_profile_rules_financialFundId_fkey" FOREIGN KEY ("financialFundId") REFERENCES "financial_funds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_profile_rules" ADD CONSTRAINT "posting_profile_rules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_profile_rules" ADD CONSTRAINT "posting_profile_rules_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_financialConfigurationId_fkey" FOREIGN KEY ("financialConfigurationId") REFERENCES "financial_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_accountingPeriodId_fkey" FOREIGN KEY ("accountingPeriodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfJournalId_fkey" FOREIGN KEY ("reversalOfJournalId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_financialFundId_fkey" FOREIGN KEY ("financialFundId") REFERENCES "financial_funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
