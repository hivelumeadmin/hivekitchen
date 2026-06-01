import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
import { PlansService } from './plans.service.js';
import type { PlansRepository } from './plans.repository.js';
import type { BriefStateRepository } from './brief-state.repository.js';
import type { BriefStateComposer } from './brief-state.composer.js';
import type { AllergyGuardrailService } from '../allergy-guardrail/allergy-guardrail.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { RecipeService } from '../recipe/recipe.service.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import type { RecipeAgent } from '../../agents/recipe-agent.js';
import type { CommitPlanInput } from '@hivekitchen/types';

// Slice 2.6-s3 — focused tests for the Layer 2 materialization trigger in
// PlansService.commit. Kept in a separate file from plans.service.test.ts
// because the latter carries pre-existing TS errors unrelated to this slice.

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CATALOG_RECIPE_ID = '66666666-6666-4666-8666-666666666666';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function makeInput(
  recipeId: string | undefined = CATALOG_RECIPE_ID,
): CommitPlanInput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_id: WEEK_ID,
    week_of: '2026-05-04',
    revision: 1,
    generated_at: '2026-05-02T11:00:00.000Z',
    prompt_version: 'v1.0.0',
    items: [
      {
        child_id: CHILD_ID,
        day: 'monday',
        slot: 'main',
        ingredients: ['rice', 'lentils'],
        ...(recipeId !== undefined ? { recipe_id: recipeId } : {}),
      },
    ],
  };
}

function buildRepo(): PlansRepository & {
  commit: ReturnType<typeof vi.fn>;
  findActiveByHouseholdAndWeek: ReturnType<typeof vi.fn>;
} {
  return {
    commit: vi.fn(async (input: CommitPlanInput) => input.plan_id),
    findActiveByHouseholdAndWeek: vi.fn().mockResolvedValue(null),
  } as unknown as PlansRepository & {
    commit: ReturnType<typeof vi.fn>;
    findActiveByHouseholdAndWeek: ReturnType<typeof vi.fn>;
  };
}

function buildGuardrail(): AllergyGuardrailService {
  return {
    clearOrReject: vi.fn().mockResolvedValue({ verdict: 'cleared', conflicts: [] }),
  } as unknown as AllergyGuardrailService;
}

function buildAudit(): AuditService {
  return {
    write: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
}

function buildBriefStateRepo(): BriefStateRepository {
  return {} as unknown as BriefStateRepository;
}

function buildBriefStateComposer(): BriefStateComposer {
  return {
    refresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as BriefStateComposer;
}

function buildRedis(): Redis {
  return {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
  } as unknown as Redis;
}

function buildRegenQueue(): Queue {
  return { add: vi.fn().mockResolvedValue({ id: 'job' }) } as unknown as Queue;
}

function buildRecipeService(): RecipeService {
  return {
    materializeFromPlanItem: vi.fn().mockResolvedValue({ recipeId: CATALOG_RECIPE_ID }),
    recordUse: vi.fn().mockResolvedValue(undefined),
    readCandidate: vi.fn().mockResolvedValue(null),
    insertFromDiscoverExtraction: vi.fn(),
  } as unknown as RecipeService;
}

describe('PlansService.commit — Layer 2 materialization (Slice 2.6-s3)', () => {
  it('catalog_seeded recipe with empty ingredients triggers Layer 2 discover + updateIngredients', async () => {
    const recipesRepo = {
      findById: vi.fn().mockResolvedValue({
        source: 'catalog_seeded',
        canonical_name: 'Dal chawal thermos',
        ingredients: [],
      }),
      updateIngredients: vi.fn().mockResolvedValue(undefined),
      markDiscoverFailed: vi.fn().mockResolvedValue(undefined),
    } as unknown as RecipesRepository;

    const recipeAgent = {
      discover: vi.fn().mockResolvedValue({
        candidates: [
          {
            candidateId: 'cand-1',
            extraction: {
              name: 'Dal chawal thermos',
              source_url: 'https://recipetineats.com/dal-chawal',
              source_site: 'recipetineats',
              ingredients: [
                {
                  key: 'lentil',
                  modifier: null,
                  display: '1 cup lentils',
                  quantity: 1,
                  unit: 'cup',
                  optional: false,
                  substitutes: [],
                },
                {
                  key: 'rice',
                  modifier: null,
                  display: '1 cup rice',
                  quantity: 1,
                  unit: 'cup',
                  optional: false,
                  substitutes: [],
                },
              ],
              steps: [
                { mode: 'prep' as const, text: 'Cook rice.' },
                { mode: 'prep' as const, text: 'Cook lentils.' },
              ],
              ingredient_keys: ['lentil', 'rice'],
              primary_ingredient_key: 'lentil',
              allergen_flags: [],
              dietary_flags: ['vegetarian'],
              cultural_tags: ['south_asian'],
              cuisine_tags: ['south_asian'],
              prep_time_minutes: 20,
            },
            preview: {},
          },
        ],
        sourceSites: ['recipetineats'],
        droppedCount: 0,
      }),
    } as unknown as RecipeAgent;

    const repo = buildRepo();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail(),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService: buildRecipeService(),
      recipesRepo,
      recipeAgent,
    });

    await service.commit(makeInput(), REQUEST_ID, vi.fn());

    expect(recipesRepo.findById).toHaveBeenCalledWith(CATALOG_RECIPE_ID);
    expect(recipeAgent.discover).toHaveBeenCalledTimes(1);
    expect(recipesRepo.updateIngredients).toHaveBeenCalledTimes(1);
    expect(recipesRepo.markDiscoverFailed).not.toHaveBeenCalled();
    // Commit proceeded.
    expect(repo.commit).toHaveBeenCalledTimes(1);
  });

  it('Layer 2 discover returns no candidates → markDiscoverFailed called + throws', async () => {
    const recipesRepo = {
      findById: vi.fn().mockResolvedValue({
        source: 'catalog_seeded',
        canonical_name: 'Exotic dish',
        ingredients: [],
      }),
      updateIngredients: vi.fn().mockResolvedValue(undefined),
      markDiscoverFailed: vi.fn().mockResolvedValue(undefined),
    } as unknown as RecipesRepository;

    const recipeAgent = {
      discover: vi.fn().mockResolvedValue({
        candidates: [],
        sourceSites: [],
        droppedCount: 3,
      }),
    } as unknown as RecipeAgent;

    const repo = buildRepo();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail(),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService: buildRecipeService(),
      recipesRepo,
      recipeAgent,
    });

    // The Layer 2 failure throws inside materializeRecipesForCommit; commit
    // surfaces it directly (no regenerate callback wired here).
    await expect(service.commit(makeInput(), REQUEST_ID, vi.fn())).rejects.toThrow(
      /Layer 2 discovery failed/,
    );
    expect(recipesRepo.markDiscoverFailed).toHaveBeenCalledWith(
      CATALOG_RECIPE_ID,
      HOUSEHOLD_ID,
    );
    expect(recipesRepo.updateIngredients).not.toHaveBeenCalled();
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it('non-catalog recipe (source=agent_generated) passes through; Layer 2 not invoked', async () => {
    const recipesRepo = {
      findById: vi.fn().mockResolvedValue({
        source: 'agent_generated',
        canonical_name: 'Some other dish',
        ingredients: [
          { key: 'rice', modifier: null, display: 'rice', quantity: 1, unit: 'cup', optional: false, substitutes: [] },
        ],
      }),
      updateIngredients: vi.fn(),
      markDiscoverFailed: vi.fn(),
    } as unknown as RecipesRepository;

    const recipeAgent = {
      discover: vi.fn(),
    } as unknown as RecipeAgent;

    const repo = buildRepo();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail(),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService: buildRecipeService(),
      recipesRepo,
      recipeAgent,
    });

    await service.commit(makeInput(), REQUEST_ID, vi.fn());

    expect(recipesRepo.findById).toHaveBeenCalledWith(CATALOG_RECIPE_ID);
    // Source is agent_generated → Layer 2 branch short-circuits.
    expect(recipeAgent.discover).not.toHaveBeenCalled();
    expect(recipesRepo.updateIngredients).not.toHaveBeenCalled();
    expect(repo.commit).toHaveBeenCalledTimes(1);
  });

  it('catalog_seeded recipe with non-empty ingredients passes through; Layer 2 not invoked', async () => {
    const recipesRepo = {
      findById: vi.fn().mockResolvedValue({
        source: 'catalog_seeded',
        canonical_name: 'Already-materialized lunch',
        ingredients: [
          { key: 'rice', modifier: null, display: 'rice', quantity: 1, unit: 'cup', optional: false, substitutes: [] },
        ],
      }),
      updateIngredients: vi.fn(),
      markDiscoverFailed: vi.fn(),
    } as unknown as RecipesRepository;

    const recipeAgent = {
      discover: vi.fn(),
    } as unknown as RecipeAgent;

    const repo = buildRepo();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail(),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService: buildRecipeService(),
      recipesRepo,
      recipeAgent,
    });

    await service.commit(makeInput(), REQUEST_ID, vi.fn());

    expect(recipeAgent.discover).not.toHaveBeenCalled();
    expect(recipesRepo.updateIngredients).not.toHaveBeenCalled();
    expect(repo.commit).toHaveBeenCalledTimes(1);
  });

  it('non-main slot (snack) skips Layer 2 entirely even when item has recipe_id', async () => {
    const recipesRepo = {
      findById: vi.fn(),
      updateIngredients: vi.fn(),
      markDiscoverFailed: vi.fn(),
    } as unknown as RecipesRepository;

    const recipeAgent = {
      discover: vi.fn(),
    } as unknown as RecipeAgent;

    const repo = buildRepo();
    const service = new PlansService({
      repository: repo,
      briefStateRepository: buildBriefStateRepo(),
      briefStateComposer: buildBriefStateComposer(),
      allergyGuardrail: buildGuardrail(),
      auditService: buildAudit(),
      logger: buildLogger(),
      redis: buildRedis(),
      regenQueue: buildRegenQueue(),
      recipeService: buildRecipeService(),
      recipesRepo,
      recipeAgent,
    });

    const input: CommitPlanInput = {
      ...makeInput(undefined),
      items: [
        {
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'snack',
          ingredients: ['apple'],
          recipe_id: CATALOG_RECIPE_ID,
        },
      ],
    };

    await service.commit(input, REQUEST_ID, vi.fn());

    expect(recipesRepo.findById).not.toHaveBeenCalled();
    expect(recipeAgent.discover).not.toHaveBeenCalled();
  });
});
