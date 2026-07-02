import { describe, it, expect, vi } from 'vitest';
import {
  assembleRecipeCandidateSlate,
  loadHighActivityExtraProposalsForHousehold,
  loadPantrySnapshotForHousehold,
  loadRecipeCandidatesForHousehold,
} from './planner-context.loader.js';
import type { PlanDayContextRepository } from '../modules/plans/plan-day-context.repository.js';
import type { PlannerBagComposition } from '../agents/orchestrator.js';
import type {
  CandidateSlateRow,
  RecipesRepository,
} from '../modules/recipe/recipes.repository.js';
import type { PantryService } from '../modules/pantry/pantry.service.js';
import type { ChildSignalOutput, PlanDayContext } from '@hivekitchen/types';
import { NotImplementedError } from '../common/errors.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_A = '22222222-2222-4222-8222-222222222222';
const CHILD_B = '33333333-3333-4333-8333-333333333333';

// weekOf = 2026-11-02 (Monday). Expected window: 2026-11-02..2026-11-06 (Fri).
const WEEK_OF = '2026-11-02';

function makeOverride(childId: string, date: string, type: PlanDayContext['context_type']): PlanDayContext {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    plan_slot_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    child_id: childId,
    household_id: HOUSEHOLD_ID,
    override_date: date,
    context_type: type,
    is_lumi_proposed: false,
    confirmed_at: null,
    reverted_at: null,
    created_at: '2026-11-01T10:00:00.000Z',
    updated_at: '2026-11-01T10:00:00.000Z',
  };
}

function makeRepo(overrides: PlanDayContext[]): PlanDayContextRepository {
  return {
    findActiveByHousehold: vi.fn().mockResolvedValue(overrides),
  } as unknown as PlanDayContextRepository;
}

const extraOffCompositions: PlannerBagComposition[] = [
  { child_id: CHILD_A, child_name: 'Asha', snack: true, extra: false },
  { child_id: CHILD_B, child_name: 'Kai', snack: true, extra: false },
];

describe('loadHighActivityExtraProposalsForHousehold', () => {
  it('returns empty when all children have Extra ON', async () => {
    const repo = makeRepo([makeOverride(CHILD_A, '2026-11-04', 'sport_practice')]);
    const comps: PlannerBagComposition[] = [
      { child_id: CHILD_A, child_name: 'Asha', snack: true, extra: true },
    ];
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, comps, repo);
    expect(result).toEqual([]);
  });

  it('returns empty when no active overrides for the household', async () => {
    const repo = makeRepo([]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toEqual([]);
  });

  it('includes sport_practice and field_trip overrides within the Mon..Fri window', async () => {
    const repo = makeRepo([
      makeOverride(CHILD_A, '2026-11-04', 'sport_practice'), // Wednesday ✓
      makeOverride(CHILD_B, '2026-11-06', 'field_trip'),     // Friday ✓
    ]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ child_id: CHILD_A, override_date: '2026-11-04', context_type: 'sport_practice' });
    expect(result[1]).toMatchObject({ child_id: CHILD_B, override_date: '2026-11-06', context_type: 'field_trip' });
  });

  it('excludes Saturday overrides — window ends at Friday', async () => {
    const saturday = '2026-11-07';
    const repo = makeRepo([makeOverride(CHILD_A, saturday, 'sport_practice')]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toEqual([]);
  });

  it('excludes overrides before the plan week', async () => {
    const priorSunday = '2026-11-01';
    const repo = makeRepo([makeOverride(CHILD_A, priorSunday, 'field_trip')]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toEqual([]);
  });

  it('excludes overrides after the plan week', async () => {
    const nextMonday = '2026-11-09';
    const repo = makeRepo([makeOverride(CHILD_A, nextMonday, 'sport_practice')]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toEqual([]);
  });

  it('excludes non-high-activity override types', async () => {
    const repo = makeRepo([
      makeOverride(CHILD_A, '2026-11-04', 'half_day'),
      makeOverride(CHILD_A, '2026-11-04', 'post_dentist'),
      makeOverride(CHILD_A, '2026-11-04', 'test_day'),
    ]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toEqual([]);
  });

  it('excludes overrides for children whose Extra is ON', async () => {
    const repo = makeRepo([makeOverride(CHILD_A, '2026-11-04', 'field_trip')]);
    const comps: PlannerBagComposition[] = [
      { child_id: CHILD_A, child_name: 'Asha', snack: true, extra: true }, // Extra ON
    ];
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, comps, repo);
    expect(result).toEqual([]);
  });

  it('excludes children with null extra — null is not Extra-OFF', async () => {
    const repo = makeRepo([makeOverride(CHILD_A, '2026-11-04', 'sport_practice')]);
    const comps = [
      { child_id: CHILD_A, child_name: 'Asha', snack: true, extra: null as unknown as boolean },
    ] as PlannerBagComposition[];
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, comps, repo);
    expect(result).toEqual([]);
  });

  it('includes Monday and Friday boundary dates', async () => {
    const repo = makeRepo([
      makeOverride(CHILD_A, '2026-11-02', 'sport_practice'), // Monday (weekOf boundary)
      makeOverride(CHILD_B, '2026-11-06', 'field_trip'),     // Friday (+4 boundary)
    ]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toHaveLength(2);
  });

  it('includes child_name from bagCompositions in the proposal', async () => {
    const repo = makeRepo([makeOverride(CHILD_A, '2026-11-04', 'sport_practice')]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result[0]?.child_name).toBe('Asha');
  });

  it('deduplicates proposals for the same (child_id, override_date) — first match wins', async () => {
    const repo = makeRepo([
      makeOverride(CHILD_A, '2026-11-04', 'sport_practice'),
      makeOverride(CHILD_A, '2026-11-04', 'field_trip'), // same child, same date — duplicate
    ]);
    const result = await loadHighActivityExtraProposalsForHousehold(HOUSEHOLD_ID, WEEK_OF, extraOffCompositions, repo);
    expect(result).toHaveLength(1);
    expect(result[0]?.context_type).toBe('sport_practice');
  });
});

// ===========================================================================
// Story 3-S36 — pantry snapshot pre-load
// ===========================================================================

describe('loadPantrySnapshotForHousehold', () => {
  it('maps pantry item names to on_hand', async () => {
    const pantryService = {
      read: vi.fn().mockResolvedValue({
        items: [
          { id: 'a', name: 'basmati rice', quantity: '1', tags: [] },
          { id: 'b', name: 'chickpeas', quantity: '1', tags: [] },
        ],
      }),
    } as unknown as PantryService;

    const result = await loadPantrySnapshotForHousehold(HOUSEHOLD_ID, pantryService);

    expect(result).toEqual({ on_hand: ['basmati rice', 'chickpeas'] });
  });

  it('drops empty names', async () => {
    const pantryService = {
      read: vi.fn().mockResolvedValue({
        items: [
          { id: 'a', name: '', quantity: '1', tags: [] },
          { id: 'b', name: 'paneer', quantity: '1', tags: [] },
        ],
      }),
    } as unknown as PantryService;

    const result = await loadPantrySnapshotForHousehold(HOUSEHOLD_ID, pantryService);

    expect(result).toEqual({ on_hand: ['paneer'] });
  });

  it('returns an empty snapshot when the pantry service is unimplemented (AC5 fallback)', async () => {
    const pantryService = {
      read: vi.fn().mockRejectedValue(new NotImplementedError('pantry.read')),
    } as unknown as PantryService;

    const result = await loadPantrySnapshotForHousehold(HOUSEHOLD_ID, pantryService);

    expect(result).toEqual({ on_hand: [] });
  });
});

// ===========================================================================
// Story 3-S36 — candidate recipe slate
// ===========================================================================

function makeSlateRow(overrides: Partial<CandidateSlateRow>): CandidateSlateRow {
  return {
    id: overrides.id ?? 'rec-1',
    canonical_name: overrides.canonical_name ?? 'Chana Masala Wraps',
    cuisine_tags: overrides.cuisine_tags ?? ['indian'],
    allergen_flags: overrides.allergen_flags ?? [],
    applicable_slots: overrides.applicable_slots ?? ['main'],
    ingredient_keys: overrides.ingredient_keys ?? ['chickpea', 'wrap'],
    confidence_score: overrides.confidence_score ?? 70,
    is_household_favorite: overrides.is_household_favorite ?? false,
    use_count: overrides.use_count ?? 0,
  };
}

describe('assembleRecipeCandidateSlate', () => {
  it('returns empty groups for no rows', () => {
    expect(assembleRecipeCandidateSlate([], new Set())).toEqual({ main: [], snack: [], extra: [] });
  });

  it('groups a recipe into every applicable slot and projects key_ingredients', () => {
    const slate = assembleRecipeCandidateSlate(
      [makeSlateRow({ applicable_slots: ['main', 'snack'], ingredient_keys: ['chickpea', 'wrap'] })],
      new Set(),
    );
    expect(slate.main).toHaveLength(1);
    expect(slate.snack).toHaveLength(1);
    expect(slate.extra).toHaveLength(0);
    expect(slate.main[0]).toEqual({
      id: 'rec-1',
      name: 'Chana Masala Wraps',
      cuisine_tags: ['indian'],
      allergen_flags: [],
      key_ingredients: ['chickpea', 'wrap'],
      confidence: 70,
    });
  });

  it('defaults applicable_slots to main when the row has none', () => {
    const slate = assembleRecipeCandidateSlate([makeSlateRow({ applicable_slots: [] })], new Set());
    expect(slate.main).toHaveLength(1);
    expect(slate.snack).toHaveLength(0);
  });

  it('caps key_ingredients at 6', () => {
    const slate = assembleRecipeCandidateSlate(
      [makeSlateRow({ ingredient_keys: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })],
      new Set(),
    );
    expect(slate.main[0]?.key_ingredients).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('ranks favourite > liked-signal > confidence > use_count > name', () => {
    const rows = [
      makeSlateRow({ id: '1', canonical_name: 'Zeta', confidence_score: 50 }),
      makeSlateRow({ id: '2', canonical_name: 'Alpha', confidence_score: 50 }),
      makeSlateRow({ id: '3', canonical_name: 'Liked Dish', confidence_score: 50 }),
      makeSlateRow({ id: '4', canonical_name: 'Fav Dish', confidence_score: 10, is_household_favorite: true }),
      makeSlateRow({ id: '5', canonical_name: 'High Conf', confidence_score: 99 }),
    ];
    const liked = new Set(['liked dish']);
    const slate = assembleRecipeCandidateSlate(rows, liked);
    expect(slate.main.map((c) => c.name)).toEqual([
      'Fav Dish',   // favourite wins despite low confidence
      'Liked Dish', // liked-signal next
      'High Conf',  // then confidence desc
      'Alpha',      // tie on confidence → name asc
      'Zeta',
    ]);
  });

  it('caps each slot group at 12 candidates', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeSlateRow({ id: `r${String(i)}`, canonical_name: `Dish ${String(i).padStart(2, '0')}` }),
    );
    const slate = assembleRecipeCandidateSlate(rows, new Set());
    expect(slate.main).toHaveLength(12);
  });
});

describe('loadRecipeCandidatesForHousehold', () => {
  it('reads the slate and folds child-signal liked bias into ranking', async () => {
    const rows = [
      makeSlateRow({ id: '1', canonical_name: 'Plain Dish', confidence_score: 80 }),
      makeSlateRow({ id: '2', canonical_name: 'Loved Wrap', confidence_score: 40 }),
    ];
    const recipesRepository = {
      findCandidateSlateForHousehold: vi.fn().mockResolvedValue(rows),
    } as unknown as RecipesRepository;

    const childSignals: ChildSignalOutput = {
      per_child: [
        {
          child_id: CHILD_A,
          child_name: 'Asha',
          liked: [{ recipe_id: '2', recipe_name: 'Loved Wrap', slot_kind: 'main', count: 3, last_at: '2026-06-01' }],
          disliked: [],
        },
      ],
      family_liked: [],
    };

    const slate = await loadRecipeCandidatesForHousehold(HOUSEHOLD_ID, recipesRepository, childSignals);

    // 'Loved Wrap' ranks first despite lower confidence — liked-signal bias.
    expect(slate.main.map((c) => c.name)).toEqual(['Loved Wrap', 'Plain Dish']);
  });

  it('works with no child signals (ranks by confidence)', async () => {
    const rows = [
      makeSlateRow({ id: '1', canonical_name: 'Low', confidence_score: 30 }),
      makeSlateRow({ id: '2', canonical_name: 'High', confidence_score: 90 }),
    ];
    const recipesRepository = {
      findCandidateSlateForHousehold: vi.fn().mockResolvedValue(rows),
    } as unknown as RecipesRepository;

    const slate = await loadRecipeCandidatesForHousehold(HOUSEHOLD_ID, recipesRepository, undefined);

    expect(slate.main.map((c) => c.name)).toEqual(['High', 'Low']);
  });
});
