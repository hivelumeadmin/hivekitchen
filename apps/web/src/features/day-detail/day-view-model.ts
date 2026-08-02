// Story 14-s4 — the day-detail view model.
//
// These types were previously owned by `data/multiChildMockData.ts`, which made
// the shipped Wall Card structurally dependent on a mock fixture. They now live
// here; the mock literal and the live projection are two producers of the same
// model.
//
// `projectWeekPlan` is pure and its inputs are typed STRUCTURALLY rather than
// imported from `features/plan` — the projection stays testable without React
// or the plan feature, and `useDayView.ts` is the single file that reaches
// across the feature boundary.

export type ChildDotColor = 'foliage' | 'lumi-terracotta' | 'sacred';

type AgeBand = 'toddler' | 'child' | 'preteen' | 'teen';

export interface ChildPerson {
  readonly id: string;
  readonly name: string;
  readonly color: ChildDotColor;
  readonly ageBand: AgeBand;
}

export type CookingMode = 'prep' | 'finish';

interface MethodStep {
  readonly text: string;
  readonly mode: CookingMode;
}

interface MainRecipe {
  readonly id: string;
  readonly title: string;
  readonly ingredients: readonly string[];
  readonly method: readonly MethodStep[];
  readonly prepMinutes: number;
  readonly finishMinutes: number;
  // Whether the cook already knows this recipe (recipe-vs-method rule): it
  // drives whether the method starts expanded and whether a familiarity line is
  // printed. UNDEFINED means "no signal" — the live projection emits undefined
  // because nothing in the data records familiarity yet, so the method expands
  // and no unsupported "New recipe" claim is made.
  readonly familiarityKnown?: boolean;
}

type PortionSize = 'small' | 'regular' | 'large';
type TextureLevel = 'soft' | 'normal' | 'diced' | 'finger';
type SpiceLevel = 'mild' | 'regular' | 'spicy';

export interface ChildVariation {
  readonly childId: string;
  readonly portionSize: PortionSize;
  readonly texture: TextureLevel;
  readonly spiceLevel: SpiceLevel;
  readonly cuttingStyle?: string;
  readonly container?: string;
  readonly addOns: readonly string[];
  readonly removals: readonly string[];
  readonly notes?: string;
  // True when this child is paused for the day (variation paused_at set via
  // PATCH …/pause-child). Drives the chip's paused state and disables the
  // "Pause for <child>" action.
  readonly paused?: boolean;
}

interface SnackEntry {
  readonly title: string;
  readonly ingredients: readonly string[];
  readonly perChildVariation?: Readonly<Record<string, string>>;
}

export type OptionalExtraKind =
  | 'drink'
  | 'extra_snack'
  | 'protein_boost'
  | 'sports_add'
  | 'sweet'
  | 'toddler_safe'
  | 'allergy_substitute'
  | 'custom';

export interface OptionalExtra {
  readonly kind: OptionalExtraKind;
  readonly title: string;
  readonly perChildAssignment: Readonly<Record<string, 'included' | 'excluded'>>;
}

interface PrepInvestment {
  readonly savedMinutes: number;
  readonly label: string;
}

type DayName =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export interface DayPlan {
  readonly id: string;
  readonly dayName: DayName;
  readonly dateLabel: string;
  readonly mainGroupId: string;
  readonly mainGroupNote?: string;
  readonly main: MainRecipe;
  readonly variations: readonly ChildVariation[];
  readonly snack: SnackEntry;
  readonly optionalExtra?: OptionalExtra;
  // Mock-only today: no data source records what weekend prep saved. The live
  // projection never sets it, so the Wall Card's rollup line self-hides.
  readonly prepInvestment?: PrepInvestment;
  readonly paused: boolean;
}

export interface WeekPlan {
  readonly id: string;
  readonly children: readonly ChildPerson[];
  readonly days: readonly DayPlan[];
}

export function formatAttribution(kids: readonly ChildPerson[]): string {
  if (kids.length === 0) return '';
  if (kids.length === 1) return `For ${kids[0]!.name}`;
  if (kids.length === 2) return `For ${kids[0]!.name} & ${kids[1]!.name}`;
  const head = kids
    .slice(0, -1)
    .map((k) => k.name)
    .join(', ');
  const last = kids[kids.length - 1]!.name;
  return `For ${head} & ${last}`;
}

// ---------------------------------------------------------------------------
// Live projection
// ---------------------------------------------------------------------------

export interface VariationInput {
  readonly child_id: string;
  readonly portion_size: PortionSize;
  readonly texture: TextureLevel;
  readonly spice_level: SpiceLevel;
  readonly cutting_style: string | null;
  readonly container: string | null;
  readonly add_ons: readonly string[];
  readonly removals: readonly string[];
  readonly notes: string | null;
  readonly paused_at: string | null;
}

export interface SlotInput {
  readonly slot_kind: 'main' | 'snack' | 'extra';
  readonly recipe_id: string | null;
  readonly snack_sku_id: string | null;
  readonly main_assignment_id: string | null;
  readonly extra_kind: string | null;
  readonly variations: readonly VariationInput[];
}

export interface DayInput {
  readonly day: DayName;
  readonly plan_day_id: string | null;
  readonly paused: boolean;
  readonly slots: readonly SlotInput[];
}

export interface RecipeContent {
  readonly recipe: {
    readonly id: string;
    readonly canonical_name: string;
    readonly ingredients: readonly string[];
    readonly prep_time_minutes: number | null;
    readonly finish_time_minutes: number | null;
  };
  readonly steps: readonly { readonly sequence: number; readonly mode: CookingMode; readonly text: string }[];
}

interface RosterEntry {
  readonly id: string;
  readonly name: string;
  readonly age_band: AgeBand;
}

// Names resolved by the brief composer (14-s3): snack-SKU display names and
// recipe names, keyed by day then slot kind. Used for the snack/extra titles,
// which have no recipe row of their own to read a name from.
interface TileNameInput {
  // `slot` is a plain string: the brief payload is hkFetch'd raw (no Zod parse
  // on the web side), so it is not narrowed to the slot union at this boundary.
  readonly day: string;
  readonly items: readonly {
    readonly slot: string;
    readonly name?: string;
  }[];
}

export interface ProjectWeekPlanInput {
  readonly weekId: string;
  readonly days: readonly DayInput[];
  readonly mainAssignmentSequenceById: ReadonlyMap<string, number>;
  // main_assignment_id → recipe_id, built from main_assignments[]. Main slots
  // NEVER carry recipe_id themselves (plan_slots_main_uses_assignment CHECK) —
  // the assignment row is the only source of the Main's recipe.
  readonly mainAssignmentRecipeById: ReadonlyMap<string, string>;
  readonly recipes: ReadonlyMap<string, RecipeContent>;
  readonly tileSummaries: readonly TileNameInput[];
  readonly children: readonly RosterEntry[];
  readonly weekDates: Readonly<Record<string, string>>;
}

const CHILD_COLORS: readonly ChildDotColor[] = ['foliage', 'lumi-terracotta', 'sacred'];

const DAY_ORDINAL: Record<DayName, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DAY_LABEL: Record<DayName, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
};

const EXTRA_KINDS: readonly OptionalExtraKind[] = [
  'drink',
  'extra_snack',
  'protein_boost',
  'sports_add',
  'sweet',
  'toddler_safe',
  'allergy_substitute',
  'custom',
];

// Locale pinned to en-US to match the Brief's day rows (14-s3): the surrounding
// copy is fixed English and tests assert the rendered text.
function formatDateLabel(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '';
  const parsed = new Date(`${iso}T00:00:00`);
  if (isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toChildVariation(v: VariationInput): ChildVariation {
  return {
    childId: v.child_id,
    portionSize: v.portion_size,
    texture: v.texture,
    spiceLevel: v.spice_level,
    ...(v.cutting_style !== null ? { cuttingStyle: v.cutting_style } : {}),
    ...(v.container !== null ? { container: v.container } : {}),
    addOns: v.add_ons,
    removals: v.removals,
    ...(v.notes !== null ? { notes: v.notes } : {}),
    ...(v.paused_at !== null ? { paused: true } : {}),
  };
}

// The recipe a slot points at: main slots dereference through their
// main_assignment, every other slot carries recipe_id directly.
function slotRecipeId(
  slot: SlotInput,
  mainAssignmentRecipeById: ReadonlyMap<string, string>,
): string | null {
  if (slot.slot_kind === 'main' && slot.main_assignment_id !== null) {
    return mainAssignmentRecipeById.get(slot.main_assignment_id) ?? slot.recipe_id;
  }
  return slot.recipe_id;
}

function tileName(
  tileSummaries: readonly TileNameInput[],
  day: DayName,
  slot: 'main' | 'snack' | 'extra',
): string | undefined {
  const tile = tileSummaries.find((t) => t.day === day);
  return tile?.items.find((i) => i.slot === slot && i.name !== undefined)?.name;
}

/**
 * Project the live plan tree + fetched recipe content into the Wall Card's
 * week model. Pure: every input is already resolved by `useDayView`.
 *
 * Days with no plan row (`plan_day_id === null` — the tree adapter emits a stub
 * per weekday) are dropped: there is nothing to cook.
 */
export function projectWeekPlan(input: ProjectWeekPlanInput): WeekPlan {
  const children: ChildPerson[] = input.children.map((c, i) => ({
    id: c.id,
    name: c.name,
    color: CHILD_COLORS[i % CHILD_COLORS.length]!,
    ageBand: c.age_band,
  }));

  const { mainAssignmentRecipeById } = input;

  const planned = input.days.filter((d) => d.plan_day_id !== null);

  const days: DayPlan[] = planned.map((day, index) => {
    const mainSlot = day.slots.find((s) => s.slot_kind === 'main') ?? null;
    const snackSlot = day.slots.find((s) => s.slot_kind === 'snack') ?? null;
    const extraSlot = day.slots.find((s) => s.slot_kind === 'extra') ?? null;

    const mainRecipeId =
      mainSlot !== null ? slotRecipeId(mainSlot, mainAssignmentRecipeById) : null;
    const content = mainRecipeId !== null ? input.recipes.get(mainRecipeId) : undefined;

    const sequence =
      mainSlot?.main_assignment_id !== null && mainSlot?.main_assignment_id !== undefined
        ? input.mainAssignmentSequenceById.get(mainSlot.main_assignment_id)
        : undefined;

    // "Same as Monday" — only when the PREVIOUS CALENDAR day shares this day's
    // main assignment. Array adjacency alone would misreport across a day the
    // composer omitted (14-s3 review finding).
    const previous = index > 0 ? planned[index - 1] : undefined;
    const previousMainAssignment =
      previous?.slots.find((s) => s.slot_kind === 'main')?.main_assignment_id ?? null;
    const sharesWithPrevious =
      previous !== undefined &&
      mainSlot?.main_assignment_id !== null &&
      mainSlot?.main_assignment_id !== undefined &&
      previousMainAssignment === mainSlot.main_assignment_id &&
      DAY_ORDINAL[day.day] - DAY_ORDINAL[previous.day] === 1;

    const snackTitle = tileName(input.tileSummaries, day.day, 'snack');
    const snackRecipe =
      snackSlot?.recipe_id !== null && snackSlot?.recipe_id !== undefined
        ? input.recipes.get(snackSlot.recipe_id)
        : undefined;
    const perChildSnackNotes: Record<string, string> = {};
    for (const v of snackSlot?.variations ?? []) {
      if (v.notes !== null && v.notes !== '') perChildSnackNotes[v.child_id] = v.notes;
    }

    const extraTitle = tileName(input.tileSummaries, day.day, 'extra');
    const extraKind: OptionalExtraKind =
      extraSlot?.extra_kind !== null &&
      extraSlot?.extra_kind !== undefined &&
      (EXTRA_KINDS as readonly string[]).includes(extraSlot.extra_kind)
        ? (extraSlot.extra_kind as OptionalExtraKind)
        : 'custom';
    const perChildAssignment: Record<string, 'included' | 'excluded'> = {};
    if (extraSlot !== null) {
      const included = new Set(extraSlot.variations.map((v) => v.child_id));
      for (const child of children) {
        perChildAssignment[child.id] = included.has(child.id) ? 'included' : 'excluded';
      }
    }

    return {
      id: day.plan_day_id!,
      dayName: day.day,
      dateLabel: formatDateLabel(input.weekDates[day.day]),
      mainGroupId: sequence !== undefined ? `M${String(sequence)}` : '',
      ...(sharesWithPrevious ? { mainGroupNote: `Same as ${DAY_LABEL[previous.day]}` } : {}),
      main: {
        id: mainRecipeId ?? '',
        title: content?.recipe.canonical_name ?? tileName(input.tileSummaries, day.day, 'main') ?? '',
        ingredients: content?.recipe.ingredients ?? [],
        method: (content?.steps ?? [])
          .slice()
          .sort((a, b) => a.sequence - b.sequence)
          .map((s) => ({ text: s.text, mode: s.mode })),
        prepMinutes: content?.recipe.prep_time_minutes ?? 0,
        finishMinutes: content?.recipe.finish_time_minutes ?? 0,
        // familiarityKnown is deliberately left unset: no signal exists, so the
        // method shows and the card makes no claim either way.
      },
      variations: (mainSlot?.variations ?? []).map(toChildVariation),
      snack: {
        title: snackTitle ?? snackRecipe?.recipe.canonical_name ?? '',
        ingredients: snackRecipe?.recipe.ingredients ?? [],
        ...(Object.keys(perChildSnackNotes).length > 0
          ? { perChildVariation: perChildSnackNotes }
          : {}),
      },
      ...(extraSlot !== null && (extraTitle ?? '') !== ''
        ? {
            optionalExtra: {
              kind: extraKind,
              title: extraTitle!,
              perChildAssignment,
            },
          }
        : {}),
      paused: day.paused,
    };
  });

  return { id: input.weekId, children, days };
}

// The distinct recipe ids a week's plan tree needs content for. `useDayView`
// fans these out as one query each so the 3-Main week costs ~3 cached fetches.
// `mainAssignmentRecipeById` comes from main_assignments[] — main slots never
// carry recipe_id (DB CHECK), so the assignment map is the only source.
export function collectRecipeIds(
  days: readonly DayInput[],
  mainAssignmentRecipeById: ReadonlyMap<string, string>,
): string[] {
  const ids = new Set<string>();
  for (const day of days) {
    if (day.plan_day_id === null) continue;
    for (const slot of day.slots) {
      const id = slotRecipeId(slot, mainAssignmentRecipeById);
      if (id !== null) ids.add(id);
    }
  }
  return [...ids];
}
