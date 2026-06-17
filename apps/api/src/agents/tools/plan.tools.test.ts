import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { createPlanComposeSpec } from './plan.tools.js';
import { PLANNER_PROMPT } from '../prompts/planner.prompt.js';
import type { PlansService } from '../../modules/plans/plans.service.js';
import type { RecipeService } from '../../modules/recipe/recipe.service.js';

// Story 3-DM-C1 — §10.7's "synthetic plan_compose gate" surfaced as a
// Vitest test: stub the planner LLM with hand-authored tree-shape outputs,
// drive them through the plan.compose tool, assert the input/output
// schemas accept them and the tool plumbs through to plansService.composeTree.

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const RECIPE_M1 = '22222222-2222-4222-8222-222222222222';
const RECIPE_M2 = '33333333-3333-4333-8333-333333333333';
const RECIPE_SNACK = '44444444-4444-4444-8444-444444444444';
const RECIPE_EXTRA = '55555555-5555-4555-8555-555555555555';
const AARAV = '66666666-6666-4666-8666-666666666666';
const MIRA = '77777777-7777-4777-8777-777777777777';
const KABIR = '88888888-8888-4888-8888-888888888888';
const PROMPT_VERSION = 'v2.0.0-test';

function buildRedisStub(): Redis {
  return {} as unknown as Redis;
}

function buildRecipeServiceStub(): RecipeService {
  return { findIdByName: vi.fn().mockResolvedValue(null) } as unknown as RecipeService;
}

function buildPlansServiceStub(): PlansService & {
  composeTree: ReturnType<typeof vi.fn>;
} {
  const composeTree = vi.fn().mockImplementation(async (input: Record<string, unknown>) => {
    return Promise.resolve({
      plan_id: '99999999-9999-4999-8999-999999999999',
      household_id: input.household_id,
      week_of: input.week_of,
      main_assignments: input.main_assignments,
      days: input.days,
      prompt_version: input.prompt_version,
    });
  });
  return { composeTree } as unknown as PlansService & {
    composeTree: ReturnType<typeof vi.fn>;
  };
}

describe('PLANNER_PROMPT', () => {
  it('declares v2.4.0 and includes plan.compose in toolsAllowed', () => {
    expect(PLANNER_PROMPT.version).toBe('v2.4.0');
    expect(PLANNER_PROMPT.toolsAllowed).toContain('plan.compose');
  });

  it('embeds the worked examples inline in the prompt text', () => {
    expect(PLANNER_PROMPT.text).toContain('main_assignments');
    expect(PLANNER_PROMPT.text).toContain('main_assignment_sequence');
    expect(PLANNER_PROMPT.text).toContain('Example 1 — Shared Main Monday');
    expect(PLANNER_PROMPT.text).toContain('Example 2 — Allergen-fork Wednesday');
    expect(PLANNER_PROMPT.text).toContain('plan.compose');
  });
});

describe('createPlanComposeSpec — synthetic plan_compose tree round-trips', () => {
  // §10.7's "shared-Main day" stubbed output: M1 Main + snack + per-child
  // extra, two kids with portion / texture variation differences.
  const sharedMainOutput = {
    household_id: HOUSEHOLD,
    week_of: '2026-06-01',
    prompt_version: PROMPT_VERSION,
    main_assignments: [
      { sequence: 1, recipe_id: RECIPE_M1 },
      { sequence: 2, recipe_id: RECIPE_M2 },
    ],
    days: [
      {
        day: 'monday' as const,
        slots: [
          {
            slot_kind: 'main' as const,
            main_assignment_sequence: 1,
            variations: [
              { child_id: AARAV, portion_size: 'regular' as const },
              { child_id: MIRA, portion_size: 'small' as const, texture: 'soft' as const },
            ],
          },
          {
            slot_kind: 'snack' as const,
            recipe_id: RECIPE_SNACK,
            variations: [
              { child_id: AARAV },
              { child_id: MIRA, portion_size: 'small' as const },
            ],
          },
          {
            slot_kind: 'extra' as const,
            recipe_id: RECIPE_EXTRA,
            extra_kind: 'protein_boost' as const,
            variations: [
              { child_id: AARAV, add_ons: ['honey drizzle'] },
            ],
          },
        ],
      },
    ],
  };

  // §10.7's "allergen-fork day" stubbed output: M2 Main shared across 3 kids,
  // Aarav's variation removes peanut paste and adds coconut cream.
  const allergenForkOutput = {
    household_id: HOUSEHOLD,
    week_of: '2026-06-01',
    prompt_version: PROMPT_VERSION,
    main_assignments: [{ sequence: 2, recipe_id: RECIPE_M2 }],
    days: [
      {
        day: 'wednesday' as const,
        slots: [
          {
            slot_kind: 'main' as const,
            main_assignment_sequence: 2,
            variations: [
              {
                child_id: AARAV,
                portion_size: 'regular' as const,
                spice_level: 'mild' as const,
                removals: ['peanut paste'],
                add_ons: ['coconut cream'],
                notes: 'peanut-free substitution per declared allergen',
              },
              { child_id: MIRA, portion_size: 'small' as const, spice_level: 'mild' as const },
              { child_id: KABIR, portion_size: 'regular' as const, spice_level: 'regular' as const },
            ],
          },
        ],
      },
    ],
  };

  it('accepts the shared-Main day output through input + output schema parse', async () => {
    const spec = createPlanComposeSpec(buildPlansServiceStub(), buildRedisStub(), buildRecipeServiceStub());
    const inputParse = spec.inputSchema.safeParse(sharedMainOutput);
    expect(inputParse.success).toBe(true);
  });

  it('accepts the allergen-fork day output through input + output schema parse', async () => {
    const spec = createPlanComposeSpec(buildPlansServiceStub(), buildRedisStub(), buildRecipeServiceStub());
    const inputParse = spec.inputSchema.safeParse(allergenForkOutput);
    expect(inputParse.success).toBe(true);
  });

  it('routes the shared-Main day to plansService.composeTree and returns a tree-shape output', async () => {
    const service = buildPlansServiceStub();
    const spec = createPlanComposeSpec(service, buildRedisStub(), buildRecipeServiceStub());

    const result = (await spec.fn(sharedMainOutput)) as Record<string, unknown>;

    expect(service.composeTree).toHaveBeenCalledTimes(1);
    expect(result.plan_id).toBeDefined();
    expect(result.main_assignments).toEqual(sharedMainOutput.main_assignments);
    expect(result.days).toEqual(sharedMainOutput.days);
  });

  it('rejects a flat-shape items[] body (the most common LLM regression)', async () => {
    const spec = createPlanComposeSpec(buildPlansServiceStub(), buildRedisStub(), buildRecipeServiceStub());
    const flatShaped = {
      household_id: HOUSEHOLD,
      week_of: '2026-06-01',
      prompt_version: PROMPT_VERSION,
      days: [
        {
          day: 'monday',
          items: [
            { child_id: AARAV, slot: 'main', ingredients: ['rice', 'beans'] },
          ],
        },
      ],
    };
    const parse = spec.inputSchema.safeParse(flatShaped);
    expect(parse.success).toBe(false);
  });

  it('rejects a main slot that carries recipe_id (XOR violation)', async () => {
    const spec = createPlanComposeSpec(buildPlansServiceStub(), buildRedisStub(), buildRecipeServiceStub());
    const bad = {
      ...sharedMainOutput,
      days: [
        {
          day: 'monday' as const,
          slots: [
            {
              slot_kind: 'main' as const,
              main_assignment_sequence: 1,
              recipe_id: RECIPE_M1, // ← XOR violation: main must not carry recipe_id
              variations: [{ child_id: AARAV }],
            },
          ],
        },
      ],
    };
    const parse = spec.inputSchema.safeParse(bad);
    expect(parse.success).toBe(false);
  });

  it('rejects a slot referencing an undeclared main_assignment_sequence', async () => {
    const spec = createPlanComposeSpec(buildPlansServiceStub(), buildRedisStub(), buildRecipeServiceStub());
    const bad = {
      ...sharedMainOutput,
      days: [
        {
          day: 'monday' as const,
          slots: [
            {
              slot_kind: 'main' as const,
              main_assignment_sequence: 9, // ← not in main_assignments[]
              variations: [{ child_id: AARAV }],
            },
          ],
        },
      ],
    };
    const parse = spec.inputSchema.safeParse(bad);
    expect(parse.success).toBe(false);
  });
});
