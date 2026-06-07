import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { VoiceTranscriptRepository } from './voice-transcript.repository.js';

// Captures the payload passed to from('voice_transcripts').insert(...).
function buildClient(insertError: unknown = null) {
  const capture: { table?: string; payload?: Record<string, unknown> } = {};
  const client = {
    from: vi.fn((table: string) => {
      capture.table = table;
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          capture.payload = payload;
          return Promise.resolve({ error: insertError });
        }),
      };
    }),
  } as unknown as SupabaseClient;
  return { client, capture };
}

describe('VoiceTranscriptRepository.insertTranscript', () => {
  it('inserts a row with thread_id, turn_id and transcript', async () => {
    const { client, capture } = buildClient();
    const repo = new VoiceTranscriptRepository(client);

    await repo.insertTranscript('thread-1', 'turn-1', 'pasta please');

    expect(capture.table).toBe('voice_transcripts');
    expect(capture.payload).toMatchObject({
      thread_id: 'thread-1',
      turn_id: 'turn-1',
      transcript: 'pasta please',
    });
  });

  it('defaults retention_until to ~now + 90 days', async () => {
    const { client, capture } = buildClient();
    const repo = new VoiceTranscriptRepository(client);

    const before = Date.now();
    await repo.insertTranscript('thread-1', 'turn-1', 'hi');
    const retentionMs = new Date(capture.payload!.retention_until as string).getTime();
    const expected = before + 90 * 24 * 60 * 60 * 1000;

    // ±1 minute tolerance covers clock drift across the two Date reads.
    expect(Math.abs(retentionMs - expected)).toBeLessThan(60_000);
  });

  it('honors an explicit retentionDays override', async () => {
    const { client, capture } = buildClient();
    const repo = new VoiceTranscriptRepository(client);

    const before = Date.now();
    await repo.insertTranscript('thread-1', 'turn-1', 'hi', 30);
    const retentionMs = new Date(capture.payload!.retention_until as string).getTime();
    const expected = before + 30 * 24 * 60 * 60 * 1000;

    expect(Math.abs(retentionMs - expected)).toBeLessThan(60_000);
  });

  it('throws when the insert returns an error', async () => {
    const { client } = buildClient(new Error('insert failed'));
    const repo = new VoiceTranscriptRepository(client);

    await expect(repo.insertTranscript('thread-1', 'turn-1', 'hi')).rejects.toThrow('insert failed');
  });
});
