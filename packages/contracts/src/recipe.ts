import { z } from 'zod';

export const RecipeSearchInputSchema = z.object({
  query: z.string().min(1).max(200),
  household_id: z.string().uuid(),
  max_results: z.number().int().min(1).max(20).default(5),
});

export const RecipePreviewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tags: z.array(z.string()),
  allergen_flags: z.array(z.string()),
  prep_time_minutes: z.number().int(),
});

export const RecipeSearchOutputSchema = z.object({
  results: z.array(RecipePreviewSchema),
});

export const RecipeFetchInputSchema = z.object({
  recipe_id: z.string().uuid(),
  household_id: z.string().uuid(),
});

export const RecipeIngredientSchema = z.object({
  name: z.string(),
  quantity: z.string(),
  allergens: z.array(z.string()),
});

export const RecipeDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  ingredients: z.array(RecipeIngredientSchema),
  prep_time_minutes: z.number().int(),
  instructions: z.string(),
  tags: z.array(z.string()),
  allergen_flags: z.array(z.string()),
});

export const RecipeFetchOutputSchema = RecipeDetailSchema;
