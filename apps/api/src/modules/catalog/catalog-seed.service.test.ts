import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type OpenAI from 'openai';
import type { KitchenMap } from '@hivekitchen/types';
import {
  CatalogSeedService,
  type CatalogSeedServiceDeps,
} from './catalog-seed.service.js';
import type { HouseholdsRepository } from '../households/households.repository.js';
import type { KitchenMapService } from '../kitchen-map/kitchen-map.service.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import {
  AllergyGuardrailDecryptError,
  type AllergyGuardrailRepository,
} from '../allergy-guardrail/allergy-guardrail.repository.js';
import type { AllergyRule } from '../allergy-guardrail/allergy-rules.engine.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = 'req-abcd-0000';

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

// FALCPA rules — same shape as curated-baseline tests.
const FALCPA_RULES: AllergyRule[] = [
  { id: 'peanut', household_id: null, child_id: null, allergen: 'peanut', rule_type: 'falcpa' },
  { id: 'tree_nut', household_id: null, child_id: null, allergen: 'tree_nut', rule_type: 'falcpa' },
  { id: 'dairy', household_id: null, child_id: null, allergen: 'dairy', rule_type: 'falcpa' },
  { id: 'egg', household_id: null, child_id: null, allergen: 'egg', rule_type: 'falcpa' },
  { id: 'wheat', household_id: null, child_id: null, allergen: 'wheat', rule_type: 'falcpa' },
  { id: 'soy', household_id: null, child_id: null, allergen: 'soy', rule_type: 'falcpa' },
  { id: 'fish', household_id: null, child_id: null, allergen: 'fish', rule_type: 'falcpa' },
  { id: 'shellfish', household_id: null, child_id: null, allergen: 'shellfish', rule_type: 'falcpa' },
  { id: 'sesame', household_id: null, child_id: null, allergen: 'sesame', rule_type: 'falcpa' },
];

function buildKitchenMap(): KitchenMap {
  return {
    household: {
      id: HOUSEHOLD_ID,
      tier: 'standard',
      tier_variant: 'A',
      timezone: 'America/Toronto',
      display_name: 'The Khans',
      cultural_identifiers: ['south_asian'],
      dietary_preferences: [],
      declared_allergens: [],
    },
    caregivers: [],
    children: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Layla',
        age_band: 'child',
        declared_allergens: [],
        cultural_identifiers: [],
        dietary_preferences: [],
        bag_composition: { main: true, snack: false, extra: false },
        bag_composition_pattern: 'main_only',
        school_policies: [],
        extra_rules: { pinned: [], banned: [] },
      },
    ],
    cultural: {
      active: [
        {
          key: 'south_asian',
          label: 'South Asian',
          state: 'active',
          tier: 'L1',
          confidence: 90,
          presence: 90,
          enforcement: 'just_for_context',
        },
      ],
      suggested: [],
    },
    memory: { nodes: [] },
    household_extras: { library: [] },
    recipes: { favourites: [], banned: [] },
    allergens: [],
    dietary: [],
    food_preferences: [],
    favorite_lunches: [],
    rules: [],
    meta: {
      composed_at: '2026-05-25T00:00:00.000Z',
      map_version: 1,
      schema_version: '1.1.0',
      is_complete: false,
      required_set_complete: false,
    },
  };
}

type Deps = {
  openai: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
  kitchenMapService: { get: ReturnType<typeof vi.fn> };
  recipesRepo: { seedFromCatalogBaseline: ReturnType<typeof vi.fn> };
  householdsRepo: {
    getStage1CompletedAt: ReturnType<typeof vi.fn>;
    setStage1CompletedAt: ReturnType<typeof vi.fn>;
  };
  guardrailRepo: { getRulesForHousehold: ReturnType<typeof vi.fn> };
  curatedBaselineRepo: { findAllActive: ReturnType<typeof vi.fn> };
};

function buildDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    openai: {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: Array.from({ length: 12 }, (_, i) => ({
                      canonical_name: `safe lunch ${i + 1}`,
                      allergen_flags: [],
                      dietary_flags: [],
                      cultural_tags: [],
                      cuisine_tags: ['south_asian'],
                      applicable_slots: ['main'],
                    })),
                  }),
                },
              },
            ],
          }),
        },
      },
    },
    kitchenMapService: {
      get: vi.fn().mockResolvedValue(buildKitchenMap()),
    },
    recipesRepo: {
      seedFromCatalogBaseline: vi.fn().mockResolvedValue(12),
    },
    householdsRepo: {
      getStage1CompletedAt: vi.fn().mockResolvedValue(null),
      setStage1CompletedAt: vi.fn().mockResolvedValue(undefined),
    },
    guardrailRepo: {
      getRulesForHousehold: vi.fn().mockResolvedValue(FALCPA_RULES),
    },
    curatedBaselineRepo: {
      findAllActive: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

function buildService(deps: Deps, logger = buildLogger()): CatalogSeedService {
  return new CatalogSeedService({
    openai: deps.openai as unknown as OpenAI,
    kitchenMapService: deps.kitchenMapService as unknown as KitchenMapService,
    recipesRepo: deps.recipesRepo as unknown as RecipesRepository,
    householdsRepo: deps.householdsRepo as unknown as HouseholdsRepository,
    guardrailRepo: deps.guardrailRepo as unknown as AllergyGuardrailRepository,
    curatedBaselineRepo:
      deps.curatedBaselineRepo as unknown as CatalogSeedServiceDeps['curatedBaselineRepo'],
    logger,
  });
}

describe('CatalogSeedService — seedForHousehold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('happy path: LLM emits 50 → 2 Zod-invalid dropped → 5 guardrail-blocked dropped → 43 persisted', async () => {
    const deps = buildDeps();
    // 43 clean items
    const cleanItems = Array.from({ length: 43 }, (_, i) => ({
      canonical_name: `safe lunch ${i + 1}`,
      allergen_flags: [],
      dietary_flags: [],
      cultural_tags: [],
      cuisine_tags: ['south_asian'],
      applicable_slots: ['main'],
    }));
    // 5 items with allergen_flags matching the FALCPA peanut rule; names contain
    // no FALCPA token so they pass the name pre-filter but get blocked by the
    // guardrail engine (peanut rule in FALCPA_RULES fires on allergen_flags).
    const guardrailBlockedItems = Array.from({ length: 5 }, (_, i) => ({
      canonical_name: `savory wraps ${i + 1}`,
      allergen_flags: ['peanut'],
      dietary_flags: [],
      cultural_tags: [],
      cuisine_tags: ['south_asian'],
      applicable_slots: ['main'],
    }));
    // 2 items missing applicable_slots — Zod rejects these before guardrail.
    const zodInvalidItems = Array.from({ length: 2 }, (_, i) => ({
      canonical_name: `broken item ${i + 1}`,
      allergen_flags: [],
      dietary_flags: [],
      cultural_tags: [],
      cuisine_tags: [],
      // applicable_slots intentionally omitted
    }));
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [...cleanItems, ...guardrailBlockedItems, ...zodInvalidItems],
            }),
          },
        },
      ],
    });
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(43);

    await buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.recipesRepo.seedFromCatalogBaseline).toHaveBeenCalledTimes(1);
    const [callHouseholdId, callItems, , callConfidence] =
      deps.recipesRepo.seedFromCatalogBaseline.mock.calls[0]!;
    expect(callHouseholdId).toBe(HOUSEHOLD_ID);
    expect(callItems).toHaveLength(43);
    // Stage 1 confidence MUST be 50 (not 60 — that's curated baseline).
    expect(callConfidence).toBe(50);
    expect(deps.householdsRepo.setStage1CompletedAt).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('idempotent no-op when stage1_completed_at is already set', async () => {
    const deps = buildDeps();
    deps.householdsRepo.getStage1CompletedAt.mockResolvedValue('2026-05-25T00:00:00.000Z');

    await buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.openai.chat.completions.create).not.toHaveBeenCalled();
    expect(deps.recipesRepo.seedFromCatalogBaseline).not.toHaveBeenCalled();
    expect(deps.householdsRepo.setStage1CompletedAt).not.toHaveBeenCalled();
  });

  it('LLM error (non-abort) → stage1_completed_at NOT set; catalog.stage1.failed logged', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.openai.chat.completions.create.mockRejectedValue(new Error('openai down'));

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.recipesRepo.seedFromCatalogBaseline).not.toHaveBeenCalled();
    expect(deps.householdsRepo.setStage1CompletedAt).not.toHaveBeenCalled();
    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const failed = errCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage1.failed',
    );
    expect(failed).toBeDefined();
  });

  it('LLM timeout (AbortError) → stage1_completed_at NOT set; catalog.stage1.llm_timeout logged', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    deps.openai.chat.completions.create.mockRejectedValue(abortErr);

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.householdsRepo.setStage1CompletedAt).not.toHaveBeenCalled();
    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const timeout = errCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage1.llm_timeout',
    );
    expect(timeout).toBeDefined();
  });

  it('LLM emits non-JSON → catalog.stage1.failed (reason response_not_json); timestamp NOT set', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'sorry, I cannot do that' } }],
    });

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.householdsRepo.setStage1CompletedAt).not.toHaveBeenCalled();
    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const failed = errCalls.find(
      ([ctx]) =>
        (ctx as { action?: string }).action === 'catalog.stage1.failed' &&
        (ctx as { reason?: string }).reason === 'response_not_json',
    );
    expect(failed).toBeDefined();
  });

  it('LLM emits JSON that fails CatalogSeedResponseSchema → response_schema_invalid; timestamp NOT set', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ wrong_shape: true }) } }],
    });

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.householdsRepo.setStage1CompletedAt).not.toHaveBeenCalled();
    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const invalid = errCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage1.response_schema_invalid',
    );
    expect(invalid).toBeDefined();
  });

  it('curated baseline flag disagreement: curated tags overwrite LLM tags; item_index logged (no canonical_name)', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    // LLM emits 1 item whose name normalizes to match a curated baseline row
    // but with DIFFERENT tag arrays.
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [
                {
                  // matches curated "dal chawal thermos" after normalization
                  canonical_name: 'Dal Chawal Thermos',
                  allergen_flags: [],
                  dietary_flags: [],
                  cultural_tags: [],
                  cuisine_tags: ['mexican'], // intentionally wrong
                  applicable_slots: ['main'],
                },
              ],
            }),
          },
        },
      ],
    });
    deps.curatedBaselineRepo.findAllActive.mockResolvedValue([
      {
        canonical_name: 'Dal chawal thermos',
        allergen_flags: [],
        dietary_flags: ['vegetarian'],
        cultural_tags: ['south_asian'],
        cuisine_tags: ['south_asian', 'north_indian'],
        applicable_slots: ['main'],
      },
    ]);
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(1);

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.recipesRepo.seedFromCatalogBaseline).toHaveBeenCalled();
    const survivors = deps.recipesRepo.seedFromCatalogBaseline.mock.calls[0]![1] as Array<{
      canonical_name: string;
      cuisine_tags: string[];
      dietary_flags: string[];
    }>;
    expect(survivors).toHaveLength(1);
    // Curated tags win; LLM's 'mexican' is gone.
    expect(survivors[0]!.cuisine_tags).toEqual(['south_asian', 'north_indian']);
    expect(survivors[0]!.dietary_flags).toEqual(['vegetarian']);
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const disagree = infoCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage1.flag_disagreement',
    );
    expect(disagree).toBeDefined();
    expect((disagree![0] as { item_index: number }).item_index).toBe(0);
    // No canonical_name in the log payload (PII discipline).
    expect(JSON.stringify(disagree![0])).not.toContain('Dal');
  });

  it('floor breach (< 10 validated items): catalog.stage1.floor_breach logged; survivors still persisted; stage1_completed_at still set', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: Array.from({ length: 5 }, (_, i) => ({
                canonical_name: `lunch ${i + 1}`,
                allergen_flags: [],
                dietary_flags: [],
                cultural_tags: [],
                cuisine_tags: [],
                applicable_slots: ['main'],
              })),
            }),
          },
        },
      ],
    });
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(5);

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const floorBreach = warnCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage1.floor_breach',
    );
    expect(floorBreach).toBeDefined();
    expect(deps.recipesRepo.seedFromCatalogBaseline).toHaveBeenCalled();
    expect(deps.householdsRepo.setStage1CompletedAt).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('guardrail uncertain verdict: item skipped + catalog.stage1.guardrail_uncertain logged with item_index (no canonical_name)', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    // Empty rules → engine returns uncertain('falcpa_baseline_missing').
    deps.guardrailRepo.getRulesForHousehold.mockResolvedValue([]);
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [
                {
                  canonical_name: 'Some lunch',
                  allergen_flags: [],
                  dietary_flags: [],
                  cultural_tags: [],
                  cuisine_tags: [],
                  applicable_slots: ['main'],
                },
              ],
            }),
          },
        },
      ],
    });
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(0);

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const uncertain = warnCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage1.guardrail_uncertain',
    );
    expect(uncertain).toBeDefined();
    expect((uncertain![0] as { item_index: number }).item_index).toBe(0);
    expect(JSON.stringify(uncertain![0])).not.toContain('Some lunch');
  });

  it('AllergyGuardrailDecryptError: fail-closed; stage1_completed_at NOT set; allergen_decrypt_failure logged', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.guardrailRepo.getRulesForHousehold.mockRejectedValue(
      new AllergyGuardrailDecryptError(HOUSEHOLD_ID),
    );

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.openai.chat.completions.create).not.toHaveBeenCalled();
    expect(deps.recipesRepo.seedFromCatalogBaseline).not.toHaveBeenCalled();
    expect(deps.householdsRepo.setStage1CompletedAt).not.toHaveBeenCalled();
    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const decrypt = errCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage1.allergen_decrypt_failure',
    );
    expect(decrypt).toBeDefined();
  });

  it('getRulesForHousehold called exactly once per batch (not once per item)', async () => {
    const deps = buildDeps();
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: Array.from({ length: 25 }, (_, i) => ({
                canonical_name: `lunch ${i + 1}`,
                allergen_flags: [],
                dietary_flags: [],
                cultural_tags: [],
                cuisine_tags: [],
                applicable_slots: ['main'],
              })),
            }),
          },
        },
      ],
    });
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(25);

    await buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.guardrailRepo.getRulesForHousehold).toHaveBeenCalledTimes(1);
  });

  it('item name containing FALCPA token (peanut) is pre-filtered before guardrail', async () => {
    const deps = buildDeps();
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [
                {
                  canonical_name: 'peanut butter sandwich',
                  allergen_flags: [],
                  dietary_flags: [],
                  cultural_tags: [],
                  cuisine_tags: [],
                  applicable_slots: ['main'],
                },
                {
                  canonical_name: 'chicken rice bowl',
                  allergen_flags: [],
                  dietary_flags: [],
                  cultural_tags: [],
                  cuisine_tags: [],
                  applicable_slots: ['main'],
                },
              ],
            }),
          },
        },
      ],
    });
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(1);

    await buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    const survivors = deps.recipesRepo.seedFromCatalogBaseline.mock.calls[0]![1] as Array<{
      canonical_name: string;
    }>;
    expect(survivors.map((s) => s.canonical_name)).not.toContain('peanut butter sandwich');
    expect(survivors.map((s) => s.canonical_name)).toContain('chicken rice bowl');
  });
});
