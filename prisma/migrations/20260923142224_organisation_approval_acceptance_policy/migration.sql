-- AlterEnum
ALTER TYPE "ActivityEventType" ADD VALUE 'APPROVAL_POLICY_UPDATED';

-- AlterTable
ALTER TABLE "contractor_quotes" ADD COLUMN     "approvalPolicySnapshot" JSONB,
ADD COLUMN     "requiredWorkflowMode" "WorkflowMode";

-- AlterTable
ALTER TABLE "work_order_variations" ADD COLUMN     "approvalPolicySnapshot" JSONB,
ADD COLUMN     "requiredWorkflowMode" "WorkflowMode";

-- CreateTable
CREATE TABLE "organisation_approval_policies" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organisation_approval_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_policy_rules" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "minAmount" DECIMAL(12,2) NOT NULL,
    "maxAmount" DECIMAL(12,2),
    "workflowMode" "WorkflowMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_policy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisation_approval_policies_organisationId_key" ON "organisation_approval_policies"("organisationId");

-- CreateIndex
CREATE INDEX "approval_policy_rules_organisationId_idx" ON "approval_policy_rules"("organisationId");

-- CreateIndex
CREATE INDEX "approval_policy_rules_policyId_idx" ON "approval_policy_rules"("policyId");

-- AddForeignKey
ALTER TABLE "organisation_approval_policies" ADD CONSTRAINT "organisation_approval_policies_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_approval_policies" ADD CONSTRAINT "organisation_approval_policies_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_approval_policies" ADD CONSTRAINT "organisation_approval_policies_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policy_rules" ADD CONSTRAINT "approval_policy_rules_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policy_rules" ADD CONSTRAINT "approval_policy_rules_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "organisation_approval_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
