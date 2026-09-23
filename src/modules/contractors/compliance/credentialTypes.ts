import type { CredentialCategory } from '@prisma/client';

/**
 * A starter catalogue of common credential names, for the "Add credential"
 * picker UI only — ContractorCredential.type is free text, never
 * constrained to this list (see that field's schema doc comment). Adding a
 * new credential type an organisation needs is just typing it; this list
 * exists purely so the common cases don't require typing from scratch.
 */
export const COMMON_CREDENTIAL_TYPES: Array<{ category: CredentialCategory; type: string }> = [
  { category: 'LICENCE', type: 'Electrical Contractor Licence' },
  { category: 'LICENCE', type: 'Plumbing Licence' },
  { category: 'LICENCE', type: 'Gas Fitting Licence' },
  { category: 'LICENCE', type: 'Builder’s Licence' },
  { category: 'CERTIFICATION', type: 'HVAC Certification' },
  { category: 'CERTIFICATION', type: 'Electrical Safety Certification' },
  { category: 'CERTIFICATION', type: 'Fire Safety Certification' },
  { category: 'CERTIFICATION', type: 'Working at Heights' },
  { category: 'CERTIFICATION', type: 'White Card' },
  { category: 'INSURANCE', type: 'Public Liability Insurance' },
  { category: 'INSURANCE', type: 'Workers Compensation' },
  { category: 'INSURANCE', type: 'Professional Indemnity' },
  { category: 'QUALIFICATION', type: 'Trade Qualification' },
  { category: 'BUSINESS_REGISTRATION', type: 'Business Registration' },
];
