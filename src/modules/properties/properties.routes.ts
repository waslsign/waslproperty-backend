import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireCapability } from '../../middlewares/authorize.middleware.js';
import { fromParam } from '../../middlewares/resolvePropertyId.js';
import { resolvePropertyReference, resolveSpaceReference } from '../../middlewares/resolvePublicReference.js';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { listActivityForProperty } from '../activity/activity.controller.js';
import {
  addPersonToProperty,
  assignExistingPerson,
  listPeopleForProperty,
} from '../people/people.controller.js';
import {
  activateFinancialSetup,
  addFinancialFund,
  bulkSetFinancialLotOpeningPositions,
  getFinancialReconciliation,
  getFinancialSummary,
  startFinancialSetup,
  updateFinancialFund,
  updateFinancialYear,
} from '../financials/financials.controller.js';
import {
  activateFinancialBudget,
  addFinancialBudgetLine,
  approveFinancialBudget,
  createFinancialBudget,
  deleteFinancialBudgetLine,
  getFinancialBudget,
  listFinancialBudgets,
  reviseFinancialBudget,
  updateFinancialBudgetLine,
  updateFinancialBudgetMetadata,
} from '../financials/budgets.controller.js';
import {
  applyAccountsImport,
  createAccount,
  deactivateAccount,
  exportAccountsCsv,
  listAccounts,
  previewAccountsImport,
  reactivateAccount,
  updateAccount,
} from '../financials/accounts.controller.js';
import { provisionAccountsFromTemplate } from '../financials/account-templates.controller.js';
import {
  closeAccountingPeriod,
  createAccountingPeriod,
  listAccountingPeriods,
  reopenAccountingPeriod,
} from '../financials/accounting-periods.controller.js';
import {
  listPostingProfileRules,
  upsertPostingProfileRule,
} from '../financials/posting-profile.controller.js';
import {
  generateOpeningJournal,
  getJournal,
  getTrialBalance,
  listJournals,
  postManualJournal,
  reverseJournal,
} from '../financials/ledger.controller.js';
import {
  approveLevySchedule,
  cancelLevySchedule,
  createLevyAdjustment,
  createRegularLevySchedule,
  createSpecialLevySchedule,
  getLevySchedule,
  issueLevySchedule,
  listLevySchedules,
  listLotLevyCharges,
  previewLevySchedule,
  reverseLevySchedule,
} from '../financials/levies.controller.js';
import {
  getLotFinancialAccount,
  getLotLedger,
  getLotStatement,
} from '../financials/lot-ledger.controller.js';
import {
  createAllocation,
  getReceipt,
  listReceipts,
  recordReceipt,
  reverseAllocation,
  reverseReceipt,
} from '../financials/receipts.controller.js';
import {
  addCollectionNote,
  cancelReminder,
  createCollectionCase,
  draftReminder,
  getArrearsRegister,
  getArrearsSummary,
  getCollectionCase,
  getLotArrearsDetail,
  getReminder,
  updateCollectionCase,
} from '../financials/arrears.controller.js';
import {
  getBankAccount,
  listBankAccounts,
  listEligibleGlAccounts,
  registerBankAccount,
  updateBankAccount,
} from '../financials/bank-accounts.controller.js';
import {
  applyBankStatement,
  listBankStatementImports,
  previewBankStatement,
} from '../financials/bank-import.controller.js';
import { getBankTransaction, listBankTransactions } from '../financials/bank-transactions.controller.js';
import {
  confirmSuggestedMatch,
  createReceiptFromTransaction,
  generateMatchSuggestion,
  ignoreTransaction,
  manualMatchJournalLine,
  manualMatchReceipt,
  reverseMatch,
} from '../financials/bank-matching.controller.js';
import {
  calculateReconciliation,
  completeReconciliation,
  createReconciliationDraft,
  getReconciliation,
  listReconciliations,
  reopenReconciliation,
} from '../financials/bank-reconciliation.controller.js';
import { createSpaceForProperty, listSpacesForProperty } from '../spaces/spaces.controller.js';
import {
  bulkSetStrataLots,
  classifyStrataSpaces,
  completeStrataSetup,
  enableStrata,
  getStrataSummary,
  updateStrataPlan,
} from '../strata/strata.controller.js';
import {
  createProperty,
  getProperty,
  getPropertyInsights,
  listProperties,
  updateProperty,
} from './properties.controller.js';

export const propertiesRouter = Router();

propertiesRouter.use(authenticate);

// Portfolio scoping happens inside the service (PropertiesService.list) via
// AuthorizationService.getAccessiblePropertyIds — a user with no accessible
// properties simply gets an empty list, no separate route gate needed here.
propertiesRouter.get('/', asyncHandler(listProperties));
// Creating a brand-new property has no propertyId to scope against, so this
// is the coarse "does this user hold property.manage on ANY property"
// form of requireCapability (no resolvePropertyId) — OWNER/ADMIN always
// pass via AuthorizationService.can's own special case; a property-scoped
// manager passes only if their organisation has granted property.manage,
// and only once they already manage at least one existing property (a
// user with zero PropertyMemberships holds no capabilities to check).
propertiesRouter.post('/', requireCapability('property.manage'), asyncHandler(createProperty));
// No route-level capability gate: a resident/tenant may view their own
// property read-only (pre-existing behaviour), separate from the
// operational `property.view` capability — PropertiesService.getById
// resolves both and 404s if neither applies (never leaking that a
// different property exists, staff or resident alike).
propertiesRouter.get('/:id', resolvePropertyReference('id'), asyncHandler(getProperty));
propertiesRouter.patch(
  '/:id',
  resolvePropertyReference('id'),
  requireCapability('property.manage', fromParam('id')),
  asyncHandler(updateProperty),
);
propertiesRouter.get(
  '/:id/insights',
  resolvePropertyReference('id'),
  requireCapability('analytics.view', fromParam('id')),
  asyncHandler(getPropertyInsights),
);

propertiesRouter.get(
  '/:propertyId/spaces',
  resolvePropertyReference('propertyId'),
  requireCapability('spaces.view', fromParam('propertyId')),
  asyncHandler(listSpacesForProperty),
);
propertiesRouter.post(
  '/:propertyId/spaces',
  resolvePropertyReference('propertyId'),
  requireCapability('spaces.manage', fromParam('propertyId')),
  asyncHandler(createSpaceForProperty),
);

propertiesRouter.get(
  '/:propertyId/memberships',
  resolvePropertyReference('propertyId'),
  requireCapability('people.view', fromParam('propertyId')),
  asyncHandler(listPeopleForProperty),
);
propertiesRouter.post(
  '/:propertyId/memberships',
  resolvePropertyReference('propertyId'),
  requireCapability('people.manage', fromParam('propertyId')),
  asyncHandler(addPersonToProperty),
);
propertiesRouter.post(
  '/:propertyId/memberships/assign',
  resolvePropertyReference('propertyId'),
  requireCapability('people.manage', fromParam('propertyId')),
  asyncHandler(assignExistingPerson),
);

propertiesRouter.get(
  '/:propertyId/activity',
  resolvePropertyReference('propertyId'),
  requireCapability('activity.view', fromParam('propertyId')),
  asyncHandler(listActivityForProperty),
);

// Strata (M11-B) — the guided "Enable Strata Management" setup flow and
// the Units of Entitlement summary. strata.view/strata.manage, not
// property.manage/spaces.manage: narrower, purpose-built capabilities an
// organisation grants independently (see capabilities.ts) — a property
// manager who can edit a property's name doesn't automatically get to
// configure its strata scheme, and vice versa.
propertiesRouter.get(
  '/:propertyId/strata',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.view', fromParam('propertyId')),
  asyncHandler(getStrataSummary),
);
propertiesRouter.post(
  '/:propertyId/strata/enable',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.manage', fromParam('propertyId')),
  asyncHandler(enableStrata),
);
propertiesRouter.patch(
  '/:propertyId/strata/plan',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.manage', fromParam('propertyId')),
  asyncHandler(updateStrataPlan),
);
propertiesRouter.put(
  '/:propertyId/strata/lots',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.manage', fromParam('propertyId')),
  asyncHandler(bulkSetStrataLots),
);
propertiesRouter.put(
  '/:propertyId/strata/spaces/classify',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.manage', fromParam('propertyId')),
  asyncHandler(classifyStrataSpaces),
);
propertiesRouter.post(
  '/:propertyId/strata/complete',
  resolvePropertyReference('propertyId'),
  requireCapability('strata.manage', fromParam('propertyId')),
  asyncHandler(completeStrataSetup),
);

// Financial Management (M16.1) — financial onboarding and the opening
// financial position for an existing strata scheme. financials.view/
// financials.manage, mirroring strata.view/strata.manage's own narrower-
// than-property.manage rationale (see capabilities.ts).
propertiesRouter.get(
  '/:propertyId/financials',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getFinancialSummary),
);
propertiesRouter.post(
  '/:propertyId/financials',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(startFinancialSetup),
);
propertiesRouter.patch(
  '/:propertyId/financials',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(updateFinancialYear),
);
propertiesRouter.post(
  '/:propertyId/financials/funds',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(addFinancialFund),
);
propertiesRouter.patch(
  '/:propertyId/financials/funds/:fundId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(updateFinancialFund),
);
propertiesRouter.put(
  '/:propertyId/financials/lot-positions',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(bulkSetFinancialLotOpeningPositions),
);
propertiesRouter.get(
  '/:propertyId/financials/reconciliation',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getFinancialReconciliation),
);
propertiesRouter.post(
  '/:propertyId/financials/activate',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(activateFinancialSetup),
);

// Chart of Accounts (M16.2.1) — see prisma/schema.prisma's "Strata
// Financial Management: Chart of Accounts" section doc comment. Same
// financials.view/financials.manage split as the rest of this section;
// deliberately no separate capability (mirrors how financials.manage
// already covers funds/budgets — see M16.2.1 ADR D-capability).
propertiesRouter.get(
  '/:propertyId/financials/accounts',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listAccounts),
);
propertiesRouter.post(
  '/:propertyId/financials/accounts',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(createAccount),
);
propertiesRouter.patch(
  '/:propertyId/financials/accounts/:accountId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(updateAccount),
);
propertiesRouter.post(
  '/:propertyId/financials/accounts/:accountId/deactivate',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(deactivateAccount),
);
propertiesRouter.post(
  '/:propertyId/financials/accounts/:accountId/reactivate',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(reactivateAccount),
);
propertiesRouter.get(
  '/:propertyId/financials/accounts/export',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(exportAccountsCsv),
);
propertiesRouter.post(
  '/:propertyId/financials/accounts/import/preview',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(previewAccountsImport),
);
propertiesRouter.post(
  '/:propertyId/financials/accounts/import/apply',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(applyAccountsImport),
);
propertiesRouter.post(
  '/:propertyId/financials/accounts/provision-from-template',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(provisionAccountsFromTemplate),
);

// Budget Management (M16.2) — the authoritative planned funding requirement
// for a financial year, broken down by fund. Same financials.view/
// financials.manage split as the rest of this section.
propertiesRouter.get(
  '/:propertyId/financials/budgets',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listFinancialBudgets),
);
propertiesRouter.post(
  '/:propertyId/financials/budgets',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(createFinancialBudget),
);
propertiesRouter.get(
  '/:propertyId/financials/budgets/:budgetId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getFinancialBudget),
);
propertiesRouter.patch(
  '/:propertyId/financials/budgets/:budgetId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(updateFinancialBudgetMetadata),
);
propertiesRouter.post(
  '/:propertyId/financials/budgets/:budgetId/lines',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(addFinancialBudgetLine),
);
propertiesRouter.patch(
  '/:propertyId/financials/budgets/:budgetId/lines/:lineId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(updateFinancialBudgetLine),
);
propertiesRouter.delete(
  '/:propertyId/financials/budgets/:budgetId/lines/:lineId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(deleteFinancialBudgetLine),
);
propertiesRouter.post(
  '/:propertyId/financials/budgets/:budgetId/approve',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(approveFinancialBudget),
);
propertiesRouter.post(
  '/:propertyId/financials/budgets/:budgetId/activate',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(activateFinancialBudget),
);
propertiesRouter.post(
  '/:propertyId/financials/budgets/:budgetId/revise',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(reviseFinancialBudget),
);

// General Ledger & Posting Engine (M16.2.2) — see prisma/schema.prisma's
// "Strata Financial Management: General Ledger & Posting Engine" section
// doc comment. Read access is financials.view; every write that touches
// posted history, period status, or the posting profile requires
// financials.approve (never financials.manage alone — see that
// capability's own doc comment on why it's deliberately separate).

// Accounting Periods.
propertiesRouter.get(
  '/:propertyId/financials/periods',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listAccountingPeriods),
);
propertiesRouter.post(
  '/:propertyId/financials/periods',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(createAccountingPeriod),
);
propertiesRouter.post(
  '/:propertyId/financials/periods/:periodId/close',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(closeAccountingPeriod),
);
propertiesRouter.post(
  '/:propertyId/financials/periods/:periodId/reopen',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(reopenAccountingPeriod),
);

// Posting Profile.
propertiesRouter.get(
  '/:propertyId/financials/posting-profile',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listPostingProfileRules),
);
propertiesRouter.put(
  '/:propertyId/financials/posting-profile',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(upsertPostingProfileRule),
);

// Journals.
propertiesRouter.get(
  '/:propertyId/financials/journals',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listJournals),
);
propertiesRouter.post(
  '/:propertyId/financials/journals',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(postManualJournal),
);
propertiesRouter.get(
  '/:propertyId/financials/journals/:journalId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getJournal),
);
propertiesRouter.post(
  '/:propertyId/financials/journals/:journalId/reverse',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(reverseJournal),
);

// Trial balance (read model over posted journals, never a stored total).
propertiesRouter.get(
  '/:propertyId/financials/trial-balance',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getTrialBalance),
);

// Opening journal (M16.1 -> ledger transition).
propertiesRouter.post(
  '/:propertyId/financials/opening-journal',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(generateOpeningJournal),
);

// Levy Management & UOE Allocation (M16.3) — see prisma/schema.prisma's
// "Strata Financial Management: Levy Management & UOE Allocation" section
// doc comment. Draft/approve/cancel (pre-posting) are financials.manage;
// issue/reverse/adjust (every write that touches posted ledger history)
// are financials.approve — same split as periods/posting-profile in
// M16.2.2.
propertiesRouter.get(
  '/:propertyId/financials/levy-schedules',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listLevySchedules),
);
propertiesRouter.post(
  '/:propertyId/financials/levy-schedules/regular',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(createRegularLevySchedule),
);
propertiesRouter.post(
  '/:propertyId/financials/levy-schedules/special',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(createSpecialLevySchedule),
);
propertiesRouter.get(
  '/:propertyId/financials/levy-schedules/:scheduleId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getLevySchedule),
);
propertiesRouter.post(
  '/:propertyId/financials/levy-schedules/:scheduleId/approve',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(approveLevySchedule),
);
propertiesRouter.post(
  '/:propertyId/financials/levy-schedules/:scheduleId/cancel',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(cancelLevySchedule),
);
propertiesRouter.get(
  '/:propertyId/financials/levy-schedules/:scheduleId/preview',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(previewLevySchedule),
);
propertiesRouter.post(
  '/:propertyId/financials/levy-schedules/:scheduleId/issue',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(issueLevySchedule),
);
propertiesRouter.post(
  '/:propertyId/financials/levy-schedules/:scheduleId/reverse',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(reverseLevySchedule),
);
propertiesRouter.get(
  '/:propertyId/financials/lot-levy-charges',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listLotLevyCharges),
);
propertiesRouter.post(
  '/:propertyId/financials/lot-levy-charges/:chargeId/adjust',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(createLevyAdjustment),
);

// Lot Ledger & Owner Financial Accounts (M16.4) — a read-only projection
// over LotOpeningPosition/LotLevyCharge/LevyAdjustment (see
// lot-ledger.service.ts's own architecture note for why there is no new
// persisted subledger table). financials.view only, same as every other
// read endpoint in this section — people.view is checked independently,
// inside the controller, before an owner's name is ever included.
propertiesRouter.get(
  '/:propertyId/financials/lots/:spaceId/financial-account',
  resolvePropertyReference('propertyId'),
  resolveSpaceReference('spaceId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getLotFinancialAccount),
);
propertiesRouter.get(
  '/:propertyId/financials/lots/:spaceId/ledger',
  resolvePropertyReference('propertyId'),
  resolveSpaceReference('spaceId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getLotLedger),
);
propertiesRouter.get(
  '/:propertyId/financials/lots/:spaceId/statement',
  resolvePropertyReference('propertyId'),
  resolveSpaceReference('spaceId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getLotStatement),
);

// Receipts & Payment Allocation (M16.5, ADR-026) — recording a receipt or
// posting/reversing an allocation is itself an immediate ledger posting
// (no separate "draft" step), so these follow the same financials.approve
// bar as issue()/reverseInstallment() in the levy section above, never
// financials.manage.
propertiesRouter.post(
  '/:propertyId/financials/receipts',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(recordReceipt),
);
propertiesRouter.get(
  '/:propertyId/financials/receipts',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listReceipts),
);
propertiesRouter.get(
  '/:propertyId/financials/receipts/:receiptId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getReceipt),
);
propertiesRouter.post(
  '/:propertyId/financials/receipts/:receiptId/reverse',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(reverseReceipt),
);
propertiesRouter.post(
  '/:propertyId/financials/receipts/:receiptId/allocations',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(createAllocation),
);
propertiesRouter.post(
  '/:propertyId/financials/payment-allocations/:allocationId/reverse',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(reverseAllocation),
);

// M16.6 — Arrears Management (ADR-027). Summary/register/lot-detail are
// pure reads (financials.view); collection-case/note/reminder writes are
// reversible workflow data, never a ledger posting, so they're gated on
// financials.manage (not financials.approve, which is reserved for
// immutable-ledger actions — see that capability's own doc comment).
propertiesRouter.get(
  '/:propertyId/financials/arrears/summary',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getArrearsSummary),
);
propertiesRouter.get(
  '/:propertyId/financials/arrears/register',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getArrearsRegister),
);
propertiesRouter.get(
  '/:propertyId/financials/arrears/lots/:spaceId',
  resolvePropertyReference('propertyId'),
  resolveSpaceReference('spaceId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getLotArrearsDetail),
);
propertiesRouter.post(
  '/:propertyId/financials/arrears/lots/:spaceId/collection-cases',
  resolvePropertyReference('propertyId'),
  resolveSpaceReference('spaceId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(createCollectionCase),
);
propertiesRouter.get(
  '/:propertyId/financials/arrears/collection-cases/:caseId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getCollectionCase),
);
propertiesRouter.patch(
  '/:propertyId/financials/arrears/collection-cases/:caseId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(updateCollectionCase),
);
propertiesRouter.post(
  '/:propertyId/financials/arrears/collection-cases/:caseId/notes',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(addCollectionNote),
);
propertiesRouter.post(
  '/:propertyId/financials/arrears/lots/:spaceId/reminders',
  resolvePropertyReference('propertyId'),
  resolveSpaceReference('spaceId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(draftReminder),
);
propertiesRouter.get(
  '/:propertyId/financials/arrears/reminders/:reminderId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getReminder),
);
propertiesRouter.post(
  '/:propertyId/financials/arrears/reminders/:reminderId/cancel',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(cancelReminder),
);

// M16.7 — Banking & Manual Bank Reconciliation. Registering/updating a
// bank account and importing/matching statement data is reversible
// workflow data (financials.manage) — none of it posts a GL journal by
// itself. Completing a reconciliation, reopening one, and creating a new
// Receipt from an unmatched deposit DO change immutable-ledger-adjacent
// state (the same maker-checker bar as closing an accounting period or
// reversing a journal), so those sit on financials.approve instead — see
// bank-matching.service.ts / bank-reconciliation.service.ts doc comments.
propertiesRouter.post(
  '/:propertyId/financials/bank-accounts',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(registerBankAccount),
);
propertiesRouter.get(
  '/:propertyId/financials/bank-accounts',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listBankAccounts),
);
// Registered before the :bankAccountId route below so the literal
// "eligible-gl-accounts" segment is never shadowed by the param route.
propertiesRouter.get(
  '/:propertyId/financials/bank-accounts/eligible-gl-accounts',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listEligibleGlAccounts),
);
propertiesRouter.get(
  '/:propertyId/financials/bank-accounts/:bankAccountId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getBankAccount),
);
propertiesRouter.patch(
  '/:propertyId/financials/bank-accounts/:bankAccountId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(updateBankAccount),
);

propertiesRouter.post(
  '/:propertyId/financials/bank-accounts/:bankAccountId/statements/preview',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(previewBankStatement),
);
propertiesRouter.post(
  '/:propertyId/financials/bank-accounts/:bankAccountId/statements/apply',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(applyBankStatement),
);
propertiesRouter.get(
  '/:propertyId/financials/bank-accounts/:bankAccountId/statements',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listBankStatementImports),
);

propertiesRouter.get(
  '/:propertyId/financials/bank-accounts/:bankAccountId/transactions',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listBankTransactions),
);
propertiesRouter.get(
  '/:propertyId/financials/bank-transactions/:bankTransactionId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getBankTransaction),
);
propertiesRouter.post(
  '/:propertyId/financials/bank-transactions/:bankTransactionId/suggest-match',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(generateMatchSuggestion),
);
propertiesRouter.post(
  '/:propertyId/financials/bank-transactions/:bankTransactionId/match/receipt',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(manualMatchReceipt),
);
propertiesRouter.post(
  '/:propertyId/financials/bank-transactions/:bankTransactionId/match/journal-line',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(manualMatchJournalLine),
);
propertiesRouter.post(
  '/:propertyId/financials/bank-transactions/:bankTransactionId/ignore',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(ignoreTransaction),
);
propertiesRouter.post(
  '/:propertyId/financials/bank-transactions/:bankTransactionId/create-receipt',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(createReceiptFromTransaction),
);
propertiesRouter.post(
  '/:propertyId/financials/bank-transaction-matches/:matchId/confirm',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(confirmSuggestedMatch),
);
propertiesRouter.post(
  '/:propertyId/financials/bank-transaction-matches/:matchId/reverse',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(reverseMatch),
);

propertiesRouter.post(
  '/:propertyId/financials/bank-accounts/:bankAccountId/reconciliations',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(createReconciliationDraft),
);
propertiesRouter.get(
  '/:propertyId/financials/bank-accounts/:bankAccountId/reconciliations',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(listReconciliations),
);
propertiesRouter.get(
  '/:propertyId/financials/reconciliations/:reconciliationId',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.view', fromParam('propertyId')),
  asyncHandler(getReconciliation),
);
propertiesRouter.post(
  '/:propertyId/financials/reconciliations/:reconciliationId/calculate',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.manage', fromParam('propertyId')),
  asyncHandler(calculateReconciliation),
);
propertiesRouter.post(
  '/:propertyId/financials/reconciliations/:reconciliationId/complete',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(completeReconciliation),
);
propertiesRouter.post(
  '/:propertyId/financials/reconciliations/:reconciliationId/reopen',
  resolvePropertyReference('propertyId'),
  requireCapability('financials.approve', fromParam('propertyId')),
  asyncHandler(reopenReconciliation),
);
