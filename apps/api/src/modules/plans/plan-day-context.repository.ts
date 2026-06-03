import { BaseRepository } from '../../repository/base.repository.js';
import type { PlanDayContext } from '@hivekitchen/types';

const OVERRIDE_COLUMNS =
  'id, plan_slot_id, child_id, household_id, override_date, context_type, is_lumi_proposed, confirmed_at, reverted_at, created_at, updated_at';

// Story 3-DM-E1 — post-rename interface. plan_slot_id is the canonical FK.
export interface UpsertPlanDayContextInput {
  planSlotId: string;
  childId: string;
  householdId: string;
  overrideDate: string;
  contextType: string;
  isLumiProposed: boolean;
}

export class PlanDayContextRepository extends BaseRepository {
  // Story 3.19 — keyed on (plan_slot_id, child_id, override_date). Uses an
  // explicit insert-then-update split so that confirmed_at on an existing
  // parent-confirmed row is never overwritten by a subsequent Lumi-proposed
  // override (which would silently un-confirm a parent action).
  async upsert(input: UpsertPlanDayContextInput): Promise<PlanDayContext> {
    const nowIso = new Date().toISOString();
    const confirmedAt = input.isLumiProposed ? null : nowIso;

    const { data: insertData, error: insertError } = await this.client
      .from('plan_day_context')
      .insert({
        plan_slot_id: input.planSlotId,
        child_id: input.childId,
        household_id: input.householdId,
        override_date: input.overrideDate,
        context_type: input.contextType,
        is_lumi_proposed: input.isLumiProposed,
        confirmed_at: confirmedAt,
        reverted_at: null,
        updated_at: nowIso,
      })
      .select(OVERRIDE_COLUMNS)
      .single();

    if (!insertError) return insertData as PlanDayContext;

    // Unique conflict on (plan_slot_id, child_id, override_date) — update the
    // mutable fields but deliberately omit confirmed_at so a prior parent
    // confirmation is preserved.
    if (insertError.code === '23505') {
      const { data, error } = await this.client
        .from('plan_day_context')
        .update({
          context_type: input.contextType,
          is_lumi_proposed: input.isLumiProposed,
          reverted_at: null,
          updated_at: nowIso,
        })
        .eq('plan_slot_id', input.planSlotId)
        .eq('child_id', input.childId)
        .eq('override_date', input.overrideDate)
        .select(OVERRIDE_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('plan_day_context: conflict row vanished between insert and update');
      return data as PlanDayContext;
    }

    throw insertError;
  }

  // Soft revert — the row remains so the timeline can show what happened.
  // planSlotId is included to prevent cross-slot revert via a mismatched route param.
  async revert(
    overrideId: string,
    householdId: string,
    planSlotId: string,
  ): Promise<PlanDayContext | null> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('plan_day_context')
      .update({ reverted_at: nowIso, updated_at: nowIso })
      .eq('id', overrideId)
      .eq('household_id', householdId)
      .eq('plan_slot_id', planSlotId)
      .is('reverted_at', null)
      .select(OVERRIDE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data as PlanDayContext | null) ?? null;
  }

  // Fetch a single non-reverted row by its id, scoped to household and slot so
  // a mismatched route param cannot expose another slot's record.
  async findActiveById(
    overrideId: string,
    householdId: string,
    planSlotId: string,
  ): Promise<PlanDayContext | null> {
    const { data, error } = await this.client
      .from('plan_day_context')
      .select(OVERRIDE_COLUMNS)
      .eq('id', overrideId)
      .eq('household_id', householdId)
      .eq('plan_slot_id', planSlotId)
      .is('reverted_at', null)
      .maybeSingle();
    if (error) throw error;
    return (data as PlanDayContext | null) ?? null;
  }

  // Active (non-reverted) context rows for a household whose date is today or
  // future. Used by the planner-context loader.
  async findActiveByHousehold(householdId: string): Promise<PlanDayContext[]> {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('plan_day_context')
      .select(OVERRIDE_COLUMNS)
      .eq('household_id', householdId)
      .gte('override_date', today)
      .is('reverted_at', null);
    if (error) throw error;
    return (data ?? []) as PlanDayContext[];
  }

  // Bulk soft-revert of rows whose date is strictly before today (UTC).
  // Returns the count of rows reverted; the nightly job logs that.
  async revertExpired(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('plan_day_context')
      .update({ reverted_at: nowIso, updated_at: nowIso })
      .lt('override_date', today)
      .is('reverted_at', null)
      .select('id');
    if (error) throw error;
    return (data ?? []).length;
  }
}
