import type { Redis } from 'ioredis';
import {
  RecipeDiscoverInputSchema,
  RecipeDiscoverOutputSchema,
  RecipeFetchInputSchema,
  RecipeFetchOutputSchema,
  RecipeSearchInputSchema,
  RecipeSearchOutputSchema,
} from '@hivekitchen/contracts';
import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
import type { ToolSpec } from '../tools.manifest.js';
import type { RecipeService, RecipeServiceDiscoverDeps } from '../../modules/recipe/recipe.service.js';

export const MANIFESTED_TOOL_NAMES = ['recipe.search', 'recipe.fetch', 'recipe.discover'] as const;

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

/**
 * Story 3-31 — recipe.discover tool.
 *
 * Higher latency budget (8000ms) than recipe.search (300ms) because this
 * path makes a Tavily network call plus an LLM extraction per result.
 * The orchestrator builds the discoverDeps closure once per planWeek run;
 * the closure carries the per-run RecipeAgent + requestId so audit
 * correlation works.
 */
export function createRecipeDiscoverSpec(
  recipeService: RecipeService,
  discoverDeps: RecipeServiceDiscoverDeps,
  redis: Redis,
): ToolSpec {
  return {
    name: 'recipe.discover',
    description:
      'Discover candidate recipes from the public web (Allrecipes / RecipeTin Eats) shaped to the household profile. Call ONLY when recipe.search returns too few results or cultural variety is needed beyond the household catalog. Always call recipe.search first.',
    inputSchema: RecipeDiscoverInputSchema,
    outputSchema: RecipeDiscoverOutputSchema,
    maxLatencyMs: 8000,
    fn: async (input: unknown) => {
      const start = Date.now();
      try {
        const parsed = RecipeDiscoverInputSchema.parse(input);
        const result = await recipeService.discover(parsed, discoverDeps);
        return RecipeDiscoverOutputSchema.parse(result);
      } finally {
        try {
          await recordToolLatency(redis, 'recipe.discover', Date.now() - start);
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
