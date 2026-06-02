import { BaseRepository } from '../../repository/base.repository.js';
import type {
  CommitPlanInput,
  CommitPlanTreeInput,
  PauseReason,
  PlanDayRow,
  PlanItemRow,
  PlanItemSwapSummary,
  PlanMainAssignmentRow,
  PlanRow,
  PlanSlotRow,
  PlanSlotVariationRow,
  PortionSize,
  SpiceLevel,
  TextureLevel,
  Weekday,
} from '@hivekitchen/types';
import { getCurrentWeekMonday } from '../../lib/derive-week-id.js';

const PLAN_COLUMNS =
  'id, household_id, week_id, week_of, revision, generated_at, guardrail_cleared_at, guardrail_version, prompt_version, created_at, updated_at';

const PLAN_ITEM_COLUMNS =
  'id, plan_id, child_id, day, slot, recipe_id, item_id, ingredients, paused_at, replaced_by_plan_id, created_at, updated_at';

// Story 3-DM-C1 — column constants for the tree-shape tables.
const PLAN_MAIN_ASSIGNMENT_COLUMNS =
  'id, plan_id, sequence, recipe_id, created_at';

const PLAN_DAY_COLUMNS =
  'id, plan_id, day, paused_at, paused_reason, paused_note, created_at, updated_at';

const PLAN_SLOT_COLUMNS =
  'id, plan_day_id, slot_kind, main_assignment_id, recipe_id, extra_kind, paused_at, created_at, updated_at';

const PLAN_SLOT_VARIATION_COLUMNS =
  'id, plan_slot_id, child_id, portion_size, texture, spice_level, cutting_style, container, add_ons, removals, notes, paused_at, created_at, updated_at';

export class PlansRepository extends BaseRepository {
  // Presentation-bind contract: only guardrail-cleared rows ever reach the UI.
  // Architecture §3.5 — three-layer enforcement; this is the query-time layer.
  async findByIdForPresentation(opts: {
    planId: string;
    householdId: string;
  }): Promise<PlanRow | null> {
    const { data, error } = await this.client
      .from('plans')
      .select(PLAN_COLUMNS)
      .eq('id', opts.planId)
      .eq('household_id', opts.householdId)
      .not('guardrail_cleared_at', 'is', null)
      .maybeSingle();
    if (error) throw error;
    return (data as PlanRow | null) ?? null;
  }

  async findByIdForOps(opts: {
    planId: string;
    householdId: string;
  }): Promise<PlanRow | null> {
    const { data, error } = await this.client.from('plans').select(PLAN_COLUMNS).eq('id', opts.planId).eq('household_id', opts.householdId).maybeSingle(); // presentation-bypass: ops-audit
    if (error) throw error;
    return (data as PlanRow | null) ?? null;
  }

  // Story 3.14 — presentation read for a single (household, week) pair.
  // Differs from findCurrentByHousehold in intent only: maybeSingle() relies on
  // the (household_id, week_id) unique index to enforce a single row, so the
  // call surfaces a constraint violation rather than silently picking a winner.
  async findByHouseholdAndWeek(opts: {
    householdId: string;
    weekId: string;
  }): Promise<PlanRow | null> {
    const { data, error } = await this.client
      .from('plans')
      .select(PLAN_COLUMNS)
      .eq('household_id', opts.householdId)
      .eq('week_id', opts.weekId)
      .not('guardrail_cleared_at', 'is', null)
      .maybeSingle();
    if (error) throw error;
    return (data as PlanRow | null) ?? null;
  }

  async findCurrentByHousehold(opts: {
    householdId: string;
    weekId: string;
  }): Promise<PlanRow | null> {
    const { data, error } = await this.client
      .from('plans')
      .select(PLAN_COLUMNS)
      .eq('household_id', opts.householdId)
      .eq('week_id', opts.weekId)
      .not('guardrail_cleared_at', 'is', null)
      .order('revision', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as PlanRow | null) ?? null;
  }

  // Resolves the canonical plan_id for a household+week pair regardless of
  // clearance state. Used by PlansService.commit() so the commit_plan() upsert
  // always hits ON CONFLICT (id) and never violates the (household_id, week_id)
  // unique index.
  async findActiveByHouseholdAndWeek(opts: {
    householdId: string;
    weekId: string;
  }): Promise<PlanRow | null> {
    const { data, error } = await this.client
      .from('plans')
      .select(PLAN_COLUMNS)
      .eq('household_id', opts.householdId)
      .eq('week_id', opts.weekId)
      .order('revision', { ascending: false })
      .limit(1)
      .maybeSingle(); // presentation-bypass: ops-audit — plan_id lookup only, not for rendering
    if (error) throw error;
    return (data as PlanRow | null) ?? null;
  }

  // Read shape — note recipe_id / item_id are nullable here (DB returns null
  // for unset uuid columns). Used by BriefStateComposer.refresh() to build the
  // plan_tile_summaries projection.
  // Story 3.13 — filters archived items (replaced_by_plan_id IS NOT NULL)
  // because commit_plan() now archives instead of deleting on regeneration.
  async findItemsByPlanId(planId: string): Promise<PlanItemRow[]> {
    const { data, error } = await this.client
      .from('plan_items')
      .select(PLAN_ITEM_COLUMNS)
      .eq('plan_id', planId)
      .is('replaced_by_plan_id', null);
    if (error) throw error;
    return (data ?? []) as PlanItemRow[];
  }

  // Story 3.13 — returns ALL items for a plan including archived rows. Used
  // by Story 3.15 (historical plans view) and audit reconstruction only.
  // presentation-bypass: ops-history — intentional; never call for UI rendering.
  async findAllItemsByPlanId(planId: string): Promise<PlanItemRow[]> {
    const { data, error } = await this.client
      .from('plan_items')
      .select(PLAN_ITEM_COLUMNS)
      .eq('plan_id', planId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as PlanItemRow[];
  }

  // Story 3.15 — derives swap-event summaries from the archived plan_items
  // for a single plan. Each archived row (replaced_by_plan_id IS NOT NULL)
  // represents a prior version of a slot before a slot-swap (Story 3.12) or
  // day/week regeneration (Story 3.13) archived it. previous_ingredients is
  // the archived row's own ingredient list, and replaced_at is its updated_at
  // (the moment the swap landed). child_id is preserved so multi-child
  // households can attribute each swap to the correct child in the UI.
  // presentation-bypass: ops-history — intentional; only called by the
  // history view, not by the live brief surface.
  async findSwapHistory(planId: string): Promise<PlanItemSwapSummary[]> {
    const allItems = await this.findAllItemsByPlanId(planId);
    return allItems
      .filter((item) => item.replaced_by_plan_id !== null)
      .map((item) => ({
        child_id: item.child_id,
        day: item.day,
        slot: item.slot,
        previous_ingredients: item.ingredients,
        replaced_at: item.updated_at,
      }));
  }

  // Story 3.12 — fetch a single plan_item by id within a given plan.
  // Household ownership is validated at the service layer by loading the plan
  // via findByIdForPresentation (household_id WHERE clause) — not duplicated here.
  async findItemById(opts: {
    itemId: string;
    planId: string;
  }): Promise<PlanItemRow | null> {
    const { data, error } = await this.client
      .from('plan_items')
      .select(PLAN_ITEM_COLUMNS)
      .eq('id', opts.itemId)
      .eq('plan_id', opts.planId)
      .is('replaced_by_plan_id', null)  // exclude archived items from prior regenerations
      .maybeSingle();
    if (error) throw error;
    return (data as PlanItemRow | null) ?? null;
  }

  // Story 3.12 — per-slot ingredient swap. Returns the updated row. Always
  // clears paused_at: a parent who edits a slot is implicitly un-pausing it,
  // and leaving paused_at set would silently hide the new ingredients from
  // Lunch Link delivery (Epic 4 reads paused_at to skip).
  async updateItemIngredients(opts: {
    itemId: string;
    planId: string;
    ingredients: string[];
    recipeId?: string;
    itemSlotId?: string;  // maps to plan_items.item_id; named itemSlotId to avoid shadowing opts.itemId
  }): Promise<PlanItemRow> {
    const patch: Record<string, unknown> = {
      ingredients: opts.ingredients,
      paused_at: null,
      updated_at: new Date().toISOString(),
    };
    if (opts.recipeId !== undefined) patch.recipe_id = opts.recipeId;
    if (opts.itemSlotId !== undefined) patch.item_id = opts.itemSlotId;

    const { data, error } = await this.client
      .from('plan_items')
      .update(patch)
      .eq('id', opts.itemId)
      .eq('plan_id', opts.planId)
      .select(PLAN_ITEM_COLUMNS)
      .single();
    if (error) throw error;
    return data as PlanItemRow;
  }

  // Story 3.12 — sets paused_at on ALL items for a given day. Partial-child
  // pausing (one child sick, another not) is deferred — Story 3.12 treats
  // pause as a full-day operation.
  //
  // Returns the rows that were actually updated. Callers can distinguish:
  //   - empty array → no items exist for this (plan, day); caller should 422
  //   - rows already paused → app-level idempotency: caller skips audit/refresh
  //   - rows newly paused → caller writes audit + refreshes brief
  async pauseDay(opts: {
    planId: string;
    day: PlanItemRow['day'];
    pausedAt: string;
  }): Promise<PlanItemRow[]> {
    const { data, error } = await this.client
      .from('plan_items')
      .update({ paused_at: opts.pausedAt, updated_at: new Date().toISOString() })
      .eq('plan_id', opts.planId)
      .eq('day', opts.day)
      .is('paused_at', null)          // only flip rows that aren't already paused — app-level idempotency
      .is('replaced_by_plan_id', null) // exclude archived items from prior regenerations
      .select(PLAN_ITEM_COLUMNS);
    if (error) throw error;
    return (data ?? []) as PlanItemRow[];
  }

  // Story 3.19 — narrow per-slot pause used by day-level overrides
  // (bag_suspended, sick_day). Unlike pauseDay() this flips a single
  // plan_item row, leaving siblings on the same day untouched. Returns the
  // updated row when paused, or null if the item was already paused or absent.
  async pauseItemById(opts: {
    itemId: string;
    planId: string;
    pausedAt: string;
  }): Promise<PlanItemRow | null> {
    const { data, error } = await this.client
      .from('plan_items')
      .update({ paused_at: opts.pausedAt, updated_at: new Date().toISOString() })
      .eq('id', opts.itemId)
      .eq('plan_id', opts.planId)
      .is('paused_at', null)
      .is('replaced_by_plan_id', null)
      .select(PLAN_ITEM_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data as PlanItemRow | null) ?? null;
  }

  // Story 3.19 — undo the per-slot pause set by a pausing override (bag_suspended,
  // sick_day) when the parent reverts that override. Returns the updated row if
  // the slot was paused, or null if it was already unpaused (idempotent).
  async unpauseItemById(opts: {
    itemId: string;
    planId: string;
  }): Promise<PlanItemRow | null> {
    const { data, error } = await this.client
      .from('plan_items')
      .update({ paused_at: null, updated_at: new Date().toISOString() })
      .eq('id', opts.itemId)
      .eq('plan_id', opts.planId)
      .not('paused_at', 'is', null)
      .select(PLAN_ITEM_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data as PlanItemRow | null) ?? null;
  }

  // Story 3.12 — count of CURRENT (non-archived) plan_items for a (plan, day) pair,
  // regardless of pause state. Used by pauseDay-the-service to distinguish "no items
  // for this day" (422) from "already paused" (idempotent 204).
  async countItemsForDay(opts: {
    planId: string;
    day: PlanItemRow['day'];
  }): Promise<number> {
    const { count, error } = await this.client
      .from('plan_items')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', opts.planId)
      .eq('day', opts.day)
      .is('replaced_by_plan_id', null); // exclude archived items from prior regenerations
    if (error) throw error;
    return count ?? 0;
  }

  // Story 3.16 — used by school-policy propagation to find which future plans
  // need regeneration when a parent toggles a policy. Filters to cleared rows
  // whose week starts on or after the current Monday (UTC). Returns the
  // metadata fields the regeneration job requires (week_id, week_of, revision).
  // presentation-bypass: ops-history — intentional; not for UI rendering.
  async findActiveFuturePlanIds(
    householdId: string,
    nowMonday: string = getCurrentWeekMonday(),
  ): Promise<Array<{ id: string; week_id: string; week_of: string; revision: number }>> {
    const { data, error } = await this.client
      .from('plans')
      .select('id, week_id, week_of, revision')
      .eq('household_id', householdId)
      .gte('week_of', nowMonday)
      .not('guardrail_cleared_at', 'is', null);
    if (error) throw error;
    type Row = { id: string; week_id: string; week_of: string | null; revision: number };
    return ((data ?? []) as Row[])
      .filter((row): row is Row & { week_of: string } => row.week_of !== null)
      .map((row) => ({
        id: row.id,
        week_id: row.week_id,
        week_of: row.week_of,
        revision: row.revision,
      }));
  }

  // Story 3.25 — slow-path lookup that returns the failed_at timestamp when at
  // least one plan.hard_fail audit row exists for the given household+week, or
  // null when none. Only invoked by GET /v1/plans when plan===null && !isDraft,
  // so the cost is bounded. Story 3.26 extended the SELECT to include
  // created_at so the API can surface the ETA to the parent UI.
  // Story pre-4-s3 — stages is selected so the service layer can extract
  // compound-uncertain flagged_items for the AllergyUncertaintyBanner.
  async findHardFailAudit(
    householdId: string,
    weekOf: string,
  ): Promise<{ failedAt: string; stages: unknown } | null> {
    const { data, error } = await this.client
      .from('audit_log')
      .select('id, created_at, stages')
      .eq('event_type', 'plan.hard_fail')
      .eq('household_id', householdId)
      .eq('metadata->>week_of', weekOf)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data !== null
      ? { failedAt: data.created_at as string, stages: data.stages }
      : null;
  }

  // Atomic write: plan row + plan_items + guardrail_cleared_at + guardrail_version
  // are committed in one Postgres transaction via the commit_plan() function.
  // supabase-js has no client-side BEGIN/COMMIT, so the RPC is the only way to
  // guarantee atomicity (architecture §3.5).
  async commit(
    input: CommitPlanInput,
    guardrailClearedAt: string,
    guardrailVersion: string,
  ): Promise<string> {
    const { data, error } = await this.client.rpc('commit_plan', {
      p_plan_id: input.plan_id,
      p_household_id: input.household_id,
      p_week_id: input.week_id,
      p_week_of: input.week_of,   // Story 3.13 — added to RPC signature
      p_revision: input.revision,
      p_generated_at: input.generated_at,
      p_guardrail_cleared_at: guardrailClearedAt,
      p_guardrail_version: guardrailVersion,
      p_prompt_version: input.prompt_version,
      p_items: input.items,
    });
    if (error) throw error;
    return data as string;
  }

  // ==========================================================================
  // Story 3-DM-C1 — Tree-shape reads + commands (Phase 3).
  //
  // These methods coexist with the flat plan_items methods above for the
  // duration of the C1 cutover window. Phase 4 (BriefStateComposer) consumes
  // the find* methods; Phase 7 (plan-generation.job) switches commit() →
  // commitTree(). Phase 9 deletes the flat methods, applies the migration,
  // and renames commitTree → commit.
  //
  // Until the migration is applied, calls to these methods at runtime will
  // FAIL because the underlying tables / RPCs don't exist yet. Tests are
  // Vitest-mocked so they exercise the call shape without DB.
  // ==========================================================================

  // §9.1 step 2 — parallel read of M1/M2/M3 main assignments.
  async findMainAssignmentsByPlanId(planId: string): Promise<PlanMainAssignmentRow[]> {
    const { data, error } = await this.client
      .from('plan_main_assignments')
      .select(PLAN_MAIN_ASSIGNMENT_COLUMNS)
      .eq('plan_id', planId)
      .order('sequence', { ascending: true });
    if (error) throw error;
    return (data ?? []) as PlanMainAssignmentRow[];
  }

  // §9.1 step 2 — plan_days ordered Mon-Sat for predictable rendering.
  async findDaysByPlanId(planId: string): Promise<PlanDayRow[]> {
    const { data, error } = await this.client
      .from('plan_days')
      .select(PLAN_DAY_COLUMNS)
      .eq('plan_id', planId)
      .order('day', { ascending: true });
    if (error) throw error;
    return (data ?? []) as PlanDayRow[];
  }

  // §9.1 step 2 — batch read of all slots across all days for a plan.
  // Used by the composer; the join through plan_day_id → plans is implicit
  // since the composer already has the day list and filters slots by day id.
  async findSlotsByPlanId(planId: string): Promise<PlanSlotRow[]> {
    // Two-query form: get day ids first, then slots by .in('plan_day_id', ...)
    // since supabase-js doesn't support JOIN inside .select(). For a Mon-Sat
    // plan that's 6 ids at most — well under the IN-clause practical ceiling.
    const dayIds = (await this.findDaysByPlanId(planId)).map((d) => d.id);
    if (dayIds.length === 0) return [];
    return this.findSlotsByDayIds(dayIds);
  }

  // Per-day fan-in used by the Wall Card live-join read path (§9.2 Option B).
  async findSlotsByDayId(planDayId: string): Promise<PlanSlotRow[]> {
    const { data, error } = await this.client
      .from('plan_slots')
      .select(PLAN_SLOT_COLUMNS)
      .eq('plan_day_id', planDayId);
    if (error) throw error;
    return (data ?? []) as PlanSlotRow[];
  }

  // Batch variant used by findSlotsByPlanId — avoids round-trip-per-day.
  async findSlotsByDayIds(planDayIds: readonly string[]): Promise<PlanSlotRow[]> {
    if (planDayIds.length === 0) return [];
    const { data, error } = await this.client
      .from('plan_slots')
      .select(PLAN_SLOT_COLUMNS)
      .in('plan_day_id', planDayIds as string[]);
    if (error) throw error;
    return (data ?? []) as PlanSlotRow[];
  }

  // §9.1 step 2 — variation read across multiple slots. Composer batches
  // every slot's variations in one IN query.
  async findVariationsBySlotIds(slotIds: readonly string[]): Promise<PlanSlotVariationRow[]> {
    if (slotIds.length === 0) return [];
    const { data, error } = await this.client
      .from('plan_slot_variations')
      .select(PLAN_SLOT_VARIATION_COLUMNS)
      .in('plan_slot_id', slotIds as string[]);
    if (error) throw error;
    return (data ?? []) as PlanSlotVariationRow[];
  }

  // §9.3 — canvas drag-drop atomic day swap. Calls the swap_plan_days RPC
  // so the (plan_id, day) UNIQUE constraint is honored throughout the swap.
  async swapDays(opts: { planId: string; dayAId: string; dayBId: string }): Promise<void> {
    const { error } = await this.client.rpc('swap_plan_days', {
      p_plan_id: opts.planId,
      p_day_a_id: opts.dayAId,
      p_day_b_id: opts.dayBId,
    });
    if (error) throw error;
  }

  // §9.4 — single-row variation edit (portion / texture / spice / containers / etc).
  // Portion-only changes don't need a guardrail re-eval; ingredient-affecting
  // patches (add_ons / removals) DO, and that re-eval is the caller's job.
  async updateVariation(opts: {
    variationId: string;
    patch: Partial<{
      portion_size: PortionSize;
      texture: TextureLevel;
      spice_level: SpiceLevel;
      cutting_style: string | null;
      container: string | null;
      add_ons: string[];
      removals: string[];
      notes: string | null;
      paused_at: string | null;
    }>;
  }): Promise<PlanSlotVariationRow> {
    const patch: Record<string, unknown> = {
      ...opts.patch,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.client
      .from('plan_slot_variations')
      .update(patch)
      .eq('id', opts.variationId)
      .select(PLAN_SLOT_VARIATION_COLUMNS)
      .single();
    if (error) throw error;
    return data as PlanSlotVariationRow;
  }

  // §9.5 — full-day pause. Pauses the whole day for every child in one
  // UPDATE row. Idempotent on already-paused days: paused_at gets restamped.
  async pauseDayById(opts: {
    dayId: string;
    pausedAt: string;
    reason: PauseReason;
    note?: string | null;
  }): Promise<PlanDayRow> {
    const { data, error } = await this.client
      .from('plan_days')
      .update({
        paused_at: opts.pausedAt,
        paused_reason: opts.reason,
        paused_note: opts.note ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', opts.dayId)
      .select(PLAN_DAY_COLUMNS)
      .single();
    if (error) throw error;
    return data as PlanDayRow;
  }

  // §9.5 — undo pauseDayById when the parent reverses the pause.
  async unpauseDayById(opts: { dayId: string }): Promise<PlanDayRow | null> {
    const { data, error } = await this.client
      .from('plan_days')
      .update({
        paused_at: null,
        paused_reason: null,
        paused_note: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', opts.dayId)
      .not('paused_at', 'is', null)
      .select(PLAN_DAY_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data as PlanDayRow | null) ?? null;
  }

  // §9.6 — pause one child across every slot on a given day. Calls the
  // pause_child_on_day RPC because supabase-js doesn't natively support
  // .in() over a subquery. Returns the count of variation rows affected.
  async pauseChildOnDay(opts: {
    childId: string;
    planDayId: string;
    pausedAt: string;
  }): Promise<number> {
    const { data, error } = await this.client.rpc('pause_child_on_day', {
      p_child_id: opts.childId,
      p_plan_day_id: opts.planDayId,
      p_paused_at: opts.pausedAt,
    });
    if (error) throw error;
    return data as number;
  }

  // §9.7 — swap this Main. One UPDATE on plan_main_assignments affects
  // every plan_day that references this assignment via the M1/M2/M3 grouping
  // (i.e., the 2-day-repeat preservation is automatic). Guardrail re-eval
  // is the caller's responsibility.
  async swapMain(opts: {
    mainAssignmentId: string;
    newRecipeId: string;
  }): Promise<PlanMainAssignmentRow> {
    const { data, error } = await this.client
      .from('plan_main_assignments')
      .update({ recipe_id: opts.newRecipeId })
      .eq('id', opts.mainAssignmentId)
      .select(PLAN_MAIN_ASSIGNMENT_COLUMNS)
      .single();
    if (error) throw error;
    return data as PlanMainAssignmentRow;
  }

  // Tree-shape atomic commit. Maps to the new commit_plan() RPC signature
  // (10 args: p_plan_id, p_household_id, p_week_of, p_revision, p_generated_at,
  // p_guardrail_cleared_at, p_guardrail_version, p_prompt_version,
  // p_main_assignments, p_days). Phase 7 swaps plan-generation.job from
  // commit() → commitTree().
  async commitTree(
    input: CommitPlanTreeInput,
    guardrailClearedAt: string,
    guardrailVersion: string,
  ): Promise<string> {
    const { data, error } = await this.client.rpc('commit_plan', {
      p_plan_id: input.plan_id,
      p_household_id: input.household_id,
      p_week_of: input.week_of,
      p_revision: input.revision,
      p_generated_at: input.generated_at,
      p_guardrail_cleared_at: guardrailClearedAt,
      p_guardrail_version: guardrailVersion,
      p_prompt_version: input.prompt_version,
      p_main_assignments: input.main_assignments,
      p_days: input.days,
    });
    if (error) throw error;
    return data as string;
  }
}

// Story 3-DM-C1 — Weekday ordering helper. The DB returns plan_days ordered
// alphabetically when ordered by the enum text representation, which puts
// 'friday' before 'monday'. Composer code that needs Mon-Sat order calls this
// to re-sort the row list before walking. Pure function; no DB.
export function sortPlanDaysByWeekday<T extends { day: Weekday }>(days: T[]): T[] {
  const order: Record<Weekday, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  return [...days].sort((a, b) => order[a.day] - order[b.day]);
}
