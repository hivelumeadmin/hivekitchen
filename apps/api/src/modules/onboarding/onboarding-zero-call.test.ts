import type { FastifyBaseLogger } from 'fastify';
import { describe, it, expect, vi } from 'vitest';
import { OnboardingService, type OnboardingServiceDeps } from './onboarding.service.js';
import type { MomentState } from './onboarding-moment.repository.js';

// ===========================================================================
// Slice 2.7-s5 — pure-chip zero-call path (AC2).
// ===========================================================================
// When the parent answers a chip moment (M2/M3/M4) entirely by tapping chips —
// no free text — the service applies the tool calls deterministically and fills
// a per-moment template with ZERO conversational LLM calls. A chip+free-text
// turn still routes through the model.
// ===========================================================================

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const THREAD_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';

function makeLogger(): FastifyBaseLogger {
  const fn = vi.fn();
  return {
    info: fn, warn: fn, error: fn, debug: fn, fatal: fn, trace: fn,
    child: () => makeLogger(), level: 'info', silent: () => {},
  } as unknown as FastifyBaseLogger;
}

function m3State(current: MomentState['current_moment']): MomentState {
  return {
    current_moment: current,
    required_set_status: {
      m1_household_name: true,
      m1_child_declared: true,
      m2_allergen_response: current !== 'm2_safe',
      m3_answered: current !== 'm2_safe' && current !== 'm3_taste',
      m5_favorite_count: 0,
      m5_complete: false,
    },
    cold_start_triggered: false,
    cold_start_trigger_reason: null,
  };
}

function buildService(preMoment: MomentState['current_moment']) {
  const allergenDeclares: Array<{ child_id: string | null; allergen: string }> = [];
  const dietaryDeclares: Array<{ child_id: string | null; tag: string; enforcement: string }> = [];
  const cuisineDeclares: Array<{ key: string; enforcement: string }> = [];
  const childUpserts: Array<{ name: string; bag: string | null | undefined }> = [];

  const agent = {
    respond: vi.fn().mockResolvedValue({
      text: 'should not be called',
      complete: false,
      toolCallsSummary: [],
      usage: { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, iterations: 1 },
    }),
    isSummaryConfirmed: vi.fn().mockResolvedValue(false),
    extractSummary: vi.fn(),
    inferCulturalPriors: vi.fn(),
    closingPhrase: vi.fn(),
  };

  const threads = {
    findActiveThreadByHousehold: vi.fn().mockResolvedValue({
      id: THREAD_ID, household_id: HOUSEHOLD_ID, type: 'onboarding', modality: 'text',
      status: 'active', created_at: new Date().toISOString(),
    }),
    createThread: vi.fn(),
    listTurns: vi.fn().mockResolvedValue([]),
    findClosedThreadByHousehold: vi.fn().mockResolvedValue(null),
    appendTurnNext: vi.fn().mockResolvedValue({ id: 'turn' }),
    closeThread: vi.fn(),
  };

  const momentRepository = {
    getState: vi.fn().mockResolvedValue(m3State(preMoment)),
    countRequiredSetSources: vi.fn().mockResolvedValue({
      household_name_set: true, child_count: 1, child_allergen_count: 0, favorite_lunch_count: 0,
    }),
    upsertState: vi.fn().mockResolvedValue(undefined),
  };

  const kitchenMapService = {
    get: vi.fn().mockResolvedValue({
      household: { display_name: 'The Zeros' },
      caregivers: [], cultural: { active: [], suggested: [] }, memory: { nodes: [] },
      children: [{ id: CHILD_ID, name: 'Zoe', age_band: 'child', bag_composition_pattern: null,
        declared_allergens: [], cultural_identifiers: [], dietary_preferences: [], school_policies: [] }],
      allergens: [], dietary: [], food_preferences: [], favorite_lunches: [], rules: [],
      meta: { is_complete: false, required_set_complete: false },
    }),
  };

  const vocabularyService = {
    snapshot: () => ({ allergen_tags: [], dietary_tags: [], cultural_tags: [], cuisine_tags: [], loaded_at: '2026-01-01T00:00:00.000Z' }),
    validateDietary: (keys: readonly string[]) => [...keys],
    validateCuisine: (keys: readonly string[]) => [...keys],
    validateCultural: (keys: readonly string[]) => [...keys],
    resolveAllergen: (k: string) => k,
    isActive: () => true,
    expandImpliesClosure: (keys: readonly string[]) => [...keys],
  };

  const householdAllergensRepository = {
    declareIfNew: vi.fn(async (input: { child_id: string | null; allergen: string }) => {
      allergenDeclares.push({ child_id: input.child_id, allergen: input.allergen });
      return { inserted: true };
    }),
    findByHouseholdId: vi.fn().mockResolvedValue([]),
  };

  const childAllergensRepository = { declare: vi.fn() };

  const dietaryPreferencesRepository = {
    declare: vi.fn(async (_h: string, childId: string | null, tag: string, enforcement: string) => {
      dietaryDeclares.push({ child_id: childId, tag, enforcement });
      return { dietary_id: 'di', was_existing: false };
    }),
    findByHouseholdId: vi.fn().mockResolvedValue([]),
  };

  const culturalPriorRepository = {
    noteSuggested: vi.fn(async (_h: string, input: { key: string; enforcement: string }) => {
      cuisineDeclares.push({ key: input.key, enforcement: input.enforcement });
      return { id: 'p1', was_existing: false };
    }),
    findByHousehold: vi.fn().mockResolvedValue([]),
  };

  const childrenService = {
    upsertByName: vi.fn(async (input: { body: { name: string; bag_composition_pattern?: string | null } }) => {
      childUpserts.push({ name: input.body.name, bag: input.body.bag_composition_pattern });
      return { child: { id: CHILD_ID, name: input.body.name }, was_existing: true };
    }),
    findChildIdByName: vi.fn().mockResolvedValue(CHILD_ID),
    getChild: vi.fn().mockResolvedValue({ id: CHILD_ID }),
  };

  const deps: OnboardingServiceDeps = {
    threads: threads as unknown as OnboardingServiceDeps['threads'],
    agent: agent as unknown as OnboardingServiceDeps['agent'],
    culturalPriorService: {} as OnboardingServiceDeps['culturalPriorService'],
    logger: makeLogger(),
    agentToolsEnabled: true,
    momentRepository: momentRepository as unknown as OnboardingServiceDeps['momentRepository'],
    kitchenMapService: kitchenMapService as unknown as OnboardingServiceDeps['kitchenMapService'],
    vocabularyService: vocabularyService as unknown as OnboardingServiceDeps['vocabularyService'],
    memoryService: { noteFromAgent: vi.fn(), seedFromOnboarding: vi.fn() } as unknown as OnboardingServiceDeps['memoryService'],
    childrenService: childrenService as unknown as OnboardingServiceDeps['childrenService'],
    culturalPriorRepository: culturalPriorRepository as unknown as OnboardingServiceDeps['culturalPriorRepository'],
    householdsService: { setDisplayName: vi.fn(), patchProfile: vi.fn(), addAllergens: vi.fn() } as unknown as OnboardingServiceDeps['householdsService'],
    childAllergensRepository: childAllergensRepository as unknown as OnboardingServiceDeps['childAllergensRepository'],
    householdAllergensRepository: householdAllergensRepository as unknown as OnboardingServiceDeps['householdAllergensRepository'],
    dietaryPreferencesRepository: dietaryPreferencesRepository as unknown as OnboardingServiceDeps['dietaryPreferencesRepository'],
    foodPreferencesRepository: { declare: vi.fn() } as unknown as OnboardingServiceDeps['foodPreferencesRepository'],
    householdRulesRepository: { declare: vi.fn() } as unknown as OnboardingServiceDeps['householdRulesRepository'],
    recipesRepository: { declareForHousehold: vi.fn(), countDeclaredFavorites: vi.fn().mockResolvedValue(0), findById: vi.fn().mockResolvedValue(null) } as unknown as OnboardingServiceDeps['recipesRepository'],
  };

  const service = new OnboardingService(deps);
  return { service, agent, momentRepository, allergenDeclares, dietaryDeclares, cuisineDeclares, childUpserts };
}

describe('OnboardingService — pure-chip zero-call (Slice 2.7-s5)', () => {
  it('M2 pure-chip: declares household-wide allergens with zero conversational LLM calls and advances to m3_taste', async () => {
    const ctx = buildService('m2_safe');
    const result = await ctx.service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: '[Chips selected: peanut, dairy]',
    });

    expect(ctx.agent.respond).not.toHaveBeenCalled();
    expect(ctx.allergenDeclares).toEqual([
      { child_id: null, allergen: 'peanut' },
      { child_id: null, allergen: 'dairy' },
    ]);
    expect(result.moment_key).toBe('m3_taste');
    expect(result.lumi_response).toContain('Peanut');
    expect(result.lumi_response).toContain('Dairy');
    expect(result.lumi_response).not.toContain('[NEXT_MOMENT:');
    // chip_config for the NEXT moment (M3) is rendered.
    expect(result.chip_config?.mode).toBe('choice');
    expect(result.chip_config?.skip_label).toBe('Skip this moment');
  });

  it("M2 'none' pure-chip: fires no allergen.declare, still advances", async () => {
    const ctx = buildService('m2_safe');
    const result = await ctx.service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: '[Chips selected: none]',
    });

    expect(ctx.agent.respond).not.toHaveBeenCalled();
    expect(ctx.allergenDeclares).toEqual([]);
    expect(result.moment_key).toBe('m3_taste');
  });

  it('M3 pure-chip: dietary → enforcement=default, cuisine → confidence/presence defaults, advances to m4_bag', async () => {
    const ctx = buildService('m3_taste');
    const result = await ctx.service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: '[Chips selected: vegetarian, south_indian]',
    });

    expect(ctx.agent.respond).not.toHaveBeenCalled();
    expect(ctx.dietaryDeclares).toEqual([{ child_id: null, tag: 'vegetarian', enforcement: 'default' }]);
    expect(ctx.cuisineDeclares).toEqual([{ key: 'south_indian', enforcement: 'just_for_context' }]);
    expect(result.moment_key).toBe('m4_bag');
    expect(result.chip_config?.mode).toBe('action');
  });

  it('M3 skip pure-chip: fires no tools, advances to m4_bag', async () => {
    const ctx = buildService('m3_taste');
    const result = await ctx.service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: '[Chips selected: skip]',
    });

    expect(ctx.agent.respond).not.toHaveBeenCalled();
    expect(ctx.dietaryDeclares).toEqual([]);
    expect(ctx.cuisineDeclares).toEqual([]);
    expect(result.moment_key).toBe('m4_bag');
  });

  it('M4 pure-chip: upserts the bag pattern for every child, advances to m5_starting_line', async () => {
    const ctx = buildService('m4_bag');
    const result = await ctx.service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: '[Chips selected: main_plus_snack]',
    });

    expect(ctx.agent.respond).not.toHaveBeenCalled();
    expect(ctx.childUpserts).toEqual([{ name: 'Zoe', bag: 'main_plus_snack' }]);
    expect(result.moment_key).toBe('m5_starting_line');
  });

  it('chip + free text routes through the model (NOT zero-call)', async () => {
    const ctx = buildService('m2_safe');
    await ctx.service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: '[Chips selected: peanut] Zoe also reacts to kiwi',
    });

    expect(ctx.agent.respond).toHaveBeenCalledTimes(1);
  });

  // Slice 2.7-s7 (AC4) — a typical text turn now makes ~1 LLM call: the
  // conversational respond(), and NEVER the per-turn isSummaryConfirmed
  // classifier (deleted — completion eligibility is the slot predicate). This is
  // the call-count drop from "1–2 + a classifier once history ≥ 6" to ~1.
  it('a free-text turn makes one conversational call and zero classifier calls (AC4)', async () => {
    const ctx = buildService('m3_taste');
    await ctx.service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: 'We love South Indian food and Italian',
    });

    expect(ctx.agent.respond).toHaveBeenCalledTimes(1);
    expect(ctx.agent.isSummaryConfirmed).not.toHaveBeenCalled();
  });
});
