import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  RecipeService,
  deriveCanonicalName,
  toIngredientKey,
} from './recipe.service.js';
import type { RecipesRepository, RecipeRowMinimal } from './recipes.repository.js';
import { NotImplementedError } from '../../common/errors.js';

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
};

function buildRepo(opts: { existing?: RecipeRowMinimal | null } = {}): RepoMock {
  return {
    findByHouseholdAndName: vi.fn().mockResolvedValue(opts.existing ?? null),
    insertRecipe: vi.fn().mockResolvedValue({ id: RECIPE_ID, canonical_name: 'Rice with lentils' }),
    upsertUsageIncrement: vi.fn().mockResolvedValue(undefined),
  } as unknown as RepoMock;
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

  describe('legacy stub read methods (slice D.2 still pending)', () => {
    it('search() throws NotImplementedError', async () => {
      const svc = new RecipeService();
      await expect(
        svc.search({ household_id: HOUSEHOLD_ID, query: 'pasta' } as never),
      ).rejects.toBeInstanceOf(NotImplementedError);
    });

    it('fetch() throws NotImplementedError', async () => {
      const svc = new RecipeService();
      await expect(
        svc.fetch({ recipe_id: RECIPE_ID } as never),
      ).rejects.toBeInstanceOf(NotImplementedError);
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
