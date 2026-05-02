import { z } from 'zod';

export const PantryReadInputSchema = z.object({
  household_id: z.string().uuid(),
});

export const PantryItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  quantity: z.string(),
  unit: z.string().optional(),
  expires_at: z.string().datetime().optional(),
  tags: z.array(z.string()),
});

export const PantryReadOutputSchema = z.object({
  items: z.array(PantryItemSchema),
});
