import { BaseRepository } from '../../repository/base.repository.js';
import type { CommitPlanInput, PlanRow, PlanItemRow } from '@hivekitchen/types';

const PLAN_COLUMNS =
  'id, household_id, week_id, revision, generated_at, guardrail_cleared_at, guardrail_version, prompt_version, created_at, updated_at';

const PLAN_ITEM_COLUMNS =
  'id, plan_id, child_id, day, slot, recipe_id, item_id, ingredients, created_at, updated_at';

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
  async findItemsByPlanId(planId: string): Promise<PlanItemRow[]> {
    const { data, error } = await this.client
      .from('plan_items')
      .select(PLAN_ITEM_COLUMNS)
      .eq('plan_id', planId);
    if (error) throw error;
    return (data ?? []) as PlanItemRow[];
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
