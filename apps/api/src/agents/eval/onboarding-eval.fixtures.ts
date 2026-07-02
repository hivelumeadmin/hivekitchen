import type { Scenario } from './onboarding-eval.harness.js';

// ===========================================================================
// Story 2.7-s1 — Onboarding golden-set scenarios.
// ===========================================================================
// Each scenario pairs FIXED user inputs (free text + chip taps) with RECORDED
// LLM responses (the assistant prose + the tool calls the model would emit),
// so the run is fully deterministic. The `expected` ScenarioOutcome is the
// committed golden — STRUCTURED OUTCOMES ONLY (moment transitions, slot fills,
// tool calls). Never assert prose. See onboarding-eval.harness.ts for the
// determinism contract and the regeneration procedure.
//
// Coverage map (AC4/AC5):
//   spine-happy-path           — M1→M5 + finalize-eligible (required-set gate),
//                                 pre_start→m1_table bootstrap, m2-exit catalog
//                                 seed, M5 personalized chips, finalize success.
//   m3-elevation-strict        — strict (non_negotiable) dietary + the M3
//                                 [CHIP_PROMPT:elevation:] ratification chip.
//   safety-net-chip-only       — M3 chip-only auto-advance + M4 chip-only
//                                 auto-advance (LLM omits [NEXT_MOMENT:]).
//   safety-net-reanchor        — kitchen-map-inference re-anchoring (moment row
//                                 missing but data present).
//   pre-start-bootstrap        — first turn, no directive → m1_table.
//   m5-cold-start              — CatalogProjection cold-start fallback.
//   resume-in-progress         — getState on a mid-interview thread.
//   reset-interview            — resetState then getState → not_started.
//   finalize-gate-negative     — finalize blocked when not at summary.
// ===========================================================================

export const SCENARIOS: Scenario[] = [
  {
    id: 'spine-happy-path',
    description: 'M1→M5 happy path, finalize-eligible, finalize succeeds',
    m5Projection: {
      chips: [
        { key: 'r-1', label: 'Idli + sambar', provenance: 'inferred' },
        { key: 'r-2', label: 'Lemon rice', provenance: 'declared' },
        { key: 'r-3', label: 'Dal + roti', provenance: 'parent_added' },
      ],
      coldStartReason: null,
      stage1Complete: true,
    },
    extractSummary: {
      cultural_templates: ['south_asian'],
      palate_notes: ['mild spice'],
      allergens_mentioned: ['peanut', 'dairy'],
      family_rhythms: ['friday is dosa night'],
    },
    finalize: true,
    turns: [
      {
        userInput: 'Hi',
        llmSteps: [{ content: 'Hi! Who am I planning lunches for?', finishReason: 'stop' }],
      },
      {
        userInput: "We're the Menons, and my daughter Layla is 10.",
        llmSteps: [
          {
            toolCalls: [
              { name: 'household.set_name', args: { display_name: 'The Menons' } },
              { name: 'child.upsert', args: { name: 'Layla', age_band: 'preteen' } },
            ],
            finishReason: 'tool_calls',
          },
          { content: 'Lovely. Any allergies I should know about? [NEXT_MOMENT:m2_safe]', finishReason: 'stop' },
        ],
      },
      {
        // Slice 2.7-s5 — pure-chip M2 → zero conversational LLM calls. The
        // service applies household-wide allergen.declare deterministically.
        userInput: '[Chips selected: peanut, dairy]',
        llmSteps: [],
      },
      {
        // Pure-chip M3 → zero-call dietary.declare(default) + cuisine.declare(80/70).
        userInput: '[Chips selected: vegetarian, south_indian]',
        llmSteps: [],
      },
      {
        // Pure-chip M4 → zero-call child.upsert(bag) for every child.
        userInput: '[Chips selected: main_plus_snack]',
        llmSteps: [],
      },
      {
        userInput: 'She loves dosa, idli, lemon rice, dal, and yogurt rice.',
        llmSteps: [
          {
            toolCalls: [
              { name: 'favorite_lunch.add', args: { item: 'Dosa' } },
              { name: 'favorite_lunch.add', args: { item: 'Idli' } },
              { name: 'favorite_lunch.add', args: { item: 'Lemon rice' } },
              { name: 'favorite_lunch.add', args: { item: 'Dal' } },
              { name: 'favorite_lunch.add', args: { item: 'Yogurt rice' } },
            ],
            finishReason: 'tool_calls',
          },
          // Slice 13-s6 — five free-text favourites now clear the M5 natural
          // gate (threshold dropped 10→5), so the controller advances straight
          // to summary this turn; no override_fewer tap is needed.
          { content: 'Wonderful list — that gives me plenty to start with.', finishReason: 'stop' },
        ],
      },
      {
        // The parent taps "Start with fewer" after M5 already completed — a
        // no-op that holds at summary (kept to exercise the override path).
        userInput: '[Chips selected: override_fewer]',
        llmSteps: [
          { content: 'Your kitchen is ready — tap Finalize on the right whenever you are.', finishReason: 'stop' },
        ],
      },
    ],
    expectedCatalogSeedCount: 1,
  },

  {
    id: 'm3-elevation-strict',
    description: 'strict (non_negotiable) dietary + M3 elevation ratification chip',
    turns: [
      {
        userInput: "We're the Khans, my son Adam is 12.",
        llmSteps: [
          {
            toolCalls: [
              { name: 'household.set_name', args: { display_name: 'The Khans' } },
              { name: 'child.upsert', args: { name: 'Adam', age_band: 'teen' } },
            ],
            finishReason: 'tool_calls',
          },
          { content: 'Any allergies? [NEXT_MOMENT:m2_safe]', finishReason: 'stop' },
        ],
      },
      {
        // Pure-chip M2 'none' → zero-call, no allergen.declare, advances to M3.
        userInput: '[Chips selected: none]',
        llmSteps: [],
      },
      {
        // Free-text M3 with strong-but-ambiguous enforcement → model path. The
        // model records its best-guess enforcement AND request_ratification=true;
        // the service renders the ratification chip from the tool RESULT (Slice
        // 2.7-s5 — replaces the [CHIP_PROMPT:elevation:…] prose sentinel).
        userInput: "We're strictly halal — it's a hard rule.",
        llmSteps: [
          {
            toolCalls: [
              {
                name: 'dietary.declare',
                args: { tag: 'halal', enforcement: 'non_negotiable', request_ratification: true },
              },
            ],
            finishReason: 'tool_calls',
          },
          {
            content:
              "Got it — 'strictly halal.' Should I treat that as a hard rule or a preference?",
            finishReason: 'stop',
          },
        ],
      },
    ],
    expectedCatalogSeedCount: 1,
  },

  {
    id: 'safety-net-chip-only',
    description:
      'M2/M3/M4 pure-chip turns advance deterministically with zero conversational LLM calls (Slice 2.7-s5)',
    turns: [
      {
        userInput: "We're the Patels, my son Aarav is 8.",
        llmSteps: [
          {
            toolCalls: [
              { name: 'household.set_name', args: { display_name: 'The Patels' } },
              { name: 'child.upsert', args: { name: 'Aarav', age_band: 'child' } },
            ],
            finishReason: 'tool_calls',
          },
          { content: 'Any allergies? [NEXT_MOMENT:m2_safe]', finishReason: 'stop' },
        ],
      },
      {
        // Pure-chip M2 → zero-call, household-wide peanut.
        userInput: '[Chips selected: peanut]',
        llmSteps: [],
      },
      {
        // Pure-chip M3 → zero-call cuisine.declare(80/70).
        userInput: '[Chips selected: south_indian]',
        llmSteps: [],
      },
      {
        // Pure-chip M4 → zero-call child.upsert(bag).
        userInput: '[Chips selected: main_plus_snack]',
        llmSteps: [],
      },
    ],
    expectedCatalogSeedCount: 1,
  },

  {
    id: 'safety-net-reanchor',
    description: 'kitchen-map re-anchoring: moment row missing but data already present',
    seed: {
      householdName: 'The Owusus',
      children: [{ name: 'Ama', ageBand: 'child' }],
      childAllergens: [{ childName: 'Ama', allergen: 'peanut' }],
    },
    turns: [
      {
        userInput: 'Hi again',
        llmSteps: [{ content: 'Welcome back! Where were we?', finishReason: 'stop' }],
      },
    ],
  },

  {
    id: 'pre-start-bootstrap',
    description: 'first turn, no directive → m1_table bootstrap + M1 hint chips',
    turns: [
      {
        userInput: 'Hi',
        llmSteps: [{ content: 'Hi! Who am I planning for?', finishReason: 'stop' }],
      },
    ],
  },

  {
    id: 'm5-cold-start',
    description:
      'M5 cold-start fallback: projection returns coldStartReason (walks the spine to M5; the controller refuses to skip the M2 safety wall)',
    m5Projection: { chips: [], coldStartReason: 'per_cuisine_floor', stage1Complete: true },
    turns: [
      {
        userInput: "We're the Lees, my daughter Mia is 7.",
        llmSteps: [
          {
            toolCalls: [
              { name: 'household.set_name', args: { display_name: 'The Lees' } },
              { name: 'child.upsert', args: { name: 'Mia', age_band: 'child' } },
            ],
            finishReason: 'tool_calls',
          },
          { content: 'Any allergies I should know about?', finishReason: 'stop' },
        ],
      },
      // M2 'none' (pure-chip) → advances to M3.
      { userInput: '[Chips selected: none]', llmSteps: [] },
      // M3 skip (pure-chip) → advances to M4.
      { userInput: '[Chips selected: skip]', llmSteps: [] },
      // M4 bag pattern (pure-chip) → advances to M5, where the projection
      // returns a coldStartReason and the cold-start fallback engages.
      { userInput: '[Chips selected: main_plus_snack]', llmSteps: [] },
    ],
    expectedCatalogSeedCount: 1,
  },

  {
    id: 'resume-in-progress',
    description: 'getState on a mid-interview thread returns in_progress',
    resume: true,
    turns: [
      {
        userInput: "We're the Tanakas, my son Ren is 9.",
        llmSteps: [
          {
            toolCalls: [
              { name: 'household.set_name', args: { display_name: 'The Tanakas' } },
              { name: 'child.upsert', args: { name: 'Ren', age_band: 'child' } },
            ],
            finishReason: 'tool_calls',
          },
          { content: 'Any allergies? [NEXT_MOMENT:m2_safe]', finishReason: 'stop' },
        ],
      },
      {
        // Pure-chip M2 → zero-call, household-wide shellfish.
        userInput: '[Chips selected: shellfish]',
        llmSteps: [],
      },
    ],
    expectedCatalogSeedCount: 1,
  },

  {
    id: 'reset-interview',
    description: 'resetState closes the active thread; getState → not_started',
    reset: true,
    turns: [
      {
        userInput: "We're the Romanos, my daughter Sofia is 6.",
        llmSteps: [
          {
            toolCalls: [
              { name: 'household.set_name', args: { display_name: 'The Romanos' } },
              { name: 'child.upsert', args: { name: 'Sofia', age_band: 'child' } },
            ],
            finishReason: 'tool_calls',
          },
          { content: 'Any allergies? [NEXT_MOMENT:m2_safe]', finishReason: 'stop' },
        ],
      },
    ],
  },

  {
    id: 'finalize-gate-negative',
    description: 'finalize blocked with ConflictError when not yet at summary',
    finalize: true,
    turns: [
      {
        userInput: "We're the Garcias, my son Mateo is 11.",
        llmSteps: [
          {
            toolCalls: [
              { name: 'household.set_name', args: { display_name: 'The Garcias' } },
              { name: 'child.upsert', args: { name: 'Mateo', age_band: 'preteen' } },
            ],
            finishReason: 'tool_calls',
          },
          { content: 'Any allergies? [NEXT_MOMENT:m2_safe]', finishReason: 'stop' },
        ],
      },
      {
        // Pure-chip M2 'none' → zero-call, advances to M3 (no allergens).
        userInput: '[Chips selected: none]',
        llmSteps: [],
      },
    ],
    expectedCatalogSeedCount: 1,
  },
];
