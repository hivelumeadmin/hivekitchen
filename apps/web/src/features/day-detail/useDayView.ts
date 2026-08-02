import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { GetRecipeResponseSchema, ListChildrenResponseSchema } from '@hivekitchen/contracts';
import { hkFetch } from '@/lib/fetch.js';
import { usePlanQuery } from '@/features/plan/queries.js';
import { adaptPlansResponse } from '@/features/plan/tree-adapter.js';
import { useBriefStateQuery } from '@/features/plan/useBriefStateQuery.js';
import {
  collectRecipeIds,
  projectWeekPlan,
  type DayInput,
  type RecipeContent,
  type WeekPlan,
} from './day-view-model.js';

// Story 14-s4 — the day-detail data layer. This is the ONE file in the feature
// that reaches into `features/plan`: the plan tree and brief projection are the
// day view's source data, and both queries are already warm because the day
// sheet renders OVER the Brief. The projection itself (`projectWeekPlan`) is
// pure and lives in day-view-model.ts.

function useChildrenRoster(householdId: string | null) {
  return useQuery({
    queryKey: ['children', householdId],
    queryFn: async ({ signal }) => {
      const raw = await hkFetch<unknown>(`/v1/households/${householdId ?? ''}/children`, {
        method: 'GET',
        signal,
      });
      return ListChildrenResponseSchema.parse(raw);
    },
    enabled: householdId !== null,
    staleTime: 5 * 60_000,
  });
}

export interface DayView {
  readonly week: WeekPlan | null;
  readonly isLoading: boolean;
  readonly hasRecipeError: boolean;
  readonly refetchRecipes: () => void;
  // The plan query failed — the week is UNKNOWN, not empty. Callers must not
  // render the empty-week copy while this is true.
  readonly hasPlanError: boolean;
  readonly retryPlan: () => void;
}

export function useDayView(householdId: string | null): DayView {
  const planQuery = usePlanQuery('current', {
    enabled: householdId !== null,
  });
  const { data: planData, isLoading: isPlanLoading } = planQuery;
  const { data: briefData, isLoading: isBriefLoading } = useBriefStateQuery(householdId);
  const roster = useChildrenRoster(householdId);

  // includeSaturday: the wall card renders every planned day — a Saturday
  // school week must not be silently dropped (default excludes it for the
  // Brief's 5-column grid).
  const adapted = useMemo(
    () => (planData === undefined ? null : adaptPlansResponse(planData, { includeSaturday: true })),
    [planData],
  );

  // DayTreeView/DaySlotView are structurally the projection's DayInput/SlotInput
  // (day-view-model types them structurally on purpose); the cast names that.
  const days = useMemo<DayInput[]>(
    () => (adapted?.dayViews ?? []) as unknown as DayInput[],
    [adapted],
  );

  const mainAssignmentSequenceById = useMemo(() => {
    const out = new Map<string, number>();
    for (const [id, row] of adapted?.mainAssignments ?? []) out.set(id, row.sequence);
    return out;
  }, [adapted]);

  // main_assignment_id → recipe_id. Main slots never carry recipe_id (the
  // plan_slots_main_uses_assignment CHECK forces it NULL) — the assignment row
  // is the ONLY place the Main's recipe lives.
  const mainAssignmentRecipeById = useMemo(() => {
    const out = new Map<string, string>();
    for (const [id, row] of adapted?.mainAssignments ?? []) out.set(id, row.recipe_id);
    return out;
  }, [adapted]);

  const recipeIds = useMemo(
    () => collectRecipeIds(days, mainAssignmentRecipeById),
    [days, mainAssignmentRecipeById],
  );

  // One query per distinct recipe: React Query dedupes and caches each id, so a
  // 3-Main week costs three requests on first open and none afterwards.
  const recipeQueries = useQueries({
    queries: recipeIds.map((id) => ({
      queryKey: ['recipe', id],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const raw = await hkFetch<unknown>(`/v1/recipes/${id}`, { method: 'GET', signal });
        return GetRecipeResponseSchema.parse(raw);
      },
      staleTime: 30 * 60_000,
    })),
  });

  // Keyed on WHICH recipes have resolved AND when their data last changed —
  // status alone misses a success→success refetch that returns new content
  // (dataUpdatedAt bumps on every fresh payload). Not the query-object
  // identities: useQueries returns fresh objects every render.
  const resolvedKey = recipeQueries
    .map((q) => `${q.status}:${String(q.dataUpdatedAt)}`)
    .join('|');
  const recipes = useMemo(() => {
    const out = new Map<string, RecipeContent>();
    recipeQueries.forEach((q, i) => {
      const id = recipeIds[i];
      if (id !== undefined && q.data !== undefined) out.set(id, q.data);
    });
    return out;
  }, [recipeIds, resolvedKey]);

  const week = useMemo<WeekPlan | null>(() => {
    if (planData === undefined) return null;
    return projectWeekPlan({
      weekId: planData.week_of,
      days,
      mainAssignmentSequenceById,
      mainAssignmentRecipeById,
      recipes,
      tileSummaries: briefData?.brief?.payload?.tile_summaries ?? [],
      children: roster.data?.children ?? [],
      weekDates: buildWeekDates(planData.week_of),
    });
  }, [
    planData,
    days,
    mainAssignmentSequenceById,
    mainAssignmentRecipeById,
    recipes,
    briefData,
    roster.data,
  ]);

  return {
    week,
    isLoading: isPlanLoading || isBriefLoading || roster.isLoading,
    hasRecipeError: recipeQueries.some((q) => q.isError),
    refetchRecipes: () => {
      for (const q of recipeQueries) void q.refetch();
    },
    hasPlanError: planQuery.isError,
    retryPlan: () => {
      void planQuery.refetch();
    },
  };
}

// Anchored on the plan's week_of, mirroring useBriefView (14-s3 review D1): the
// wall clock lies on Sundays, when the composed plan is next week's.
function buildWeekDates(weekOf: string): Record<string, string> {
  const monday = new Date(`${weekOf}T00:00:00`);
  if (isNaN(monday.getTime())) return {};
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
      const yyyy = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return [day, `${yyyy}-${mo}-${dd}`];
    }),
  );
}
