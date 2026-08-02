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

// Story 15-s2 — the signals log (canonical-data-model-v2 §4.9).
// INSERT-ONLY by design (AuditRepository precedent): signals are append-only,
// a correction is a new row, and the DB enforces it with a mutation-blocking
// trigger (20261035000200). Reads arrive with the 15-s3 projection.
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
}
