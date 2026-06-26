import { describe, it, expect } from 'vitest';
import type {
  AgeBand,
  KitchenMap,
  KitchenMapChild,
  PlanComposeTreeOutput,
  PlannerVariationInput,
} from '@hivekitchen/types';
import type { PlannerContext } from './context/assemble.js';
import { applyPlanDefaults, enforceNoConsecutiveMain } from './post-compose.js';

// ---------------------------------------------------------------------------
// Inline, fully-typed fixtures — no real service deps (Story 3.5-s6, AC6).
// ---------------------------------------------------------------------------

const HH = '11111111-1111-4111-8111-111111111111';
const PLAN = '99999999-9999-4999-8999-999999999999';
const CHILD_A = '22222222-2222-4222-8222-222222222222';
const CHILD_B = '33333333-3333-4333-8333-333333333333';

function makeChild(id: string, ageBand: AgeBand): KitchenMapChild {
  return {
    id,
    name: 'Test Child',
    age_band: ageBand,
    declared_allergens: [],
    cultural_identifiers: [],
    dietary_preferences: [],
    bag_composition: { main: true, snack: false, extra: false },
    bag_composition_pattern: null,
    school_policies: [],
    extra_rules: { pinned: [], banned: [] },
  };
}

function makeKitchenMap(children: KitchenMapChild[]): KitchenMap {
  return {
    household: {
      id: HH,
      tier: 'standard',
      tier_variant: 'control',
      timezone: 'America/New_York',
      display_name: 'The Test Household',
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    },
    caregivers: [],
    children,
    cultural: { active: [], suggested: [] },
    memory: { nodes: [] },
    household_extras: { library: [] },
    recipes: { favourites: [], banned: [] },
    allergens: [],
    dietary: [],
    food_preferences: [],
    favorite_lunches: [],
    rules: [],
    meta: {
      composed_at: '2026-05-01T00:00:00+00:00',
      map_version: 1,
      schema_version: '1.1.0',
      is_complete: true,
      required_set_complete: true,
    },
  };
}

function makeCtx(children?: KitchenMapChild[]): PlannerContext {
  return {
    kitchenMap: children === undefined ? undefined : makeKitchenMap(children),
    culturalContext: undefined,
    bagCompositions: undefined,
    extraRules: undefined,
    extraLibraryItems: undefined,
    extraProposals: undefined,
    sovereigntyMode: undefined,
    variantEligibleChildren: undefined,
    childSignals: undefined,
    pantrySnapshot: undefined,
    recipeCandidates: undefined,
  };
}

// One main slot for `day` carrying one variation per supplied variation arg.
function mainDay(
  weekday: PlanComposeTreeOutput['days'][number]['day'],
  sequence: number,
  variations: PlannerVariationInput[],
): PlanComposeTreeOutput['days'][number] {
  return {
    day: weekday,
    slots: [{ slot_kind: 'main', main_assignment_sequence: sequence, variations }],
  };
}

function makeOutput(
  days: PlanComposeTreeOutput['days'],
): PlanComposeTreeOutput {
  return {
    plan_id: PLAN,
    household_id: HH,
    week_of: '2026-05-11',
    main_assignments: [{ sequence: 1, recipe_id: 'm1' }],
    days,
    prompt_version: 'v2.10.0',
  };
}

// Convenience: the single variation of the single slot of day[0].
function firstVariation(output: PlanComposeTreeOutput): PlannerVariationInput {
  return output.days[0].slots[0].variations[0];
}

describe('applyPlanDefaults', () => {
  it('fills all three defaults when the variation leaves them undefined (child band)', () => {
    const output = makeOutput([mainDay('monday', 1, [{ child_id: CHILD_A }])]);
    const ctx = makeCtx([makeChild(CHILD_A, 'child')]);

    const result = applyPlanDefaults(output, ctx);

    const v = firstVariation(result);
    expect(v.portion_size).toBe('regular');
    expect(v.spice_level).toBe('mild');
    expect(v.texture).toBe('normal');
  });

  it('preserves an explicit portion_size', () => {
    const output = makeOutput([
      mainDay('monday', 1, [{ child_id: CHILD_A, portion_size: 'small' }]),
    ]);
    const ctx = makeCtx([makeChild(CHILD_A, 'child')]);

    const v = firstVariation(applyPlanDefaults(output, ctx));

    expect(v.portion_size).toBe('small');
    expect(v.spice_level).toBe('mild');
    expect(v.texture).toBe('normal');
  });

  it('preserves an explicit spice_level', () => {
    const output = makeOutput([
      mainDay('monday', 1, [{ child_id: CHILD_A, spice_level: 'spicy' }]),
    ]);
    const ctx = makeCtx([makeChild(CHILD_A, 'child')]);

    const v = firstVariation(applyPlanDefaults(output, ctx));

    expect(v.spice_level).toBe('spicy');
    expect(v.portion_size).toBe('regular');
    expect(v.texture).toBe('normal');
  });

  it('preserves an explicit texture', () => {
    const output = makeOutput([
      mainDay('monday', 1, [{ child_id: CHILD_A, texture: 'diced' }]),
    ]);
    const ctx = makeCtx([makeChild(CHILD_A, 'child')]);

    const v = firstVariation(applyPlanDefaults(output, ctx));

    expect(v.texture).toBe('diced');
    expect(v.portion_size).toBe('regular');
    expect(v.spice_level).toBe('mild');
  });

  it('derives texture "soft" for a toddler', () => {
    const output = makeOutput([mainDay('monday', 1, [{ child_id: CHILD_A }])]);
    const ctx = makeCtx([makeChild(CHILD_A, 'toddler')]);

    expect(firstVariation(applyPlanDefaults(output, ctx)).texture).toBe('soft');
  });

  it('derives texture "normal" for a teen', () => {
    const output = makeOutput([mainDay('monday', 1, [{ child_id: CHILD_A }])]);
    const ctx = makeCtx([makeChild(CHILD_A, 'teen')]);

    expect(firstVariation(applyPlanDefaults(output, ctx)).texture).toBe('normal');
  });

  it('derives texture "normal" for a preteen', () => {
    const output = makeOutput([mainDay('monday', 1, [{ child_id: CHILD_A }])]);
    const ctx = makeCtx([makeChild(CHILD_A, 'preteen')]);

    expect(firstVariation(applyPlanDefaults(output, ctx)).texture).toBe('normal');
  });

  it('falls back to texture "normal" for an unknown child_id', () => {
    const output = makeOutput([mainDay('monday', 1, [{ child_id: CHILD_B }])]);
    const ctx = makeCtx([makeChild(CHILD_A, 'toddler')]); // CHILD_B not in map

    expect(firstVariation(applyPlanDefaults(output, ctx)).texture).toBe('normal');
  });

  it('falls back to texture "normal" for all children when kitchenMap is undefined', () => {
    const output = makeOutput([mainDay('monday', 1, [{ child_id: CHILD_A }])]);
    const ctx = makeCtx(undefined);

    expect(firstVariation(applyPlanDefaults(output, ctx)).texture).toBe('normal');
  });

  it('never touches removals or add_ons (allergen-fork preservation)', () => {
    const output = makeOutput([
      mainDay('monday', 1, [
        { child_id: CHILD_A, removals: ['peanuts'], add_ons: ['extra rice'] },
      ]),
    ]);
    const ctx = makeCtx([makeChild(CHILD_A, 'child')]);

    const v = firstVariation(applyPlanDefaults(output, ctx));

    expect(v.removals).toEqual(['peanuts']);
    expect(v.add_ons).toEqual(['extra rice']);
    // defaults still applied to the three target fields
    expect(v.portion_size).toBe('regular');
  });

  it('returns a new object and does not mutate the input', () => {
    const output = makeOutput([mainDay('monday', 1, [{ child_id: CHILD_A }])]);
    const ctx = makeCtx([makeChild(CHILD_A, 'child')]);

    const result = applyPlanDefaults(output, ctx);

    expect(result).not.toBe(output);
    expect(firstVariation(output).portion_size).toBeUndefined();
  });

  it('passes top-level fields through unchanged', () => {
    const output = makeOutput([mainDay('monday', 1, [{ child_id: CHILD_A }])]);
    const ctx = makeCtx([makeChild(CHILD_A, 'child')]);

    const result = applyPlanDefaults(output, ctx);

    expect(result.plan_id).toBe(PLAN);
    expect(result.household_id).toBe(HH);
    expect(result.week_of).toBe('2026-05-11');
    expect(result.main_assignments).toEqual(output.main_assignments);
  });
});

describe('enforceNoConsecutiveMain', () => {
  it('throws when Mon+Tue share the same Main sequence', () => {
    const output = makeOutput([
      mainDay('monday', 1, [{ child_id: CHILD_A }]),
      mainDay('tuesday', 1, [{ child_id: CHILD_A }]),
    ]);

    expect(() => enforceNoConsecutiveMain(output)).toThrow(
      /consecutive Main on monday→tuesday/,
    );
  });

  it('does not throw when Mon+Tue use different Main sequences', () => {
    const output = makeOutput([
      mainDay('monday', 1, [{ child_id: CHILD_A }]),
      mainDay('tuesday', 2, [{ child_id: CHILD_A }]),
    ]);

    expect(() => enforceNoConsecutiveMain(output)).not.toThrow();
  });

  it('does not throw for a same-sequence non-adjacent pair (Mon+Wed)', () => {
    const output = makeOutput([
      mainDay('monday', 1, [{ child_id: CHILD_A }]),
      mainDay('wednesday', 1, [{ child_id: CHILD_A }]),
    ]);

    expect(() => enforceNoConsecutiveMain(output)).not.toThrow();
  });

  it('does not throw for a single-day plan', () => {
    const output = makeOutput([mainDay('monday', 1, [{ child_id: CHILD_A }])]);

    expect(() => enforceNoConsecutiveMain(output)).not.toThrow();
  });

  it('skips a day that has no main slot (paused / extra-only)', () => {
    const output = makeOutput([
      mainDay('monday', 1, [{ child_id: CHILD_A }]),
      {
        day: 'tuesday',
        slots: [
          {
            slot_kind: 'extra',
            recipe_id: 'e1',
            extra_kind: 'sweet',
            variations: [{ child_id: CHILD_A }],
          },
        ],
      },
    ]);

    expect(() => enforceNoConsecutiveMain(output)).not.toThrow();
  });

  it('sorts out-of-order days before checking adjacency (Tue before Mon, same seq → throws)', () => {
    const output = makeOutput([
      mainDay('tuesday', 1, [{ child_id: CHILD_A }]),
      mainDay('monday', 1, [{ child_id: CHILD_A }]),
    ]);

    expect(() => enforceNoConsecutiveMain(output)).toThrow(
      /consecutive Main on monday→tuesday/,
    );
  });

  it('does not throw for a 2-day plan with non-1..2 sequences that differ (3 and 5)', () => {
    const output = makeOutput([
      mainDay('monday', 3, [{ child_id: CHILD_A }]),
      mainDay('tuesday', 5, [{ child_id: CHILD_A }]),
    ]);

    expect(() => enforceNoConsecutiveMain(output)).not.toThrow();
  });
});
