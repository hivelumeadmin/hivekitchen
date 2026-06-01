import { BaseRepository } from '../../repository/base.repository.js';
import type {
  BriefStateRow,
  ClearedAllergyEntry,
  PlanTileSummary,
  ScaffoldingDiff,
} from '@hivekitchen/types';

const BRIEF_STATE_COLUMNS =
  'household_id, plan_id, moment_headline, lumi_note, memory_prose, plan_tile_summaries, cleared_allergies, scaffolding_diff, generated_at, plan_revision, updated_at, plan_state, plan_state_set_at, plan_state_message';

export interface BriefStateUpsertInput {
  household_id: string;
  plan_id: string | null;  // Story 3.12
  moment_headline: string;
  lumi_note: string;
  memory_prose: string;
  plan_tile_summaries: PlanTileSummary[];
  cleared_allergies: ClearedAllergyEntry[];
  scaffolding_diff: ScaffoldingDiff | null;
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

  // Story 3.29 — set the soft plan_state signal AFTER the briefStateComposer
  // has run; an UPDATE (not upsert) since the row must already exist for a
  // degraded state to be meaningful (degradation describes a committed plan).
  async setPlanState(opts: {
    householdId: string;
    planState: 'degraded' | 'hard_failed';
    setAt: string;
    message: string;
  }): Promise<void> {
    const { data, error } = await this.client
      .from('brief_state')
      .update({
        plan_state: opts.planState,
        plan_state_set_at: opts.setAt,
        plan_state_message: opts.message,
        updated_at: new Date().toISOString(),
      })
      .eq('household_id', opts.householdId)
      .select('household_id')
      .maybeSingle();
    if (error) throw error;
    if (data === null) {
      throw new Error(`setPlanState: no brief_state row for household ${opts.householdId} — degraded flag not set`);
    }
  }

  // Story 3.29 — clears the degraded plan_state once the parent picks a
  // sovereignty mode. Filtered by plan_state='degraded' so a future hard_failed
  // row isn't accidentally cleared by the same code path.
  async clearDegradedPlanState(householdId: string): Promise<void> {
    const { error } = await this.client
      .from('brief_state')
      .update({
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('household_id', householdId)
      .eq('plan_state', 'degraded');
    if (error) throw error;
  }
}
