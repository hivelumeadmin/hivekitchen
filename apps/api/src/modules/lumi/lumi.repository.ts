import type { Turn } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';
import { ForbiddenError } from '../../common/errors.js';
import {
  TURN_COLUMNS,
  THREAD_COLUMNS,
  type TurnRow,
  type ThreadRow,
  type ThreadModality,
  isUniqueViolation,
} from '../threads/thread.repository.js';

const TURNS_LIMIT = 20;

export type HouseholdTier = 'standard' | 'premium';

export interface TalkSessionRow {
  id: string;
  user_id: string;
  household_id: string;
  thread_id: string;
  status: 'active' | 'closed' | 'timed_out' | 'disconnected';
  started_at: string;
  ended_at: string | null;
}

const TALK_SESSION_COLUMNS =
  'id, user_id, household_id, thread_id, status, started_at, ended_at';

export class LumiRepository extends BaseRepository {
  async getThreadTurns(threadId: string, householdId: string): Promise<Turn[]> {
    const { data: thread, error: threadError } = await this.client
      .from('threads')
      .select('id, household_id')
      .eq('id', threadId)
      .maybeSingle();
    if (threadError) throw threadError;
    if (!thread || (thread as { household_id: string }).household_id !== householdId) {
      throw new ForbiddenError('Thread not accessible');
    }

    // Newest 20 first, then reverse for ascending display order. The DB has no
    // single-query "last N ascending" — descending + limit + reverse is the
    // standard idiom (also used by GitHub Search and Postgres docs examples).
    const { data, error } = await this.client
      .from('thread_turns')
      .select(TURN_COLUMNS)
      .eq('thread_id', threadId)
      .order('server_seq', { ascending: false })
      .limit(TURNS_LIMIT);
    if (error) throw error;

    const rows = ((data as TurnRow[] | null) ?? []).slice(0, TURNS_LIMIT).reverse();
    return rows.map(mapRowToTurn);
  }

  async getHouseholdTier(householdId: string): Promise<HouseholdTier | null> {
    const { data, error } = await this.client
      .from('households')
      .select('tier')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return (data as { tier: HouseholdTier }).tier;
  }

  async findActiveAmbientThread(
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

  // Lazy-create an ambient (non-onboarding) thread. The Story 12.4 partial unique
  // index `threads_one_active_per_household_type` prevents two active rows for
  // the same (household, type). On a concurrent insert that loses the race, we
  // re-read and return the winner's row so the caller observes a stable thread.
  async createAmbientThread(
    householdId: string,
    type: string,
    modality: ThreadModality,
  ): Promise<ThreadRow> {
    try {
      const { data, error } = await this.client
        .from('threads')
        .insert({ household_id: householdId, type, modality })
        .select(THREAD_COLUMNS)
        .single();
      if (error) throw error;
      return data as ThreadRow;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.findActiveAmbientThread(householdId, type);
      if (winner === null || winner.status !== 'active') {
        throw new Error(
          `createAmbientThread: unique-violation race unresolvable — no active thread found for household ${householdId} type ${type}`,
        );
      }
      return winner;
    }
  }

  async createTalkSession(input: {
    userId: string;
    householdId: string;
    threadId: string;
  }): Promise<TalkSessionRow> {
    const { data, error } = await this.client
      .from('voice_sessions')
      .insert({
        user_id: input.userId,
        household_id: input.householdId,
        thread_id: input.threadId,
      })
      .select(TALK_SESSION_COLUMNS)
      .single();
    if (error) throw error;
    return data as TalkSessionRow;
  }

  async findTalkSession(sessionId: string): Promise<TalkSessionRow | null> {
    const { data, error } = await this.client
      .from('voice_sessions')
      .select(TALK_SESSION_COLUMNS)
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw error;
    return (data as TalkSessionRow | null) ?? null;
  }

  async closeTalkSession(sessionId: string, endedAt: string, householdId: string): Promise<void> {
    const { error } = await this.client
      .from('voice_sessions')
      .update({ status: 'closed', ended_at: endedAt })
      .eq('id', sessionId)
      .eq('household_id', householdId)
      .eq('status', 'active');
    if (error) throw error;
  }
}

function mapRowToTurn(row: TurnRow): Turn {
  return {
    id: row.id,
    thread_id: row.thread_id,
    server_seq: row.server_seq,
    role: row.role,
    body: row.body,
    modality: row.modality,
    created_at: row.created_at,
  };
}
