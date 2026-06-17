import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  createAllergenDeclareToolSpec,
  createChildUpsertToolSpec,
  createCuisineDeclareToolSpec,
  createCulturalNoteToolSpec,
  createDietaryDeclareToolSpec,
  createFavoriteLunchAddToolSpec,
  createFoodPreferenceDeclareToolSpec,
  createHouseholdSetNameToolSpec,
  createHouseholdUpsertToolSpec,
  createMemoryNoteToolSpec,
  createOnboardingToolSpecs,
  createRuleSetToolSpec,
  type OnboardingToolContext,
  type OnboardingToolDeps,
} from './onboarding.tools.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const PRIOR_ID = '44444444-4444-4444-8444-444444444444';
const NODE_ID = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-05-14T10:00:00.000Z';

function makeLogger(): FastifyBaseLogger {
  const fn = vi.fn();
  return {
    info: fn,
    warn: fn,
    error: fn,
    debug: fn,
    fatal: fn,
    trace: fn,
    child: () => makeLogger(),
    level: 'info',
    silent: () => {},
  } as unknown as FastifyBaseLogger;
}

function makeCtx(): OnboardingToolContext {
  return { householdId: HOUSEHOLD_ID, userId: USER_ID, logger: makeLogger() };
}

const ALLERGEN_ROW_ID = '66666666-6666-4666-8666-666666666666';
const DIETARY_ROW_ID = '77777777-7777-4777-8777-777777777777';
const FOOD_PREF_ROW_ID = '88888888-8888-4888-8888-888888888888';
const RULE_ROW_ID = '99999999-9999-4999-9999-999999999999';
const FAV_LUNCH_ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeDeps(overrides: Partial<OnboardingToolDeps> = {}): OnboardingToolDeps {
  return {
    childrenService: {
      upsertByName: vi.fn().mockResolvedValue({
        child: { id: CHILD_ID, name: 'Layla' },
        was_existing: false,
      }),
      findChildIdByName: vi.fn().mockResolvedValue(CHILD_ID),
      getChild: vi.fn().mockResolvedValue({ id: CHILD_ID }),
    } as unknown as OnboardingToolDeps['childrenService'],
    culturalPriorRepository: {
      noteSuggested: vi
        .fn()
        .mockResolvedValue({ id: PRIOR_ID, was_existing: false }),
    } as unknown as OnboardingToolDeps['culturalPriorRepository'],
    memoryService: {
      noteFromAgent: vi
        .fn()
        .mockResolvedValue({ node_id: NODE_ID, created_at: NOW }),
    } as unknown as OnboardingToolDeps['memoryService'],
    householdsService: {
      patchProfile: vi.fn().mockResolvedValue({
        id: HOUSEHOLD_ID,
        cultural_identifiers: [],
        dietary_preferences: [],
        declared_allergens: [],
      }),
      addAllergens: vi.fn().mockResolvedValue({
        id: HOUSEHOLD_ID,
        cultural_identifiers: [],
        dietary_preferences: [],
        declared_allergens: [],
      }),
      getProfile: vi.fn().mockResolvedValue({
        id: HOUSEHOLD_ID,
        cultural_identifiers: [],
        dietary_preferences: [],
        declared_allergens: [],
      }),
      setDisplayName: vi.fn().mockResolvedValue(undefined),
    } as unknown as OnboardingToolDeps['householdsService'],
    vocabularyService: {
      // Slice 2.6-s8 — production child.upsert uses resolveAllergen +
      // isActive (per-key resolution) for the allergen-vocabulary partition
      // instead of the legacy validateAllergens batch path. Default mock
      // accepts every key as a known active allergen so existing tests'
      // `declared_allergens: ['peanut']` payloads flow through to the
      // ChildrenService.upsertByName mock unchanged.
      resolveAllergen: vi.fn((key: string) => key),
      isActive: vi.fn(() => true),
      validateAllergens: vi.fn((keys: string[]) => [...new Set(keys)]),
      validateCultural: vi.fn((keys: string[]) => [...new Set(keys)]),
      validateDietary: vi.fn((keys: string[]) => [...new Set(keys)]),
      validateCuisine: vi.fn((keys: string[]) => [...new Set(keys)]),
      expandImpliesClosure: vi.fn((keys: string[]) => keys),
    } as unknown as OnboardingToolDeps['vocabularyService'],
    childAllergensRepository: {
      declare: vi.fn().mockResolvedValue({
        child_allergen_id: ALLERGEN_ROW_ID,
        was_existing: false,
      }),
    } as unknown as OnboardingToolDeps['childAllergensRepository'],
    householdAllergensRepository: {
      declareIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    } as unknown as OnboardingToolDeps['householdAllergensRepository'],
    dietaryPreferencesRepository: {
      declare: vi.fn().mockResolvedValue({
        dietary_id: DIETARY_ROW_ID,
        was_existing: false,
      }),
    } as unknown as OnboardingToolDeps['dietaryPreferencesRepository'],
    foodPreferencesRepository: {
      declare: vi.fn().mockResolvedValue({
        food_preference_id: FOOD_PREF_ROW_ID,
        was_existing: false,
      }),
    } as unknown as OnboardingToolDeps['foodPreferencesRepository'],
    householdRulesRepository: {
      declare: vi.fn().mockResolvedValue({
        household_rule_id: RULE_ROW_ID,
        was_existing: false,
      }),
    } as unknown as OnboardingToolDeps['householdRulesRepository'],
    recipesRepository: {
      declareForHousehold: vi.fn().mockResolvedValue({
        recipeId: FAV_LUNCH_ROW_ID,
        usageWasExisting: false,
        recipeWasInserted: true,
      }),
      countDeclaredFavorites: vi.fn().mockResolvedValue(1),
    } as unknown as OnboardingToolDeps['recipesRepository'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// child.upsert
// ---------------------------------------------------------------------------

describe('createChildUpsertToolSpec', () => {
  let deps: OnboardingToolDeps;
  let spec: ReturnType<typeof createChildUpsertToolSpec>;

  beforeEach(() => {
    deps = makeDeps();
    spec = createChildUpsertToolSpec(makeCtx(), deps);
  });

  it('happy path: parses input, calls childrenService.upsertByName, returns child_id', async () => {
    const result = await spec.fn({
      name: 'Layla',
      age_band: 'child',
      declared_allergens: ['peanut'],
      cultural_identifiers: ['south_asian'],
      dietary_preferences: ['vegetarian'],
    });
    expect(result).toEqual({
      child_id: CHILD_ID,
      name: 'Layla',
      was_existing: false,
    });
    expect(deps.childrenService.upsertByName).toHaveBeenCalledTimes(1);
  });

  // Slice 2.6-s8 — child.upsert is the legacy declared_allergens entry point.
  // After the storage cutover, known allergens still flow through
  // upsertByName (which fans into child_allergens internally — see
  // ChildrenRepository.insert/updateProfile). The tool itself does not call
  // ChildAllergensRepository directly; the service does.
  it('child.upsert passes known declared_allergens through upsertByName (storage routed by service)', async () => {
    await spec.fn({
      name: 'Layla',
      age_band: 'child',
      declared_allergens: ['peanut', 'shellfish'],
      cultural_identifiers: [],
      dietary_preferences: [],
    });
    expect(deps.childrenService.upsertByName).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          declared_allergens: ['peanut', 'shellfish'],
        }),
      }),
    );
  });

  it('validates allergens against vocabulary before persisting (per-key resolve+isActive)', async () => {
    await spec.fn({
      name: 'Layla',
      age_band: 'child',
      declared_allergens: ['peanut'],
      cultural_identifiers: [],
      dietary_preferences: [],
    });
    expect(
      (deps.vocabularyService as unknown as { resolveAllergen: ReturnType<typeof vi.fn> })
        .resolveAllergen,
    ).toHaveBeenCalledWith('peanut');
    expect(
      (deps.vocabularyService as unknown as { isActive: ReturnType<typeof vi.fn> }).isActive,
    ).toHaveBeenCalledWith('allergen', 'peanut');
  });

  it('runs dietary tags through implies-closure expansion', async () => {
    await spec.fn({
      name: 'Layla',
      age_band: 'child',
      declared_allergens: [],
      cultural_identifiers: [],
      dietary_preferences: ['vegan'],
    });
    expect(deps.vocabularyService.expandImpliesClosure).toHaveBeenCalledWith(['vegan']);
  });

  it('routes unknown allergens to memory.note instead of throwing (graceful partition)', async () => {
    // Slice 2.6-s8 — production code partitions unknowns (resolveAllergen
    // returns undefined) into a memory.note write rather than throwing.
    // A thrown error would propagate as a tool failure and force Lumi to
    // apologise; the partition keeps the conversation moving.
    (
      deps.vocabularyService as unknown as { resolveAllergen: ReturnType<typeof vi.fn> }
    ).resolveAllergen.mockImplementation((key: string) =>
      key === 'unicorn' ? undefined : key,
    );

    const result = await spec.fn({
      name: 'Layla',
      age_band: 'child',
      declared_allergens: ['unicorn'],
      cultural_identifiers: [],
      dietary_preferences: [],
    });

    expect(deps.childrenService.upsertByName).toHaveBeenCalled();
    expect(deps.memoryService.noteFromAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeType: 'allergy',
        facet: 'allergen',
      }),
    );
    expect((result as { unknown_allergens_noted?: string[] }).unknown_allergens_noted).toEqual([
      'unicorn',
    ]);
  });

  it('reports was_existing=true when repository upsert hit an existing row', async () => {
    vi.mocked(deps.childrenService.upsertByName).mockResolvedValue({
      child: { id: CHILD_ID, name: 'Layla' } as never,
      was_existing: true,
    });
    const result = await spec.fn({
      name: 'Layla',
      age_band: 'child',
      declared_allergens: [],
      cultural_identifiers: [],
      dietary_preferences: [],
    });
    expect((result as { was_existing: boolean }).was_existing).toBe(true);
  });

  it('rejects empty name at the Zod boundary', async () => {
    await expect(
      spec.fn({
        name: '',
        age_band: 'child',
        declared_allergens: [],
        cultural_identifiers: [],
        dietary_preferences: [],
      }),
    ).rejects.toThrow();
  });

  it('rejects invalid age_band', async () => {
    await expect(
      spec.fn({
        name: 'Layla',
        age_band: 'infant',
        declared_allergens: [],
        cultural_identifiers: [],
        dietary_preferences: [],
      }),
    ).rejects.toThrow();
  });

  it('PATCH semantics: omitted tag arrays pass through as undefined (preserve existing)', async () => {
    await spec.fn({
      name: 'Layla',
      age_band: 'child',
      // no declared_allergens, no cultural_identifiers, no dietary_preferences
    });
    // Service receives undefined for the omitted fields so it can merge with
    // existing row values rather than clobbering them.
    expect(deps.childrenService.upsertByName).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          name: 'Layla',
          age_band: 'child',
          declared_allergens: undefined,
          cultural_identifiers: undefined,
          dietary_preferences: undefined,
        }),
      }),
    );
    // Vocabulary validators should NOT be called for fields the agent omitted.
    expect(deps.vocabularyService.validateAllergens).not.toHaveBeenCalled();
    expect(deps.vocabularyService.validateCultural).not.toHaveBeenCalled();
    expect(deps.vocabularyService.validateDietary).not.toHaveBeenCalled();
  });

  it('PATCH semantics: explicit empty array IS an overwrite', async () => {
    await spec.fn({
      name: 'Layla',
      age_band: 'child',
      declared_allergens: [],
    });
    // Empty array is a deliberate clear — the service should receive it as
    // [] (overwrite), not undefined (preserve). Slice 2.6-s8: production
    // partition iterates per-key, so an empty array calls neither
    // resolveAllergen nor isActive — assertion on validator counts dropped.
    expect(deps.childrenService.upsertByName).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          declared_allergens: [],
        }),
      }),
    );
  });

  it('PATCH semantics: partial update — only declared_allergens supplied', async () => {
    await spec.fn({
      name: 'Layla',
      age_band: 'child',
      declared_allergens: ['peanut'],
      // dietary_preferences + cultural_identifiers omitted
    });
    expect(deps.childrenService.upsertByName).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          declared_allergens: ['peanut'],
          cultural_identifiers: undefined,
          dietary_preferences: undefined,
        }),
      }),
    );
  });

  // Slice 2.5-s8 — Moment 4 wire-through: ChildUpsertInputSchema accepts
  // bag_composition_pattern (added in 2.5-s1); the tool spec must forward it
  // into the UpsertByNameBody passed to ChildrenService.upsertByName().
  it('forwards bag_composition_pattern to the service (Slice 2.5-s8)', async () => {
    await spec.fn({
      name: 'Layla',
      age_band: 'child',
      bag_composition_pattern: 'main_plus_snack',
    });
    expect(deps.childrenService.upsertByName).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          name: 'Layla',
          bag_composition_pattern: 'main_plus_snack',
        }),
      }),
    );
  });

  it('omits bag_composition_pattern when not supplied so PATCH preserves existing (Slice 2.5-s8)', async () => {
    await spec.fn({ name: 'Layla', age_band: 'child' });
    expect(deps.childrenService.upsertByName).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ bag_composition_pattern: undefined }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// cultural.note
// ---------------------------------------------------------------------------

describe('createCulturalNoteToolSpec', () => {
  let deps: OnboardingToolDeps;
  let spec: ReturnType<typeof createCulturalNoteToolSpec>;

  beforeEach(() => {
    deps = makeDeps();
    spec = createCulturalNoteToolSpec(makeCtx(), deps);
  });

  it('happy path: persists a suggested prior with enforcement defaulted to just_for_context', async () => {
    const result = await spec.fn({
      key: 'south_asian',
      label: 'South Asian',
      confidence: 80,
      presence: 70,
    });
    expect(result).toEqual({ prior_id: PRIOR_ID, was_existing: false });
    // Slice 2.5-s7 — schema defaults enforcement to 'just_for_context' and the
    // tool now passes it through to noteSuggested.
    expect(deps.culturalPriorRepository.noteSuggested).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      key: 'south_asian',
      label: 'South Asian',
      confidence: 80,
      presence: 70,
      enforcement: 'just_for_context',
    });
  });

  it('passes parent-language-derived enforcement through to repo (Slice 2.5-s7)', async () => {
    await spec.fn({
      key: 'halal',
      label: 'Halal',
      confidence: 95,
      presence: 90,
      enforcement: 'non_negotiable',
    });
    expect(deps.culturalPriorRepository.noteSuggested).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.objectContaining({ enforcement: 'non_negotiable' }),
    );
  });

  it('validates the key against cultural_tags vocabulary', async () => {
    await spec.fn({ key: 'south_asian', label: 'South Asian', confidence: 80, presence: 70 });
    expect(deps.vocabularyService.validateCultural).toHaveBeenCalledWith(['south_asian']);
  });

  it('throws on unknown cultural key without persisting', async () => {
    vi.mocked(deps.vocabularyService.validateCultural).mockImplementation(() => {
      throw new Error('Unknown cultural tag');
    });
    await expect(
      spec.fn({ key: 'martian', label: 'Martian', confidence: 50, presence: 50 }),
    ).rejects.toThrow();
    expect(deps.culturalPriorRepository.noteSuggested).not.toHaveBeenCalled();
  });

  it('rejects confidence outside 0–100', async () => {
    await expect(
      spec.fn({ key: 'south_asian', label: 'South Asian', confidence: 150, presence: 70 }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// memory.note
// ---------------------------------------------------------------------------

describe('createMemoryNoteToolSpec', () => {
  let deps: OnboardingToolDeps;
  let spec: ReturnType<typeof createMemoryNoteToolSpec>;

  beforeEach(() => {
    deps = makeDeps();
    spec = createMemoryNoteToolSpec(makeCtx(), deps);
  });

  it('happy path: persists a household-wide rhythm note', async () => {
    const result = await spec.fn({
      node_type: 'rhythm',
      facet: 'family_rhythm',
      prose_text: 'Friday is leftover night.',
    });
    expect(result).toEqual({ node_id: NODE_ID, created_at: NOW });
    expect(deps.memoryService.noteFromAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: HOUSEHOLD_ID,
        nodeType: 'rhythm',
        facet: 'family_rhythm',
        proseText: 'Friday is leftover night.',
        subjectChildId: null,
        confidence: 0.8,
      }),
    );
  });

  it('passes subject_child_id through for child-scoped notes', async () => {
    await spec.fn({
      node_type: 'child_obsession',
      facet: 'fixation',
      prose_text: 'Layla only wants pasta this month.',
      subject_child_id: CHILD_ID,
    });
    expect(deps.memoryService.noteFromAgent).toHaveBeenCalledWith(
      expect.objectContaining({ subjectChildId: CHILD_ID }),
    );
  });

  it('resolves subject_child_name to child_id via ChildrenService', async () => {
    await spec.fn({
      node_type: 'child_obsession',
      facet: 'fixation',
      prose_text: "Layla won't eat anything but pasta.",
      subject_child_name: 'Layla',
    });
    expect(deps.childrenService.findChildIdByName).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      'Layla',
    );
    expect(deps.memoryService.noteFromAgent).toHaveBeenCalledWith(
      expect.objectContaining({ subjectChildId: CHILD_ID }),
    );
  });

  it('falls back to household-wide when subject_child_name does not resolve', async () => {
    vi.mocked(deps.childrenService.findChildIdByName).mockResolvedValueOnce(null);
    await spec.fn({
      node_type: 'child_obsession',
      facet: 'fixation',
      prose_text: 'Phantom kid only eats pasta.',
      subject_child_name: 'PhantomKid',
    });
    expect(deps.memoryService.noteFromAgent).toHaveBeenCalledWith(
      expect.objectContaining({ subjectChildId: null }),
    );
  });

  it('prefers subject_child_id when both id and name are provided', async () => {
    await spec.fn({
      node_type: 'child_obsession',
      facet: 'fixation',
      prose_text: "Layla won't eat anything but pasta.",
      subject_child_id: CHILD_ID,
      subject_child_name: 'Layla',
    });
    // id wins, name resolver should not be consulted
    expect(deps.childrenService.findChildIdByName).not.toHaveBeenCalled();
    expect(deps.memoryService.noteFromAgent).toHaveBeenCalledWith(
      expect.objectContaining({ subjectChildId: CHILD_ID }),
    );
  });

  it('uses the agent-provided confidence when set', async () => {
    await spec.fn({
      node_type: 'other',
      facet: 'note',
      prose_text: 'Kids love yogurt.',
      confidence: 0.95,
    });
    expect(deps.memoryService.noteFromAgent).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 0.95 }),
    );
  });

  it('rejects empty prose_text', async () => {
    await expect(
      spec.fn({ node_type: 'rhythm', facet: 'x', prose_text: '' }),
    ).rejects.toThrow();
  });

  it('rejects invalid node_type', async () => {
    await expect(
      spec.fn({ node_type: 'opinion', facet: 'x', prose_text: 'y' }),
    ).rejects.toThrow();
  });

  it('stamps source_type=onboarding_turn on the provenance', async () => {
    await spec.fn({
      node_type: 'other',
      facet: 'note',
      prose_text: 'Loves rice.',
    });
    expect(deps.memoryService.noteFromAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: expect.objectContaining({ source_type: 'onboarding_turn' }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// household.upsert (Slice 2-s27)
// ---------------------------------------------------------------------------

describe('createHouseholdUpsertToolSpec', () => {
  let deps: OnboardingToolDeps;
  let spec: ReturnType<typeof createHouseholdUpsertToolSpec>;

  beforeEach(() => {
    deps = makeDeps();
    spec = createHouseholdUpsertToolSpec(makeCtx(), deps);
  });

  it('happy path: forwards the patch to householdsService.patchProfile and returns household_id', async () => {
    (deps.householdsService.patchProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: HOUSEHOLD_ID,
      cultural_identifiers: ['south_asian', 'malayali'],
      dietary_preferences: [],
      declared_allergens: [],
    });

    const result = await spec.fn({
      cultural_identifiers: ['south_asian', 'malayali'],
    });

    expect(result).toEqual({
      household_id: HOUSEHOLD_ID,
      was_existing: true,
    });
    expect(deps.householdsService.patchProfile).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      cultural_identifiers: ['south_asian', 'malayali'],
      dietary_preferences: undefined,
      declared_allergens: undefined,
    });
  });

  it('PATCH semantics: omitting fields preserves them (only set keys forwarded)', async () => {
    (deps.householdsService.patchProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: HOUSEHOLD_ID,
      cultural_identifiers: [],
      dietary_preferences: ['halal'],
      declared_allergens: [],
    });

    await spec.fn({ dietary_preferences: ['halal'] });

    const call = (deps.householdsService.patchProfile as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, Record<string, unknown>] | undefined;
    expect(call?.[1]).toEqual({
      cultural_identifiers: undefined,
      dietary_preferences: ['halal'],
      declared_allergens: undefined,
    });
  });

  it('empty array clears the field (passed through, not omitted)', async () => {
    (deps.householdsService.patchProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: HOUSEHOLD_ID,
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    });

    await spec.fn({ declared_allergens: [] });

    const call = (deps.householdsService.patchProfile as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, Record<string, unknown>] | undefined;
    expect(call?.[1].declared_allergens).toEqual([]);
  });

  it('vocabulary rejection from the service propagates as a tool error', async () => {
    (deps.householdsService.patchProfile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Unknown or inactive allergen tag: kryptonite'),
    );

    await expect(
      spec.fn({ declared_allergens: ['kryptonite'] }),
    ).rejects.toThrow(/Unknown or inactive/);
  });

  it('rejects invalid input via the schema (allergen tag too long)', async () => {
    await expect(
      spec.fn({ declared_allergens: ['a'.repeat(101)] }),
    ).rejects.toThrow();
    expect(deps.householdsService.patchProfile).not.toHaveBeenCalled();
  });

  it('declared_allergens_add routes to addAllergens instead of patchProfile', async () => {
    (deps.householdsService.addAllergens as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: HOUSEHOLD_ID,
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: ['celery', 'sesame'],
    });

    const result = await spec.fn({ declared_allergens_add: ['sesame'] });

    expect(result).toEqual({ household_id: HOUSEHOLD_ID, was_existing: true });
    expect(deps.householdsService.addAllergens).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      ['sesame'],
      { cultural_identifiers: undefined, dietary_preferences: undefined },
    );
    expect(deps.householdsService.patchProfile).not.toHaveBeenCalled();
  });

  it('rejects when both declared_allergens and declared_allergens_add are provided', async () => {
    await expect(
      spec.fn({ declared_allergens: ['peanut'], declared_allergens_add: ['sesame'] }),
    ).rejects.toThrow(/mutually exclusive/);
    expect(deps.householdsService.patchProfile).not.toHaveBeenCalled();
    expect(deps.householdsService.addAllergens).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Slice 2.5-s1 — seven new structured tools (stub factories)
// ===========================================================================
// Each factory is a deterministic-shaped success stub. The contract is the
// real test surface; these tests assert the factories register with the
// right name, validate input via Zod, and return a contract-valid shape.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('createHouseholdSetNameToolSpec (2.5-s5 wired)', () => {
  it('happy path: parses input, calls householdsService.setDisplayName, returns household_id', async () => {
    const deps = makeDeps();
    const spec = createHouseholdSetNameToolSpec(makeCtx(), deps);
    expect(spec.name).toBe('household.set_name');
    const result = await spec.fn({ display_name: 'The Menons' });
    expect(result).toEqual({ household_id: HOUSEHOLD_ID });
    expect(deps.householdsService.setDisplayName).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      'The Menons',
    );
  });

  it('rejects empty display_name and does not call setDisplayName', async () => {
    const deps = makeDeps();
    const spec = createHouseholdSetNameToolSpec(makeCtx(), deps);
    await expect(spec.fn({ display_name: '' })).rejects.toThrow();
    expect(deps.householdsService.setDisplayName).not.toHaveBeenCalled();
  });
});

describe('createAllergenDeclareToolSpec (2.5-s6 wired)', () => {
  it('child_id path: verifies household membership via getChild then declares', async () => {
    const deps = makeDeps();
    const spec = createAllergenDeclareToolSpec(makeCtx(), deps);
    expect(spec.name).toBe('allergen.declare');
    const result = (await spec.fn({
      child_id: CHILD_ID,
      allergen: 'peanut',
    })) as { child_allergen_id: string; was_existing: boolean };

    expect(deps.childrenService.getChild).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      childId: CHILD_ID,
    });
    expect(deps.childAllergensRepository.declare).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CHILD_ID,
      'peanut',
      'onboarding_declared',
    );
    expect(deps.childrenService.findChildIdByName).not.toHaveBeenCalled();
    expect(result.child_allergen_id).toBe(ALLERGEN_ROW_ID);
    expect(result.was_existing).toBe(false);
  });

  it('child_id path rejects when getChild throws (child not in this household)', async () => {
    const deps = makeDeps();
    vi.mocked(deps.childrenService.getChild).mockRejectedValueOnce(
      new Error('Child not found'),
    );
    const spec = createAllergenDeclareToolSpec(makeCtx(), deps);
    await expect(
      spec.fn({ child_id: CHILD_ID, allergen: 'peanut' }),
    ).rejects.toThrow(/Child not found/);
    expect(deps.childAllergensRepository.declare).not.toHaveBeenCalled();
  });

  it('child_name path: resolves via findChildIdByName then declares', async () => {
    const deps = makeDeps();
    const spec = createAllergenDeclareToolSpec(makeCtx(), deps);
    await spec.fn({ child_name: 'Layla', allergen: 'peanut' });

    expect(deps.childrenService.findChildIdByName).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      'Layla',
    );
    expect(deps.childAllergensRepository.declare).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CHILD_ID,
      'peanut',
      'onboarding_declared',
    );
  });

  it('throws when child_name does not match any child in the household', async () => {
    const deps = makeDeps();
    vi.mocked(deps.childrenService.findChildIdByName).mockResolvedValueOnce(null);
    const spec = createAllergenDeclareToolSpec(makeCtx(), deps);
    await expect(
      spec.fn({ child_name: 'Ghost', allergen: 'peanut' }),
    ).rejects.toThrow(/child "Ghost" not found/);
    expect(deps.childAllergensRepository.declare).not.toHaveBeenCalled();
  });

  it('passes was_existing through from the repo', async () => {
    const deps = makeDeps();
    vi.mocked(deps.childAllergensRepository.declare).mockResolvedValueOnce({
      child_allergen_id: ALLERGEN_ROW_ID,
      was_existing: true,
    });
    const spec = createAllergenDeclareToolSpec(makeCtx(), deps);
    const result = (await spec.fn({
      child_id: CHILD_ID,
      allergen: 'peanut',
    })) as { was_existing: boolean };
    expect(result.was_existing).toBe(true);
  });
});

describe('createDietaryDeclareToolSpec (2.5-s6 wired)', () => {
  it('household-scoped: calls repo with child_id=null', async () => {
    const deps = makeDeps();
    const spec = createDietaryDeclareToolSpec(makeCtx(), deps);
    expect(spec.name).toBe('dietary.declare');
    const result = (await spec.fn({
      child_id: null,
      tag: 'halal',
      enforcement: 'non_negotiable',
    })) as { dietary_id: string; was_existing: boolean };

    expect(deps.dietaryPreferencesRepository.declare).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      null,
      'halal',
      'non_negotiable',
      'onboarding_declared',
    );
    expect(result.dietary_id).toBe(DIETARY_ROW_ID);
    expect(result.was_existing).toBe(false);
  });

  it('child-scoped: calls repo with the supplied child_id', async () => {
    const deps = makeDeps();
    const spec = createDietaryDeclareToolSpec(makeCtx(), deps);
    await spec.fn({
      child_id: CHILD_ID,
      tag: 'vegetarian',
      enforcement: 'default',
    });

    expect(deps.dietaryPreferencesRepository.declare).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CHILD_ID,
      'vegetarian',
      'default',
      'onboarding_declared',
    );
  });

  it('validates tag against vocabularyService before calling the repo', async () => {
    const deps = makeDeps();
    vi.mocked(deps.vocabularyService.validateDietary).mockImplementationOnce(() => {
      throw new Error('Unknown dietary tag: bogus');
    });
    const spec = createDietaryDeclareToolSpec(makeCtx(), deps);
    await expect(
      spec.fn({ child_id: null, tag: 'bogus', enforcement: 'default' }),
    ).rejects.toThrow(/Unknown dietary tag/);
    expect(deps.vocabularyService.validateDietary).toHaveBeenCalledWith(['bogus']);
    expect(deps.dietaryPreferencesRepository.declare).not.toHaveBeenCalled();
  });
});

describe('createCuisineDeclareToolSpec (2.5-s7 wired)', () => {
  it('validates key against vocabularyService.validateCuisine', async () => {
    const deps = makeDeps();
    const spec = createCuisineDeclareToolSpec(makeCtx(), deps);
    expect(spec.name).toBe('cuisine.declare');
    await spec.fn({
      key: 'south_indian',
      label: 'South Indian',
      confidence: 80,
      presence: 70,
    });
    expect(deps.vocabularyService.validateCuisine).toHaveBeenCalledWith(['south_indian']);
  });

  it('writes via culturalPriorRepository.noteSuggested with enforcement passthrough', async () => {
    const deps = makeDeps();
    const spec = createCuisineDeclareToolSpec(makeCtx(), deps);
    const result = (await spec.fn({
      key: 'south_indian',
      label: 'South Indian',
      confidence: 80,
      presence: 70,
      enforcement: 'strong',
    })) as { prior_id: string; was_existing: boolean };

    expect(result.prior_id).toBe(PRIOR_ID);
    expect(result.was_existing).toBe(false);
    expect(deps.culturalPriorRepository.noteSuggested).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      key: 'south_indian',
      label: 'South Indian',
      confidence: 80,
      presence: 70,
      enforcement: 'strong',
    });
  });

  it('rejects unknown cuisine key (vocabulary validation throws)', async () => {
    const deps = makeDeps();
    vi.mocked(deps.vocabularyService.validateCuisine).mockImplementationOnce(() => {
      throw new Error('Unknown cuisine key: bogus');
    });
    const spec = createCuisineDeclareToolSpec(makeCtx(), deps);
    await expect(
      spec.fn({ key: 'bogus', label: 'Bogus', confidence: 50, presence: 50 }),
    ).rejects.toThrow(/Unknown cuisine key/);
    expect(deps.culturalPriorRepository.noteSuggested).not.toHaveBeenCalled();
  });

  it('returns was_existing passthrough', async () => {
    const deps = makeDeps();
    vi.mocked(deps.culturalPriorRepository.noteSuggested).mockResolvedValueOnce({
      id: PRIOR_ID,
      was_existing: true,
    });
    const spec = createCuisineDeclareToolSpec(makeCtx(), deps);
    const result = (await spec.fn({
      key: 'south_indian',
      label: 'South Indian',
      confidence: 80,
      presence: 70,
    })) as { was_existing: boolean };
    expect(result.was_existing).toBe(true);
  });
});

describe('createFoodPreferenceDeclareToolSpec (2.5-s7 wired)', () => {
  it('household-scoped: child_id and child_name both null → repo called with null', async () => {
    const deps = makeDeps();
    const spec = createFoodPreferenceDeclareToolSpec(makeCtx(), deps);
    expect(spec.name).toBe('food_preference.declare');
    const result = (await spec.fn({
      item: 'cilantro',
      valence: 'refuses',
    })) as { food_preference_id: string };
    expect(result.food_preference_id).toBe(FOOD_PREF_ROW_ID);
    expect(deps.foodPreferencesRepository.declare).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      null,
      'cilantro',
      'refuses',
      'soft',
      'onboarding_declared',
    );
    expect(deps.childrenService.getChild).not.toHaveBeenCalled();
    expect(deps.childrenService.findChildIdByName).not.toHaveBeenCalled();
  });

  it('with child_id: calls getChild for cross-household guard, then repo', async () => {
    const deps = makeDeps();
    const spec = createFoodPreferenceDeclareToolSpec(makeCtx(), deps);
    await spec.fn({
      child_id: CHILD_ID,
      item: 'mushrooms',
      valence: 'dislikes',
    });
    expect(deps.childrenService.getChild).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      childId: CHILD_ID,
    });
    expect(deps.foodPreferencesRepository.declare).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CHILD_ID,
      'mushrooms',
      'dislikes',
      'soft',
      'onboarding_declared',
    );
  });

  it('with child_name: resolves via findChildIdByName, then repo', async () => {
    const deps = makeDeps();
    const spec = createFoodPreferenceDeclareToolSpec(makeCtx(), deps);
    await spec.fn({
      child_name: 'Layla',
      item: 'ras malai',
      valence: 'loves',
    });
    expect(deps.childrenService.findChildIdByName).toHaveBeenCalledWith(HOUSEHOLD_ID, 'Layla');
    expect(deps.foodPreferencesRepository.declare).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CHILD_ID,
      'ras malai',
      'loves',
      'soft',
      'onboarding_declared',
    );
  });

  it('throws when child_name is not found in household', async () => {
    const deps = makeDeps();
    vi.mocked(deps.childrenService.findChildIdByName).mockResolvedValueOnce(null);
    const spec = createFoodPreferenceDeclareToolSpec(makeCtx(), deps);
    await expect(
      spec.fn({ child_name: 'Ghost', item: 'ras malai', valence: 'loves' }),
    ).rejects.toThrow(/child "Ghost" not found/);
    expect(deps.foodPreferencesRepository.declare).not.toHaveBeenCalled();
  });

  it('does NOT log item plaintext (item: REDACTED in log payload)', async () => {
    const logger = makeLogger();
    const ctx = { householdId: HOUSEHOLD_ID, userId: USER_ID, logger };
    const deps = makeDeps();
    const spec = createFoodPreferenceDeclareToolSpec(ctx, deps);
    await spec.fn({ item: 'ras malai', valence: 'loves' });

    const calls = vi.mocked(logger.info).mock.calls as unknown as Array<[unknown, string]>;
    const declareCall = calls.find(
      (c) => (c[0] as { action?: string }).action === 'food_preference.declare',
    );
    expect(declareCall).toBeDefined();
    expect((declareCall?.[0] as { item: string }).item).toBe('REDACTED');
    expect(JSON.stringify(declareCall?.[0])).not.toContain('ras malai');
  });

  it('was_existing passthrough from repo', async () => {
    const deps = makeDeps();
    vi.mocked(deps.foodPreferencesRepository.declare).mockResolvedValueOnce({
      food_preference_id: FOOD_PREF_ROW_ID,
      was_existing: true,
    });
    const spec = createFoodPreferenceDeclareToolSpec(makeCtx(), deps);
    const result = (await spec.fn({
      item: 'cilantro',
      valence: 'refuses',
    })) as { was_existing: boolean };
    expect(result.was_existing).toBe(true);
  });

  it('rejects unknown valence at the schema layer', async () => {
    const spec = createFoodPreferenceDeclareToolSpec(makeCtx(), makeDeps());
    await expect(spec.fn({ item: 'cilantro', valence: 'hates' })).rejects.toThrow();
  });
});

describe('createFavoriteLunchAddToolSpec (2.6-s1 — writes to recipes catalog)', () => {
  it('happy path: calls recipesRepository.declareForHousehold and maps to output schema', async () => {
    const deps = makeDeps();
    const spec = createFavoriteLunchAddToolSpec(makeCtx(), deps);
    expect(spec.name).toBe('favorite_lunch.add');

    const result = (await spec.fn({ item: 'Paratha roll' })) as {
      favorite_lunch_id: string;
      position: number;
    };

    expect(deps.recipesRepository.declareForHousehold).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      'Paratha roll',
    );
    expect(result.favorite_lunch_id).toBe(FAV_LUNCH_ROW_ID);
    // position derived from countDeclaredFavorites (mocked to 1) → max(0, 1-1) = 0
    expect(result.position).toBe(0);
  });

  it('uses explicit position when the agent supplies one', async () => {
    const deps = makeDeps();
    const spec = createFavoriteLunchAddToolSpec(makeCtx(), deps);

    const result = (await spec.fn({ item: 'Wrap', position: 7 })) as { position: number };

    expect(deps.recipesRepository.declareForHousehold).toHaveBeenCalledWith(HOUSEHOLD_ID, 'Wrap');
    expect(result.position).toBe(7);
  });

  it('rejects empty item at the Zod boundary (M5 chip must have a label)', async () => {
    const spec = createFavoriteLunchAddToolSpec(makeCtx(), makeDeps());
    await expect(spec.fn({ item: '' })).rejects.toThrow();
  });
});

describe('createRuleSetToolSpec (2.5-s7 wired)', () => {
  it('non-custom rule_type calls repo with customLabel=null', async () => {
    const deps = makeDeps();
    const spec = createRuleSetToolSpec(makeCtx(), deps);
    expect(spec.name).toBe('rule.set');
    const result = (await spec.fn({ rule_type: 'no_pork' })) as {
      household_rule_id: string;
      was_existing: boolean;
    };
    expect(result.household_rule_id).toBe(RULE_ROW_ID);
    expect(result.was_existing).toBe(false);
    expect(deps.householdRulesRepository.declare).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      'no_pork',
      null,
      'strong',
      'onboarding_declared',
    );
  });

  it('custom rule_type calls repo with the label string', async () => {
    const deps = makeDeps();
    const spec = createRuleSetToolSpec(makeCtx(), deps);
    await spec.fn({ rule_type: 'custom', custom_label: 'no peanut butter on Fridays' });
    expect(deps.householdRulesRepository.declare).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      'custom',
      'no peanut butter on Fridays',
      'strong',
      'onboarding_declared',
    );
  });

  it('custom rule without label is rejected at the schema layer', async () => {
    const spec = createRuleSetToolSpec(makeCtx(), makeDeps());
    await expect(spec.fn({ rule_type: 'custom' })).rejects.toThrow();
  });

  it('non-custom rule with custom_label is rejected at the schema layer', async () => {
    const spec = createRuleSetToolSpec(makeCtx(), makeDeps());
    // Schema layer should reject — confirm via .refine signal. The repo also
    // rejects this defensively (covered in household-rules.repository.test).
    // Either layer can reject; this asserts at least one does.
    // (DBG: 2.5-s1 had the schema-level refine, kept active here.)
    // No assertion on which layer — just that the call fails.
    await expect(
      spec.fn({ rule_type: 'no_pork', custom_label: 'foo' }),
    ).rejects.toThrow();
  });

  it('does NOT log custom_label plaintext for custom rules', async () => {
    const logger = makeLogger();
    const ctx = { householdId: HOUSEHOLD_ID, userId: USER_ID, logger };
    const deps = makeDeps();
    const spec = createRuleSetToolSpec(ctx, deps);
    await spec.fn({
      rule_type: 'custom',
      custom_label: 'no sattvic-violating foods on Tuesdays',
    });
    const calls = vi.mocked(logger.info).mock.calls as unknown as Array<[unknown, string]>;
    const declareCall = calls.find(
      (c) => (c[0] as { action?: string }).action === 'rule.set',
    );
    expect(declareCall).toBeDefined();
    expect((declareCall?.[0] as { custom_label: string }).custom_label).toBe('REDACTED');
    expect(JSON.stringify(declareCall?.[0])).not.toContain('sattvic');
  });

  it('does NOT redact for non-custom rules (rule_type is structured)', async () => {
    const logger = makeLogger();
    const ctx = { householdId: HOUSEHOLD_ID, userId: USER_ID, logger };
    const deps = makeDeps();
    const spec = createRuleSetToolSpec(ctx, deps);
    await spec.fn({ rule_type: 'no_pork' });
    const calls = vi.mocked(logger.info).mock.calls as unknown as Array<[unknown, string]>;
    const declareCall = calls.find(
      (c) => (c[0] as { action?: string }).action === 'rule.set',
    );
    expect((declareCall?.[0] as { custom_label: string | null }).custom_label).toBeNull();
  });

  it('was_existing passthrough', async () => {
    const deps = makeDeps();
    vi.mocked(deps.householdRulesRepository.declare).mockResolvedValueOnce({
      household_rule_id: RULE_ROW_ID,
      was_existing: true,
    });
    const spec = createRuleSetToolSpec(makeCtx(), deps);
    const result = (await spec.fn({ rule_type: 'no_pork' })) as { was_existing: boolean };
    expect(result.was_existing).toBe(true);
  });
});

describe('createOnboardingToolSpecs (2.5-s4)', () => {
  it('exposes all 11 onboarding tools to the agent', () => {
    const specs = createOnboardingToolSpecs(makeCtx(), makeDeps());
    expect(specs).toHaveLength(11);
    const names = specs.map((s) => s.name).sort();
    expect(names).toEqual(
      [
        'allergen.declare',
        'child.upsert',
        'cuisine.declare',
        'cultural.note',
        'dietary.declare',
        'favorite_lunch.add',
        'food_preference.declare',
        'household.set_name',
        'household.upsert',
        'memory.note',
        'rule.set',
      ].sort(),
    );
  });

  it('still includes the four originally wired tools (child/cultural/memory/household upsert)', () => {
    const specs = createOnboardingToolSpecs(makeCtx(), makeDeps());
    const names = new Set(specs.map((s) => s.name));
    expect(names.has('child.upsert')).toBe(true);
    expect(names.has('cultural.note')).toBe(true);
    expect(names.has('memory.note')).toBe(true);
    expect(names.has('household.upsert')).toBe(true);
  });
});

describe('memory.note schema narrowing (2.5-s2)', () => {
  it("rejects node_type='preference' at the Zod boundary", async () => {
    const spec = createMemoryNoteToolSpec(makeCtx(), makeDeps());
    await expect(
      spec.fn({
        node_type: 'preference',
        facet: 'palate',
        prose_text: 'Loves yogurt.',
      }),
    ).rejects.toThrow();
  });

  it("rejects node_type='allergy' at the Zod boundary", async () => {
    const spec = createMemoryNoteToolSpec(makeCtx(), makeDeps());
    await expect(
      spec.fn({
        node_type: 'allergy',
        facet: 'declared_allergen',
        prose_text: 'Layla is peanut-allergic.',
      }),
    ).rejects.toThrow();
  });
});
