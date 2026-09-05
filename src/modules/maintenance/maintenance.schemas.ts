import { MaintenanceCategory, MaintenancePriority, MaintenanceRequestStatus } from '@prisma/client';
import { z } from 'zod';

export const createMaintenanceRequestSchema = z.object({
  propertyId: z.string().trim().min(1),
  spaceId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(4000),
  category: z.nativeEnum(MaintenanceCategory),
  priority: z.nativeEnum(MaintenancePriority),
});
export type CreateMaintenanceRequestInput = z.infer<typeof createMaintenanceRequestSchema>;

export const updateMaintenanceRequestSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  category: z.nativeEnum(MaintenanceCategory).optional(),
  priority: z.nativeEnum(MaintenancePriority).optional(),
});
export type UpdateMaintenanceRequestInput = z.infer<typeof updateMaintenanceRequestSchema>;

export const updateStatusSchema = z.object({
  status: z.nativeEnum(MaintenanceRequestStatus),
});
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

export const maintenanceRequestQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  propertyId: z.string().trim().min(1).optional(),
  spaceId: z.string().trim().min(1).optional(),
  status: z.nativeEnum(MaintenanceRequestStatus).optional(),
  priority: z.nativeEnum(MaintenancePriority).optional(),
  category: z.nativeEnum(MaintenanceCategory).optional(),
});
export type MaintenanceRequestQuery = z.infer<typeof maintenanceRequestQuerySchema>;
