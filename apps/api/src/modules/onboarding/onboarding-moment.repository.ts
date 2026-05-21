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
}

interface MomentStateRow {
  household_id: string;
  current_moment: CurrentMoment | null;
  required_set_status: Partial<RequiredSetStatus> | null;
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
      .select('household_id, current_moment, required_set_status')
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
        .from('child_allergens')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', householdId),
      this.client
        .from('favorite_lunches')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', householdId),
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
        `onboarding_moment_state.countRequiredSetSources(child_allergens): ${allergenRes.error.message}`,
      );
    }
    if (favoriteRes.error !== null && favoriteRes.error !== undefined) {
      throw new Error(
        `onboarding_moment_state.countRequiredSetSources(favorite_lunches): ${favoriteRes.error.message}`,
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

  async upsertState(householdId: string, state: MomentState): Promise<void> {
    const { error } = await this.client
      .from('onboarding_moment_state')
      .upsert(
        {
          household_id: householdId,
          current_moment: state.current_moment,
          required_set_status: state.required_set_status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'household_id' },
      );

    if (error !== null && error !== undefined) {
      throw new Error(`onboarding_moment_state.upsertState: ${error.message}`);
    }
  }
}
