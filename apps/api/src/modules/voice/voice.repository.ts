import type { TurnBody } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';
import { NotFoundError } from '../../common/errors.js';

export interface ThreadRow {
  id: string;
  household_id: string;
  type: string;
  status: string;
  created_at: string;
}

export interface VoiceSessionRow {
  id: string;
  user_id: string;
  household_id: string;
  thread_id: string;
  elevenlabs_conversation_id: string | null;
  status: 'active' | 'closed' | 'timed_out';
  started_at: string;
  ended_at: string | null;
}

const THREAD_COLUMNS = 'id, household_id, type, status, created_at';
const SESSION_COLUMNS =
  'id, user_id, household_id, thread_id, elevenlabs_conversation_id, status, started_at, ended_at';

export class VoiceRepository extends BaseRepository {
  async createThread(householdId: string, type: string): Promise<ThreadRow> {
    const { data, error } = await this.client
      .from('threads')
      .insert({ household_id: householdId, type })
      .select(THREAD_COLUMNS)
      .single();
    if (error) throw error;
    return data as ThreadRow;
  }

  async createVoiceSession(params: {
    userId: string;
    householdId: string;
    threadId: string;
    elevenLabsConversationId: string;
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

  async findSessionByConversationId(
    elevenLabsConversationId: string,
  ): Promise<VoiceSessionRow | null> {
    const { data, error } = await this.client
      .from('voice_sessions')
      .select(SESSION_COLUMNS)
      .eq('elevenlabs_conversation_id', elevenLabsConversationId)
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

  async appendTurn(params: {
    threadId: string;
    seq: number;
    role: 'user' | 'lumi' | 'system';
    body: TurnBody;
    modality: 'text' | 'voice';
  }): Promise<void> {
    const { error } = await this.client.from('thread_turns').insert({
      thread_id: params.threadId,
      server_seq: params.seq,
      role: params.role,
      body: params.body,
      modality: params.modality,
    });
    if (error) throw error;
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
}
