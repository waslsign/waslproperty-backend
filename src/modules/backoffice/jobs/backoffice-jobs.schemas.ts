import { z } from 'zod';

export const deliveryStatusQuerySchema = z.object({
  status: z.enum(['PENDING', 'SENDING', 'SENT', 'DELIVERED', 'FAILED']).default('FAILED'),
});
export type DeliveryStatusQuery = z.infer<typeof deliveryStatusQuerySchema>;
