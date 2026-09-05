import { PropertyRole } from '@prisma/client';
import { z } from 'zod';

export const addPersonSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  role: z.nativeEnum(PropertyRole),
  spaceId: z.string().trim().min(1).optional(),
});
export type AddPersonInput = z.infer<typeof addPersonSchema>;

export const peopleDirectoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  role: z.nativeEnum(PropertyRole).optional(),
  propertyId: z.string().trim().min(1).optional(),
});
export type PeopleDirectoryQuery = z.infer<typeof peopleDirectoryQuerySchema>;
