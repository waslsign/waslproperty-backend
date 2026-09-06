import { MaintenancePriority, WorkOrderStatus } from '@prisma/client';
import { z } from 'zod';

export const createWorkOrderSchema = z.object({
  maintenanceRequestId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(4000),
  priority: z.nativeEnum(MaintenancePriority),
});
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;

export const updateStatusSchema = z.object({
  status: z.nativeEnum(WorkOrderStatus),
  scheduledAt: z.coerce.date().optional(),
});
export type UpdateWorkOrderStatusInput = z.infer<typeof updateStatusSchema>;

export const assignContractorSchema = z.object({
  contractorId: z.string().trim().min(1),
});
export type AssignContractorInput = z.infer<typeof assignContractorSchema>;

export const updateCostSchema = z.object({
  estimatedCost: z.coerce.number().nonnegative().optional(),
  actualCost: z.coerce.number().nonnegative().optional(),
});
export type UpdateCostInput = z.infer<typeof updateCostSchema>;

export const workOrderQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  propertyId: z.string().trim().min(1).optional(),
  status: z.nativeEnum(WorkOrderStatus).optional(),
  priority: z.nativeEnum(MaintenancePriority).optional(),
});
export type WorkOrderQuery = z.infer<typeof workOrderQuerySchema>;
