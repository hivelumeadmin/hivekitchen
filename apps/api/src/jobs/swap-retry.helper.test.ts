import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type {
  CommitPlanTreeInput,
  GuardrailResult,
  PlanComposeTreeOutput,
  PlannerDayInput,
  PlannerMainAssignmentInput,
  PlannerSlotInput,
  PlannerVariationInput,
} from '@hivekitchen/types';
import { trySurgicalSwap } from './swap-retry.helper.js';
import type { DomainOrchestrator } from '../agents/orchestrator.js';

// =============================================================================
// trySurgicalSwap — tree-shape tests (9b part 3)
// =============================================================================
// Re-authored from the 9a flat-shape suite. Same behavioural contract:
//   - Returns null on no-actionable / phantom / agent-error / incomplete
//     coverage paths.
//   - Returns a merged CommitPlanTreeInput on full coverage.
// Tree-specific invariants verified here:
//   - Variations field-merge so an allergen-fork-only swap preserves
//     portion/texture/spice from the prev variation.
//   - Non-blocked swap variations are dropped (no rewrites of passing kids).
//   - main_assignments overlay by sequence keeps untouched Mains intact.
//   - Days the swap doesn't touch pass through identical to prev.
// =============================================================================

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID_A = '44444444-4444-4444-8444-444444444444';
const CHILD_ID_B = '55555555-5555-4555-8555-555555555555';
const RECIPE_PEANUT = '66666666-6666-4666-8666-666666666666';
const RECIPE_SUNFLOWER = '77777777-7777-4777-8777-777777777777';
const RECIPE_FRUIT = '88888888-8888-4888-8888-888888888888';

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

function variation(
  overrides: Partial<PlannerVariationInput> & { child_id: string },
): PlannerVariationInput {
  return {
    portion_size: 'regular',
    texture: 'normal',
    spice_level: 'mild',
    add_ons: [],
    removals: [],
    ...overrides,
  };
}

function mainSlot(
  sequence: number,
  variations: PlannerVariationInput[],
): PlannerSlotInput {
  return {
    slot_kind: 'main',
    main_assignment_sequence: sequence,
    variations,
  };
}

function snackSlot(
  recipeId: string,
  variations: PlannerVariationInput[],
): PlannerSlotInput {
  return {
    slot_kind: 'snack',
    recipe_id: recipeId,
    variations,
  };
}

function day(
  dayName: PlannerDayInput['day'],
  slots: PlannerSlotInput[],
): PlannerDayInput {
  return { day: dayName, slots };
}

function buildCommit(
  days: PlannerDayInput[],
  mainAssignments: PlannerMainAssignmentInput[] = [{ sequence: 1, recipe_id: RECIPE_PEANUT }],
): CommitPlanTreeInput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: '2026-05-18',
    revision: 1,
    generated_at: '2026-05-15T11:00:00.000Z',
    prompt_version: 'v2.0.0',
    main_assignments: mainAssignments,
    days,
  };
}

function buildSwapOutput(
  days: PlannerDayInput[],
  mainAssignments: PlannerMainAssignmentInput[] = [{ sequence: 1, recipe_id: RECIPE_PEANUT }],
): PlanComposeTreeOutput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: '2026-05-18',
    main_assignments: mainAssignments,
    days,
    prompt_version: 'v2.0.0',
  };
}

function blocked(
  ...conflicts: Array<{
    child_id: string;
    day: string;
    slot: string;
    allergen: string;
    ingredient: string;
  }>
): GuardrailResult {
  return { verdict: 'blocked', conflicts };
}

type OrchestratorMock = Pick<DomainOrchestrator, 'swapBlockedItems'> & {
  swapBlockedItems: ReturnType<typeof vi.fn>;
};

function buildOrchestrator(impl?: PlanComposeTreeOutput | Error): OrchestratorMock {
  const fn = vi.fn();
  if (impl instanceof Error) {
    fn.mockRejectedValue(impl);
  } else if (impl !== undefined) {
    fn.mockResolvedValue(impl);
  }
  return { swapBlockedItems: fn };
}

// Reusable two-kid Monday Main fixture: kid A blocked on peanut via add_ons,
// kid B clean. Used as the previousCommit input for the happy-path tests.
function twoKidMondayMain(): CommitPlanTreeInput {
  return buildCommit([
    day('monday', [
      mainSlot(1, [
        variation({ child_id: CHILD_ID_A, add_ons: ['peanut butter'] }),
        variation({ child_id: CHILD_ID_B }),
      ]),
    ]),
  ]);
}

describe('trySurgicalSwap', () => {
  it('returns null when no rejections are actionable (cleared/infrastructure-uncertain)', async () => {
    const orchestrator = buildOrchestrator();
    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit: twoKidMondayMain(),
      rejections: [
        { verdict: 'cleared', conflicts: [] },
        { verdict: 'uncertain', conflicts: [], reason: 'no_rules_loaded' },
      ],
      weekOf: '2026-05-18',
      requestId: 'req-1',
      logger: buildLogger(),
    });
    expect(result).toBeNull();
    expect(orchestrator.swapBlockedItems).not.toHaveBeenCalled();
  });

  it('returns null when blocked tuples have no matching variation in previousCommit', async () => {
    const orchestrator = buildOrchestrator();
    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit: twoKidMondayMain(),
      rejections: [
        // child_id, day, and slot_kind all match commit shape, but the conflict
        // references a tuesday slot the commit doesn't have.
        blocked({
          child_id: CHILD_ID_A,
          day: 'tuesday',
          slot: 'main',
          allergen: 'peanut',
          ingredient: 'peanut butter',
        }),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-2',
      logger: buildLogger(),
    });
    expect(result).toBeNull();
    expect(orchestrator.swapBlockedItems).not.toHaveBeenCalled();
  });

  it('returns null and falls through when the swap agent throws', async () => {
    const orchestrator = buildOrchestrator(new Error('mini-tier outage'));
    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit: twoKidMondayMain(),
      rejections: [
        blocked({
          child_id: CHILD_ID_A,
          day: 'monday',
          slot: 'main',
          allergen: 'peanut',
          ingredient: 'peanut butter',
        }),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-3',
      logger: buildLogger(),
    });
    expect(result).toBeNull();
    expect(orchestrator.swapBlockedItems).toHaveBeenCalledTimes(1);
  });

  it('returns null when the swap output is missing coverage for a blocked tuple', async () => {
    // Block both kid A and kid B on monday/main, but swap only covers kid A.
    const previousCommit = buildCommit([
      day('monday', [
        mainSlot(1, [
          variation({ child_id: CHILD_ID_A, add_ons: ['peanut butter'] }),
          variation({ child_id: CHILD_ID_B, add_ons: ['peanut butter'] }),
        ]),
      ]),
    ]);
    const swap = buildSwapOutput([
      day('monday', [
        mainSlot(1, [
          variation({ child_id: CHILD_ID_A, removals: ['peanut butter'], add_ons: ['sunflower seed butter'] }),
        ]),
      ]),
    ]);
    const orchestrator = buildOrchestrator(swap);

    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit,
      rejections: [
        blocked(
          { child_id: CHILD_ID_A, day: 'monday', slot: 'main', allergen: 'peanut', ingredient: 'peanut butter' },
          { child_id: CHILD_ID_B, day: 'monday', slot: 'main', allergen: 'peanut', ingredient: 'peanut butter' },
        ),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-4',
      logger: buildLogger(),
    });
    expect(result).toBeNull();
    expect(orchestrator.swapBlockedItems).toHaveBeenCalledTimes(1);
  });

  it('field-merges the swap variation onto prev so portion/texture/spice survive an allergen-fork edit', async () => {
    const previousCommit = buildCommit([
      day('monday', [
        mainSlot(1, [
          variation({
            child_id: CHILD_ID_A,
            portion_size: 'large',
            texture: 'soft',
            spice_level: 'mild',
            cutting_style: 'cubes',
            add_ons: ['peanut butter'],
          }),
          variation({ child_id: CHILD_ID_B }),
        ]),
      ]),
    ]);
    // Swap emits ONLY the allergen-fork delta (removals + add_ons). Other
    // variation fields are absent — the merge must preserve prev values.
    const swap = buildSwapOutput([
      day('monday', [
        mainSlot(1, [
          {
            child_id: CHILD_ID_A,
            removals: ['peanut butter'],
            add_ons: ['sunflower seed butter'],
          },
        ]),
      ]),
    ]);
    const orchestrator = buildOrchestrator(swap);

    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit,
      rejections: [
        blocked({
          child_id: CHILD_ID_A,
          day: 'monday',
          slot: 'main',
          allergen: 'peanut',
          ingredient: 'peanut butter',
        }),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-5',
      logger: buildLogger(),
    });

    expect(result).not.toBeNull();
    const mergedSlot = result!.days[0]!.slots[0]!;
    const mergedKidA = mergedSlot.variations.find((v) => v.child_id === CHILD_ID_A);
    const mergedKidB = mergedSlot.variations.find((v) => v.child_id === CHILD_ID_B);

    // Field merge: kid A keeps portion/texture/spice/cutting_style, gets the swap's
    // removals + add_ons.
    expect(mergedKidA).toEqual({
      child_id: CHILD_ID_A,
      portion_size: 'large',
      texture: 'soft',
      spice_level: 'mild',
      cutting_style: 'cubes',
      container: undefined,
      add_ons: ['sunflower seed butter'],
      removals: ['peanut butter'],
      notes: undefined,
      paused_at: undefined,
    });
    // Kid B variation passes through unchanged.
    expect(mergedKidB?.add_ons).toEqual([]);
    expect(mergedKidB?.removals).toEqual([]);
  });

  it('drops swap variations whose (child_id, day, slot_kind) is not in the blocked set', async () => {
    const previousCommit = twoKidMondayMain();
    // Agent oversteps and emits a variation for kid B — not blocked. Drop it.
    const swap = buildSwapOutput([
      day('monday', [
        mainSlot(1, [
          { child_id: CHILD_ID_A, removals: ['peanut butter'], add_ons: ['sunflower seed butter'] },
          { child_id: CHILD_ID_B, add_ons: ['some unwanted change'] },
        ]),
      ]),
    ]);
    const orchestrator = buildOrchestrator(swap);

    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit,
      rejections: [
        blocked({
          child_id: CHILD_ID_A,
          day: 'monday',
          slot: 'main',
          allergen: 'peanut',
          ingredient: 'peanut butter',
        }),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-6',
      logger: buildLogger(),
    });

    expect(result).not.toBeNull();
    const mergedKidB = result!.days[0]!.slots[0]!.variations.find((v) => v.child_id === CHILD_ID_B);
    // Kid B passes through identical to the prev (empty add_ons), NOT the agent's overstep.
    expect(mergedKidB?.add_ons).toEqual([]);
  });

  it('overlays main_assignments by sequence and preserves untouched ones', async () => {
    const previousCommit = buildCommit(
      [
        day('monday', [mainSlot(1, [variation({ child_id: CHILD_ID_A, add_ons: ['peanut butter'] })])]),
        day('tuesday', [mainSlot(2, [variation({ child_id: CHILD_ID_A })])]),
      ],
      [
        { sequence: 1, recipe_id: RECIPE_PEANUT },
        { sequence: 2, recipe_id: RECIPE_FRUIT },
      ],
    );
    // Swap rewrites M1 to RECIPE_SUNFLOWER; M2 is untouched.
    const swap = buildSwapOutput(
      [
        day('monday', [
          mainSlot(1, [
            { child_id: CHILD_ID_A, removals: ['peanut butter'], add_ons: ['sunflower seed butter'] },
          ]),
        ]),
      ],
      [{ sequence: 1, recipe_id: RECIPE_SUNFLOWER }],
    );
    const orchestrator = buildOrchestrator(swap);

    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit,
      rejections: [
        blocked({
          child_id: CHILD_ID_A,
          day: 'monday',
          slot: 'main',
          allergen: 'peanut',
          ingredient: 'peanut butter',
        }),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-7',
      logger: buildLogger(),
    });

    expect(result).not.toBeNull();
    expect(result!.main_assignments).toEqual([
      { sequence: 1, recipe_id: RECIPE_SUNFLOWER },
      { sequence: 2, recipe_id: RECIPE_FRUIT },
    ]);
  });

  it('passes untouched days through unchanged and merges only the days the swap targets', async () => {
    const previousCommit = buildCommit([
      day('monday', [mainSlot(1, [variation({ child_id: CHILD_ID_A, add_ons: ['peanut butter'] })])]),
      day('tuesday', [snackSlot(RECIPE_FRUIT, [variation({ child_id: CHILD_ID_A })])]),
    ]);
    const swap = buildSwapOutput([
      day('monday', [
        mainSlot(1, [
          { child_id: CHILD_ID_A, removals: ['peanut butter'], add_ons: ['sunflower seed butter'] },
        ]),
      ]),
    ]);
    const orchestrator = buildOrchestrator(swap);

    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit,
      rejections: [
        blocked({
          child_id: CHILD_ID_A,
          day: 'monday',
          slot: 'main',
          allergen: 'peanut',
          ingredient: 'peanut butter',
        }),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-8',
      logger: buildLogger(),
    });

    expect(result).not.toBeNull();
    // Tuesday subtree is the identical object reference from prev — no rewrite.
    expect(result!.days[1]).toBe(previousCommit.days[1]);
    // Monday is a new object with the merged kid A variation.
    expect(result!.days[0]).not.toBe(previousCommit.days[0]);
    expect(result!.days[0]!.slots[0]!.variations[0]!.add_ons).toEqual(['sunflower seed butter']);
  });

  it('handles slot-level recipe_id swap on a snack slot (field merge on the slot)', async () => {
    const previousCommit = buildCommit([
      day('monday', [snackSlot(RECIPE_PEANUT, [variation({ child_id: CHILD_ID_A, add_ons: ['peanut'] })])]),
    ]);
    const swap = buildSwapOutput([
      day('monday', [
        {
          slot_kind: 'snack',
          recipe_id: RECIPE_FRUIT,
          variations: [{ child_id: CHILD_ID_A, removals: ['peanut'], add_ons: [] }],
        },
      ]),
    ]);
    const orchestrator = buildOrchestrator(swap);

    const result = await trySurgicalSwap({
      orchestrator,
      previousCommit,
      rejections: [
        blocked({
          child_id: CHILD_ID_A,
          day: 'monday',
          slot: 'snack',
          allergen: 'peanut',
          ingredient: 'peanut',
        }),
      ],
      weekOf: '2026-05-18',
      requestId: 'req-9',
      logger: buildLogger(),
    });

    expect(result).not.toBeNull();
    const mergedSlot = result!.days[0]!.slots[0]!;
    expect(mergedSlot.slot_kind).toBe('snack');
    expect(mergedSlot.recipe_id).toBe(RECIPE_FRUIT);
  });

  it('forwards compound-uncertain flagged items as uncertainContext to the swap agent', async () => {
    const previousCommit = twoKidMondayMain();
    // Set up a swap output that covers the compound-flagged tuple so we
    // reach the orchestrator call site and can inspect its arguments.
    const swap = buildSwapOutput([
      day('monday', [
        mainSlot(1, [
          { child_id: CHILD_ID_A, removals: ['garam masala'], add_ons: ['cumin'] },
        ]),
      ]),
    ]);
    const orchestrator = buildOrchestrator(swap);

    await trySurgicalSwap({
      orchestrator,
      previousCommit,
      rejections: [
        {
          verdict: 'uncertain',
          conflicts: [],
          reason: 'compound_ingredient_unverified',
          flagged_items: [
            {
              child_id: CHILD_ID_A,
              day: 'monday',
              slot: 'main',
              ingredient: 'garam masala',
            },
          ],
        },
      ],
      weekOf: '2026-05-18',
      requestId: 'req-10',
      logger: buildLogger(),
    });

    expect(orchestrator.swapBlockedItems).toHaveBeenCalledTimes(1);
    const callArg = orchestrator.swapBlockedItems.mock.calls[0]![0] as {
      uncertainContext?: string;
      blockedItems: ReadonlyArray<{ child_id: string; day: string; slot: string }>;
    };
    expect(callArg.uncertainContext).toContain('ALLERGEN-UNCERTAIN');
    expect(callArg.uncertainContext).toContain(`${CHILD_ID_A}|monday|main`);
    expect(callArg.blockedItems).toHaveLength(1);
    expect(callArg.blockedItems[0]!.child_id).toBe(CHILD_ID_A);
  });
});
