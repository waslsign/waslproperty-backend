-- CreateEnum
CREATE TYPE "LevyInstallmentStatus" AS ENUM ('PENDING', 'ISSUED', 'REVERSED');

-- AlterEnum
ALTER TYPE "LevyScheduleStatus" ADD VALUE 'PARTIALLY_ISSUED';

-- AlterTable
ALTER TABLE "levy_installments" ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "issuedByUserId" TEXT,
ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedByUserId" TEXT,
ADD COLUMN     "status" "LevyInstallmentStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "levy_installments_journalEntryId_idx" ON "levy_installments"("journalEntryId");

-- AddForeignKey
ALTER TABLE "levy_installments" ADD CONSTRAINT "levy_installments_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_installments" ADD CONSTRAINT "levy_installments_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "levy_installments" ADD CONSTRAINT "levy_installments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ADR-024 data backfill: annotate every PRE-ADR-024 whole-schedule
-- issuance down onto its own instalments, preserving existing financial
-- history exactly as it happened (same shared journal, same actor, same
-- timestamp) rather than losing or fabricating per-instalment detail. A
-- schedule that was issued then reversed gets both updates applied in
-- order, ending at REVERSED with the reversal fields set — matching
-- LevyInstallmentStatus's terminal-REVERSED semantics.
UPDATE "levy_installments" li
SET "status" = 'ISSUED',
    "issuedByUserId" = ls."issuedByUserId",
    "issuedAt" = ls."issuedAt",
    "journalEntryId" = ls."journalEntryId"
FROM "levy_schedules" ls
WHERE li."levyScheduleId" = ls.id
  AND ls."status" IN ('ISSUED', 'REVERSED')
  AND ls."issuedAt" IS NOT NULL;

UPDATE "levy_installments" li
SET "status" = 'REVERSED',
    "reversedByUserId" = ls."reversedByUserId",
    "reversedAt" = ls."reversedAt",
    "reversalReason" = ls."reversalReason"
FROM "levy_schedules" ls
WHERE li."levyScheduleId" = ls.id
  AND ls."status" = 'REVERSED';
