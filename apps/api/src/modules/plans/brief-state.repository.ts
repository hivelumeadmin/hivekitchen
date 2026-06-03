import { BaseRepository } from '../../repository/base.repository.js';
import type { BriefStatePayload, BriefStateRow } from '@hivekitchen/types';

// Story 3-DM-D1 — the four loose JSONB columns + the plan_state mirror are
// consolidated into a single validated `payload` jsonb column.
const BRIEF_STATE_COLUMNS =
  'household_id, plan_id, moment_headline, lumi_note, memory_prose, payload, generated_at, plan_revision, updated_at';

export interface BriefStateUpsertInput {
  household_id: string;
  plan_id: string | null;  // Story 3.12
  moment_headline: string;
  lumi_note: string;
  memory_prose: string;
  payload: BriefStatePayload;  // Story 3-DM-D1 — replaces plan_tile_summaries, cleared_allergies, scaffolding_diff
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
  // write only when the stored revision is strictly greater than the incoming
  // revision, so an older recompose cannot clobber a fresher one.
  //
  // Same-revision writes are allowed by design: Story 3.12 swap/pause refreshes
  // mutate `paused_at` and `scaffolding_diff` without bumping `plan_revision`,
  // so the projection must be rewritable at the same revision. Cross-revision
  // ordering is preserved because a stored higher revision short-circuits.
  //
  // Concurrent same-revision writes (e.g., two BullMQ jobs racing on the same
  // household) are serialized by Story 3.7's per-household BullMQ job, which is
  // the actual mutual-exclusion mechanism — the in-row guard only protects
  // against cross-revision regressions, not concurrent same-revision races.
  async upsert(input: BriefStateUpsertInput): Promise<void> {
    const current = await this.findByHousehold(input.household_id);
    if (current && current.plan_revision > input.plan_revision) {
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

  // Story 3-DM-D1 — setPlanState() / clearDegradedPlanState() moved to
  // PlansRepository. plans.state is now the source of truth for plan state;
  // those methods write the plans row and patch the brief_state.payload mirror.
}
