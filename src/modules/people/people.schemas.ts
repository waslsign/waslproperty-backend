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

/** Attaches a contact that already exists in the organisation's directory,
 * as an alternative to addPersonSchema (which always creates a brand-new
 * one). */
export const assignExistingPersonSchema = z.object({
  contactId: z.string().trim().min(1),
  role: z.nativeEnum(PropertyRole),
  spaceId: z.string().trim().min(1).optional(),
});
export type AssignExistingPersonInput = z.infer<typeof assignExistingPersonSchema>;

/** null spaceId means "move to whole-property" (property-level role);
 * omitted means "leave the space assignment as-is". */
export const updateMembershipSchema = z.object({
  role: z.nativeEnum(PropertyRole).optional(),
  spaceId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;

export const searchContactsQuerySchema = z.object({
  search: z.string().trim().min(1),
});
export type SearchContactsQuery = z.infer<typeof searchContactsQuerySchema>;
