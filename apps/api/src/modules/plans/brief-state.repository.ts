import { BaseRepository } from '../../repository/base.repository.js';
import type { BriefStateRow, PlanTileSummary } from '@hivekitchen/types';

const BRIEF_STATE_COLUMNS =
  'household_id, moment_headline, lumi_note, memory_prose, plan_tile_summaries, generated_at, plan_revision, updated_at';

export interface BriefStateUpsertInput {
  household_id: string;
  moment_headline: string;
  lumi_note: string;
  memory_prose: string;
  plan_tile_summaries: PlanTileSummary[];
  generated_at: string;
  plan_revision: number;
}

export class BriefStateRepository extends BaseRepository {
  async findByHousehold(householdId: string): Promise<BriefStateRow | null> {
    const { data, error } = await this.client
      .from('brief_state')
      .select(BRIEF_STATE_COLUMNS)
      .eq('household_id', householdId)
      .maybeSingle();
    if (error) throw error;
    return (data as BriefStateRow | null) ?? null;
  }

  // Idempotent upsert with application-level plan_revision guard. Skips the
  // write when the stored revision is already >= incoming revision so a stale
  // background recompose cannot clobber a fresher write.
  //
  // The read-then-write has a TOCTOU race: two concurrent writes can both read
  // a stale revision and both proceed. Story 3.7's BullMQ job serializes
  // commits per household (advisory lock), which removes the race in practice.
  async upsert(input: BriefStateUpsertInput): Promise<void> {
    const current = await this.findByHousehold(input.household_id);
    if (current && current.plan_revision >= input.plan_revision) {
      return;
    }
    const { error } = await this.client
      .from('brief_state')
      .upsert(
        { ...input, updated_at: new Date().toISOString() },
        { onConflict: 'household_id' },
      );
    if (error) throw error;
  }
}
