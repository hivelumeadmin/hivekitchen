import type { Redis } from 'ioredis';
import {
  RecipeFetchInputSchema,
  RecipeFetchOutputSchema,
  RecipeSearchInputSchema,
  RecipeSearchOutputSchema,
} from '@hivekitchen/contracts';
import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
import type { ToolSpec } from '../tools.manifest.js';
import type { RecipeService } from '../../modules/recipe/recipe.service.js';

export const MANIFESTED_TOOL_NAMES = ['recipe.search', 'recipe.fetch'] as const;

export function createRecipeSearchSpec(recipeService: RecipeService, redis: Redis): ToolSpec {
  return {
    name: 'recipe.search',
    description:
      'Search recipes by natural-language query. Returns previews with allergen flags for up to max_results recipes.',
    inputSchema: RecipeSearchInputSchema,
    outputSchema: RecipeSearchOutputSchema,
    maxLatencyMs: 300,
    fn: async (input: unknown) => {
      const start = Date.now();
      try {
        const parsed = RecipeSearchInputSchema.parse(input);
        const result = await recipeService.search(parsed);
        return RecipeSearchOutputSchema.parse(result);
      } finally {
        try {
          await recordToolLatency(redis, 'recipe.search', Date.now() - start);
        } catch {
          // latency recording is observability-only; do not mask the tool result
        }
      }
    },
  };
}

export function createRecipeFetchSpec(recipeService: RecipeService, redis: Redis): ToolSpec {
  return {
    name: 'recipe.fetch',
    description: 'Fetch full recipe detail including all ingredients with allergen annotations.',
    inputSchema: RecipeFetchInputSchema,
    outputSchema: RecipeFetchOutputSchema,
    maxLatencyMs: 100,
    fn: async (input: unknown) => {
      const start = Date.now();
      try {
        const parsed = RecipeFetchInputSchema.parse(input);
        const result = await recipeService.fetch(parsed);
        return RecipeFetchOutputSchema.parse(result);
      } finally {
        try {
          await recordToolLatency(redis, 'recipe.fetch', Date.now() - start);
        } catch {
          // latency recording is observability-only; do not mask the tool result
        }
      }
    },
  };
}
