import { BaseRepository } from '../../repository/base.repository.js';

const DEFAULT_RETENTION_DAYS = 90;

export interface VoiceTranscriptItemRow {
  id: string;
  transcript: string;
  retention_until: string;
  created_at: string;
}

// Slice 5-S5 — persists the user-speech transcript for a voice turn. Anchored to
// the Lumi turn that the speech produced (turn_id → thread_turns.id). 5-S15 adds
// per-user scoping (user_id), the retention-controls read/delete methods, and the
// nightly purge of expired rows.
export class VoiceTranscriptRepository extends BaseRepository {
  async insertTranscript(
    threadId: string,
    turnId: string,
    transcript: string,
    retentionDays = DEFAULT_RETENTION_DAYS,
    userId?: string, // 5-S15 — optional; undefined for legacy/text callers
  ): Promise<void> {
    const retentionUntil = new Date();
    retentionUntil.setDate(retentionUntil.getDate() + retentionDays);

    const row: Record<string, unknown> = {
      thread_id: threadId,
      turn_id: turnId,
      transcript,
      retention_until: retentionUntil.toISOString(),
    };
    if (userId !== undefined) row.user_id = userId;

    const { error } = await this.client.from('voice_transcripts').insert(row);
    if (error) throw error;
  }

  // 5-S15 — newest-first transcripts for the authenticated user (AC1–AC3).
  // Rows from legacy 5-S5 inserts (user_id NULL) are invisible here.
  async findByUserId(userId: string, limit = 20): Promise<VoiceTranscriptItemRow[]> {
    const { data, error } = await this.client
      .from('voice_transcripts')
      .select('id, transcript, retention_until, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as VoiceTranscriptItemRow[] | null) ?? [];
  }

  // 5-S15 — synchronous delete of all of a user's transcripts (AC5), run when
  // the user switches to immediate_delete mode.
  async deleteByUserId(userId: string): Promise<void> {
    const { error } = await this.client
      .from('voice_transcripts')
      .delete()
      .eq('user_id', userId);
    if (error) throw error;
  }

  // 5-S15 — nightly purge of expired rows (AC8). Mirrors the
  // .delete().select('id') pattern proven in MemoryRepository.hardDeleteSoftForgotten.
  async deleteExpired(): Promise<{ count: number }> {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from('voice_transcripts')
      .delete()
      .lt('retention_until', now)
      .select('id');
    if (error) throw error;
    return { count: (data as { id: string }[] | null)?.length ?? 0 };
  }
}
