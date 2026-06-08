import type { SupabaseClient } from '@supabase/supabase-js';

// ===========================================================================
// Slice 2.5-s4 — OnboardingMomentRepository
// ===========================================================================
// Sidecar to thread/turn machinery: stores the chaptered-conversation
// progression (current_moment) and the required-set completion booleans
// per household. Table `onboarding_moment_state` was created in 2.5-s1
// (migration 20260903000800).
//
// One row per household_id. `getState` returns `null` when no row exists
// yet — the agent treats that as `pre_start`. `upsertState` is idempotent
// (ON CONFLICT (household_id) DO UPDATE) so a first-turn write and a
// subsequent in-flight write both succeed without race-aware orchestration.
//
// `current_moment` is `text` with a DB CHECK constraint matching the 8
// valid values; the TS type-alias mirrors them so a typo in the service
// layer fails to compile rather than 23514-ing at write time.
//
// Slice 2.6-s6 — extended with cold_start_triggered + cold_start_trigger_reason
// columns. These are sticky once set; callers must always carry forward
// the pre-turn value when upserting so routine moment advances don't
// accidentally reset the flag.
// ===========================================================================

export type CurrentMoment =
  | 'pre_start'
  | 'm1_table'
  | 'm2_safe'
  | 'm3_taste'
  | 'm4_bag'
  | 'm5_starting_line'
  | 'summary'
  | 'finalized';

export interface RequiredSetStatus {
  m1_household_name: boolean;
  m1_child_declared: boolean;
  m2_allergen_response: boolean;
  m5_favorite_count: number;
  m5_complete: boolean;
}

export interface MomentState {
  current_moment: CurrentMoment;
  required_set_status: RequiredSetStatus;
  // Slice 2.6-s6 — cold-start fallback flag. False on rows that predate
  // the migration. Sticky: once true, the service must carry it forward
  // on every subsequent upsertState.
  cold_start_triggered: boolean;
  cold_start_trigger_reason: string | null;
}

interface MomentStateRow {
  household_id: string;
  current_moment: CurrentMoment | null;
  required_set_status: Partial<RequiredSetStatus> | null;
  cold_start_triggered: boolean | null;
  cold_start_trigger_reason: string | null;
}

const EMPTY_REQUIRED_SET: RequiredSetStatus = {
  m1_household_name: false,
  m1_child_declared: false,
  m2_allergen_response: false,
  m5_favorite_count: 0,
  m5_complete: false,
};

function normalizeRequiredSet(raw: Partial<RequiredSetStatus> | null | undefined): RequiredSetStatus {
  if (raw === null || raw === undefined) return { ...EMPTY_REQUIRED_SET };
  return {
    m1_household_name: raw.m1_household_name === true,
    m1_child_declared: raw.m1_child_declared === true,
    m2_allergen_response: raw.m2_allergen_response === true,
    m5_favorite_count:
      typeof raw.m5_favorite_count === 'number'
        ? raw.m5_favorite_count
        : Number(raw.m5_favorite_count) || 0,
    m5_complete: raw.m5_complete === true,
  };
}

export class OnboardingMomentRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getState(householdId: string): Promise<MomentState | null> {
    const { data, error } = await this.client
      .from('onboarding_moment_state')
      .select(
        'household_id, current_moment, required_set_status, cold_start_triggered, cold_start_trigger_reason',
      )
      .eq('household_id', householdId)
      .maybeSingle();

    if (error !== null && error !== undefined) {
      throw new Error(`onboarding_moment_state.getState: ${error.message}`);
    }
    if (data === null || data === undefined) return null;

    const row = data as MomentStateRow;
    return {
      current_moment: row.current_moment ?? 'pre_start',
      required_set_status: normalizeRequiredSet(row.required_set_status),
      cold_start_triggered: row.cold_start_triggered === true,
      cold_start_trigger_reason: row.cold_start_trigger_reason ?? null,
    };
  }

  /**
   * Read-only row counters used by OnboardingService.submitTextTurn to compute
   * required_set_status after each turn. Four lightweight COUNT-like calls
   * dispatched in parallel — total latency budget ~40ms.
   *
   * The "no known allergens" path doesn't write a child_allergens row; the
   * caller combines this count with the moment-advance directive ("did the
   * agent leave m2_safe this turn?") to derive m2_allergen_response.
   */
  async countRequiredSetSources(householdId: string): Promise<{
    household_name_set: boolean;
    child_count: number;
    child_allergen_count: number;
    favorite_lunch_count: number;
  }> {
    const [householdRes, childRes, allergenRes, favoriteRes] = await Promise.all([
      this.client
        .from('households')
        .select('display_name')
        .eq('id', householdId)
        .maybeSingle(),
      this.client
        .from('children')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', householdId),
      this.client
        .from('household_allergens')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', householdId)
        .not('child_id', 'is', null),
      // Slice 2.6-s1 — favorite_lunches table dropped; count derives from
      // household_recipe_usage rows the parent declared (catalog_provenance
      // ='declared'). The completion gate semantics (FR124 ≥10) are
      // preserved.
      this.client
        .from('household_recipe_usage')
        .select('recipe_id', { count: 'exact', head: true })
        .eq('household_id', householdId)
        .eq('catalog_provenance', 'declared'),
    ]);

    if (householdRes.error !== null && householdRes.error !== undefined) {
      throw new Error(
        `onboarding_moment_state.countRequiredSetSources(households): ${householdRes.error.message}`,
      );
    }
    if (childRes.error !== null && childRes.error !== undefined) {
      throw new Error(
        `onboarding_moment_state.countRequiredSetSources(children): ${childRes.error.message}`,
      );
    }
    if (allergenRes.error !== null && allergenRes.error !== undefined) {
      throw new Error(
        `onboarding_moment_state.countRequiredSetSources(household_allergens): ${allergenRes.error.message}`,
      );
    }
    if (favoriteRes.error !== null && favoriteRes.error !== undefined) {
      throw new Error(
        `onboarding_moment_state.countRequiredSetSources(household_recipe_usage[declared]): ${favoriteRes.error.message}`,
      );
    }

    const displayName = (householdRes.data as { display_name?: string | null } | null)
      ?.display_name;
    const household_name_set =
      typeof displayName === 'string' && displayName.trim().length > 0;

    return {
      household_name_set,
      child_count: childRes.count ?? 0,
      child_allergen_count: allergenRes.count ?? 0,
      favorite_lunch_count: favoriteRes.count ?? 0,
    };
  }

  /**
   * Slice 2.6-s6 — `update.cold_start_triggered` is OPTIONAL but, in
   * practice, the OnboardingService callsite always passes the carried-
   * forward pre-turn value. When omitted, the column gets its DEFAULT
   * (false) on INSERT; on UPDATE (conflict), the existing value is
   * preserved — Supabase excludes absent columns from the
   * ON CONFLICT DO UPDATE SET clause. Same pattern for
   * cold_start_trigger_reason.
   */
  async upsertState(
    householdId: string,
    update: {
      current_moment: CurrentMoment;
      required_set_status: RequiredSetStatus;
      cold_start_triggered?: boolean;
      cold_start_trigger_reason?: string | null;
    },
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      household_id: householdId,
      current_moment: update.current_moment,
      required_set_status: update.required_set_status,
      updated_at: new Date().toISOString(),
    };
    if (update.cold_start_triggered !== undefined) {
      payload['cold_start_triggered'] = update.cold_start_triggered;
    }
    if (update.cold_start_trigger_reason !== undefined) {
      payload['cold_start_trigger_reason'] = update.cold_start_trigger_reason;
    }

    const { error } = await this.client
      .from('onboarding_moment_state')
      .upsert(payload, { onConflict: 'household_id' });

    if (error !== null && error !== undefined) {
      throw new Error(`onboarding_moment_state.upsertState: ${error.message}`);
    }
  }
}
