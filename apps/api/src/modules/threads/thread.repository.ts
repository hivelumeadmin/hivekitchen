import type { TurnBody } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';

export type ThreadModality = 'voice' | 'text';

export interface ThreadRow {
  id: string;
  household_id: string;
  type: string;
  status: string;
  modality: ThreadModality;
  created_at: string;
}

export interface TurnRow {
  id: string;
  thread_id: string;
  server_seq: number;
  role: 'user' | 'lumi' | 'system';
  body: TurnBody;
  modality: 'text' | 'voice';
  created_at: string;
}

export const THREAD_COLUMNS = 'id, household_id, type, status, modality, created_at';
export const TURN_COLUMNS = 'id, thread_id, server_seq, role, body, modality, created_at';

// Postgres unique-violation SQLSTATE — surfaced raw on the supabase-js
// error envelope. Match strictly on the code: a substring check on
// `.message` was previously used as a fallback but misclassified wrapped
// errors that embedded another error's text (e.g., logged transaction
// failures). The code is the authoritative signal.
const UNIQUE_VIOLATION_CODE = '23505';

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown };
  return typeof e.code === 'string' && e.code === UNIQUE_VIOLATION_CODE;
}

export class ThreadRepository extends BaseRepository {
  // R2-D2 — modality is required at creation. The DB partial unique index
  // `threads_one_active_per_household_type_modality` guarantees one active
  // thread per (household, type, modality); a duplicate insert surfaces as
  // a unique-violation that callers can map to a 409.
  async createThread(
    householdId: string,
    type: string,
    modality: ThreadModality,
  ): Promise<ThreadRow> {
    const { data, error } = await this.client
      .from('threads')
      .insert({ household_id: householdId, type, modality })
      .select(THREAD_COLUMNS)
      .single();
    if (error) throw error;
    return data as ThreadRow;
  }

  // R2-D2 — active-thread lookup is per-modality so voice and text never
  // share a thread mid-webhook (Story 2.6 → 2.7 gap).
  async findActiveThreadByHousehold(
    householdId: string,
    type: string,
    modality: ThreadModality,
  ): Promise<ThreadRow | null> {
    const { data, error } = await this.client
      .from('threads')
      .select(THREAD_COLUMNS)
      .eq('household_id', householdId)
      .eq('type', type)
      .eq('modality', modality)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as ThreadRow | null) ?? null;
  }

  // The completion gate is intentionally modality-agnostic: a household that
  // completed onboarding via voice should not be allowed to re-onboard via
  // text. Pass `modality` only when callers explicitly need a per-modality
  // closed-thread record.
  async findClosedThreadByHousehold(
    householdId: string,
    type: string,
    modality?: ThreadModality,
  ): Promise<ThreadRow | null> {
    let q = this.client
      .from('threads')
      .select(THREAD_COLUMNS)
      .eq('household_id', householdId)
      .eq('type', type)
      .eq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1);
    if (modality !== undefined) {
      q = q.eq('modality', modality);
    }
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return (data as ThreadRow | null) ?? null;
  }

  async findThreadById(threadId: string): Promise<ThreadRow | null> {
    const { data, error } = await this.client
      .from('threads')
      .select(THREAD_COLUMNS)
      .eq('id', threadId)
      .maybeSingle();
    if (error) throw error;
    return (data as ThreadRow | null) ?? null;
  }

  // Idempotent: only flips an active thread to closed. Re-closing a thread that
  // has already been closed (or that never existed in active state) is a no-op
  // rather than a silent overwrite. Callers don't need to track prior status.
  async closeThread(threadId: string): Promise<void> {
    const { error } = await this.client
      .from('threads')
      .update({ status: 'closed' })
      .eq('id', threadId)
      .eq('status', 'active');
    if (error) throw error;
  }

  async listTurns(threadId: string): Promise<TurnRow[]> {
    const { data, error } = await this.client
      .from('thread_turns')
      .select(TURN_COLUMNS)
      .eq('thread_id', threadId)
      .order('server_seq', { ascending: true });
    if (error) throw error;
    return (data as TurnRow[] | null) ?? [];
  }

  async appendTurn(params: {
    threadId: string;
    seq: number;
    role: 'user' | 'lumi' | 'system';
    body: TurnBody;
    modality: 'text' | 'voice';
  }): Promise<TurnRow> {
    const { data, error } = await this.client
      .from('thread_turns')
      .insert({
        thread_id: params.threadId,
        server_seq: params.seq,
        role: params.role,
        body: params.body,
        modality: params.modality,
      })
      .select(TURN_COLUMNS)
      .single();
    if (error) throw error;
    return data as TurnRow;
  }

  async getNextSeq(threadId: string): Promise<number> {
    const { data, error } = await this.client
      .from('thread_turns')
      .select('server_seq')
      .eq('thread_id', threadId)
      .order('server_seq', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const row = data as { server_seq: number } | null;
    return row !== null ? row.server_seq + 1 : 1;
  }

  // Atomic-ish wrapper: read max(server_seq), append, retry on
  // unique-violation caused by a concurrent inserter racing on the same
  // (thread_id, server_seq) UNIQUE constraint. Real durability still requires
  // a per-thread Postgres sequence; this narrows the window enough for the
  // single-author onboarding flow without a schema change.
  // R2-P2 — accept both raw PG `code` and PostgREST `message` markers; default
  // `lastErr` to a real Error so retry-exhaustion is debuggable.
  async appendTurnNext(params: {
    threadId: string;
    role: 'user' | 'lumi' | 'system';
    body: TurnBody;
    modality: 'text' | 'voice';
  }): Promise<TurnRow> {
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown = new Error(
      'appendTurnNext exhausted retries with no captured error',
    );
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const seq = await this.getNextSeq(params.threadId);
      try {
        return await this.appendTurn({
          threadId: params.threadId,
          seq,
          role: params.role,
          body: params.body,
          modality: params.modality,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        lastErr = err;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error('appendTurnNext exhausted retries on unique-violation');
  }
}

// Re-exported so service-layer callers can map raw DB unique-violations
// (e.g. on createThread, on the summary partial unique index) to clean
// 409 ConflictError without re-implementing the detection.
export { isUniqueViolation };
