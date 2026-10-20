import { getPrismaClient } from '../../src/lib/prisma.js';

export const testPrisma = getPrismaClient();

export async function resetDb() {
  // WorkOrder.selectedQuoteId <-> ContractorQuote.workOrderId and
  // QuoteRound.awardedQuoteId <-> ContractorQuote.quoteRoundId are each a
  // circular FK pair — neither table in either pair can be fully deleted
  // first without violating the other direction, so both "award" links
  // are nulled out up front to break the cycles before any deletes run.
  await testPrisma.$transaction([
    testPrisma.workOrder.updateMany({ data: { selectedQuoteId: null } }),
    testPrisma.quoteRound.updateMany({ data: { awardedQuoteId: null } }),
    // PropertyDocument.createdPropertyId <-> Property is the same kind of
    // circular pair — a confirmed document points at the property it
    // created, so the link is broken before either side is deleted.
    testPrisma.propertyDocument.updateMany({ data: { createdPropertyId: null } }),
    // M16.2.1 — AccountingAccount.parentAccountId is a self-reference, and
    // sourceTemplateLineId/sourceImportBatchId each point at a row (an
    // AccountTemplateLine / AccountImportBatch) that must itself be
    // deletable without first checking every account that might reference
    // it — same cycle-breaking shape as the pairs above.
    testPrisma.accountingAccount.updateMany({
      data: { parentAccountId: null, sourceTemplateLineId: null, sourceImportBatchId: null },
    }),
  ]);

  await testPrisma.$transaction([
    testPrisma.documentAnalysis.deleteMany(),
    testPrisma.propertyDocument.deleteMany(),
    testPrisma.aiMessage.deleteMany(),
    testPrisma.aiAuditEvent.deleteMany(),
    testPrisma.aiConversation.deleteMany(),
    testPrisma.activityEvent.deleteMany(),
    testPrisma.waslSignWebhookEvent.deleteMany(),
    testPrisma.notification.deleteMany(),
    testPrisma.communicationDelivery.deleteMany(),
    testPrisma.communicationRecipient.deleteMany(),
    testPrisma.communication.deleteMany(),
    testPrisma.savedAudience.deleteMany(),
    testPrisma.contractorQuoteAttachment.deleteMany(),
    testPrisma.workOrderVariationAttachment.deleteMany(),
    testPrisma.workOrderVariation.deleteMany(),
    testPrisma.quoteRoundInvitation.deleteMany(),
    testPrisma.contractorQuote.deleteMany(),
    testPrisma.workOrder.deleteMany(),
    testPrisma.quoteRound.deleteMany(),
    testPrisma.contractorCredential.deleteMany(),
    testPrisma.contractorComplianceRequirement.deleteMany(),
    testPrisma.organisationRolePermission.deleteMany(),
    testPrisma.approvalPolicyRule.deleteMany(),
    testPrisma.organisationApprovalPolicy.deleteMany(),
    testPrisma.contractor.deleteMany(),
    testPrisma.maintenanceRequestAttachment.deleteMany(),
    testPrisma.maintenanceRequest.deleteMany(),
    testPrisma.contactInvite.deleteMany(),
    testPrisma.propertyMembership.deleteMany(),
    testPrisma.propertyContact.deleteMany(),
    // M16.1 — financial_opening_balances/lot_opening_positions must go
    // before financial_funds/financial_configurations (which they
    // reference), which must go before space/property (ON DELETE RESTRICT
    // in both directions — see the schema's own doc comment).
    // M16.2 — financial_budget_lines reference both financial_funds and
    // financial_budgets, and financial_budgets self-references
    // (revisionOfBudgetId) — both must go before financial_funds/
    // financial_configurations.
    testPrisma.financialBudgetLine.deleteMany(),
    testPrisma.financialBudget.deleteMany(),
    // M16.2.1 — accounting_accounts references financial_funds/
    // financial_configurations (and, after the cycle-break above, no
    // longer references itself or account_template_lines/
    // account_import_batches), so it must go before all of those; the
    // template/import tables themselves go before property/organisation.
    // M16.2.2 — journal_lines reference journal_entries/accounting_accounts/
    // financial_funds; journal_entries self-reference (reversalOfJournalId)
    // but one single deleteMany on the whole table is safe (Postgres checks
    // the FK after the statement, by which point every row in it is
    // already gone); posting_profile_rules reference accounting_accounts/
    // financial_funds; accounting_periods reference financial_configurations.
    // All four must go before accounting_accounts/financial_funds/
    // financial_configurations below.
    testPrisma.journalLine.deleteMany(),
    testPrisma.journalEntry.deleteMany(),
    testPrisma.postingProfileRule.deleteMany(),
    testPrisma.accountingPeriod.deleteMany(),
    testPrisma.accountingAccount.deleteMany(),
    testPrisma.accountImportBatch.deleteMany(),
    testPrisma.accountTemplateLine.deleteMany(),
    testPrisma.accountTemplate.deleteMany(),
    testPrisma.financialOpeningBalance.deleteMany(),
    testPrisma.lotOpeningPosition.deleteMany(),
    testPrisma.financialFund.deleteMany(),
    testPrisma.financialConfiguration.deleteMany(),
    testPrisma.space.deleteMany(),
    testPrisma.property.deleteMany(),
    testPrisma.session.deleteMany(),
    testPrisma.platformAuditEvent.deleteMany(),
    testPrisma.employeeSession.deleteMany(),
    testPrisma.employee.deleteMany(),
    testPrisma.organisationMembership.deleteMany(),
    testPrisma.user.deleteMany(),
    testPrisma.organisation.deleteMany(),
  ]);
}
