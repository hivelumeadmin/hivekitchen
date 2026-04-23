import { z } from "zod";

export const GroceryItem = z.object({
  id: z.string().uuid(),
  name: z.string(),
  quantity: z.string().optional(),
  category: z.string().optional(),
  checked: z.boolean().default(false),
});

export const GroceryList = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  items: z.array(GroceryItem),
});
