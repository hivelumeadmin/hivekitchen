import type { SignalKind, SignalRow, SignalSource } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';

const SIGNAL_COLUMNS =
  'id, household_id, child_id, kind, subject_ref, payload, occurred_at, source, created_at';

export interface InsertSignalRowParams {
  householdId: string;
  childId: string | null;
  kind: SignalKind;
  subjectRef: Record<string, unknown> | null;
  // Already validated + encrypted by SignalsService — this layer only persists.
  payload: Record<string, unknown>;
  occurredAt: string;
  source: SignalSource;
}

export interface FindLunchRatingsOptions {
  limit?: number;
  // Composite keyset cursor. `id` alone cannot page an occurred_at-ordered scan
  // — the rating seam stamps occurred_at per slot from wall-clock time, so
  // three slots of one rating routinely share a millisecond.
  after?: { occurredAt: string; id: string };
}

const DEFAULT_SCAN_PAGE = 500;

// Story 15-s2 — the signals log (canonical-data-model-v2 §4.9).
// NO UPDATE, NO DELETE by design (AuditRepository precedent): signals are
// append-only, a correction is a new row, and the DB enforces it with a
// mutation-blocking trigger (20261035000200). The first READ arrived with the
// 15-s3 child_preferences projection — rebuild/parity scans only, no route
// exposes it.
export class SignalsRepository extends BaseRepository {
  async insert(params: InsertSignalRowParams): Promise<SignalRow> {
    const { data, error } = await this.client
      .from('signals')
      .insert({
        household_id: params.householdId,
        child_id: params.childId,
        kind: params.kind,
        subject_ref: params.subjectRef,
        payload: params.payload,
        occurred_at: params.occurredAt,
        source: params.source,
      })
      .select(SIGNAL_COLUMNS)
      .single();
    if (error) throw error;
    return data as SignalRow;
  }

  // Story 15-s3 — every lunch_rating signal for one household, oldest first.
  // Ordering is (occurred_at ASC, id ASC), which is what the projection's
  // last-write-wins collapse reads; signals_household_kind_occurred_idx serves
  // the (household_id, kind, occurred_at) prefix.
  async findLunchRatingsByHousehold(
    householdId: string,
    options: FindLunchRatingsOptions = {},
  ): Promise<SignalRow[]> {
    let query = this.client
      .from('signals')
      .select(SIGNAL_COLUMNS)
      .eq('household_id', householdId)
      .eq('kind', 'lunch_rating')
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(options.limit ?? DEFAULT_SCAN_PAGE);

    const after = options.after;
    if (after !== undefined) {
      query = query.or(
        `occurred_at.gt."${after.occurredAt}",and(occurred_at.eq."${after.occurredAt}",id.gt."${after.id}")`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as SignalRow[];
  }
}
