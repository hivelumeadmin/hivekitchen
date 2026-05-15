import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  RecipeService,
  deriveCanonicalName,
  toIngredientKey,
} from './recipe.service.js';
import type {
  HouseholdUsageScore,
  RecipePreviewRow,
  RecipeRow,
  RecipeRowMinimal,
  RecipesRepository,
} from './recipes.repository.js';
import { NotFoundError } from '../../common/errors.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = '22222222-2222-4222-8222-222222222222';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

type RepoMock = RecipesRepository & {
  findByHouseholdAndName: ReturnType<typeof vi.fn>;
  insertRecipe: ReturnType<typeof vi.fn>;
  upsertUsageIncrement: ReturnType<typeof vi.fn>;
  searchByHousehold: ReturnType<typeof vi.fn>;
  findUsageScores: ReturnType<typeof vi.fn>;
  findByIdForHousehold: ReturnType<typeof vi.fn>;
};

function buildRepo(opts: {
  existing?: RecipeRowMinimal | null;
  searchResults?: RecipePreviewRow[];
  usageScores?: HouseholdUsageScore[];
  fetchResult?: RecipeRow | null;
} = {}): RepoMock {
  return {
    findByHouseholdAndName: vi.fn().mockResolvedValue(opts.existing ?? null),
    insertRecipe: vi.fn().mockResolvedValue({ id: RECIPE_ID, canonical_name: 'Rice with lentils' }),
    upsertUsageIncrement: vi.fn().mockResolvedValue(undefined),
    searchByHousehold: vi.fn().mockResolvedValue(opts.searchResults ?? []),
    findUsageScores: vi.fn().mockResolvedValue(opts.usageScores ?? []),
    findByIdForHousehold: vi.fn().mockResolvedValue(opts.fetchResult ?? null),
  } as unknown as RepoMock;
}

function buildPreview(overrides: Partial<RecipePreviewRow> & { id: string; canonical_name: string }): RecipePreviewRow {
  return {
    primary_ingredient_key: null,
    cuisine_tags: [],
    allergen_flags: [],
    dietary_flags: [],
    prep_time_minutes: null,
    community_use_count: 0,
    ...overrides,
  };
}

describe('RecipeService — slice D server write path', () => {
  describe('materializeFromPlanItem', () => {
    it('skips materialization for snack-slot items (snack uses item_sku_id)', async () => {
      const repo = buildRepo();
      const svc = new RecipeService(repo, buildLogger());
      const result = await svc.materializeFromPlanItem({
        householdId: HOUSEHOLD_ID,
        ingredients: ['granola', 'milk'],
        slot: 'snack',
      });
      expect(result).toBeNull();
      expect(repo.findByHouseholdAndName).not.toHaveBeenCalled();
      expect(repo.insertRecipe).not.toHaveBeenCalled();
    });

    it('skips materialization for extra-slot items (extras use item_sku_id)', async () => {
      const repo = buildRepo();
      const svc = new RecipeService(repo, buildLogger());
      const result = await svc.materializeFromPlanItem({
        householdId: HOUSEHOLD_ID,
        ingredients: ['fruit', 'cheese'],
        slot: 'extra',
      });
      expect(result).toBeNull();
      expect(repo.insertRecipe).not.toHaveBeenCalled();
    });

    it('skips materialization when ingredients is empty (guardrail would have rejected earlier)', async () => {
      const repo = buildRepo();
      const svc = new RecipeService(repo, buildLogger());
      const result = await svc.materializeFromPlanItem({
        householdId: HOUSEHOLD_ID,
        ingredients: [],
        slot: 'main',
      });
      expect(result).toBeNull();
      expect(repo.findByHouseholdAndName).not.toHaveBeenCalled();
    });

    it('inserts a new recipe row when no existing one matches by canonical name', async () => {
      const repo = buildRepo({ existing: null });
      const svc = new RecipeService(repo, buildLogger());

      const result = await svc.materializeFromPlanItem({
        householdId: HOUSEHOLD_ID,
        ingredients: ['chicken thigh', 'rice', 'lemon zest'],
        slot: 'main',
      });

      expect(result).toEqual({ recipeId: RECIPE_ID, wasExisting: false });
      expect(repo.findByHouseholdAndName).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        'Chicken thigh with rice',
      );
      expect(repo.insertRecipe).toHaveBeenCalledTimes(1);

      const insertArg = repo.insertRecipe.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insertArg).toMatchObject({
        canonical_name: 'Chicken thigh with rice',
        applicable_slots: ['main'],
        source: 'agent_generated',
        visibility: 'private',
        created_by_household_id: HOUSEHOLD_ID,
        // empty for v1 — guardrail handles per-item; recipe-level tags come in slice D.2
        allergen_flags: [],
        dietary_flags: [],
        cultural_tags: [],
        cuisine_tags: [],
      });

      const ingredientKeys = insertArg.ingredient_keys as string[];
      expect(ingredientKeys).toEqual(['chicken_thigh', 'rice', 'lemon_zest']);
      expect(insertArg.primary_ingredient_key).toBe('chicken_thigh');
    });

    it('reuses an existing recipe row when canonical_name matches within the household (idempotency)', async () => {
      const repo = buildRepo({
        existing: { id: RECIPE_ID, canonical_name: 'Chicken thigh with rice' },
      });
      const svc = new RecipeService(repo, buildLogger());

      const result = await svc.materializeFromPlanItem({
        householdId: HOUSEHOLD_ID,
        ingredients: ['chicken thigh', 'rice'],
        slot: 'main',
      });

      expect(result).toEqual({ recipeId: RECIPE_ID, wasExisting: true });
      expect(repo.insertRecipe).not.toHaveBeenCalled();
    });

    it('throws when constructed without a repository (write path requires repo wiring)', async () => {
      const svc = new RecipeService();
      await expect(
        svc.materializeFromPlanItem({
          householdId: HOUSEHOLD_ID,
          ingredients: ['rice'],
          slot: 'main',
        }),
      ).rejects.toThrow(/RecipesRepository/);
    });
  });

  describe('recordUse', () => {
    it('delegates to repository.upsertUsageIncrement', async () => {
      const repo = buildRepo();
      const svc = new RecipeService(repo, buildLogger());
      await svc.recordUse({ householdId: HOUSEHOLD_ID, recipeId: RECIPE_ID });
      expect(repo.upsertUsageIncrement).toHaveBeenCalledWith(HOUSEHOLD_ID, RECIPE_ID);
    });

    it('throws when constructed without a repository', async () => {
      const svc = new RecipeService();
      await expect(
        svc.recordUse({ householdId: HOUSEHOLD_ID, recipeId: RECIPE_ID }),
      ).rejects.toThrow(/RecipesRepository/);
    });
  });

});

describe('RecipeService — slice D.2 agent read path', () => {
  const RECIPE_A = '33333333-3333-4333-8333-333333333333';
  const RECIPE_B = '44444444-4444-4444-8444-444444444444';
  const RECIPE_C = '55555555-5555-4555-8555-555555555555';

  describe('search', () => {
    it('returns empty results when the repository finds nothing', async () => {
      const repo = buildRepo({ searchResults: [] });
      const svc = new RecipeService(repo, buildLogger());
      const out = await svc.search({
        household_id: HOUSEHOLD_ID,
        query: 'dal',
        max_results: 5,
      });
      expect(out).toEqual({ results: [] });
      // No usage-score fetch when there's nothing to score.
      expect(repo.findUsageScores).not.toHaveBeenCalled();
    });

    it('overfetches by 3x from the repository to give rerank room', async () => {
      const repo = buildRepo({ searchResults: [] });
      const svc = new RecipeService(repo, buildLogger());
      await svc.search({ household_id: HOUSEHOLD_ID, query: 'rice', max_results: 4 });
      expect(repo.searchByHousehold).toHaveBeenCalledWith({
        householdId: HOUSEHOLD_ID,
        query: 'rice',
        overfetchLimit: 12,
      });
    });

    it('shapes repository rows into RecipePreview (canonical_name → name)', async () => {
      const repo = buildRepo({
        searchResults: [
          buildPreview({
            id: RECIPE_A,
            canonical_name: 'Chickpea curry',
            cuisine_tags: ['indian', 'south_asian'],
            dietary_flags: ['vegan'],
            allergen_flags: [],
            prep_time_minutes: 30,
          }),
        ],
      });
      const svc = new RecipeService(repo, buildLogger());
      const out = await svc.search({
        household_id: HOUSEHOLD_ID,
        query: 'curry',
        max_results: 5,
      });
      expect(out.results).toEqual([
        {
          id: RECIPE_A,
          name: 'Chickpea curry',
          primary_ingredient_key: null,
          cuisine_tags: ['indian', 'south_asian'],
          allergen_flags: [],
          dietary_flags: ['vegan'],
          prep_time_minutes: 30,
        },
      ]);
    });

    it('filters out recipes the household has banned', async () => {
      const repo = buildRepo({
        searchResults: [
          buildPreview({ id: RECIPE_A, canonical_name: 'A' }),
          buildPreview({ id: RECIPE_B, canonical_name: 'B' }),
        ],
        usageScores: [
          { recipe_id: RECIPE_B, use_count: 0, is_household_banned: true, is_household_favorite: false },
        ],
      });
      const svc = new RecipeService(repo, buildLogger());
      const out = await svc.search({
        household_id: HOUSEHOLD_ID,
        query: 'x',
        max_results: 5,
      });
      const ids = out.results.map((r) => r.id);
      expect(ids).toEqual([RECIPE_A]);
    });

    it('ranks household favourites above non-favourites regardless of use_count', async () => {
      const repo = buildRepo({
        searchResults: [
          buildPreview({ id: RECIPE_A, canonical_name: 'A' }),
          buildPreview({ id: RECIPE_B, canonical_name: 'B' }),
        ],
        usageScores: [
          { recipe_id: RECIPE_A, use_count: 99, is_household_banned: false, is_household_favorite: false },
          { recipe_id: RECIPE_B, use_count: 1,  is_household_banned: false, is_household_favorite: true  },
        ],
      });
      const svc = new RecipeService(repo, buildLogger());
      const out = await svc.search({
        household_id: HOUSEHOLD_ID,
        query: 'x',
        max_results: 5,
      });
      expect(out.results.map((r) => r.id)).toEqual([RECIPE_B, RECIPE_A]);
    });

    it('falls back to community_use_count when no household usage exists', async () => {
      const repo = buildRepo({
        searchResults: [
          buildPreview({ id: RECIPE_A, canonical_name: 'A', community_use_count: 2 }),
          buildPreview({ id: RECIPE_B, canonical_name: 'B', community_use_count: 50 }),
          buildPreview({ id: RECIPE_C, canonical_name: 'C', community_use_count: 10 }),
        ],
        usageScores: [], // cold start — household has used none of them
      });
      const svc = new RecipeService(repo, buildLogger());
      const out = await svc.search({
        household_id: HOUSEHOLD_ID,
        query: 'x',
        max_results: 5,
      });
      expect(out.results.map((r) => r.id)).toEqual([RECIPE_B, RECIPE_C, RECIPE_A]);
    });

    it('caps results to max_results after ranking', async () => {
      const repo = buildRepo({
        searchResults: Array.from({ length: 10 }, (_, i) =>
          buildPreview({
            id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
            canonical_name: `Recipe ${String(i)}`,
            community_use_count: i,
          }),
        ),
        usageScores: [],
      });
      const svc = new RecipeService(repo, buildLogger());
      const out = await svc.search({
        household_id: HOUSEHOLD_ID,
        query: 'x',
        max_results: 3,
      });
      expect(out.results).toHaveLength(3);
      // Most-used community recipes first.
      expect(out.results.map((r) => r.name)).toEqual(['Recipe 9', 'Recipe 8', 'Recipe 7']);
    });

    it('throws when repository is not wired', async () => {
      const svc = new RecipeService();
      await expect(
        svc.search({ household_id: HOUSEHOLD_ID, query: 'x', max_results: 5 }),
      ).rejects.toThrow(/RecipesRepository/);
    });
  });

  describe('fetch', () => {
    function buildRow(overrides: Partial<RecipeRow> = {}): RecipeRow {
      return {
        id: RECIPE_ID,
        canonical_name: 'Lentil dal',
        slug: null,
        ingredients: [],
        instructions: null,
        ingredient_keys: ['red_lentils'],
        primary_ingredient_key: 'red_lentils',
        allergen_flags: [],
        dietary_flags: ['vegetarian'],
        cultural_tags: [],
        cuisine_tags: ['indian'],
        applicable_slots: ['main'],
        prep_time_minutes: 25,
        source: 'agent_generated',
        created_by_household_id: HOUSEHOLD_ID,
        visibility: 'private',
        community_use_count: 0,
        community_rating_avg: null,
        community_rating_count: 0,
        is_active: true,
        created_at: '2026-05-13T00:00:00.000Z',
        updated_at: '2026-05-13T00:00:00.000Z',
        ...overrides,
      };
    }

    it('returns the row when the recipe is visible to the household', async () => {
      const repo = buildRepo({ fetchResult: buildRow() });
      const svc = new RecipeService(repo, buildLogger());
      const out = await svc.fetch({ recipe_id: RECIPE_ID, household_id: HOUSEHOLD_ID });
      expect(out.id).toBe(RECIPE_ID);
      expect(out.canonical_name).toBe('Lentil dal');
      expect(repo.findByIdForHousehold).toHaveBeenCalledWith(RECIPE_ID, HOUSEHOLD_ID);
    });

    it('throws NotFoundError when the repository returns null', async () => {
      const repo = buildRepo({ fetchResult: null });
      const svc = new RecipeService(repo, buildLogger());
      await expect(
        svc.fetch({ recipe_id: RECIPE_ID, household_id: HOUSEHOLD_ID }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws when repository is not wired', async () => {
      const svc = new RecipeService();
      await expect(
        svc.fetch({ recipe_id: RECIPE_ID, household_id: HOUSEHOLD_ID }),
      ).rejects.toThrow(/RecipesRepository/);
    });
  });
});

describe('deriveCanonicalName helper', () => {
  it('returns "X with Y" for two-ingredient lists', () => {
    expect(deriveCanonicalName(['chicken thigh', 'rice'])).toBe('Chicken thigh with rice');
  });

  it('returns just the first ingredient when only one is present', () => {
    expect(deriveCanonicalName(['chickpea curry'])).toBe('Chickpea curry');
  });

  it('uses the first two ingredients when more than two are provided', () => {
    expect(
      deriveCanonicalName(['salmon fillet', 'quinoa', 'broccoli', 'lemon']),
    ).toBe('Salmon fillet with quinoa');
  });

  it('strips quantities and units from the source ingredient strings', () => {
    expect(deriveCanonicalName(['1 cup rice', '200g chicken'])).toBe(
      'Rice with chicken',
    );
  });

  it('strips parenthetical preparation notes', () => {
    expect(deriveCanonicalName(['chicken (boneless)', 'rice (jasmine)'])).toBe(
      'Chicken with rice',
    );
  });

  it('falls back to "Untitled dish" for empty input', () => {
    expect(deriveCanonicalName([])).toBe('Untitled dish');
  });
});

describe('toIngredientKey helper', () => {
  it('snake_cases multi-word names', () => {
    expect(toIngredientKey('Chicken thigh')).toBe('chicken_thigh');
  });

  it('strips quantities and punctuation', () => {
    expect(toIngredientKey('1/2 cup rice')).toBe('cup_rice');
  });

  it('strips trailing modifiers separated by commas', () => {
    expect(toIngredientKey('Chicken thigh, sliced')).toBe('chicken_thigh_sliced');
  });

  it('returns "unknown" for strings that strip down to empty', () => {
    expect(toIngredientKey('123')).toBe('unknown');
  });
});
