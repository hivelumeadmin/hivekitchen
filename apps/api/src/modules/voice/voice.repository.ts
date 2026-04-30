import type { SupabaseClient } from '@supabase/supabase-js';
import type { TurnBody } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';
import { NotFoundError } from '../../common/errors.js';
import { ThreadRepository, type ThreadRow, type TurnRow } from '../threads/thread.repository.js';

export type { ThreadRow, TurnRow };

export interface VoiceSessionRow {
  id: string;
  user_id: string;
  household_id: string;
  thread_id: string;
  elevenlabs_conversation_id: string | null;
  status: 'active' | 'closed' | 'timed_out' | 'disconnected';
  started_at: string;
  ended_at: string | null;
}

const SESSION_COLUMNS =
  'id, user_id, household_id, thread_id, elevenlabs_conversation_id, status, started_at, ended_at';

// VoiceRepository composes ThreadRepository for thread/turn primitives so
// voice-specific code stays small and the same primitives are reused by
// the text-onboarding module.
export class VoiceRepository extends BaseRepository {
  private readonly threads: ThreadRepository;

  constructor(client: SupabaseClient) {
    super(client);
    this.threads = new ThreadRepository(client);
  }

  // --- thread/turn primitives delegated to ThreadRepository ---

  createThread(
    householdId: string,
    type: string,
    modality: 'voice' | 'text',
  ): Promise<ThreadRow> {
    return this.threads.createThread(householdId, type, modality);
  }

  appendTurn(params: {
    threadId: string;
    seq: number;
    role: 'user' | 'lumi' | 'system';
    body: TurnBody;
    modality: 'text' | 'voice';
  }): Promise<TurnRow> {
    return this.threads.appendTurn(params);
  }

  appendTurnNext(params: {
    threadId: string;
    role: 'user' | 'lumi' | 'system';
    body: TurnBody;
    modality: 'text' | 'voice';
  }): Promise<TurnRow> {
    return this.threads.appendTurnNext(params);
  }

  getNextSeq(threadId: string): Promise<number> {
    return this.threads.getNextSeq(threadId);
  }

  closeThread(threadId: string): Promise<void> {
    return this.threads.closeThread(threadId);
  }

  // --- voice-specific methods ---

  async createVoiceSession(params: {
    userId: string;
    householdId: string;
    threadId: string;
    elevenLabsConversationId: string | null;
  }): Promise<VoiceSessionRow> {
    const { data, error } = await this.client
      .from('voice_sessions')
      .insert({
        user_id: params.userId,
        household_id: params.householdId,
        thread_id: params.threadId,
        elevenlabs_conversation_id: params.elevenLabsConversationId,
      })
      .select(SESSION_COLUMNS)
      .single();
    if (error) throw error;
    return data as VoiceSessionRow;
  }

  async findVoiceSession(sessionId: string): Promise<VoiceSessionRow | null> {
    const { data, error } = await this.client
      .from('voice_sessions')
      .select(SESSION_COLUMNS)
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw error;
    return (data as VoiceSessionRow | null) ?? null;
  }

  async findActiveSessionForHousehold(
    householdId: string,
  ): Promise<VoiceSessionRow | null> {
    const { data, error } = await this.client
      .from('voice_sessions')
      .select(SESSION_COLUMNS)
      .eq('household_id', householdId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as VoiceSessionRow | null) ?? null;
  }

  async updateVoiceSession(
    id: string,
    updates: Partial<Pick<VoiceSessionRow, 'status' | 'ended_at'>>,
  ): Promise<VoiceSessionRow> {
    const { data, error } = await this.client
      .from('voice_sessions')
      .update(updates)
      .eq('id', id)
      .select(SESSION_COLUMNS)
      .single();
    if (error) throw error;
    if (!data) throw new NotFoundError(`Voice session ${id} not found`);
    return data as VoiceSessionRow;
  }
}
