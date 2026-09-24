-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_VARIATION_WORKFLOW_CONFIRMED';
ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_VARIATION_SIGNATURE_STARTED';
ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_VARIATION_SIGNED';
ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_VARIATION_SIGNATURE_FAILED';
ALTER TYPE "ActivityEventType" ADD VALUE 'WORK_ORDER_VARIATION_AUTHORISED';

-- AlterTable
ALTER TABLE "work_order_variations" ADD COLUMN     "approvalStatus" "ApprovalStatus",
ADD COLUMN     "signatureStatus" "SignatureStatus",
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "waslSignAgreementId" TEXT,
ADD COLUMN     "waslSignStatus" TEXT,
ADD COLUMN     "workflowMode" "WorkflowMode";

-- CreateIndex
CREATE INDEX "work_order_variations_waslSignAgreementId_idx" ON "work_order_variations"("waslSignAgreementId");
