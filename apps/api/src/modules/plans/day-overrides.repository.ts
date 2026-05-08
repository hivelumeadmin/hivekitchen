import { BaseRepository } from '../../repository/base.repository.js';
import type { DayOverride } from '@hivekitchen/types';

const OVERRIDE_COLUMNS =
  'id, plan_item_id, child_id, household_id, override_date, override_type, is_lumi_proposed, confirmed_at, reverted_at, created_at, updated_at';

export interface UpsertDayOverrideInput {
  planItemId: string;
  childId: string;
  householdId: string;
  overrideDate: string;
  overrideType: string;
  isLumiProposed: boolean;
}

export class DayOverridesRepository extends BaseRepository {
  // Story 3.19 — keyed on (plan_item_id, child_id, override_date). Uses an
  // explicit insert-then-update split so that confirmed_at on an existing
  // parent-confirmed row is never overwritten by a subsequent Lumi-proposed
  // override (which would silently un-confirm a parent action).
  async upsert(input: UpsertDayOverrideInput): Promise<DayOverride> {
    const nowIso = new Date().toISOString();
    const confirmedAt = input.isLumiProposed ? null : nowIso;

    const { data: insertData, error: insertError } = await this.client
      .from('day_overrides')
      .insert({
        plan_item_id: input.planItemId,
        child_id: input.childId,
        household_id: input.householdId,
        override_date: input.overrideDate,
        override_type: input.overrideType,
        is_lumi_proposed: input.isLumiProposed,
        confirmed_at: confirmedAt,
        reverted_at: null,
        updated_at: nowIso,
      })
      .select(OVERRIDE_COLUMNS)
      .single();

    if (!insertError) return insertData as DayOverride;

    // Unique conflict on (plan_item_id, child_id, override_date) — update the
    // mutable fields but deliberately omit confirmed_at so a prior parent
    // confirmation is preserved.
    if (insertError.code === '23505') {
      const { data, error } = await this.client
        .from('day_overrides')
        .update({
          override_type: input.overrideType,
          is_lumi_proposed: input.isLumiProposed,
          reverted_at: null,
          updated_at: nowIso,
        })
        .eq('plan_item_id', input.planItemId)
        .eq('child_id', input.childId)
        .eq('override_date', input.overrideDate)
        .select(OVERRIDE_COLUMNS)
        .single();
      if (error) throw error;
      return data as DayOverride;
    }

    throw insertError;
  }

  // Soft revert — the row remains so the timeline can show what happened.
  // planItemId is included to prevent cross-item revert via a mismatched route param.
  async revert(
    overrideId: string,
    householdId: string,
    planItemId: string,
  ): Promise<DayOverride | null> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('day_overrides')
      .update({ reverted_at: nowIso, updated_at: nowIso })
      .eq('id', overrideId)
      .eq('household_id', householdId)
      .eq('plan_item_id', planItemId)
      .is('reverted_at', null)
      .select(OVERRIDE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data as DayOverride | null) ?? null;
  }

  // Confirm a Lumi-proposed override. Used once Lumi-proposal wiring lands
  // (deferred — see story Dev Notes).
  async confirm(overrideId: string, householdId: string): Promise<DayOverride | null> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('day_overrides')
      .update({ confirmed_at: nowIso, updated_at: nowIso })
      .eq('id', overrideId)
      .eq('household_id', householdId)
      .is('confirmed_at', null)
      .is('reverted_at', null)
      .select(OVERRIDE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data as DayOverride | null) ?? null;
  }

  // P2: fetch a single non-reverted override by its id, scoped to household
  // and item so a mismatched route param cannot expose another item's record.
  async findActiveById(
    overrideId: string,
    householdId: string,
    planItemId: string,
  ): Promise<DayOverride | null> {
    const { data, error } = await this.client
      .from('day_overrides')
      .select(OVERRIDE_COLUMNS)
      .eq('id', overrideId)
      .eq('household_id', householdId)
      .eq('plan_item_id', planItemId)
      .is('reverted_at', null)
      .maybeSingle();
    if (error) throw error;
    return (data as DayOverride | null) ?? null;
  }

  // DN5: check whether a pausing override (sick_day / bag_suspended) is already
  // active for this child on this date across any plan item. Used to block
  // composition overrides while a day-level suspension is in place.
  async findActivePausingForChildOnDate(
    childId: string,
    overrideDate: string,
  ): Promise<DayOverride | null> {
    const { data, error } = await this.client
      .from('day_overrides')
      .select(OVERRIDE_COLUMNS)
      .eq('child_id', childId)
      .eq('override_date', overrideDate)
      .in('override_type', ['bag_suspended', 'sick_day'])
      .is('reverted_at', null)
      .maybeSingle();
    if (error) throw error;
    return (data as DayOverride | null) ?? null;
  }

  // Active (non-reverted) overrides for a household whose date is today or
  // future. Used by the planner-context loader.
  async findActiveByHousehold(householdId: string): Promise<DayOverride[]> {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('day_overrides')
      .select(OVERRIDE_COLUMNS)
      .eq('household_id', householdId)
      .gte('override_date', today)
      .is('reverted_at', null);
    if (error) throw error;
    return (data ?? []) as DayOverride[];
  }

  // Bulk soft-revert of overrides whose date is strictly before today (UTC).
  // Returns the count of rows reverted; the nightly job logs that.
  async revertExpired(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('day_overrides')
      .update({ reverted_at: nowIso, updated_at: nowIso })
      .lt('override_date', today)
      .is('reverted_at', null)
      .select('id');
    if (error) throw error;
    return (data ?? []).length;
  }
}
