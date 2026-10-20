import { z } from 'zod';
import {
  createAccountSchema,
  createAccountTemplateSchema,
  importAccountsApplySchema,
  importAccountsPreviewSchema,
  provisionFromTemplateSchema,
  updateAccountSchema,
} from '../../modules/financials/accounts.schemas.js';
import { commonErrors, jsonContent } from '../components/common.schemas.js';
import {
  accountImportApplyResultSchema,
  accountImportPreviewSchema,
  accountingAccountListSchema,
  accountingAccountSchema,
} from '../components/entities.schemas.js';
import { registry, SECURITY_CUSTOMER } from '../registry.js';
import { propertyIdPathParam } from './properties.paths.js';

const TAG = 'Financial Management';

const accountIdPathParam = registry.register(
  'FinancialAccountIdPathParam',
  z.object({ propertyId: z.string(), accountId: z.string() }),
);

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/accounts',
  operationId: 'listAccounts',
  tags: [TAG],
  summary: "Lists this property's chart of accounts.",
  description:
    'Requires `financials.view`. Ordered by classification then code. Query params: ' +
    '`classification`, `fundId` (restrictedToFundId), `activeOnly` ("true"/"false", default ' +
    'true), `search` (matches code or name).',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: {
    200: jsonContent(accountingAccountListSchema, 'Accounts.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/accounts',
  operationId: 'createAccount',
  tags: [TAG],
  summary: 'Adds one account to this property’s chart of accounts.',
  description:
    'Requires `financials.manage` and financial setup to have at least started (not necessarily ' +
    'ACTIVE). `code` must be unique within this property (409 otherwise) — the same code may ' +
    'exist on a different property. `restrictedToFundId`, if supplied, must belong to this same ' +
    'property; omitted/null means usable against any fund (see the M16.2.1 ADR, D2).',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: createAccountSchema } } },
  },
  responses: {
    201: jsonContent(accountingAccountSchema, 'Account created.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/properties/{propertyId}/financials/accounts/{accountId}',
  operationId: 'updateAccount',
  tags: [TAG],
  summary: 'Updates an account’s name/description/classification/parent/fund restriction.',
  description:
    'Requires `financials.manage`. `code` is never editable here — see UpdateAccountInput’s doc ' +
    'comment. Rejects a self-referencing or circular `parentAccountId` (422).',
  security: SECURITY_CUSTOMER,
  request: {
    params: accountIdPathParam,
    body: { content: { 'application/json': { schema: updateAccountSchema } } },
  },
  responses: {
    200: jsonContent(accountingAccountSchema, 'Updated.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/accounts/{accountId}/deactivate',
  operationId: 'deactivateAccount',
  tags: [TAG],
  summary: 'Deactivates an account — accounts are never deleted.',
  description:
    'Requires `financials.manage`. Idempotent for an already-inactive account. Every historical ' +
    'reference to this account (budget lines, and future journal lines) is left exactly as-is.',
  security: SECURITY_CUSTOMER,
  request: { params: accountIdPathParam },
  responses: {
    200: jsonContent(accountingAccountSchema, 'Deactivated.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/accounts/{accountId}/reactivate',
  operationId: 'reactivateAccount',
  tags: [TAG],
  summary: 'Reactivates a previously deactivated account.',
  description: 'Requires `financials.manage`. Idempotent for an already-active account.',
  security: SECURITY_CUSTOMER,
  request: { params: accountIdPathParam },
  responses: {
    200: jsonContent(accountingAccountSchema, 'Reactivated.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/properties/{propertyId}/financials/accounts/export',
  operationId: 'exportAccountsCsv',
  tags: [TAG],
  summary: 'Exports the current chart of accounts as CSV text.',
  description:
    'Requires `financials.view`. Columns: Code, Name, Classification, Fund, Active, External ' +
    'Code — the same shape the importer accepts, so an export can be re-imported unchanged.',
  security: SECURITY_CUSTOMER,
  request: { params: propertyIdPathParam },
  responses: {
    200: { description: 'CSV file.', content: { 'text/csv': { schema: { type: 'string' } } } },
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/accounts/import/preview',
  operationId: 'previewAccountsImport',
  tags: [TAG],
  summary: 'Dry-run validates a CSV file against this property’s chart of accounts.',
  description:
    'Requires `financials.manage`. A pure, unpersisted computation — writes nothing. Classifies ' +
    'nothing from the filename; a classification is only explicit when the file’s own "Code ' +
    'type" column states it, otherwise at most a non-authoritative heuristic suggestion is ' +
    'offered (see AccountImportService’s doc comment). `csvContent` is the uploaded file’s raw ' +
    'text, read client-side — there is no separate multipart upload endpoint for M16.2.1.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: importAccountsPreviewSchema } } },
  },
  responses: {
    200: jsonContent(accountImportPreviewSchema, 'Validation report.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/accounts/import/apply',
  operationId: 'applyAccountsImport',
  tags: [TAG],
  summary: 'Applies a CSV import atomically, creating one account per row.',
  description:
    'Requires `financials.manage`. Always re-validates the same file content from scratch — ' +
    'never trusts a prior preview call. `rowClassifications` (row number -> classification) ' +
    'resolves rows the dry run could only suggest a classification for. If any row is still ' +
    'ERROR after overrides, nothing is written (422) and the blocking rows are listed in the ' +
    'error details — one bad row blocks the whole batch. If a concurrent import or manual ' +
    'account creation takes a code this import also wanted (a race the in-transaction ' +
    'duplicate check alone cannot fully prevent), the database unique constraint catches it and ' +
    'the whole transaction rolls back cleanly with 409 — never a partial write.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: importAccountsApplySchema } } },
  },
  responses: {
    201: jsonContent(accountImportApplyResultSchema, 'Import applied.'),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});

registry.registerPath({
  method: 'post',
  path: '/properties/{propertyId}/financials/accounts/provision-from-template',
  operationId: 'provisionAccountsFromTemplate',
  tags: [TAG],
  summary: 'Copies every line of an organisation account template into this property.',
  description:
    'Requires `financials.manage`. A template is only ever COPIED, never read live afterward — ' +
    'see AccountTemplate’s doc comment. A code already present on this property’s chart of ' +
    'accounts is skipped, never overwritten, so provisioning twice is safe.',
  security: SECURITY_CUSTOMER,
  request: {
    params: propertyIdPathParam,
    body: { content: { 'application/json': { schema: provisionFromTemplateSchema } } },
  },
  responses: {
    201: {
      description: 'Accounts created from the template.',
      content: {
        'application/json': {
          schema: z.object({
            created: z.array(accountingAccountSchema),
            skippedCodes: z.array(z.string()),
          }),
        },
      },
    },
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

const ORG_TAG = 'Organisation Settings';

registry.registerPath({
  method: 'get',
  path: '/organisations/me/account-templates',
  operationId: 'listAccountTemplates',
  tags: [ORG_TAG],
  summary: 'Lists this organisation’s active account templates.',
  description: 'Requires OWNER/ADMIN. Newest version of each template name first.',
  security: SECURITY_CUSTOMER,
  responses: {
    200: {
      description: 'Templates.',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                publicReference: z.string().openapi({ example: 'ACCT-K7M4Q2' }),
                name: z.string(),
                version: z.number().int(),
                isActive: z.boolean(),
                lines: z.array(
                  z.object({
                    code: z.string(),
                    name: z.string(),
                    classification: z.string(),
                    parentCode: z.string().nullable(),
                  }),
                ),
                createdAt: z.string().datetime(),
              }),
            ),
          }),
        },
      },
    },
    401: commonErrors[401],
    403: commonErrors[403],
  },
});

registry.registerPath({
  method: 'post',
  path: '/organisations/me/account-templates',
  operationId: 'createAccountTemplate',
  tags: [ORG_TAG],
  summary: 'Creates a new account template, or the next version of an existing one by name.',
  description:
    'Requires OWNER/ADMIN. Template versions are immutable history — creating under an existing ' +
    'name never edits the prior version in place, it adds the next `version`.',
  security: SECURITY_CUSTOMER,
  request: { body: { content: { 'application/json': { schema: createAccountTemplateSchema } } } },
  responses: {
    201: {
      description: 'Template created.',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            publicReference: z.string(),
            name: z.string(),
            version: z.number().int(),
            isActive: z.boolean(),
            lines: z.array(
              z.object({
                code: z.string(),
                name: z.string(),
                classification: z.string(),
                parentCode: z.string().nullable(),
              }),
            ),
            createdAt: z.string().datetime(),
          }),
        },
      },
    },
    401: commonErrors[401],
    403: commonErrors[403],
    409: commonErrors[409],
    422: commonErrors[422],
  },
});
