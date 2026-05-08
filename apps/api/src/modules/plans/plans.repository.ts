import { BaseRepository } from '../../repository/base.repository.js';
import type {
  CommitPlanInput,
  PlanRow,
  PlanItemRow,
  PlanItemSwapSummary,
} from '@hivekitchen/types';
import { getCurrentWeekMonday } from '../../lib/derive-week-id.js';

const PLAN_COLUMNS =
  'id, household_id, week_id, week_of, revision, generated_at, guardrail_cleared_at, guardrail_version, prompt_version, created_at, updated_at';

const PLAN_ITEM_COLUMNS =
  'id, plan_id, child_id, day, slot, recipe_id, item_id, item_sku_id, ingredients, paused_at, replaced_by_plan_id, created_at, updated_at';

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
}
