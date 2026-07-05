import type {
  ExtraKind,
  GetPlansResponse,
  PlanDayRow,
  PlanHistoryResponse,
  PlanMainAssignmentRow,
  PlanSlotRow,
  PlanSlotVariationRow,
  PlanTileSummary,
  SlotKind,
  Weekday,
} from '@hivekitchen/types';

// Story 3-DM-C1 Phase 9b part 4 step 4 — bridge between the canonical tree
// response (main_assignments + days + slots + variations) and the page-level
// rendering surface. The brief composer is responsible for projecting recipe
// display data into BriefStateRow.plan_tile_summaries; the PlanPage /
// PlanHistoryPage surface reads the raw tree and renders the calendar grid
// directly. Recipe display name + ingredient list projection onto the GET
// /v1/plans response is its own follow-up slice; until then the dish line
// renders empty ("Plan pending" empty state) on these two pages — BriefCanvas
// is unaffected because it draws from brief_state.

const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const NON_SATURDAY_WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
] as const;

// Per-slot view for ONE day. The picker dispatches per-operation against
// these (swapMain via main_assignment_id, swapSlotRecipe via plan_slot_id,
// updateVariation via plan_slot_variation_id). When a kind isn't present
// on the day the field is undefined — the picker hides that option.
export interface DaySlotView {
  readonly slot_kind: SlotKind;
  readonly plan_slot_id: string;
  readonly recipe_id: string | null;
  // Story 3-S40 — snack slots carry snack_sku_id instead of recipe_id.
  readonly snack_sku_id: string | null;
  readonly main_assignment_id: string | null;
  readonly extra_kind: ExtraKind | null;
  readonly variations: readonly PlanSlotVariationRow[];
}

// Per-day tree view. paused mirrors plan_days.paused_at !== null. The
// `slots` array preserves the API's order; `mainSlot` / `snackSlot` /
// `extraSlot` are convenience lookups for the picker.
export interface DayTreeView {
  readonly day: Weekday;
  readonly plan_day_id: string | null;
  readonly paused: boolean;
  readonly slots: readonly DaySlotView[];
  readonly mainSlot: DaySlotView | null;
  readonly snackSlot: DaySlotView | null;
  readonly extraSlot: DaySlotView | null;
}

// Build per-day views from the tree arrays. Days the API didn't return
// (e.g. Saturday for a Mon-Fri household) still produce a stub view so the
// calendar grid renders a uniform five/six-wide row.
function buildDayViews(
  source: {
    days?: readonly PlanDayRow[];
    slots?: readonly PlanSlotRow[];
    variations?: readonly PlanSlotVariationRow[];
  },
  options: { includeSaturday?: boolean } = {},
): DayTreeView[] {
  const includeSaturday = options.includeSaturday ?? false;
  const orderedDays = includeSaturday ? WEEKDAYS : NON_SATURDAY_WEEKDAYS;
  const days = source.days ?? [];
  const slots = source.slots ?? [];
  const variations = source.variations ?? [];

  const dayByWeekday = new Map<Weekday, PlanDayRow>();
  for (const d of days) dayByWeekday.set(d.day, d);

  const slotsByDayId = new Map<string, PlanSlotRow[]>();
  for (const s of slots) {
    const bucket = slotsByDayId.get(s.plan_day_id);
    if (bucket === undefined) slotsByDayId.set(s.plan_day_id, [s]);
    else bucket.push(s);
  }

  const variationsBySlotId = new Map<string, PlanSlotVariationRow[]>();
  for (const v of variations) {
    const bucket = variationsBySlotId.get(v.plan_slot_id);
    if (bucket === undefined) variationsBySlotId.set(v.plan_slot_id, [v]);
    else bucket.push(v);
  }

  return orderedDays.map((weekday) => {
    const dayRow = dayByWeekday.get(weekday);
    if (dayRow === undefined) {
      return {
        day: weekday,
        plan_day_id: null,
        paused: false,
        slots: [],
        mainSlot: null,
        snackSlot: null,
        extraSlot: null,
      };
    }
    const rawSlots = slotsByDayId.get(dayRow.id) ?? [];
    const slots: DaySlotView[] = rawSlots.map((s) => ({
      slot_kind: s.slot_kind,
      plan_slot_id: s.id,
      recipe_id: s.recipe_id,
      snack_sku_id: (s as { snack_sku_id?: string | null }).snack_sku_id ?? null,
      main_assignment_id: s.main_assignment_id,
      extra_kind: s.extra_kind,
      variations: variationsBySlotId.get(s.id) ?? [],
    }));
    return {
      day: weekday,
      plan_day_id: dayRow.id,
      paused: dayRow.paused_at !== null,
      slots,
      mainSlot: slots.find((s) => s.slot_kind === 'main') ?? null,
      snackSlot: slots.find((s) => s.slot_kind === 'snack') ?? null,
      extraSlot: slots.find((s) => s.slot_kind === 'extra') ?? null,
    };
  });
}

// Lookup helper for swapMain dispatch: a slot's main_assignment_id is the
// canonical handle but the picker may know only the slot view. This map
// is built from `main_assignments[]` so the picker can resolve M-rows
// (e.g. "swap this Main affects every day pointing at it").
function buildMainAssignmentMap(
  mainAssignments: readonly PlanMainAssignmentRow[] | undefined,
): ReadonlyMap<string, PlanMainAssignmentRow> {
  return new Map((mainAssignments ?? []).map((m) => [m.id, m]));
}

// Adapter from a per-day tree view → PlanTileSummary, the shape PlanTile
// consumes. Recipe display name + ingredient projection lands in a follow-up
// slice; until then `ingredients` is populated with the variation's `add_ons`
// strings (best available human-readable signal) and empty otherwise.
// `plan_item_id` is reused as the variation row id so the tile retains a
// stable key per (child, slot) entry — DisambiguationPicker doesn't use it
// in the tree-shape flow.
function dayViewToPlanTileSummary(view: DayTreeView): PlanTileSummary {
  const items: PlanTileSummary['items'] = [];
  for (const slot of view.slots) {
    for (const v of slot.variations) {
      items.push({
        plan_item_id: v.id,
        child_id: v.child_id,
        slot: slot.slot_kind,
        // Variation add-ons surface as the dish-line preview when no recipe-
        // level ingredient projection exists yet. Empty array → "Plan pending".
        ingredients: v.add_ons,
        ...(slot.recipe_id !== null ? { recipe_id: slot.recipe_id } : {}),
        // Story 3-S40 — carry snack_sku_id; name resolution on the raw-tree
        // PlanPage surface lands with the recipe-name projection follow-up.
        ...(slot.snack_sku_id !== null ? { snack_sku_id: slot.snack_sku_id } : {}),
      });
    }
  }
  return {
    day: view.day,
    paused: view.paused,
    lunch_link_suppressed_children: [],
    child_ratings: {},
    items,
  };
}

// Build the set of distinct child UUIDs in first-appearance order. Used by
// PlanPage to derive a stable child→color map across the week.
function buildChildIdOrder(
  source: { variations?: readonly PlanSlotVariationRow[] },
): readonly string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const v of source.variations ?? []) {
    if (!seen.has(v.child_id)) {
      seen.add(v.child_id);
      order.push(v.child_id);
    }
  }
  return order;
}

// Convenience: full extraction from a GET /v1/plans tree response.
export function adaptPlansResponse(
  response: GetPlansResponse,
  options: { includeSaturday?: boolean } = {},
): {
  dayViews: DayTreeView[];
  summaries: PlanTileSummary[];
  mainAssignments: ReadonlyMap<string, PlanMainAssignmentRow>;
  childIdOrder: readonly string[];
} {
  const dayViews = buildDayViews(response, options);
  return {
    dayViews,
    summaries: dayViews.map(dayViewToPlanTileSummary),
    mainAssignments: buildMainAssignmentMap(response.main_assignments),
    childIdOrder: buildChildIdOrder(response),
  };
}

// Convenience: same extraction from a PlanHistoryResponse.
export function adaptHistoryResponse(
  response: PlanHistoryResponse,
  options: { includeSaturday?: boolean } = {},
): {
  dayViews: DayTreeView[];
  summaries: PlanTileSummary[];
  mainAssignments: ReadonlyMap<string, PlanMainAssignmentRow>;
} {
  const dayViews = buildDayViews(response, options);
  return {
    dayViews,
    summaries: dayViews.map(dayViewToPlanTileSummary),
    mainAssignments: buildMainAssignmentMap(response.main_assignments),
  };
}
