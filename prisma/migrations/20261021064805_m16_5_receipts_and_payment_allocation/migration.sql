-- CreateEnum
CREATE TYPE "ReceiptPaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('RECORDED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentAllocationStatus" AS ENUM ('APPLIED', 'REVERSED');

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialConfigurationId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "financialFundId" TEXT NOT NULL,
    "destinationAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "paymentMethod" "ReceiptPaymentMethod" NOT NULL,
    "paymentReference" TEXT,
    "description" TEXT,
    "receiptDate" DATE NOT NULL,
    "postingDate" DATE NOT NULL,
    "externalBankReference" TEXT,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'RECORDED',
    "journalEntryId" TEXT NOT NULL,
    "reversedByUserId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "lotLevyChargeId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "PaymentAllocationStatus" NOT NULL DEFAULT 'APPLIED',
    "journalEntryId" TEXT NOT NULL,
    "reversedByUserId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_publicReference_key" ON "receipts"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_journalEntryId_key" ON "receipts"("journalEntryId");

-- CreateIndex
CREATE INDEX "receipts_organisationId_idx" ON "receipts"("organisationId");

-- CreateIndex
CREATE INDEX "receipts_propertyId_idx" ON "receipts"("propertyId");

-- CreateIndex
CREATE INDEX "receipts_spaceId_idx" ON "receipts"("spaceId");

-- CreateIndex
CREATE INDEX "receipts_financialFundId_idx" ON "receipts"("financialFundId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_publicReference_key" ON "payment_allocations"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_journalEntryId_key" ON "payment_allocations"("journalEntryId");

-- CreateIndex
CREATE INDEX "payment_allocations_organisationId_idx" ON "payment_allocations"("organisationId");

-- CreateIndex
CREATE INDEX "payment_allocations_propertyId_idx" ON "payment_allocations"("propertyId");

-- CreateIndex
CREATE INDEX "payment_allocations_receiptId_idx" ON "payment_allocations"("receiptId");

-- CreateIndex
CREATE INDEX "payment_allocations_lotLevyChargeId_idx" ON "payment_allocations"("lotLevyChargeId");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_financialConfigurationId_fkey" FOREIGN KEY ("financialConfigurationId") REFERENCES "financial_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_financialFundId_fkey" FOREIGN KEY ("financialFundId") REFERENCES "financial_funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_lotLevyChargeId_fkey" FOREIGN KEY ("lotLevyChargeId") REFERENCES "lot_levy_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
