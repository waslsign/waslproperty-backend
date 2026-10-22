-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('OPERATING', 'RESERVE', 'TRUST', 'OTHER');

-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BankTransactionMatchStatus" AS ENUM ('UNMATCHED', 'SUGGESTED', 'MATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "BankTransactionReconciliationStatus" AS ENUM ('UNRECONCILED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "BankMatchType" AS ENUM ('RECEIPT', 'JOURNAL_LINE', 'NEW_RECEIPT');

-- CreateEnum
CREATE TYPE "BankMatchStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REVERSED');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'RECONCILED', 'REOPENED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'BANK_ACCOUNT_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'BANK_ACCOUNT_UPDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'BANK_STATEMENT_IMPORTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'BANK_STATEMENT_IMPORT_REJECTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'BANK_TRANSACTION_MATCH_CONFIRMED';
ALTER TYPE "ActivityEventType" ADD VALUE 'BANK_TRANSACTION_MATCH_REVERSED';
ALTER TYPE "ActivityEventType" ADD VALUE 'BANK_RECONCILIATION_STARTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'BANK_RECONCILIATION_COMPLETED';
ALTER TYPE "ActivityEventType" ADD VALUE 'BANK_RECONCILIATION_REOPENED';

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialConfigurationId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "accountIdentifierMasked" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "accountType" "BankAccountType" NOT NULL,
    "glCashAccountId" TEXT NOT NULL,
    "financialFundId" TEXT,
    "status" "BankAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "openingReconciledBalance" DECIMAL(14,2),
    "openingReconciledDate" DATE,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "statementStartDate" DATE,
    "statementEndDate" DATE,
    "totalRows" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "importedByUserId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "transactionDate" DATE NOT NULL,
    "valueDate" DATE,
    "amount" DECIMAL(14,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bankReference" TEXT,
    "runningBalance" DECIMAL(14,2),
    "externalTransactionId" TEXT,
    "sourceRowHash" TEXT NOT NULL,
    "matchStatus" "BankTransactionMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "reconciliationStatus" "BankTransactionReconciliationStatus" NOT NULL DEFAULT 'UNRECONCILED',
    "reconciliationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transaction_matches" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "matchType" "BankMatchType" NOT NULL,
    "receiptId" TEXT,
    "journalLineId" TEXT,
    "confidence" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "status" "BankMatchStatus" NOT NULL DEFAULT 'SUGGESTED',
    "suggestedByUserId" TEXT,
    "suggestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,

    CONSTRAINT "bank_transaction_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "periodStartDate" DATE NOT NULL,
    "periodEndDate" DATE NOT NULL,
    "statementOpeningBalance" DECIMAL(14,2) NOT NULL,
    "statementClosingBalance" DECIMAL(14,2) NOT NULL,
    "glOpeningBalance" DECIMAL(14,2) NOT NULL,
    "glClosingBalance" DECIMAL(14,2) NOT NULL,
    "outstandingDepositsTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unpresentedPaymentsTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "difference" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "supersedesReconciliationId" TEXT,
    "preparedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_publicReference_key" ON "bank_accounts"("publicReference");

-- CreateIndex
CREATE INDEX "bank_accounts_organisationId_idx" ON "bank_accounts"("organisationId");

-- CreateIndex
CREATE INDEX "bank_accounts_propertyId_idx" ON "bank_accounts"("propertyId");

-- CreateIndex
CREATE INDEX "bank_accounts_glCashAccountId_idx" ON "bank_accounts"("glCashAccountId");

-- CreateIndex
CREATE INDEX "bank_accounts_financialFundId_idx" ON "bank_accounts"("financialFundId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_imports_publicReference_key" ON "bank_statement_imports"("publicReference");

-- CreateIndex
CREATE INDEX "bank_statement_imports_organisationId_idx" ON "bank_statement_imports"("organisationId");

-- CreateIndex
CREATE INDEX "bank_statement_imports_propertyId_idx" ON "bank_statement_imports"("propertyId");

-- CreateIndex
CREATE INDEX "bank_statement_imports_bankAccountId_idx" ON "bank_statement_imports"("bankAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_imports_bankAccountId_fileHash_key" ON "bank_statement_imports"("bankAccountId", "fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_publicReference_key" ON "bank_transactions"("publicReference");

-- CreateIndex
CREATE INDEX "bank_transactions_organisationId_idx" ON "bank_transactions"("organisationId");

-- CreateIndex
CREATE INDEX "bank_transactions_propertyId_idx" ON "bank_transactions"("propertyId");

-- CreateIndex
CREATE INDEX "bank_transactions_bankAccountId_idx" ON "bank_transactions"("bankAccountId");

-- CreateIndex
CREATE INDEX "bank_transactions_importBatchId_idx" ON "bank_transactions"("importBatchId");

-- CreateIndex
CREATE INDEX "bank_transactions_reconciliationId_idx" ON "bank_transactions"("reconciliationId");

-- CreateIndex
CREATE INDEX "bank_transactions_matchStatus_idx" ON "bank_transactions"("matchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_bankAccountId_sourceRowHash_key" ON "bank_transactions"("bankAccountId", "sourceRowHash");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_matches_publicReference_key" ON "bank_transaction_matches"("publicReference");

-- CreateIndex
CREATE INDEX "bank_transaction_matches_organisationId_idx" ON "bank_transaction_matches"("organisationId");

-- CreateIndex
CREATE INDEX "bank_transaction_matches_propertyId_idx" ON "bank_transaction_matches"("propertyId");

-- CreateIndex
CREATE INDEX "bank_transaction_matches_bankTransactionId_idx" ON "bank_transaction_matches"("bankTransactionId");

-- CreateIndex
CREATE INDEX "bank_transaction_matches_receiptId_idx" ON "bank_transaction_matches"("receiptId");

-- CreateIndex
CREATE INDEX "bank_transaction_matches_journalLineId_idx" ON "bank_transaction_matches"("journalLineId");

-- CreateIndex
CREATE INDEX "bank_transaction_matches_status_idx" ON "bank_transaction_matches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliations_publicReference_key" ON "bank_reconciliations"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliations_supersedesReconciliationId_key" ON "bank_reconciliations"("supersedesReconciliationId");

-- CreateIndex
CREATE INDEX "bank_reconciliations_organisationId_idx" ON "bank_reconciliations"("organisationId");

-- CreateIndex
CREATE INDEX "bank_reconciliations_propertyId_idx" ON "bank_reconciliations"("propertyId");

-- CreateIndex
CREATE INDEX "bank_reconciliations_bankAccountId_idx" ON "bank_reconciliations"("bankAccountId");

-- CreateIndex
CREATE INDEX "bank_reconciliations_status_idx" ON "bank_reconciliations"("status");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_financialConfigurationId_fkey" FOREIGN KEY ("financialConfigurationId") REFERENCES "financial_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_glCashAccountId_fkey" FOREIGN KEY ("glCashAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_financialFundId_fkey" FOREIGN KEY ("financialFundId") REFERENCES "financial_funds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "bank_statement_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "bank_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "journal_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_reopenedByUserId_fkey" FOREIGN KEY ("reopenedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_supersedesReconciliationId_fkey" FOREIGN KEY ("supersedesReconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
