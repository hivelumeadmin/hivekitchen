import type { ChildSignalOutput, Weekday } from '@hivekitchen/types';
import type { EvalFixture } from './planner-eval.harness.js';
import { planComposeTurn } from './planner-eval.harness.js';
import {
  CHILD,
  HH,
  REQUEST_ID,
  WEEK_OF,
  composeInput,
  culturalPrior,
  day,
  extraSlot,
  makeCandidate,
  makeChild,
  makeKitchenMap,
  mainSlot,
} from './planner-eval.builders.js';

// ===========================================================================
// Story 3.5-s1 — the 9 ratified golden-set fixtures (Menon 2026-06-24).
// Each fixture's stubResponses stand in for the model's emissions; runFixture
// drives the REAL orchestrator/plan.compose path against them.
// ===========================================================================

const HAPPY_BUDGET = { maxTurns: 1, maxPlanComposeCalls: 1, maxPromptTokens: 100, maxCompletionTokens: 50 };

function base(overrides: Partial<EvalFixture['options']> = {}): EvalFixture['options'] {
  return { householdId: HH, weekOf: WEEK_OF, requestId: REQUEST_ID, ...overrides };
}

// 1 — Anglo single-child, no allergens, one day. Exercises <child_signals>.
const childSignals: ChildSignalOutput = {
  per_child: [
    {
      child_id: CHILD.a,
      child_name: 'Aarav',
      liked: [{ recipe_id: CHILD.a, recipe_name: 'Turkey & Cheese Pinwheel', slot_kind: 'main', count: 3, last_at: '2026-05-01' }],
      disliked: [],
    },
  ],
  family_liked: [],
};

const anglo: EvalFixture = {
  id: 'anglo-single-child',
  options: base({
    kitchenMap: makeKitchenMap([makeChild(CHILD.a, 'Aarav')]),
    childSignals,
    recipeCandidates: {
      main: [makeCandidate('Turkey & Cheese Pinwheel', 'Turkey & Cheese Pinwheel')],
      snack: [],
      extra: [],
    },
  }),
  recipeIngredients: { 'Turkey & Cheese Pinwheel': ['turkey', 'cheese', 'tortilla'] },
  stubResponses: [
    planComposeTurn(
      composeInput({
        mains: [{ sequence: 1, recipe_id: 'm1' }],
        days: [day('monday', [mainSlot(1, [{ child_id: CHILD.a, portion_size: 'regular' }])])],
      }),
    ),
  ],
  expected: { activeSlotsByChild: { [CHILD.a]: ['main'] }, declaredAllergensByChild: { [CHILD.a]: [] } },
  budget: HAPPY_BUDGET,
};

// 2 — Allergen-fork: only child A is peanut-allergic; shared Main, A's variation
// removes the peanut component. B (no allergen) eats the unmodified base.
const allergenFork: EvalFixture = {
  id: 'allergen-fork-peanut',
  options: base({
    kitchenMap: makeKitchenMap([
      makeChild(CHILD.a, 'Aarav', { allergens: ['peanut'] }),
      makeChild(CHILD.b, 'Mira'),
    ]),
    recipeCandidates: {
      main: [makeCandidate('Chicken Peanut Curry Rice', 'Chicken Peanut Curry Rice')],
      snack: [],
      extra: [],
    },
  }),
  recipeIngredients: { 'Chicken Peanut Curry Rice': ['chicken', 'peanut paste', 'rice'] },
  stubResponses: [
    planComposeTurn(
      composeInput({
        mains: [{ sequence: 2, recipe_id: 'm1' }],
        days: [
          day('wednesday', [
            mainSlot(2, [
              { child_id: CHILD.a, removals: ['peanut paste'], add_ons: ['coconut cream'], notes: 'peanut-free fork' },
              { child_id: CHILD.b, portion_size: 'small' },
            ]),
          ]),
        ],
      }),
    ),
  ],
  expected: {
    activeSlotsByChild: { [CHILD.a]: ['main'], [CHILD.b]: ['main'] },
    declaredAllergensByChild: { [CHILD.a]: ['peanut'], [CHILD.b]: [] },
  },
  budget: HAPPY_BUDGET,
};

// 3 — Halal + vegetarian intersection. No allergens; exercises cultural context.
const halalVeg: EvalFixture = {
  id: 'halal-vegetarian-intersection',
  options: base({
    kitchenMap: makeKitchenMap(
      [makeChild(CHILD.a, 'Yusuf', { dietary: ['halal', 'vegetarian'] })],
      { dietary: ['halal', 'vegetarian'], cultural: [culturalPrior('halal', 'Halal')] },
    ),
    recipeCandidates: {
      main: [makeCandidate('Paneer Veggie Wrap', 'Paneer Veggie Wrap')],
      snack: [],
      extra: [],
    },
  }),
  recipeIngredients: { 'Paneer Veggie Wrap': ['paneer', 'peppers', 'tortilla'] },
  stubResponses: [
    planComposeTurn(
      composeInput({
        mains: [{ sequence: 1, recipe_id: 'm1' }],
        days: [day('monday', [mainSlot(1, [{ child_id: CHILD.a }])])],
      }),
    ),
  ],
  expected: { activeSlotsByChild: { [CHILD.a]: ['main'] }, declaredAllergensByChild: { [CHILD.a]: [] } },
  budget: HAPPY_BUDGET,
};

// 4 — Partial week (mid-week compose). Two days, distinct Mains.
const partialWeek: EvalFixture = {
  id: 'partial-week-mon-tue',
  options: base({
    kitchenMap: makeKitchenMap([makeChild(CHILD.a, 'Aarav')]),
    plannedDays: ['monday', 'tuesday'] as Weekday[],
    recipeCandidates: {
      main: [
        makeCandidate('Turkey & Cheese Pinwheel', 'Turkey & Cheese Pinwheel'),
        makeCandidate('Mini Veggie Quesadilla', 'Mini Veggie Quesadilla'),
      ],
      snack: [],
      extra: [],
    },
  }),
  recipeIngredients: {
    'Turkey & Cheese Pinwheel': ['turkey', 'cheese', 'tortilla'],
    'Mini Veggie Quesadilla': ['cheese', 'beans', 'tortilla'],
  },
  stubResponses: [
    planComposeTurn(
      composeInput({
        mains: [
          { sequence: 1, recipe_id: 'm1' },
          { sequence: 2, recipe_id: 'm2' },
        ],
        days: [
          day('monday', [mainSlot(1, [{ child_id: CHILD.a }])]),
          day('tuesday', [mainSlot(2, [{ child_id: CHILD.a }])]),
        ],
      }),
    ),
  ],
  expected: { activeSlotsByChild: { [CHILD.a]: ['main'] }, declaredAllergensByChild: { [CHILD.a]: [] } },
  budget: HAPPY_BUDGET,
};

// 5 — Cold candidate slate: the slate is EMPTY. Story 3.5-s5 moved recipe
// acquisition out of the model loop into the ensureCandidateCoverage pre-flight
// (which calls RecipeService.search directly — the harness double returns
// nothing, and recipeAgent is null, so no augmentation occurs). The model still
// makes ONE forced plan.compose call, composing with the recipe's NAME (not a
// handle); the empty handle index falls through to findIdByName, exactly as it
// does for a runtime search/discover result.
const coldSlate: EvalFixture = {
  id: 'cold-slate-fallback',
  options: base({
    kitchenMap: makeKitchenMap([makeChild(CHILD.a, 'Aarav')]),
    recipeCandidates: { main: [], snack: [], extra: [] },
  }),
  recipeIngredients: { 'Hummus & Pita Box': ['hummus', 'pita', 'carrots'] },
  stubResponses: [
    planComposeTurn(
      composeInput({
        mains: [{ sequence: 1, recipe_id: 'Hummus & Pita Box' }],
        days: [day('monday', [mainSlot(1, [{ child_id: CHILD.a }])])],
      }),
      { promptTokens: 100, completionTokens: 50 },
      'call_compose_cold',
    ),
  ],
  expected: { activeSlotsByChild: { [CHILD.a]: ['main'] }, declaredAllergensByChild: { [CHILD.a]: [] } },
  budget: HAPPY_BUDGET,
};

// 6 — Sovereignty alternating: rotate tradition by day. Two days, distinct Mains.
const sovereignty: EvalFixture = {
  id: 'sovereignty-alternating',
  options: base({
    kitchenMap: makeKitchenMap([makeChild(CHILD.a, 'Amara')], {
      cultural: [culturalPrior('halal', 'Halal'), culturalPrior('east_african', 'East African')],
    }),
    sovereigntyMode: 'alternating',
    recipeCandidates: {
      main: [
        makeCandidate('Chicken Suqaar Rice', 'Chicken Suqaar Rice'),
        makeCandidate('Lentil Sambusa Plate', 'Lentil Sambusa Plate'),
      ],
      snack: [],
      extra: [],
    },
  }),
  recipeIngredients: {
    'Chicken Suqaar Rice': ['chicken', 'rice', 'peppers'],
    'Lentil Sambusa Plate': ['lentils', 'pastry', 'spinach'],
  },
  stubResponses: [
    planComposeTurn(
      composeInput({
        mains: [
          { sequence: 1, recipe_id: 'm1' },
          { sequence: 2, recipe_id: 'm2' },
        ],
        days: [
          day('monday', [mainSlot(1, [{ child_id: CHILD.a }])]),
          day('tuesday', [mainSlot(2, [{ child_id: CHILD.a }])]),
        ],
      }),
    ),
  ],
  expected: { activeSlotsByChild: { [CHILD.a]: ['main'] }, declaredAllergensByChild: { [CHILD.a]: [] } },
  budget: HAPPY_BUDGET,
};

// 7 — High-activity Extra proposal: extra slot proposed on a sport-practice day.
const highActivityExtra: EvalFixture = {
  id: 'high-activity-extra-proposal',
  options: base({
    kitchenMap: makeKitchenMap([makeChild(CHILD.a, 'Aarav', { extra: true })]),
    extraProposals: [
      { child_id: CHILD.a, child_name: 'Aarav', override_date: WEEK_OF, context_type: 'sport_practice' },
    ],
    recipeCandidates: {
      main: [makeCandidate('Turkey & Cheese Pinwheel', 'Turkey & Cheese Pinwheel')],
      snack: [],
      extra: [makeCandidate('Fruit & Yogurt Cup', 'Fruit & Yogurt Cup')],
    },
  }),
  recipeIngredients: {
    'Turkey & Cheese Pinwheel': ['turkey', 'cheese', 'tortilla'],
    'Fruit & Yogurt Cup': ['yogurt', 'berries'],
  },
  stubResponses: [
    planComposeTurn(
      composeInput({
        mains: [{ sequence: 1, recipe_id: 'm1' }],
        days: [
          day('monday', [
            mainSlot(1, [{ child_id: CHILD.a }]),
            extraSlot('e1', 'protein_boost', [{ child_id: CHILD.a }]),
          ]),
        ],
      }),
    ),
  ],
  expected: {
    activeSlotsByChild: { [CHILD.a]: ['main', 'extra'] },
    declaredAllergensByChild: { [CHILD.a]: [] },
  },
  budget: HAPPY_BUDGET,
};

// 8 — Banned recipe present: planner must not place it.
const bannedRecipe: EvalFixture = {
  id: 'banned-recipe-avoided',
  options: base({
    kitchenMap: makeKitchenMap([makeChild(CHILD.a, 'Aarav')], { banned: ['Ham Sandwich'] }),
    recipeCandidates: {
      main: [makeCandidate('Turkey & Cheese Pinwheel', 'Turkey & Cheese Pinwheel')],
      snack: [],
      extra: [],
    },
  }),
  recipeIngredients: { 'Turkey & Cheese Pinwheel': ['turkey', 'cheese', 'tortilla'] },
  stubResponses: [
    planComposeTurn(
      composeInput({
        mains: [{ sequence: 1, recipe_id: 'm1' }],
        days: [day('monday', [mainSlot(1, [{ child_id: CHILD.a }])])],
      }),
    ),
  ],
  expected: {
    activeSlotsByChild: { [CHILD.a]: ['main'] },
    declaredAllergensByChild: { [CHILD.a]: [] },
    bannedRecipes: ['Ham Sandwich'],
  },
  budget: HAPPY_BUDGET,
};

// 9 — Single-turn compose baseline (was: schema-invalid self-correction).
// Story 3.5-s2 made the "schema-invalid on the primary path" scenario
// IMPOSSIBLE: OpenAI strict forced tool calling validates plan.compose
// arguments at the decode layer before the SDK returns, so the model can never
// emit a malformed call and the self-correction detour is gone. The fixture now
// queues only ONE valid compose response — turns drops 2 → 1, planComposeCalls
// 2 → 1 — proving the s2 win against the s1 baseline.
const schemaInvalid: EvalFixture = {
  id: 'schema-invalid-self-correct',
  options: base({
    kitchenMap: makeKitchenMap([makeChild(CHILD.a, 'Aarav')]),
    recipeCandidates: {
      main: [makeCandidate('Turkey & Cheese Pinwheel', 'Turkey & Cheese Pinwheel')],
      snack: [],
      extra: [],
    },
  }),
  recipeIngredients: { 'Turkey & Cheese Pinwheel': ['turkey', 'cheese', 'tortilla'] },
  stubResponses: [
    planComposeTurn(
      composeInput({
        mains: [{ sequence: 1, recipe_id: 'm1' }],
        days: [day('monday', [mainSlot(1, [{ child_id: CHILD.a }])])],
      }),
      { promptTokens: 100, completionTokens: 50 },
      'call_compose_good',
    ),
  ],
  expected: { activeSlotsByChild: { [CHILD.a]: ['main'] }, declaredAllergensByChild: { [CHILD.a]: [] } },
  budget: HAPPY_BUDGET,
};

// Negative — model emits a handle (m99) that is NOT in the slate (only m1 exists).
// plan.compose's handle resolver throws a HARD, non-retried error: the throw
// exits planWeek immediately (no second LLM turn). NOT a member of
// GOLDEN_FIXTURES — exercised only by the negative test in planner-golden.eval.
export const BAD_HANDLE_FIXTURE: EvalFixture = {
  id: 'bad-handle-not-in-slate',
  options: base({
    kitchenMap: makeKitchenMap([makeChild(CHILD.a, 'Aarav')]),
    recipeCandidates: {
      main: [makeCandidate('Turkey & Cheese Pinwheel', 'Turkey & Cheese Pinwheel')],
      snack: [],
      extra: [],
    },
  }),
  recipeIngredients: {},
  stubResponses: [
    planComposeTurn(
      composeInput({
        mains: [{ sequence: 1, recipe_id: 'm99' }], // handle not in slate
        days: [day('monday', [mainSlot(1, [{ child_id: CHILD.a }])])],
      }),
    ),
  ],
  expected: { activeSlotsByChild: { [CHILD.a]: ['main'] }, declaredAllergensByChild: { [CHILD.a]: [] } },
  budget: HAPPY_BUDGET,
};

export const GOLDEN_FIXTURES: readonly EvalFixture[] = [
  anglo,
  allergenFork,
  halalVeg,
  partialWeek,
  coldSlate,
  sovereignty,
  highActivityExtra,
  bannedRecipe,
  schemaInvalid,
];

export const SCHEMA_INVALID_FIXTURE_ID = schemaInvalid.id;