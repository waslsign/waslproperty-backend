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
    // M16.3 — levy_adjustments reference lot_levy_charges and
    // journal_entries; lot_levy_charges reference levy_schedules/
    // levy_installments/spaces/financial_funds; levy_installments
    // reference levy_schedules; levy_schedules reference financial_funds/
    // financial_budgets/journal_entries (nullable). All four must go
    // before financial_budget_lines/financial_budgets below and before
    // journal_lines/journal_entries further down.
    // M16.5 — payment_allocations reference lot_levy_charges (and
    // receipts/journal_entries) — must go before lot_levy_charges below.
    testPrisma.paymentAllocation.deleteMany(),
    testPrisma.levyAdjustment.deleteMany(),
    testPrisma.lotLevyCharge.deleteMany(),
    testPrisma.levyInstallment.deleteMany(),
    testPrisma.levySchedule.deleteMany(),
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
    // M16.5 — receipts reference journal_entries/spaces/financial_funds/
    // accounting_accounts/financial_configurations (payment_allocations,
    // which also reference receipts, are already deleted above, before
    // lot_levy_charges) — must go before journal_entries/journal_lines.
    // M16.7 — bank_transaction_matches reference receipts/journal_lines/
    // bank_transactions (all nullable except bankTransactionId) — must go
    // before receipts/journal_lines/journal_entries below and before
    // bank_transactions. bank_transactions reference bank_accounts/
    // bank_statement_imports/bank_reconciliations — must go before all
    // three. bank_statement_imports and bank_reconciliations both
    // reference bank_accounts — must go before it; bank_accounts itself
    // references accounting_accounts/financial_funds/
    // financial_configurations — must go before those below.
    testPrisma.bankTransactionMatch.deleteMany(),
    testPrisma.bankTransaction.deleteMany(),
    testPrisma.bankStatementImport.deleteMany(),
    testPrisma.bankReconciliation.deleteMany(),
    testPrisma.bankAccount.deleteMany(),
    testPrisma.receipt.deleteMany(),
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
    // M16.6 — collection_notes/payment_reminders reference collection_cases
    // (and property/space/user, never journal_entries) — both must go
    // before collection_cases, and all three before space/property below.
    testPrisma.collectionNote.deleteMany(),
    testPrisma.paymentReminder.deleteMany(),
    testPrisma.collectionCase.deleteMany(),
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
