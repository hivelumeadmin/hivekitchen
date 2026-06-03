import { BaseRepository } from '../../repository/base.repository.js';
import type {
  CommitPlanTreeInput,
  PauseReason,
  PlanDayRow,
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

// Story 3-DM-D1 — week_id dropped (C1 migration 20261010000000 removed the
// column); state/state_set_at/state_message absorbed from brief_state so all
// PlansRepository reads return the canonical plan-state fields.
const PLAN_COLUMNS =
  'id, household_id, week_of, revision, generated_at, guardrail_cleared_at, guardrail_version, prompt_version, state, state_set_at, state_message, created_at, updated_at';

// Story 3-DM-C1 — column constants for the tree-shape tables.
// The flat PLAN_ITEM_COLUMNS retired with the plan_items table cutover.
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

  // Story 3-DM-C1 Phase 9b part 4 step 5 — flat plan_items reads/writes
  // (findItemsByPlanId / findAllItemsByPlanId / findSwapHistory /
  // findItemById / updateItemIngredients / pauseDay / pauseItemById /
  // unpauseItemById / countItemsForDay) retired with the plan_items table
  // cutover. Tree-shape replacements live below (findSlotsByPlanId /
  // findVariationsBySlotIds / updateVariation / pauseDayById / etc.).
  // mid-week swap audit derivation lives in audit_log per the canonical
  // model — findSwapHistory's archived-row scan no longer applies.

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

  // Story 3-DM-C1 Phase 9b part 4 step 5 — the flat commit() retired with
  // the plan_items table. commitTree() below is the canonical atomic write
  // (10-arg commit_plan RPC: p_plan_id, p_household_id, p_week_of, p_revision,
  // p_generated_at, p_guardrail_cleared_at, p_guardrail_version,
  // p_prompt_version, p_main_assignments, p_days).

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

  // Tree-shape snack/extra recipe swap. Single-row UPDATE on plan_slots —
  // the slot owns the recipe_id directly for snack/extra slots (main slots
  // route through swapMain above). The DB CHECK guarantees slot_kind=main
  // slots can't have a recipe_id, so a misrouted call against a main slot
  // fails at the DB layer; the service layer should reject up front with a
  // domain-level error before the DB call.
  async updateSlotRecipe(opts: {
    slotId: string;
    newRecipeId: string;
  }): Promise<PlanSlotRow> {
    const { data, error } = await this.client
      .from('plan_slots')
      .update({
        recipe_id: opts.newRecipeId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', opts.slotId)
      .select(PLAN_SLOT_COLUMNS)
      .single();
    if (error) throw error;
    return data as PlanSlotRow;
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

  // Story 3-DM-D1 — set the soft plan_state signal. Source of truth is the
  // plans row; the brief_state.payload plan_state mirror is patched
  // best-effort so the Brief route (which reads brief_state only) reflects it
  // without a second join. Safe under per-household BullMQ serialization
  // (one plan-gen job per household at a time per Story 3.7).
  async setPlanState(opts: {
    planId: string;
    householdId: string;
    planState: 'degraded' | 'hard_failed';
    setAt: string;
    message: string;
  }): Promise<void> {
    const now = new Date().toISOString();

    // 1. Update the plans row.
    const { data, error } = await this.client
      .from('plans')
      .update({
        state: opts.planState,
        state_set_at: opts.setAt,
        state_message: opts.message,
        updated_at: now,
      })
      .eq('id', opts.planId)
      .eq('household_id', opts.householdId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (data === null) {
      throw new Error(
        `setPlanState: no plans row for plan ${opts.planId} / household ${opts.householdId}`,
      );
    }

    // 2. Mirror into brief_state.payload (best-effort; row may not exist yet).
    const { data: bs } = await this.client
      .from('brief_state')
      .select('payload')
      .eq('household_id', opts.householdId)
      .maybeSingle();
    if (bs) {
      const merged = {
        ...(bs.payload as Record<string, unknown>),
        plan_state: opts.planState,
        plan_state_set_at: opts.setAt,
        plan_state_message: opts.message,
      };
      const { error: bsErr } = await this.client
        .from('brief_state')
        .update({ payload: merged, updated_at: now })
        .eq('household_id', opts.householdId);
      if (bsErr) {
        // Non-fatal: the plans row is updated; the brief_state mirror can lag.
        // The next refreshTree() carries forward plan_state from the payload.
      }
    }
  }

  // Story 3-DM-D1 — clears the degraded plan_state once the parent picks a
  // sovereignty mode. Filtered by state='degraded' so a hard_failed plan
  // isn't accidentally cleared by the same code path. Mirrors the clear into
  // brief_state.payload as well.
  async clearDegradedPlanState(householdId: string): Promise<void> {
    const now = new Date().toISOString();

    // 1. Clear on plans (only rows currently in 'degraded' state — hard_failed stays).
    // Use .select('id') so we know whether any row was actually cleared before
    // touching the brief_state mirror (avoids wiping a hard_failed mirror when
    // no degraded row existed).
    const { data: cleared, error } = await this.client
      .from('plans')
      .update({
        state: null,
        state_set_at: null,
        state_message: null,
        updated_at: now,
      })
      .eq('household_id', householdId)
      .eq('state', 'degraded')
      .select('id');
    if (error) throw error;

    // 2. Clear the plan_state mirror in brief_state.payload — only if a degraded
    // row was actually updated. Skipping when cleared is empty prevents wiping a
    // hard_failed mirror signal that shouldn't be touched by this code path.
    if (!cleared || cleared.length === 0) return;

    const { data: bs } = await this.client
      .from('brief_state')
      .select('payload')
      .eq('household_id', householdId)
      .maybeSingle();
    if (bs) {
      const merged = {
        ...(bs.payload as Record<string, unknown>),
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
      };
      const { error: bsErr } = await this.client
        .from('brief_state')
        .update({ payload: merged, updated_at: now })
        .eq('household_id', householdId);
      if (bsErr) {
        // Non-fatal: the plans rows are cleared; the brief_state mirror can lag.
      }
    }
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
