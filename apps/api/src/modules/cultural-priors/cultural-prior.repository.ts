import type { TemplateState, Tier } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';

export interface CulturalPriorRow {
  id: string;
  household_id: string;
  key:
    | 'halal'
    | 'kosher'
    | 'hindu_vegetarian'
    | 'south_asian'
    | 'east_african'
    | 'caribbean';
  label: string;
  tier: Tier;
  state: TemplateState;
  presence: number;
  confidence: number;
  opted_in_at: string | null;
  opted_out_at: string | null;
  last_signal_at: string;
  created_at: string;
  updated_at: string;
}

export interface InferredPrior {
  key:
    | 'halal'
    | 'kosher'
    | 'hindu_vegetarian'
    | 'south_asian'
    | 'east_african'
    | 'caribbean';
  label: string;
  confidence: number;
  presence: number;
}

export interface TransitionTimestamps {
  opted_in_at?: Date | null;
  opted_out_at?: Date | null;
}

const PRIOR_COLUMNS =
  'id, household_id, key, label, tier, state, presence, confidence, opted_in_at, opted_out_at, last_signal_at, created_at, updated_at';

export class CulturalPriorRepository extends BaseRepository {
  // ON CONFLICT (household_id, key) DO NOTHING — never overwrite a prior that
  // a household has already moved past `detected` (e.g. opt_in_confirmed,
  // forgotten). Returns rows that ended up at `detected`; rows that already
  // existed at a higher state are left untouched and not returned here.
  async upsertDetected(
    householdId: string,
    priors: InferredPrior[],
  ): Promise<CulturalPriorRow[]> {
    if (priors.length === 0) return [];
    // Supabase JS does not expose a clean "ON CONFLICT DO NOTHING ... RETURNING"
    // for a multi-row insert with mixed conflict outcomes, so we issue per-row
    // upserts. Onboarding typically yields ≤6 priors so the round-trip cost is
    // bounded.
    const out: CulturalPriorRow[] = [];
    for (const p of priors) {
      // Use upsert with ignoreDuplicates so a pre-existing row is not
      // overwritten. The select() returns the inserted row when a new row was
      // created and an empty array when the conflict path was taken.
      const { data, error } = await this.client
        .from('cultural_priors')
        .upsert(
          {
            household_id: householdId,
            key: p.key,
            label: p.label,
            tier: 'L1',
            state: 'detected',
            presence: p.presence,
            confidence: p.confidence,
          },
          { onConflict: 'household_id,key', ignoreDuplicates: true },
        )
        .select(PRIOR_COLUMNS);
      if (error) throw error;
      const rows = (data as CulturalPriorRow[] | null) ?? [];
      if (rows[0]) out.push(rows[0]);
    }
    return out;
  }

  async findByHousehold(householdId: string): Promise<CulturalPriorRow[]> {
    const { data, error } = await this.client
      .from('cultural_priors')
      .select(PRIOR_COLUMNS)
      .eq('household_id', householdId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as CulturalPriorRow[] | null) ?? [];
  }

  async findByIdForHousehold(
    householdId: string,
    priorId: string,
  ): Promise<CulturalPriorRow | null> {
    const { data, error } = await this.client
      .from('cultural_priors')
      .select(PRIOR_COLUMNS)
      .eq('household_id', householdId)
      .eq('id', priorId)
      .maybeSingle();
    if (error) throw error;
    return (data as CulturalPriorRow | null) ?? null;
  }

  // Returns null when the precondition state no longer matches (concurrent
  // write already transitioned this prior). Callers should re-fetch and return
  // the current row — no audit event should fire for a no-op race.
  async transition(
    priorId: string,
    householdId: string,
    newState: TemplateState,
    existingState: TemplateState,
    timestamps: TransitionTimestamps,
  ): Promise<CulturalPriorRow | null> {
    const update: Record<string, unknown> = {
      state: newState,
      last_signal_at: new Date().toISOString(),
    };
    if (timestamps.opted_in_at !== undefined) {
      update.opted_in_at =
        timestamps.opted_in_at !== null ? timestamps.opted_in_at.toISOString() : null;
    }
    if (timestamps.opted_out_at !== undefined) {
      update.opted_out_at =
        timestamps.opted_out_at !== null ? timestamps.opted_out_at.toISOString() : null;
    }
    const { data, error } = await this.client
      .from('cultural_priors')
      .update(update)
      .eq('id', priorId)
      .eq('household_id', householdId)
      .eq('state', existingState)
      .select(PRIOR_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return data as CulturalPriorRow | null;
  }
}
