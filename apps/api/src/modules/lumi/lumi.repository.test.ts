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

// Slice 5-S4 — getThreadTurns with a fromSeq cursor. Models the two reads the
// method makes: the threads ownership check, then the thread_turns gte/ascending
// scan. Captures the value passed to .gte() to assert bigint→string coercion.
function buildGetTurnsClient(opts: {
  ownershipRow: { id: string; household_id: string } | null;
  rows: Array<Record<string, unknown>>;
}) {
  const capture: { gteValue?: string } = {};

  const client = {
    from(table: string) {
      if (table === 'threads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: opts.ownershipRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'thread_turns') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {
          eq: () => chain,
          gte: (_col: string, val: string) => {
            capture.gteValue = val;
            return chain;
          },
          order: () => Promise.resolve({ data: opts.rows, error: null }),
        };
        return { select: () => chain };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, capture };
}

describe('LumiRepository.getThreadTurns — fromSeq cursor', () => {
  it('passes fromSeq to .gte() as a string and returns the rows ascending', async () => {
    const { client, capture } = buildGetTurnsClient({
      ownershipRow: { id: 'thread-1', household_id: 'hh-1' },
      rows: [
        {
          id: 'turn-2',
          thread_id: 'thread-1',
          server_seq: 2,
          role: 'system',
          body: { type: 'message', content: 'two' },
          modality: 'text',
          created_at: '2026-06-06T00:00:00.000Z',
        },
        {
          id: 'turn-3',
          thread_id: 'thread-1',
          server_seq: 3,
          role: 'system',
          body: { type: 'message', content: 'three' },
          modality: 'text',
          created_at: '2026-06-06T00:00:01.000Z',
        },
      ],
    });
    const repo = new LumiRepository(client);

    const turns = await repo.getThreadTurns('thread-1', 'hh-1', 2n);

    expect(capture.gteValue).toBe('2');
    expect(turns.map((t) => t.server_seq)).toEqual([2, 3]);
  });

  it('cross-household thread → ForbiddenError, no thread_turns read', async () => {
    const { client } = buildGetTurnsClient({
      ownershipRow: { id: 'thread-1', household_id: 'other-hh' },
      rows: [],
    });
    const repo = new LumiRepository(client);

    await expect(repo.getThreadTurns('thread-1', 'hh-1', 2n)).rejects.toThrow();
  });
});

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
