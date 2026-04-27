import type { TurnBody } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';

export interface ThreadRow {
  id: string;
  household_id: string;
  type: string;
  status: string;
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

export const THREAD_COLUMNS = 'id, household_id, type, status, created_at';
export const TURN_COLUMNS = 'id, thread_id, server_seq, role, body, modality, created_at';

export class ThreadRepository extends BaseRepository {
  async createThread(householdId: string, type: string): Promise<ThreadRow> {
    const { data, error } = await this.client
      .from('threads')
      .insert({ household_id: householdId, type })
      .select(THREAD_COLUMNS)
      .single();
    if (error) throw error;
    return data as ThreadRow;
  }

  async findActiveThreadByHousehold(
    householdId: string,
    type: string,
  ): Promise<ThreadRow | null> {
    const { data, error } = await this.client
      .from('threads')
      .select(THREAD_COLUMNS)
      .eq('household_id', householdId)
      .eq('type', type)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as ThreadRow | null) ?? null;
  }

  async findClosedThreadByHousehold(
    householdId: string,
    type: string,
  ): Promise<ThreadRow | null> {
    const { data, error } = await this.client
      .from('threads')
      .select(THREAD_COLUMNS)
      .eq('household_id', householdId)
      .eq('type', type)
      .eq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
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

  // Atomic-ish wrapper: read max(server_seq), append, retry once on
  // unique-violation (Postgres SQLSTATE 23505) caused by a concurrent inserter
  // racing on the same (thread_id, server_seq). Real durability still requires
  // a per-thread Postgres sequence; this narrows the window enough for the
  // single-author onboarding flow without a schema change.
  async appendTurnNext(params: {
    threadId: string;
    role: 'user' | 'lumi' | 'system';
    body: TurnBody;
    modality: 'text' | 'voice';
  }): Promise<TurnRow> {
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;
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
        const code = (err as { code?: unknown }).code;
        if (code !== '23505') throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  }
}
