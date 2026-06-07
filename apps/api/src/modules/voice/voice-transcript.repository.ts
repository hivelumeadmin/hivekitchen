import { BaseRepository } from '../../repository/base.repository.js';

const DEFAULT_RETENTION_DAYS = 90;

// Slice 5-S5 — persists the user-speech transcript for a voice turn. Anchored to
// the Lumi turn that the speech produced (turn_id → thread_turns.id). MVP is
// insert-only; findByThreadId / delete arrive in 5-S15 (retention controls).
export class VoiceTranscriptRepository extends BaseRepository {
  async insertTranscript(
    threadId: string,
    turnId: string,
    transcript: string,
    retentionDays = DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    const retentionUntil = new Date();
    retentionUntil.setDate(retentionUntil.getDate() + retentionDays);

    const { error } = await this.client.from('voice_transcripts').insert({
      thread_id: threadId,
      turn_id: turnId,
      transcript,
      retention_until: retentionUntil.toISOString(),
    });
    if (error) throw error;
  }
}
