import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  createChildUpsertToolSpec,
  createCulturalNoteToolSpec,
  createMemoryNoteToolSpec,
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

function makeDeps(overrides: Partial<OnboardingToolDeps> = {}): OnboardingToolDeps {
  return {
    childrenService: {
      upsertByName: vi.fn().mockResolvedValue({
        child: { id: CHILD_ID, name: 'Layla' },
        was_existing: false,
      }),
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
    vocabularyService: {
      validateAllergens: vi.fn((keys: string[]) => [...new Set(keys)]),
      validateCultural: vi.fn((keys: string[]) => [...new Set(keys)]),
      validateDietary: vi.fn((keys: string[]) => [...new Set(keys)]),
      expandImpliesClosure: vi.fn((keys: string[]) => keys),
    } as unknown as OnboardingToolDeps['vocabularyService'],
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

  it('validates allergens against vocabulary before persisting', async () => {
    await spec.fn({
      name: 'Layla',
      age_band: 'child',
      declared_allergens: ['peanut'],
      cultural_identifiers: [],
      dietary_preferences: [],
    });
    expect(deps.vocabularyService.validateAllergens).toHaveBeenCalledWith(['peanut']);
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

  it('propagates vocabulary validation errors so the agent can recover', async () => {
    vi.mocked(deps.vocabularyService.validateAllergens).mockImplementation(() => {
      throw new Error('Unknown allergen tag: unicorn');
    });
    await expect(
      spec.fn({
        name: 'Layla',
        age_band: 'child',
        declared_allergens: ['unicorn'],
        cultural_identifiers: [],
        dietary_preferences: [],
      }),
    ).rejects.toThrowError(/Unknown allergen/);
    expect(deps.childrenService.upsertByName).not.toHaveBeenCalled();
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

  it('happy path: persists a suggested prior', async () => {
    const result = await spec.fn({
      key: 'south_asian',
      label: 'South Asian',
      confidence: 80,
      presence: 70,
    });
    expect(result).toEqual({ prior_id: PRIOR_ID, was_existing: false });
    expect(deps.culturalPriorRepository.noteSuggested).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      key: 'south_asian',
      label: 'South Asian',
      confidence: 80,
      presence: 70,
    });
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
      node_type: 'allergy',
      facet: 'declared_allergen',
      prose_text: 'Layla is peanut-allergic.',
      subject_child_id: CHILD_ID,
    });
    expect(deps.memoryService.noteFromAgent).toHaveBeenCalledWith(
      expect.objectContaining({ subjectChildId: CHILD_ID }),
    );
  });

  it('uses the agent-provided confidence when set', async () => {
    await spec.fn({
      node_type: 'preference',
      facet: 'palate',
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
      node_type: 'preference',
      facet: 'palate',
      prose_text: 'Loves rice.',
    });
    expect(deps.memoryService.noteFromAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: expect.objectContaining({ source_type: 'onboarding_turn' }),
      }),
    );
  });
});
