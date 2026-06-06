import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LumiRepository } from './lumi.repository.js';

// Minimal supabase chain mock for insertTurn:
//   getNextSeq → from().select().eq().order().limit().maybeSingle()  (null → seq 1)
//   insert     → from().insert(payload).select().single()             (returns row)
// The same builder backs both chains; we capture the insert payload to assert on
// whether nudge_trigger is present.
function buildClient() {
  const capture: { payload?: Record<string, unknown> } = {};

  const row = {
    id: 'turn-1',
    thread_id: 'thread-1',
    server_seq: 1,
    role: 'lumi',
    body: { type: 'message', content: 'hi' },
    modality: 'text',
    created_at: '2026-06-06T00:00:00.000Z',
  };

  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  builder.single = vi.fn(() => Promise.resolve({ data: row, error: null }));
  builder.insert = vi.fn((payload: Record<string, unknown>) => {
    capture.payload = payload;
    return builder;
  });

  const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
  return { client, capture };
}

describe('LumiRepository.insertTurn — nudge_trigger column', () => {
  it('includes nudge_trigger in the insert payload when nudgeTrigger is provided', async () => {
    const { client, capture } = buildClient();
    const repo = new LumiRepository(client);

    await repo.insertTurn({
      threadId: 'thread-1',
      role: 'lumi',
      body: { type: 'message', content: 'hi' },
      modality: 'text',
      nudgeTrigger: 'plan_completed',
    });

    expect(capture.payload).toMatchObject({ nudge_trigger: 'plan_completed' });
  });

  it('omits nudge_trigger from the insert payload when nudgeTrigger is absent', async () => {
    const { client, capture } = buildClient();
    const repo = new LumiRepository(client);

    await repo.insertTurn({
      threadId: 'thread-1',
      role: 'user',
      body: { type: 'message', content: 'hi' },
      modality: 'text',
    });

    expect(capture.payload).toBeDefined();
    expect('nudge_trigger' in (capture.payload ?? {})).toBe(false);
  });
});
