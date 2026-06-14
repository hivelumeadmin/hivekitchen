import { BaseRepository } from '../../repository/base.repository.js';

// 5-S16 — weekly per-user voice usage counter (voice_usage table). Backs the
// standard-tier cap: getWeeklyUsage reads the current week's consumption, and
// incrementUsage atomically adds an utterance's estimated duration.
export class VoiceUsageRepository extends BaseRepository {
  // Returns ms_consumed for the given week, or 0 if no row exists.
  async getWeeklyUsage(userId: string, weekStart: string): Promise<number> {
    const { data, error } = await this.client
      .from('voice_usage')
      .select('ms_consumed')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .maybeSingle();
    if (error) throw error;
    return (data as { ms_consumed: number } | null)?.ms_consumed ?? 0;
  }

  // Atomically increments ms_consumed via the increment_voice_usage PostgreSQL
  // function. INSERT ... ON CONFLICT DO UPDATE ensures the counter never
  // under-counts even under concurrent turns (see D-5S16-1 for the residual
  // cross-session read-before-write race).
  async incrementUsage(userId: string, weekStart: string, durationMs: number): Promise<void> {
    const { error } = await this.client.rpc('increment_voice_usage', {
      p_user_id: userId,
      p_week_start: weekStart,
      p_duration_ms: durationMs,
    });
    if (error) throw error;
  }
}
