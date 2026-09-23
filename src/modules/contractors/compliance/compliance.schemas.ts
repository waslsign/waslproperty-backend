import { ComplianceEnforcement, CredentialCategory, MaintenanceCategory } from '@prisma/client';
import { z } from 'zod';

export const ALLOWED_CREDENTIAL_DOCUMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

const dateInput = z.coerce.date();

export const createCredentialSchema = z
  .object({
    category: z.nativeEnum(CredentialCategory),
    type: z.string().trim().min(1).max(160),
    credentialNumber: z.string().trim().min(1).max(120).optional(),
    issuer: z.string().trim().min(1).max(160).optional(),
    issuedAt: dateInput.optional(),
    expiresAt: dateInput.optional(),
    coverageAmount: z.coerce.number().nonnegative().optional(),
    coverageCurrencyCode: z.string().trim().length(3).optional(),
    notes: z.string().trim().min(1).max(2000).optional(),
    documentStorageKey: z.string().trim().min(1).optional(),
    documentFileName: z.string().trim().min(1).max(255).optional(),
    documentContentType: z.enum(ALLOWED_CREDENTIAL_DOCUMENT_CONTENT_TYPES).optional(),
    documentFileSize: z.number().int().positive().optional(),
  })
  .refine((v) => !v.expiresAt || !v.issuedAt || v.expiresAt > v.issuedAt, {
    message: 'Expiry date must be after the issue date',
    path: ['expiresAt'],
  })
  .refine(
    (v) => v.category !== 'INSURANCE' || v.coverageAmount === undefined || v.coverageCurrencyCode,
    {
      message: 'A coverage currency is required when a coverage amount is provided',
      path: ['coverageCurrencyCode'],
    },
  );
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;

export const updateCredentialSchema = z
  .object({
    type: z.string().trim().min(1).max(160).optional(),
    credentialNumber: z.string().trim().min(1).max(120).nullable().optional(),
    issuer: z.string().trim().min(1).max(160).nullable().optional(),
    issuedAt: dateInput.nullable().optional(),
    expiresAt: dateInput.nullable().optional(),
    coverageAmount: z.coerce.number().nonnegative().nullable().optional(),
    coverageCurrencyCode: z.string().trim().length(3).nullable().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
    documentStorageKey: z.string().trim().min(1).optional(),
    documentFileName: z.string().trim().min(1).max(255).optional(),
    documentContentType: z.enum(ALLOWED_CREDENTIAL_DOCUMENT_CONTENT_TYPES).optional(),
    documentFileSize: z.number().int().positive().optional(),
  })
  .refine((v) => !v.expiresAt || !v.issuedAt || v.expiresAt > v.issuedAt, {
    message: 'Expiry date must be after the issue date',
    path: ['expiresAt'],
  });
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;

export const rejectCredentialSchema = z.object({
  notes: z.string().trim().min(1).max(2000),
});
export type RejectCredentialInput = z.infer<typeof rejectCredentialSchema>;

export const verifyCredentialSchema = z.object({
  notes: z.string().trim().min(1).max(2000).optional(),
});
export type VerifyCredentialInput = z.infer<typeof verifyCredentialSchema>;

export const presignCredentialDocumentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_CREDENTIAL_DOCUMENT_CONTENT_TYPES),
  fileSize: z.number().int().positive(),
});
export type PresignCredentialDocumentInput = z.infer<typeof presignCredentialDocumentSchema>;

export const createComplianceRequirementSchema = z
  .object({
    category: z.nativeEnum(MaintenanceCategory),
    credentialCategory: z.nativeEnum(CredentialCategory),
    credentialType: z.string().trim().min(1).max(160),
    required: z.boolean().default(true),
    enforcement: z.nativeEnum(ComplianceEnforcement).default('BLOCK_ASSIGNMENT'),
    mustBeVerified: z.boolean().default(true),
    mustNotBeExpired: z.boolean().default(true),
    minimumCoverageAmount: z.coerce.number().nonnegative().optional(),
    minimumCoverageCurrencyCode: z.string().trim().length(3).optional(),
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((v) => v.credentialCategory === 'INSURANCE' || v.minimumCoverageAmount === undefined, {
    message: 'Minimum coverage only applies to insurance requirements',
    path: ['minimumCoverageAmount'],
  })
  .refine((v) => v.minimumCoverageAmount === undefined || v.minimumCoverageCurrencyCode, {
    message: 'A coverage currency is required when a minimum coverage amount is set',
    path: ['minimumCoverageCurrencyCode'],
  });
export type CreateComplianceRequirementInput = z.infer<typeof createComplianceRequirementSchema>;

export const updateComplianceRequirementSchema = z.object({
  required: z.boolean().optional(),
  enforcement: z.nativeEnum(ComplianceEnforcement).optional(),
  mustBeVerified: z.boolean().optional(),
  mustNotBeExpired: z.boolean().optional(),
  minimumCoverageAmount: z.coerce.number().nonnegative().nullable().optional(),
  minimumCoverageCurrencyCode: z.string().trim().length(3).nullable().optional(),
  notes: z.string().trim().min(1).max(1000).nullable().optional(),
});
export type UpdateComplianceRequirementInput = z.infer<typeof updateComplianceRequirementSchema>;
