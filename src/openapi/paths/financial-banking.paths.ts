import { z } from 'zod';
import { registerBankAccountSchema, updateBankAccountSchema } from '../../modules/financials/bank-accounts.schemas.js';
import { previewBankStatementSchema, applyBankStatementSchema } from '../../modules/financials/bank-import.schemas.js';
import {
  manualMatchReceiptSchema,
  manualMatchJournalLineSchema,
  reverseMatchSchema,
  ignoreTransactionSchema,
  createReceiptFromTransactionSchema,
} from '../../modules/financials/bank-matching.schemas.js';
import { createReconciliationDraftSchema, reopenReconciliationSchema } from '../../modules/financials/bank-reconciliation.schemas.js';
import { commonErrors, jsonContent } from '../components/common.schemas.js';
import {
  bankAccountListSchema,
  bankAccountViewSchema,
  eligibleGlAccountListSchema,
  bankImportApplyResultSchema,
  bankImportPreviewReportSchema,
  bankMatchSuggestionSchema,
  bankReconciliationListSchema,
  bankReconciliationViewSchema,
  bankTransactionListSchema,
  bankTransactionViewSchema,
} from '../components/entities.schemas.js';
import { propertyIdPathParam } from './properties.paths.js';
import { registry, SECURITY_CUSTOMER } from '../registry.js';

const TAG = 'Financial Management — Banking & Reconciliation';

const bankAccountIdPathParam = registry.register(
  'BankAccountIdPathParam',
  z.object({ propertyId: z.string(), bankAccountId: z.string() }),
);
const bankTransactionIdPathParam = registry.register(
  'BankTransactionIdPathParam',
  z.object({ propertyId: z.string(), bankTransactionId: z.string() }),
);
const bankMatchIdPathParam = registry.register(
  'BankMatchIdPathParam',
  z.object({ propertyId: z.string(), matchId: z.string() }),
);
const reconciliationIdPathParam = registry.register(
  'ReconciliationIdPathParam',
  z.object({ propertyId: z.string(), reconciliationId: z.string() }),
);

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/bank-accounts',
  operationId: 'registerBankAccount',
  tags: [TAG],
  summary: 'Registers a property-scoped bank account against an existing GL cash account.',
  description:
    'Requires `financials.manage`. The raw `accountIdentifier` submitted is masked server-side and ' +
    'never persisted or echoed back — only the masked last-4 form is ever stored.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam, body: { content: { 'application/json': { schema: registerBankAccountSchema } } } },
  responses: {
    201: jsonContent(bankAccountViewSchema, 'Registered bank account.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/bank-accounts',
  operationId: 'listBankAccounts',
  tags: [TAG],
  summary: 'Lists this property\'s registered bank accounts.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: { 200: jsonContent(bankAccountListSchema, 'Bank accounts.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/bank-accounts/eligible-gl-accounts',
  operationId: 'listEligibleGlAccounts',
  tags: [TAG],
  summary: 'Lists GL accounts eligible to be registered as a bank account\'s cash account.',
  description:
    'Requires `financials.view`. An account is eligible only if it is assigned the FUND_CASH ' +
    'posting-profile role (never an arbitrary ASSET account such as a receivable) and is not ' +
    'already linked to another active bank account — the same eligibility `registerBankAccount` ' +
    'enforces server-side, surfaced here so the picker never offers an account that would be ' +
    'rejected.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: {
    200: jsonContent(eligibleGlAccountListSchema, 'Eligible GL cash accounts.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/bank-accounts/{bankAccountId}',
  operationId: 'getBankAccount',
  tags: [TAG],
  summary: 'Gets one bank account.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: bankAccountIdPathParam },
  responses: { 200: jsonContent(bankAccountViewSchema, 'Bank account.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] },
});

registry.registerPath({
  method: 'patch',
  path: '/properties/{propertyId}/financials/bank-accounts/{bankAccountId}',
  operationId: 'updateBankAccount',
  tags: [TAG],
  summary: 'Renames or activates/deactivates a bank account.',
  description: 'Requires `financials.manage`.',
  security: SECURITY_CUSTOMER,
  request: { params: bankAccountIdPathParam, body: { content: { 'application/json': { schema: updateBankAccountSchema } } } },
  responses: { 200: jsonContent(bankAccountViewSchema, 'Updated bank account.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/bank-accounts/{bankAccountId}/statements/preview',
  operationId: 'previewBankStatement',
  tags: [TAG],
  summary: 'Normalizes and validates a CSV bank statement without persisting anything.',
  description:
    'Requires `financials.manage`. Pure, unpersisted computation — flags ERROR (ambiguous/invalid) and ' +
    'DUPLICATE (already-imported or within-file repeat) rows before the manager confirms the import.',
  security: SECURITY_CUSTOMER,
  request: { params: bankAccountIdPathParam, body: { content: { 'application/json': { schema: previewBankStatementSchema } } } },
  responses: {
    200: jsonContent(bankImportPreviewReportSchema, 'Row-by-row normalization/validation report.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/bank-accounts/{bankAccountId}/statements/apply',
  operationId: 'applyBankStatement',
  tags: [TAG],
  summary: 'Imports a CSV bank statement — persists transactions, skipping duplicates.',
  description:
    'Requires `financials.manage`. Re-validates the file from scratch (never trusts a prior preview); ' +
    'rejected outright if any row is ERROR. Idempotent — re-submitting the exact same file against the ' +
    'same bank account returns the original import, never a duplicate.',
  security: SECURITY_CUSTOMER,
  request: { params: bankAccountIdPathParam, body: { content: { 'application/json': { schema: applyBankStatementSchema } } } },
  responses: {
    201: jsonContent(bankImportApplyResultSchema, 'Applied import.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/bank-accounts/{bankAccountId}/statements',
  operationId: 'listBankStatementImports',
  tags: [TAG],
  summary: 'Lists a bank account\'s applied statement imports (provenance history).',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: bankAccountIdPathParam },
  responses: { 200: jsonContent(z.object({ items: z.array(z.object({}).passthrough()) }), 'Statement imports.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/bank-accounts/{bankAccountId}/transactions',
  operationId: 'listBankTransactions',
  tags: [TAG],
  summary: 'Lists a bank account\'s imported transactions, with filters.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: bankAccountIdPathParam },
  responses: { 200: jsonContent(bankTransactionListSchema, 'Bank transactions.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/bank-transactions/{bankTransactionId}',
  operationId: 'getBankTransaction',
  tags: [TAG],
  summary: 'Gets one bank transaction, with its current/suggested match.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: bankTransactionIdPathParam },
  responses: { 200: jsonContent(bankTransactionViewSchema, 'Bank transaction.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/bank-transactions/{bankTransactionId}/suggest-match',
  operationId: 'generateMatchSuggestion',
  tags: [TAG],
  summary: 'Runs the deterministic matching engine for one transaction; proposes, never confirms.',
  description:
    'Requires `financials.view` (read-only — it changes nothing accounting-visible). Returns the single ' +
    'unambiguous suggestion if one rule-priority match was found, else null.',
  security: SECURITY_CUSTOMER,
  request: { params: bankTransactionIdPathParam },
  responses: {
    200: jsonContent(z.object({ suggestion: bankMatchSuggestionSchema.nullable() }), 'Suggestion, or null.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/bank-transaction-matches/{matchId}/confirm',
  operationId: 'confirmSuggestedMatch',
  tags: [TAG],
  summary: 'Confirms a previously generated SUGGESTED match.',
  description: 'Requires `financials.manage`. Never posts a GL journal — only links two already-existing records.',
  security: SECURITY_CUSTOMER,
  request: { params: bankMatchIdPathParam },
  responses: { 201: jsonContent(z.object({}).passthrough(), 'Confirmed match.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 409: commonErrors[409] },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/bank-transactions/{bankTransactionId}/match/receipt',
  operationId: 'manualMatchReceipt',
  tags: [TAG],
  summary: 'Manually links a bank transaction to a specific existing receipt.',
  description: 'Requires `financials.manage`.',
  security: SECURITY_CUSTOMER,
  request: { params: bankTransactionIdPathParam, body: { content: { 'application/json': { schema: manualMatchReceiptSchema } } } },
  responses: { 201: jsonContent(z.object({}).passthrough(), 'Confirmed match.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 409: commonErrors[409] },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/bank-transactions/{bankTransactionId}/match/journal-line',
  operationId: 'manualMatchJournalLine',
  tags: [TAG],
  summary: 'Manually links an outgoing bank transaction to an existing GL cash movement.',
  description: 'Requires `financials.manage`. Never creates a new liability/expense — only links to a journal line that already exists.',
  security: SECURITY_CUSTOMER,
  request: { params: bankTransactionIdPathParam, body: { content: { 'application/json': { schema: manualMatchJournalLineSchema } } } },
  responses: { 201: jsonContent(z.object({}).passthrough(), 'Confirmed match.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 409: commonErrors[409] },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/bank-transaction-matches/{matchId}/reverse',
  operationId: 'reverseMatch',
  tags: [TAG],
  summary: 'Reverses a confirmed match — unlinks only, never touches the underlying receipt/journal.',
  description: 'Requires `financials.manage`. Blocked once the transaction is part of a completed reconciliation (reopen it first).',
  security: SECURITY_CUSTOMER,
  request: { params: bankMatchIdPathParam, body: { content: { 'application/json': { schema: reverseMatchSchema } } } },
  responses: { 201: jsonContent(z.object({}).passthrough(), 'Reversed match.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 409: commonErrors[409] },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/bank-transactions/{bankTransactionId}/ignore',
  operationId: 'ignoreTransaction',
  tags: [TAG],
  summary: 'Marks a transaction as will-never-match (e.g. a bank fee the scheme chooses not to book).',
  description: 'Requires `financials.manage`.',
  security: SECURITY_CUSTOMER,
  request: { params: bankTransactionIdPathParam, body: { content: { 'application/json': { schema: ignoreTransactionSchema } } } },
  responses: { 201: jsonContent(bankTransactionViewSchema, 'Ignored transaction.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 409: commonErrors[409] },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/bank-transactions/{bankTransactionId}/create-receipt',
  operationId: 'createReceiptFromTransaction',
  tags: [TAG],
  summary: 'Creates a new receipt from an unmatched incoming deposit, via the existing receipts service.',
  description:
    'Requires `financials.approve` (this posts a real GL journal, via ReceiptsService.recordReceipt — ' +
    'never a second posting implementation). Only for incoming (positive-amount) transactions.',
  security: SECURITY_CUSTOMER,
  request: { params: bankTransactionIdPathParam, body: { content: { 'application/json': { schema: createReceiptFromTransactionSchema } } } },
  responses: { 201: jsonContent(z.object({}).passthrough(), 'The new match and receipt.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404], 409: commonErrors[409] },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/bank-accounts/{bankAccountId}/reconciliations',
  operationId: 'createReconciliationDraft',
  tags: [TAG],
  summary: 'Starts a new DRAFT bank reconciliation for a statement period.',
  description:
    'Requires `financials.manage`. Validates opening-balance continuity against the prior completed ' +
    'reconciliation (or the account\'s configured opening position) and rejects an overlapping period.',
  security: SECURITY_CUSTOMER,
  request: { params: bankAccountIdPathParam, body: { content: { 'application/json': { schema: createReconciliationDraftSchema } } } },
  responses: {
    201: jsonContent(bankReconciliationViewSchema, 'Draft reconciliation, with GL totals freshly calculated.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/bank-accounts/{bankAccountId}/reconciliations',
  operationId: 'listReconciliations',
  tags: [TAG],
  summary: 'Lists a bank account\'s reconciliation history.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: bankAccountIdPathParam },
  responses: { 200: jsonContent(bankReconciliationListSchema, 'Reconciliations.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/reconciliations/{reconciliationId}',
  operationId: 'getReconciliation',
  tags: [TAG],
  summary: 'Gets one reconciliation.',
  description: 'Requires `financials.view`.',
  security: SECURITY_CUSTOMER,
  request: { params: reconciliationIdPathParam },
  responses: { 200: jsonContent(bankReconciliationViewSchema, 'Reconciliation.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/reconciliations/{reconciliationId}/calculate',
  operationId: 'calculateReconciliation',
  tags: [TAG],
  summary: 'Recomputes GL totals, outstanding items and the difference against current data.',
  description: 'Requires `financials.manage`. Callable repeatedly while DRAFT/IN_REVIEW as matches are confirmed.',
  security: SECURITY_CUSTOMER,
  request: { params: reconciliationIdPathParam },
  responses: { 200: jsonContent(bankReconciliationViewSchema, 'Recalculated reconciliation.'), 401: commonErrors[401], 403: commonErrors[403], 404: commonErrors[404] },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/reconciliations/{reconciliationId}/complete',
  operationId: 'completeReconciliation',
  tags: [TAG],
  summary: 'Completes a reconciliation — requires a freshly-recomputed difference of exactly 0.00.',
  description:
    'Requires `financials.approve` (maker-checker bar, same as closing an accounting period or reversing ' +
    'a journal). The resulting snapshot is immutable; see reopen to correct it.',
  security: SECURITY_CUSTOMER,
  request: { params: reconciliationIdPathParam },
  responses: {
    201: jsonContent(bankReconciliationViewSchema, 'Completed reconciliation.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/reconciliations/{reconciliationId}/reopen',
  operationId: 'reopenReconciliation',
  tags: [TAG],
  summary: 'Reopens a completed reconciliation for correction.',
  description:
    'Requires `financials.approve`. Never edits the original snapshot in place — flips status and ' +
    'releases its linked transactions; create a fresh draft (supersedesReconciliationId) to correct it.',
  security: SECURITY_CUSTOMER,
  request: { params: reconciliationIdPathParam, body: { content: { 'application/json': { schema: reopenReconciliationSchema } } } },
  responses: {
    201: jsonContent(bankReconciliationViewSchema, 'Reopened reconciliation.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});
