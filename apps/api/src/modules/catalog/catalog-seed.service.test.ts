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

// FALCPA rules — same shape as curated-baseline tests. Since guardrail 1.4.0
// these are vocabulary + baseline-presence only; hard blocks come exclusively
// from parent_declared rules (household-wide or per-child).
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
  recipesRepo: {
    seedFromCatalogBaseline: ReturnType<typeof vi.fn>;
    countCatalogSeededForHousehold: ReturnType<typeof vi.fn>;
  };
  householdsRepo: {
    getStage1CompletedAt: ReturnType<typeof vi.fn>;
    setStage1CompletedAt: ReturnType<typeof vi.fn>;
  };
  guardrailRepo: { getRulesForHousehold: ReturnType<typeof vi.fn> };
  curatedBaselineRepo: { findAllActive: ReturnType<typeof vi.fn> };
  recoveryQueue: { add: ReturnType<typeof vi.fn> } | undefined;
  // Slice 16-s1 (AC 6, 7) — chip-suggestion persistence, parallel to
  // recipesRepo.seedFromCatalogBaseline, from the SAME filtered survivors.
  onboardingChipSuggestionRepo: { insertMany: ReturnType<typeof vi.fn> };
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
      // Default: above STAGE2_FLOOR=35, so no floor-breach trigger fires.
      countCatalogSeededForHousehold: vi.fn().mockResolvedValue(50),
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
    recoveryQueue: { add: vi.fn().mockResolvedValue(undefined) },
    onboardingChipSuggestionRepo: {
      insertMany: vi.fn().mockResolvedValue([]),
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
    recoveryQueue:
      deps.recoveryQueue === undefined
        ? undefined
        : (deps.recoveryQueue as unknown as NonNullable<
            CatalogSeedServiceDeps['recoveryQueue']
          >),
    onboardingChipSuggestionRepo:
      deps.onboardingChipSuggestionRepo as unknown as CatalogSeedServiceDeps['onboardingChipSuggestionRepo'],
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

  it('happy path: LLM emits 50 → 2 name-prefilter dropped → 5 guardrail-blocked dropped → 43 persisted', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    // Guardrail 1.4.0 — only parent_declared rules block, so the household
    // declares peanut. FALCPA rows still satisfy the baseline-presence check
    // and provide the synonym vocabulary.
    deps.guardrailRepo.getRulesForHousehold.mockResolvedValue([
      ...FALCPA_RULES,
      {
        id: 'declared-peanut',
        household_id: HOUSEHOLD_ID,
        child_id: null,
        allergen: 'peanut',
        rule_type: 'parent_declared',
      },
    ]);
    // 43 clean items
    const cleanItems = Array.from({ length: 43 }, (_, i) => ({
      canonical_name: `safe lunch ${i + 1}`,
      allergen_flags: [],
      dietary_flags: [],
      cultural_tags: [],
      cuisine_tags: ['south_asian'],
      applicable_slots: ['main'],
    }));
    // 5 items whose names match a peanut SYNONYM ('groundnut') — no bare
    // 'peanut' token, so they pass the name pre-filter but get blocked by the
    // guardrail engine (declared peanut rule fires via synonym expansion).
    const guardrailBlockedItems = Array.from({ length: 5 }, (_, i) => ({
      canonical_name: `groundnut wraps ${i + 1}`,
      allergen_flags: ['peanut'],
      dietary_flags: [],
      cultural_tags: [],
      cuisine_tags: ['south_asian'],
      applicable_slots: ['main'],
    }));
    // 2 items whose names contain the bare declared-allergen token 'peanut' —
    // dropped by the belt-and-suspenders name pre-filter before the guardrail.
    const prefilterDroppedItems = Array.from({ length: 2 }, (_, i) => ({
      canonical_name: `peanut brittle ${i + 1}`,
      allergen_flags: ['peanut'],
      dietary_flags: [],
      cultural_tags: [],
      cuisine_tags: [],
      applicable_slots: ['main'],
    }));
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [...cleanItems, ...guardrailBlockedItems, ...prefilterDroppedItems],
            }),
          },
        },
      ],
    });
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(43);

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.recipesRepo.seedFromCatalogBaseline).toHaveBeenCalledTimes(1);
    const [callHouseholdId, callItems, , callConfidence] =
      deps.recipesRepo.seedFromCatalogBaseline.mock.calls[0]!;
    expect(callHouseholdId).toBe(HOUSEHOLD_ID);
    expect(callItems).toHaveLength(43);
    // Stage 1 confidence MUST be 50 (not 60 — that's curated baseline).
    expect(callConfidence).toBe(50);
    expect(deps.householdsRepo.setStage1CompletedAt).toHaveBeenCalledWith(HOUSEHOLD_ID);

    // AC 6 — the SAME 43 filtered survivors, not a separately-forked filter,
    // also land in onboarding_chip_suggestions.
    expect(deps.onboardingChipSuggestionRepo.insertMany).toHaveBeenCalledTimes(1);
    const [chipHouseholdId, chipItems] =
      deps.onboardingChipSuggestionRepo.insertMany.mock.calls[0]!;
    expect(chipHouseholdId).toBe(HOUSEHOLD_ID);
    expect(chipItems).toHaveLength(43);
    expect(chipItems[0]).toMatchObject({
      label: 'safe lunch 1',
      cuisine_tags: ['south_asian'],
    });

    // AC 7 — every blocked suggestion logged with label + matched allergen +
    // match source, distinguishing the name pre-filter (FALCPA_KEYS ∪
    // declared, source can't be told apart there beyond the bare token) from
    // the guardrail engine (which — guardrail 1.4.0+ — only ever blocks on a
    // declared/hard rule, never a bare FALCPA floor).
    const blockedLogs = (logger.info as ReturnType<typeof vi.fn>).mock.calls
      .map(([ctx]) => ctx as Record<string, unknown>)
      .filter((ctx) => ctx['action'] === 'catalog.chips.blocked');
    expect(blockedLogs).toHaveLength(7); // 2 prefilter + 5 guardrail

    const prefilterBlocked = blockedLogs.filter((c) => c['label'] === 'peanut brittle 1');
    expect(prefilterBlocked).toHaveLength(1);
    expect(prefilterBlocked[0]).toMatchObject({ allergen: 'peanut', source: 'declared' });

    const guardrailBlocked = blockedLogs.filter((c) => c['label'] === 'groundnut wraps 1');
    expect(guardrailBlocked).toHaveLength(1);
    expect(guardrailBlocked[0]).toMatchObject({ allergen: 'peanut', source: 'declared' });
  });

  it('AC 7 — a suggestion blocked ONLY by the FALCPA floor (no household declaration) logs source: falcpa', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    // No parent_declared/household_rule_hard rows — FALCPA rules only.
    deps.guardrailRepo.getRulesForHousehold.mockResolvedValue(FALCPA_RULES);
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [
                {
                  // Bare 'dairy' token — FALCPA_KEYS member, no household
                  // declaration behind it — dropped by the name pre-filter.
                  canonical_name: 'dairy smoothie',
                  allergen_flags: ['dairy'],
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

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    const blockedLogs = (logger.info as ReturnType<typeof vi.fn>).mock.calls
      .map(([ctx]) => ctx as Record<string, unknown>)
      .filter((ctx) => ctx['action'] === 'catalog.chips.blocked');
    expect(blockedLogs).toHaveLength(1);
    expect(blockedLogs[0]).toMatchObject({
      label: 'dairy smoothie',
      allergen: 'dairy',
      source: 'falcpa',
    });
    // FALCPA-only block: still excluded from the chip set (decision 1 —
    // deterministic filter is not optional), but never a parent_declared row.
    expect(deps.onboardingChipSuggestionRepo.insertMany).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      [],
    );
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

    // Retryable failures now REJECT so the worker's `attempts: 2` engages;
    // the service used to swallow them, making the retry config decorative.
    await expect(
      buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID),
    ).rejects.toThrow();

    expect(deps.recipesRepo.seedFromCatalogBaseline).not.toHaveBeenCalled();
    expect(deps.householdsRepo.setStage1CompletedAt).not.toHaveBeenCalled();
    // AC 9 forced-failure path 1/4 — an LLM error leaves zero chip
    // suggestions persisted, which is the precondition getM5Chips' CHIP_FLOOR
    // fallback (AC 8) relies on to still render a non-empty chip set.
    expect(deps.onboardingChipSuggestionRepo.insertMany).not.toHaveBeenCalled();
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

    // Retryable failures now REJECT so the worker's `attempts: 2` engages;
    // the service used to swallow them, making the retry config decorative.
    await expect(
      buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID),
    ).rejects.toThrow();

    expect(deps.householdsRepo.setStage1CompletedAt).not.toHaveBeenCalled();
    // AC 9 forced-failure path 2/4 — LLM timeout.
    expect(deps.onboardingChipSuggestionRepo.insertMany).not.toHaveBeenCalled();
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

    // Retryable failures now REJECT so the worker's `attempts: 2` engages;
    // the service used to swallow them, making the retry config decorative.
    await expect(
      buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID),
    ).rejects.toThrow();

    expect(deps.householdsRepo.setStage1CompletedAt).not.toHaveBeenCalled();
    // AC 9 forced-failure path 3/4 — malformed (non-JSON) response.
    expect(deps.onboardingChipSuggestionRepo.insertMany).not.toHaveBeenCalled();
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

    // Retryable failures now REJECT so the worker's `attempts: 2` engages;
    // the service used to swallow them, making the retry config decorative.
    await expect(
      buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID),
    ).rejects.toThrow();

    expect(deps.householdsRepo.setStage1CompletedAt).not.toHaveBeenCalled();
    // AC 9 forced-failure path 3/4 (schema-invalid variant) — a malformed
    // response either way leaves zero chip suggestions persisted.
    expect(deps.onboardingChipSuggestionRepo.insertMany).not.toHaveBeenCalled();
    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const invalid = errCalls.find(
      ([ctx]) => (ctx as { action?: string }).action === 'catalog.stage1.response_schema_invalid',
    );
    expect(invalid).toBeDefined();
  });

  it('AC 9 forced-failure path 4/4 — a filter that blocks EVERY item leaves zero chip suggestions persisted', async () => {
    const deps = buildDeps();
    // No parent_declared rules, so nothing is blocked by household allergens —
    // instead every item names a bare FALCPA token in its canonical_name, so
    // the name pre-filter (not the guardrail) drops all of them. Either
    // filter site blocking everything demonstrates the same AC 9 guarantee.
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: Array.from({ length: 10 }, (_, i) => ({
                canonical_name: `peanut dish ${i + 1}`,
                allergen_flags: ['peanut'],
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

    await buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.recipesRepo.seedFromCatalogBaseline).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      [],
      expect.any(Function),
      expect.any(Number),
    );
    expect(deps.onboardingChipSuggestionRepo.insertMany).toHaveBeenCalledWith(HOUSEHOLD_ID, []);
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

  // ============================================================================
  // Slice 2.6-s5 — Stage 2 recovery triggers
  // ============================================================================

  it('Stage 2 trigger: LLM timeout → enqueueRecovery called with stage1_failure', async () => {
    const deps = buildDeps();
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    deps.openai.chat.completions.create.mockRejectedValue(abortErr);

    // Retryable failures now REJECT so the worker's `attempts: 2` engages;
    // the service used to swallow them, making the retry config decorative.
    await expect(
      buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID),
    ).rejects.toThrow();

    expect(deps.recoveryQueue!.add).toHaveBeenCalledTimes(1);
    const callArgs = deps.recoveryQueue!.add.mock.calls[0]!;
    expect(callArgs[0]).toBe('catalog.recover.stage2');
    expect(callArgs[1]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      request_id: REQUEST_ID,
      triggered_by: 'stage1_failure',
    });
    // jobId dedup uses householdId
    expect(callArgs[2]).toMatchObject({
      jobId: `catalog.recover.stage2:${HOUSEHOLD_ID}`,
    });
  });

  it('Stage 2 trigger: non-JSON LLM response → enqueueRecovery called with stage1_failure', async () => {
    const deps = buildDeps();
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    });

    // Retryable failures now REJECT so the worker's `attempts: 2` engages;
    // the service used to swallow them, making the retry config decorative.
    await expect(
      buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID),
    ).rejects.toThrow();

    expect(deps.recoveryQueue!.add).toHaveBeenCalledTimes(1);
    expect(deps.recoveryQueue!.add.mock.calls[0]![1]).toMatchObject({
      triggered_by: 'stage1_failure',
    });
  });

  it('Stage 2 trigger: schema-invalid LLM response → enqueueRecovery called with stage1_failure', async () => {
    const deps = buildDeps();
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ wrong: 'shape' }) } }],
    });

    // Retryable failures now REJECT so the worker's `attempts: 2` engages;
    // the service used to swallow them, making the retry config decorative.
    await expect(
      buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID),
    ).rejects.toThrow();

    expect(deps.recoveryQueue!.add).toHaveBeenCalledTimes(1);
    expect(deps.recoveryQueue!.add.mock.calls[0]![1]).toMatchObject({
      triggered_by: 'stage1_failure',
    });
  });

  it('Stage 2 trigger: mass-block (> 50% blocked) → enqueueRecovery with mass_block + emitted/blocked counts; logs mass_block_detected', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    // Guardrail 1.4.0 — blocking requires a parent_declared rule; the
    // household declares wheat (FALCPA rows alone no longer block).
    deps.guardrailRepo.getRulesForHousehold.mockResolvedValue([
      ...FALCPA_RULES,
      {
        id: 'declared-wheat',
        household_id: HOUSEHOLD_ID,
        child_id: null,
        allergen: 'wheat',
        rule_type: 'parent_declared',
      },
    ]);
    // 10 items: 6 blocked by guardrail (canonical_name 'pasta dish N' matches
    // wheat synonym 'pasta'), 4 clean. Ratio 6/10 > 0.5 → mass-block fires.
    // Note: pre-filter checks bare allergen keys ('wheat', 'dairy', ...) only,
    // NOT synonyms — so 'pasta dish' passes pre-filter then hits guardrail.
    const blocked = Array.from({ length: 6 }, (_, i) => ({
      canonical_name: `pasta dish ${i + 1}`,
      allergen_flags: [],
      dietary_flags: [],
      cultural_tags: [],
      cuisine_tags: ['south_asian'],
      applicable_slots: ['main'],
    }));
    const clean = Array.from({ length: 4 }, (_, i) => ({
      canonical_name: `safe rice bowl ${i + 1}`,
      allergen_flags: [],
      dietary_flags: [],
      cultural_tags: [],
      cuisine_tags: ['south_asian'],
      applicable_slots: ['main'],
    }));
    deps.openai.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ items: [...blocked, ...clean] }),
          },
        },
      ],
    });
    deps.recipesRepo.seedFromCatalogBaseline.mockResolvedValue(4);

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    // At least one mass_block enqueue (may also be floor_breach since 50 default
    // — but a different test verifies floor-breach gating; this asserts the
    // mass_block call shape).
    const massBlockCall = deps.recoveryQueue!.add.mock.calls.find(
      (c) => (c[1] as { triggered_by?: string }).triggered_by === 'mass_block',
    );
    expect(massBlockCall).toBeDefined();
    expect(massBlockCall![1]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      triggered_by: 'mass_block',
      emitted_count: 10,
      blocked_count: 6,
    });
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const massBlockLog = warnCalls.find(
      ([ctx]) =>
        (ctx as { action?: string }).action === 'catalog.stage1.mass_block_detected',
    );
    expect(massBlockLog).toBeDefined();
    expect((massBlockLog![0] as { ratio: number }).ratio).toBeCloseTo(0.6, 5);
  });

  it('Stage 2 trigger: floor-breach (totalSeeded < 35) → enqueueRecovery with floor_breach after stage1_completed_at', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    // Total household catalog count post-Stage-1 is below STAGE2_FLOOR=35.
    deps.recipesRepo.countCatalogSeededForHousehold.mockResolvedValue(20);

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    expect(deps.householdsRepo.setStage1CompletedAt).toHaveBeenCalled();
    const floorBreachCall = deps.recoveryQueue!.add.mock.calls.find(
      (c) => (c[1] as { triggered_by?: string }).triggered_by === 'floor_breach',
    );
    expect(floorBreachCall).toBeDefined();
    expect(floorBreachCall![1]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      triggered_by: 'floor_breach',
    });
    // No emitted/blocked counts on floor_breach (those are mass_block-only).
    expect((floorBreachCall![1] as Record<string, unknown>).emitted_count).toBeUndefined();
    expect((floorBreachCall![1] as Record<string, unknown>).blocked_count).toBeUndefined();
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const floorBreachLog = warnCalls.find(
      ([ctx]) =>
        (ctx as { action?: string }).action === 'catalog.stage2.floor_breach_detected',
    );
    expect(floorBreachLog).toBeDefined();
  });

  it('Stage 2 trigger: NO enqueue when totalSeeded >= 35 (default happy path)', async () => {
    const deps = buildDeps();
    // Default mock returns 50 — above the floor.
    await buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);
    const floorBreachCall = deps.recoveryQueue!.add.mock.calls.find(
      (c) => (c[1] as { triggered_by?: string }).triggered_by === 'floor_breach',
    );
    expect(floorBreachCall).toBeUndefined();
  });

  it('Stage 2 trigger: countCatalogSeededForHousehold throws → no enqueue; floor_breach_check_failed logged; no rethrow', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.recipesRepo.countCatalogSeededForHousehold.mockRejectedValue(
      new Error('db connection lost'),
    );

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    // setStage1CompletedAt still fires (we don't undo Stage 1 success on a
    // post-completion check failure).
    expect(deps.householdsRepo.setStage1CompletedAt).toHaveBeenCalled();
    // No floor_breach enqueue (the check failed).
    const floorBreachCall = deps.recoveryQueue!.add.mock.calls.find(
      (c) => (c[1] as { triggered_by?: string }).triggered_by === 'floor_breach',
    );
    expect(floorBreachCall).toBeUndefined();
    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const checkFailed = errCalls.find(
      ([ctx]) =>
        (ctx as { action?: string }).action === 'catalog.stage2.floor_breach_check_failed',
    );
    expect(checkFailed).toBeDefined();
  });

  it('Stage 2 trigger: no recoveryQueue dep → recovery_skipped_no_queue warn; no crash', async () => {
    const logger = buildLogger();
    const deps = buildDeps({ recoveryQueue: undefined });
    deps.recipesRepo.countCatalogSeededForHousehold.mockResolvedValue(10);

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const skipped = warnCalls.find(
      ([ctx]) =>
        (ctx as { action?: string }).action ===
        'catalog.stage2.recovery_skipped_no_queue',
    );
    expect(skipped).toBeDefined();
  });

  it('Stage 2 trigger: queue.add rejection is caught (fire-and-forget); enqueue_failed logged', async () => {
    const logger = buildLogger();
    const deps = buildDeps();
    deps.recipesRepo.countCatalogSeededForHousehold.mockResolvedValue(10);
    deps.recoveryQueue!.add.mockRejectedValue(new Error('redis down'));

    await buildService(deps, logger).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    // Wait for next microtask so the .catch handler fires.
    await Promise.resolve();
    await Promise.resolve();

    const errCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const enqueueFailed = errCalls.find(
      ([ctx]) =>
        (ctx as { action?: string }).action === 'catalog.stage2.enqueue_failed',
    );
    expect(enqueueFailed).toBeDefined();
  });
});

// ===========================================================================
// Slice 16-s1 (AC 3) — snapshot fidelity.
//
// Moving the generation trigger to the M3 exit is worthless if the snapshot
// then throws away what M3 collected. Two defects, both of which survive a
// trigger move:
//   - dietary `enforcement` was flattened away, so the prompt could be asked
//     for dishes the M5 projection filter would later silently discard;
//   - `cuisine_tags` and `cultural_tags` were populated from the SAME source
//     (`map.cultural.active[].key`), rendering two byte-identical prompt lines.
// ===========================================================================
describe('CatalogSeedService — snapshot carries stated preferences (16-s1 AC 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function userPromptFrom(deps: Deps): string {
    const call = deps.openai.chat.completions.create.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = call.messages.find((m) => m.role === 'user');
    if (user === undefined) throw new Error('no user message in the seed prompt');
    return user.content;
  }

  it('renders the parent\'s STATED food preferences, not only the inferred cultural template', async () => {
    const map = buildKitchenMap();
    // Inferred template says south_asian; the parent actually said they love
    // pasta. The old snapshot dropped this distinction on the floor.
    map.food_preferences = [
      {
        child_id: null,
        item: 'pasta',
        valence: 'loves',
        enforcement: 'soft',
        source: 'onboarding_declared',
      },
      {
        child_id: null,
        item: 'okra',
        valence: 'refuses',
        enforcement: 'soft',
        source: 'onboarding_declared',
      },
    ];
    const deps = buildDeps();
    deps.kitchenMapService.get.mockResolvedValue(map);

    await buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    // Review follow-up (16-s1) — check the specific food_preferences line
    // rather than the whole prompt blob: a whole-blob toContain/not.toContain
    // pair is exactly the kind of ambiguous-match risk this diff's prompt
    // changes are themselves trying to eliminate from the LLM's output.
    const foodPrefLine = userPromptFrom(deps)
      .split('\n')
      .find((l) => l.startsWith('food_preferences'));
    expect(foodPrefLine).toBeDefined();
    expect(foodPrefLine).toContain('pasta');
    // Only loves/likes are forwarded — a refused item must not read as a hint.
    expect(foodPrefLine).not.toContain('okra');
  });

  it('never emits two identical tag lines (cuisine was aliased to culture)', async () => {
    const deps = buildDeps();

    await buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    const lines = userPromptFrom(deps)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('south_asian'));
    // Previously `cultural_tags: south_asian` and `cuisine_tags: south_asian`
    // were both rendered from map.cultural.active[].key. Review follow-up
    // (16-s1) — assert exactly 1: since cuisine_tags no longer exists in the
    // schema at all, `<= 1` was vacuous (it would also pass at 0, i.e. even if
    // cultural_tags silently stopped rendering).
    expect(lines).toEqual(['cultural_tags: south_asian']);
  });

  it('renders a non_negotiable dietary tag as a hard exclusion, separately from soft ones', async () => {
    const map = buildKitchenMap();
    map.dietary = [
      {
        child_id: null,
        tag: 'halal',
        enforcement: 'non_negotiable',
        source: 'onboarding_declared',
      },
      {
        child_id: null,
        tag: 'low_sugar',
        enforcement: 'soft',
        source: 'onboarding_declared',
      },
    ];
    const deps = buildDeps();
    deps.kitchenMapService.get.mockResolvedValue(map);

    await buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    const user = userPromptFrom(deps);
    const hardLine = user
      .split('\n')
      .find((l) => l.startsWith('dietary_non_negotiable'));
    expect(hardLine).toBeDefined();
    expect(hardLine).toContain('halal');
    // The soft one must NOT be presented as a hard rule.
    expect(hardLine).not.toContain('low_sugar');
    expect(user).toContain('low_sugar');
  });

  // Review follow-up (16-s1) — the legacy household.dietary_preferences loop
  // didn't check dietaryNonNegotiable before adding, so a tag present in BOTH
  // sources rendered as a hard exclusion AND a soft leaning simultaneously —
  // a self-contradictory prompt.
  it('does not render a non_negotiable tag as a soft leaning even when it is also in the legacy household column', async () => {
    const map = buildKitchenMap();
    map.household.dietary_preferences = ['halal'];
    map.dietary = [
      {
        child_id: null,
        tag: 'halal',
        enforcement: 'non_negotiable',
        source: 'onboarding_declared',
      },
    ];
    const deps = buildDeps();
    deps.kitchenMapService.get.mockResolvedValue(map);

    await buildService(deps).seedForHousehold(HOUSEHOLD_ID, REQUEST_ID);

    const user = userPromptFrom(deps);
    const softLine = user.split('\n').find((l) => l.startsWith('dietary_flags'));
    expect(softLine).toBeDefined();
    expect(softLine).not.toContain('halal');
  });
});
