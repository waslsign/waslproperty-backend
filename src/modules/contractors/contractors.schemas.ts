import { ContractorStatus } from '@prisma/client';
import { z } from 'zod';

export const createContractorSchema = z.object({
  name: z.string().trim().min(1).max(160),
  companyName: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().email(),
  phone: z.string().trim().min(1).max(40).optional(),
  tradeTypes: z.array(z.string().trim().min(1).max(60)).default([]),
  notes: z.string().trim().min(1).max(2000).optional(),
});
export type CreateContractorInput = z.infer<typeof createContractorSchema>;

export const updateContractorSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  companyName: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  tradeTypes: z.array(z.string().trim().min(1).max(60)).optional(),
  notes: z.string().trim().min(1).max(2000).optional(),
  status: z.nativeEnum(ContractorStatus).optional(),
});
export type UpdateContractorInput = z.infer<typeof updateContractorSchema>;

export const contractorQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  status: z.nativeEnum(ContractorStatus).optional(),
});
export type ContractorQuery = z.infer<typeof contractorQuerySchema>;
