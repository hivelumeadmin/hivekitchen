import { describe, it, expect } from 'vitest';
import {
  collectRecipeIds,
  formatAttribution,
  projectWeekPlan,
  type DayInput,
  type ProjectWeekPlanInput,
  type RecipeContent,
  type SlotInput,
  type VariationInput,
} from './day-view-model.js';

// Story 14-s4 — the pure projection from the live plan tree to the Wall Card's
// week model. No React, no queries: every input is already resolved.

const CHILD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECIPE_MAIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RECIPE_OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ASSIGN_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ASSIGN_2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function variation(overrides: Partial<VariationInput> = {}): VariationInput {
  return {
    child_id: CHILD_A,
    portion_size: 'regular',
    texture: 'normal',
    spice_level: 'regular',
    cutting_style: null,
    container: null,
    add_ons: [],
    removals: [],
    notes: null,
    paused_at: null,
    ...overrides,
  };
}

// recipe_id is NULL on main slots — the plan_slots_main_uses_assignment DB
// CHECK forbids it; the Main's recipe comes ONLY from the assignment map.
// (An earlier fixture put recipe_id here, masking exactly that bug.)
function mainSlot(overrides: Partial<SlotInput> = {}): SlotInput {
  return {
    slot_kind: 'main',
    recipe_id: null,
    snack_sku_id: null,
    main_assignment_id: ASSIGN_1,
    extra_kind: null,
    variations: [variation()],
    ...overrides,
  };
}

const ASSIGNMENT_RECIPES: ReadonlyMap<string, string> = new Map([
  [ASSIGN_1, RECIPE_MAIN],
  [ASSIGN_2, RECIPE_OTHER],
]);

function day(overrides: Partial<DayInput> = {}): DayInput {
  return {
    day: 'monday',
    plan_day_id: 'plan-day-mon',
    paused: false,
    slots: [mainSlot()],
    ...overrides,
  };
}

const RECIPE_CONTENT: RecipeContent = {
  recipe: {
    id: RECIPE_MAIN,
    canonical_name: 'Dal + rice thermos',
    ingredients: ['1 cup yellow dal', '1.5 cups basmati rice'],
    prep_time_minutes: 20,
    finish_time_minutes: 6,
  },
  steps: [
    { sequence: 2, mode: 'finish', text: 'Layer and seal.' },
    { sequence: 1, mode: 'prep', text: 'Cook the dal.' },
  ],
};

function input(overrides: Partial<ProjectWeekPlanInput> = {}): ProjectWeekPlanInput {
  return {
    weekId: '2026-05-04',
    days: [day()],
    mainAssignmentSequenceById: new Map([[ASSIGN_1, 1]]),
    mainAssignmentRecipeById: ASSIGNMENT_RECIPES,
    recipes: new Map([[RECIPE_MAIN, RECIPE_CONTENT]]),
    tileSummaries: [],
    children: [{ id: CHILD_A, name: 'Aarav', age_band: 'toddler' }],
    weekDates: { monday: '2026-05-04', tuesday: '2026-05-05', wednesday: '2026-05-06' },
    ...overrides,
  };
}

describe('projectWeekPlan', () => {
  it('projects the main recipe content, sorted method, and date label', () => {
    const week = projectWeekPlan(input());

    expect(week.days).toHaveLength(1);
    const d = week.days[0]!;
    expect(d.main.title).toBe('Dal + rice thermos');
    expect(d.main.ingredients).toEqual(['1 cup yellow dal', '1.5 cups basmati rice']);
    expect(d.main.prepMinutes).toBe(20);
    expect(d.main.finishMinutes).toBe(6);
    expect(d.dateLabel).toBe('May 4');
    expect(d.mainGroupId).toBe('M1');
    // Steps arrive unordered from the API; the projection sorts by sequence.
    expect(d.main.method.map((m) => m.text)).toEqual(['Cook the dal.', 'Layer and seal.']);
  });

  it('leaves familiarity unset — no signal exists, so it claims nothing', () => {
    // undefined (not false): the Wall Card expands the method AND prints no
    // "New recipe" claim about a dish the household may cook every month.
    expect(projectWeekPlan(input()).days[0]!.main.familiarityKnown).toBeUndefined();
  });

  it('maps every per-child variation field onto the chip shape', () => {
    const week = projectWeekPlan(
      input({
        days: [
          day({
            slots: [
              mainSlot({
                variations: [
                  variation({
                    child_id: CHILD_B,
                    portion_size: 'large',
                    texture: 'soft',
                    spice_level: 'spicy',
                    cutting_style: 'batons',
                    container: 'thermos',
                    add_ons: ['egg'],
                    removals: ['cumin'],
                    notes: 'keep it intact',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    );

    expect(week.days[0]!.variations[0]).toEqual({
      childId: CHILD_B,
      portionSize: 'large',
      texture: 'soft',
      spiceLevel: 'spicy',
      cuttingStyle: 'batons',
      container: 'thermos',
      addOns: ['egg'],
      removals: ['cumin'],
      notes: 'keep it intact',
    });
  });

  it('omits nullable variation fields rather than emitting nulls', () => {
    const v = projectWeekPlan(input()).days[0]!.variations[0]!;
    expect('cuttingStyle' in v).toBe(false);
    expect('container' in v).toBe(false);
    expect('notes' in v).toBe(false);
  });

  it('notes a carried-forward Main only across CALENDAR-adjacent days', () => {
    const week = projectWeekPlan(
      input({
        days: [
          day({ day: 'monday', plan_day_id: 'p-mon' }),
          day({ day: 'tuesday', plan_day_id: 'p-tue' }),
          // Wednesday absent — the composer omits days with no items.
          day({ day: 'thursday', plan_day_id: 'p-thu' }),
        ],
        weekDates: {
          monday: '2026-05-04',
          tuesday: '2026-05-05',
          thursday: '2026-05-07',
        },
      }),
    );

    expect(week.days[0]!.mainGroupNote).toBeUndefined();
    expect(week.days[1]!.mainGroupNote).toBe('Same as Monday');
    // Thursday shares the assignment but follows a GAP — not "same as Tuesday".
    expect(week.days[2]!.mainGroupNote).toBeUndefined();
  });

  it('does not note a shared Main when the assignments differ', () => {
    const week = projectWeekPlan(
      input({
        days: [
          day({ day: 'monday', plan_day_id: 'p-mon' }),
          day({
            day: 'tuesday',
            plan_day_id: 'p-tue',
            slots: [mainSlot({ main_assignment_id: ASSIGN_2 })],
          }),
        ],
        mainAssignmentSequenceById: new Map([
          [ASSIGN_1, 1],
          [ASSIGN_2, 2],
        ]),
      }),
    );

    expect(week.days[1]!.mainGroupNote).toBeUndefined();
    expect(week.days[1]!.mainGroupId).toBe('M2');
  });

  it('drops weekdays with no plan row (the tree adapter emits stubs)', () => {
    const week = projectWeekPlan(
      input({
        days: [
          day({ day: 'monday', plan_day_id: 'p-mon' }),
          { day: 'tuesday', plan_day_id: null, paused: false, slots: [] },
        ],
      }),
    );

    expect(week.days.map((d) => d.dayName)).toEqual(['monday']);
  });

  it('renders a day whose recipe has not resolved without throwing', () => {
    const week = projectWeekPlan(
      input({
        recipes: new Map(),
        tileSummaries: [{ day: 'monday', items: [{ slot: 'main', name: 'Dal + rice' }] }],
      }),
    );

    const d = week.days[0]!;
    // The brief's projected dish name stands in until the recipe resolves.
    expect(d.main.title).toBe('Dal + rice');
    expect(d.main.ingredients).toEqual([]);
    expect(d.main.method).toEqual([]);
    expect(d.main.prepMinutes).toBe(0);
  });

  it('carries the paused flag through', () => {
    const week = projectWeekPlan(input({ days: [day({ paused: true })] }));
    expect(week.days[0]!.paused).toBe(true);
  });

  it('resolves the Main recipe from the assignment map — main slots never carry recipe_id', () => {
    // The base mainSlot fixture has recipe_id: null (DB CHECK); content must
    // still resolve via main_assignment_id → ASSIGNMENT_RECIPES.
    const d = projectWeekPlan(input()).days[0]!;
    expect(d.main.id).toBe(RECIPE_MAIN);
    expect(d.main.title).toBe('Dal + rice thermos');
  });

  it('marks a variation with paused_at set as paused', () => {
    const week = projectWeekPlan(
      input({
        days: [
          day({
            slots: [
              mainSlot({
                variations: [variation({ paused_at: '2026-05-04T07:00:00+00:00' })],
              }),
            ],
          }),
        ],
      }),
    );
    expect(week.days[0]!.variations[0]!.paused).toBe(true);
    // And absent (not false) when paused_at is null.
    expect('paused' in projectWeekPlan(input()).days[0]!.variations[0]!).toBe(false);
  });

  it('assigns child colors in roster order and is the trivial case for one child', () => {
    const single = projectWeekPlan(input());
    expect(single.children).toEqual([
      { id: CHILD_A, name: 'Aarav', color: 'foliage', ageBand: 'toddler' },
    ]);

    const multi = projectWeekPlan(
      input({
        children: [
          { id: CHILD_A, name: 'Aarav', age_band: 'toddler' },
          { id: CHILD_B, name: 'Mira', age_band: 'child' },
        ],
      }),
    );
    expect(multi.children.map((c) => c.color)).toEqual(['foliage', 'lumi-terracotta']);
  });

  it('projects the snack title from the brief and per-child notes from the slot', () => {
    const week = projectWeekPlan(
      input({
        days: [
          day({
            slots: [
              mainSlot(),
              {
                slot_kind: 'snack',
                recipe_id: null,
                snack_sku_id: 'sku-1',
                main_assignment_id: null,
                extra_kind: null,
                variations: [variation({ notes: 'thin slivers, no skin' })],
              },
            ],
          }),
        ],
        tileSummaries: [{ day: 'monday', items: [{ slot: 'snack', name: 'Apple slices' }] }],
      }),
    );

    expect(week.days[0]!.snack.title).toBe('Apple slices');
    expect(week.days[0]!.snack.perChildVariation).toEqual({ [CHILD_A]: 'thin slivers, no skin' });
  });

  it('marks children without an extra variation as excluded', () => {
    const week = projectWeekPlan(
      input({
        children: [
          { id: CHILD_A, name: 'Aarav', age_band: 'toddler' },
          { id: CHILD_B, name: 'Mira', age_band: 'child' },
        ],
        days: [
          day({
            slots: [
              mainSlot(),
              {
                slot_kind: 'extra',
                recipe_id: null,
                snack_sku_id: null,
                main_assignment_id: null,
                extra_kind: 'sports_add',
                variations: [variation({ child_id: CHILD_B })],
              },
            ],
          }),
        ],
        tileSummaries: [{ day: 'monday', items: [{ slot: 'extra', name: 'Granola bar' }] }],
      }),
    );

    expect(week.days[0]!.optionalExtra).toEqual({
      kind: 'sports_add',
      title: 'Granola bar',
      perChildAssignment: { [CHILD_A]: 'excluded', [CHILD_B]: 'included' },
    });
  });

  it('falls back to the custom extra kind for an unrecognised value', () => {
    const week = projectWeekPlan(
      input({
        days: [
          day({
            slots: [
              mainSlot(),
              {
                slot_kind: 'extra',
                recipe_id: null,
                snack_sku_id: null,
                main_assignment_id: null,
                extra_kind: 'something_new',
                variations: [],
              },
            ],
          }),
        ],
        tileSummaries: [{ day: 'monday', items: [{ slot: 'extra', name: 'Mystery' }] }],
      }),
    );

    expect(week.days[0]!.optionalExtra?.kind).toBe('custom');
  });

  it('omits the optional extra when the slot has no resolved name', () => {
    const week = projectWeekPlan(
      input({
        days: [
          day({
            slots: [
              mainSlot(),
              {
                slot_kind: 'extra',
                recipe_id: null,
                snack_sku_id: null,
                main_assignment_id: null,
                extra_kind: 'drink',
                variations: [],
              },
            ],
          }),
        ],
      }),
    );

    expect(week.days[0]!.optionalExtra).toBeUndefined();
  });

  it('never sets prepInvestment — no data source records it', () => {
    expect(projectWeekPlan(input()).days[0]!.prepInvestment).toBeUndefined();
  });

  it('tolerates a missing weekDates entry', () => {
    expect(projectWeekPlan(input({ weekDates: {} })).days[0]!.dateLabel).toBe('');
  });
});

describe('collectRecipeIds', () => {
  it('collects distinct main and non-main recipe ids, skipping stub days', () => {
    const ids = collectRecipeIds(
      [
        day({ day: 'monday', plan_day_id: 'p-mon' }),
        day({ day: 'tuesday', plan_day_id: 'p-tue' }),
        day({
          day: 'wednesday',
          plan_day_id: 'p-wed',
          slots: [
            mainSlot({ main_assignment_id: ASSIGN_2 }),
            {
              slot_kind: 'snack',
              recipe_id: null,
              snack_sku_id: 'sku-1',
              main_assignment_id: null,
              extra_kind: null,
              variations: [],
            },
          ],
        }),
        { day: 'thursday', plan_day_id: null, paused: false, slots: [] },
      ],
      ASSIGNMENT_RECIPES,
    );

    // Mon+Tue share RECIPE_MAIN; Wed adds RECIPE_OTHER; the snack-SKU slot has
    // no recipe id; the stub day contributes nothing.
    expect(ids.sort()).toEqual([RECIPE_MAIN, RECIPE_OTHER].sort());
  });

  it('returns an empty list when nothing is planned', () => {
    expect(collectRecipeIds([], new Map())).toEqual([]);
  });
});

describe('formatAttribution', () => {
  it('reads naturally for zero, one, two, and many children', () => {
    const kid = (name: string) =>
      ({ id: name, name, color: 'foliage', ageBand: 'child' }) as const;
    expect(formatAttribution([])).toBe('');
    expect(formatAttribution([kid('Aarav')])).toBe('For Aarav');
    expect(formatAttribution([kid('Aarav'), kid('Mira')])).toBe('For Aarav & Mira');
    expect(formatAttribution([kid('Aarav'), kid('Mira'), kid('Kabir')])).toBe(
      'For Aarav, Mira & Kabir',
    );
  });
});
