import { useMemo } from 'react';
import type { BriefStateRow, ClearedAllergyEntry } from '@hivekitchen/types';
import { useBriefStateQuery } from './useBriefStateQuery.js';
import { usePlanQuery } from './queries.js';
import { adaptPlansResponse, type DayTreeView } from './tree-adapter.js';
import type { ChildDotColor, ChildInfo } from './PlanTile.js';
import type { AllergyUncertaintyFlaggedItem } from './AllergyUncertaintyBanner.js';
import type { PlanEditDay } from '@/stores/lumi.store.js';

const CHILD_COLORS: readonly ChildDotColor[] = ['foliage', 'lumi-terracotta'];

// 13-s10 (D1 review fix) — BriefCanvas tile taps summon Lumi, same as PlanPage.
// Exported for summonForDay in BriefCanvas (interaction glue that lives with the
// component); editableDays below derives from FULL_TO_SHORT.
export const FULL_TO_SHORT: Record<string, PlanEditDay> = {
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
  saturday: 'sat',
};
export const SHORT_DAY_LABEL: Record<PlanEditDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

// Slice 5-S3 — map each weekday name to the plan week's ISO date (Mon-anchored)
// so PackerChip can PATCH the right /days/:date/packer and the day rows can
// display their dates. 14-s3 (review D1): anchored on the plan's week_of when
// available — the wall clock lies on Sundays, when the freshly composed Brief
// is NEXT week's plan but the calendar week hasn't rolled yet. Wall-clock
// fallback covers the window before the plan query resolves.
function getWeekDates(weekOf?: string): Record<string, string> {
  let monday: Date;
  const anchored = weekOf !== undefined ? new Date(`${weekOf}T00:00:00`) : null;
  if (anchored !== null && !isNaN(anchored.getTime())) {
    monday = anchored;
  } else {
    const today = new Date();
    const dow = today.getDay(); // 0=Sun
    monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  }
  const offsets: Record<string, number> = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
    saturday: 5,
  };
  return Object.fromEntries(
    Object.entries(offsets).map(([day, offset]) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + offset);
      // Use local-date components to avoid UTC rollover for UTC+ users.
      const yyyy = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return [day, `${yyyy}-${mo}-${dd}`];
    }),
  );
}

function buildChildColorMap(
  clearedAllergies: ClearedAllergyEntry[],
): ReadonlyMap<string, ChildInfo> {
  const map = new Map<string, ChildInfo>();
  let idx = 0;
  for (const entry of clearedAllergies) {
    if (!map.has(entry.child_id)) {
      map.set(entry.child_id, {
        name: entry.child_name,
        color: CHILD_COLORS[idx % CHILD_COLORS.length]!,
      });
      idx++;
    }
  }
  return map;
}

// Story 14-s1 — the Brief's data layer. Extracted verbatim from BriefCanvas so
// the surface renders a ready view-model with no fetching/derivation in its body.
// This assembles the client-side view-model (§12-A decision: stays client-side);
// the dual-source reconciliation (brief payload + raw plan tree) and its
// pre-migration guards are preserved exactly.
export function useBriefView(householdId: string | null) {
  const { data, isLoading, isError, isStale, isFetching, error } = useBriefStateQuery(householdId);
  // Story pre-4-s3 — the plan endpoint carries compound-uncertain flagged_items
  // when the hard-fail audit row signals AllergyUncertaintyBanner is needed.
  // Gated on householdId so the query doesn't fire pre-auth.
  const { data: planData, isLoading: isPlanLoading } = usePlanQuery('current', {
    enabled: householdId !== null,
  });
  // Slice 5-S3 / 14-s3 — the plan week's date per weekday, for the PackerChip
  // below each row and the row's date line. Anchored on week_of (see getWeekDates).
  const weekDates = useMemo(() => getWeekDates(planData?.week_of), [planData?.week_of]);
  const flaggedItemsRaw = planData?.flagged_items ?? [];
  // The route returns `hard_fail` whenever a plan.hard_fail audit row exists for
  // the week (plans.routes.ts), independently of `flagged_items` — only
  // compound-uncertain rejections carry flags. Infrastructure-uncertain
  // verdicts (no_rules_loaded, falcpa_baseline_missing, decrypt failures),
  // `blocked` verdicts (which populate `conflicts`, not `flagged_items`) and
  // planner retry exhaustion all hard-fail with zero flags. This value was
  // previously never read, so those weeks fell through to BriefEmptyState and
  // sat on "Lumi is preparing your first plan" forever.
  const hardFail = planData?.hard_fail ?? null;
  // Story 3-DM-C1 Phase 9b part 4 step 4 — DisambiguationPicker takes a
  // DayTreeView (the canonical tree slice for the active day). The brief surface
  // renders tiles from brief_state.plan_tile_summaries (composer-fed; carries
  // recipe display data), but the picker dispatches against the raw tree so it
  // can resolve plan_slot_id / variation_id / main_assignment_id correctly.
  const dayViewsByDay = useMemo(() => {
    const out = new Map<DayTreeView['day'], DayTreeView>();
    if (planData === undefined) return out;
    for (const view of adaptPlansResponse(planData).dayViews) {
      out.set(view.day, view);
    }
    return out;
  }, [planData]);

  const brief: BriefStateRow | null = data?.brief ?? null;
  // Story 3-DM-D1 — the brief's tile_summaries / cleared_allergies /
  // scaffolding_diff / plan_state now live under brief.payload. Guard: hkFetch
  // returns raw JSON without Zod parsing, so payload (or a sub-field) may be
  // absent on a pre-migration cached response — default each to prevent a crash.
  const payload = brief?.payload;
  const clearedAllergies = useMemo(() => payload?.cleared_allergies ?? [], [payload]);
  const tileSummaries = useMemo(() => payload?.tile_summaries ?? [], [payload]);
  const scaffoldingDiff = payload?.scaffolding_diff ?? null;
  const planState = payload?.plan_state ?? null;
  const planStateMessage = payload?.plan_state_message ?? null;
  // Slice 5-S8 — "I noticed" learning-moment callout (null below threshold).
  const learningMomentCallout = payload?.learning_moment_callout ?? null;
  // Slice 5-S9 — "Why this?" plan reasoning (null when no plan has set it).
  const planReasoning = payload?.plan_reasoning ?? null;
  const childColorMap = useMemo(
    () => buildChildColorMap(clearedAllergies),
    // Intentional: memo keyed on the JSON value of clearedAllergies, not its
    // array reference (react-hooks/exhaustive-deps is not linted in .ts files).
    [JSON.stringify(clearedAllergies)],
  );

  // Story pre-4-s3 — map flagged_items (child_id only) to banner shape
  // (childName + childId). Resolve from cleared_allergies; fall back to a
  // generic label so the banner is still informative when no prior plan has
  // cleared (first-ever hard-fail, brief is null).
  const flaggedItems = useMemo<readonly AllergyUncertaintyFlaggedItem[]>(() => {
    if (flaggedItemsRaw.length === 0) return [];
    const nameById = new Map<string, string>();
    for (const entry of clearedAllergies) {
      if (!nameById.has(entry.child_id)) nameById.set(entry.child_id, entry.child_name);
    }
    return flaggedItemsRaw.map((item: typeof flaggedItemsRaw[number]) => ({
      childId: item.child_id,
      childName: nameById.get(item.child_id) ?? 'your child',
      ingredient: item.ingredient,
      slot: item.slot,
      day: item.day,
    }));
    // Intentional: keyed on the JSON value of the source arrays, not their refs.
  }, [JSON.stringify(flaggedItemsRaw), JSON.stringify(clearedAllergies)]);

  // brief.plan_id is null on pre-migration rows; swap UI requires it.
  const planId = brief?.plan_id ?? null;
  const canSwap = planId !== null;
  const weekConfirmed = (planData?.plan?.confirmed_at ?? null) !== null;

  // 13-s10 (D1 review fix) — childRoster dedups clearedAllergies by child_id so
  // chips are id+name pairs (same shape PlanPage derives from childColorMap).
  const childRoster = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const entry of clearedAllergies) {
      if (!seen.has(entry.child_id)) {
        seen.add(entry.child_id);
        out.push({ id: entry.child_id, name: entry.child_name });
      }
    }
    return out;
  }, [clearedAllergies]);
  const editableDays = useMemo(
    () =>
      tileSummaries
        .filter((s) => !s.paused && FULL_TO_SHORT[s.day] !== undefined)
        .map((s) => FULL_TO_SHORT[s.day]!),
    [tileSummaries],
  );

  // isError covers initial load failures (no data); error !== null also catches
  // background refetch failures where TanStack keeps cached data but sets error.
  const hasFetchError = isError || error !== null;

  return {
    brief,
    isLoading,
    isError,
    isFetching,
    isStale,
    hasFetchError,
    planData,
    isPlanLoading,
    weekDates,
    clearedAllergies,
    tileSummaries,
    scaffoldingDiff,
    planState,
    planStateMessage,
    learningMomentCallout,
    planReasoning,
    childColorMap,
    flaggedItems,
    hardFail,
    planId,
    canSwap,
    weekConfirmed,
    childRoster,
    editableDays,
    dayViewsByDay,
  };
}

// The ready-to-render Brief view-model (AC2). Named for S2/S3 consumers that
// need to type a `BriefView` without re-deriving the hook's return shape.
export type BriefView = ReturnType<typeof useBriefView>;
