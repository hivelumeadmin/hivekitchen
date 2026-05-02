import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import type { Redis } from 'ioredis';
import { createRecipeFetchSpec, createRecipeSearchSpec } from './recipe.tools.js';
import type { RecipeService } from '../../modules/recipe/recipe.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = '22222222-2222-4222-8222-222222222222';

function buildRedis() {
  const pipeline = {
    zadd: vi.fn().mockReturnThis(),
    zremrangebyscore: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };
  return {
    redis: { pipeline: vi.fn().mockReturnValue(pipeline) } as unknown as Redis,
    pipeline,
  };
}

function buildSearchService(): RecipeService {
  return {
    search: vi.fn().mockResolvedValue({ results: [] }),
    fetch: vi.fn(),
  } as unknown as RecipeService;
}

function buildFetchService(): RecipeService {
  return {
    search: vi.fn(),
    fetch: vi.fn().mockResolvedValue({
      id: RECIPE_ID,
      name: 'Lentil dal',
      description: 'Warm yellow dal with rice',
      ingredients: [{ name: 'red lentils', quantity: '1 cup', allergens: [] }],
      prep_time_minutes: 25,
      instructions: 'Simmer.',
      tags: ['vegetarian'],
      allergen_flags: [],
    }),
  } as unknown as RecipeService;
}

describe('createRecipeSearchSpec', () => {
  it('declares name and maxLatencyMs', () => {
    const { redis } = buildRedis();
    const spec = createRecipeSearchSpec(buildSearchService(), redis);
    expect(spec.name).toBe('recipe.search');
    expect(spec.maxLatencyMs).toBe(300);
  });

  it('inputSchema rejects missing household_id', () => {
    const { redis } = buildRedis();
    const spec = createRecipeSearchSpec(buildSearchService(), redis);
    expect(spec.inputSchema.safeParse({ query: 'rice' }).success).toBe(false);
  });

  it('fn calls recipeService.search with parsed input', async () => {
    const { redis } = buildRedis();
    const service = buildSearchService();
    const spec = createRecipeSearchSpec(service, redis);
    await spec.fn({ query: 'rice', household_id: HOUSEHOLD_ID, max_results: 3 });
    expect((service.search as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'rice',
        household_id: HOUSEHOLD_ID,
        max_results: 3,
      }),
    );
  });

  it('records tool latency in finally even when service throws', async () => {
    const { redis, pipeline } = buildRedis();
    const service = {
      search: vi.fn().mockRejectedValue(new Error('boom')),
      fetch: vi.fn(),
    } as unknown as RecipeService;
    const spec = createRecipeSearchSpec(service, redis);
    await expect(
      spec.fn({ query: 'rice', household_id: HOUSEHOLD_ID }),
    ).rejects.toThrow('boom');
    expect(pipeline.zadd).toHaveBeenCalledTimes(1);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed input via inputSchema.parse before calling service', async () => {
    const { redis } = buildRedis();
    const service = buildSearchService();
    const spec = createRecipeSearchSpec(service, redis);
    await expect(spec.fn({})).rejects.toBeInstanceOf(ZodError);
    expect(service.search).not.toHaveBeenCalled();
  });
});

describe('createRecipeFetchSpec', () => {
  it('declares name and maxLatencyMs', () => {
    const { redis } = buildRedis();
    const spec = createRecipeFetchSpec(buildFetchService(), redis);
    expect(spec.name).toBe('recipe.fetch');
    expect(spec.maxLatencyMs).toBe(100);
  });

  it('fn calls recipeService.fetch with parsed input', async () => {
    const { redis } = buildRedis();
    const service = buildFetchService();
    const spec = createRecipeFetchSpec(service, redis);
    await spec.fn({ recipe_id: RECIPE_ID, household_id: HOUSEHOLD_ID });
    expect((service.fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ recipe_id: RECIPE_ID, household_id: HOUSEHOLD_ID }),
    );
  });

  it('records tool latency in finally even when service throws', async () => {
    const { redis, pipeline } = buildRedis();
    const service = {
      search: vi.fn(),
      fetch: vi.fn().mockRejectedValue(new Error('not-found')),
    } as unknown as RecipeService;
    const spec = createRecipeFetchSpec(service, redis);
    await expect(
      spec.fn({ recipe_id: RECIPE_ID, household_id: HOUSEHOLD_ID }),
    ).rejects.toThrow('not-found');
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('inputSchema rejects non-uuid recipe_id', () => {
    const { redis } = buildRedis();
    const spec = createRecipeFetchSpec(buildFetchService(), redis);
    expect(spec.inputSchema.safeParse({ recipe_id: 'x', household_id: HOUSEHOLD_ID }).success).toBe(
      false,
    );
  });
});
