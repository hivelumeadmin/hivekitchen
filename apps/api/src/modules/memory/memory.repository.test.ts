import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MemoryRepository } from './memory.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const NODE_ID = '33333333-3333-4333-8333-333333333333';
const PROVENANCE_ID = '44444444-4444-4444-8444-444444444444';
const THREAD_ID = '55555555-5555-4555-8555-555555555555';
const TURN_ID = '66666666-6666-4666-8666-666666666666';

interface InsertCapture {
  table: string;
  payload: Record<string, unknown>;
}

function buildMockClient(opts: {
  insertResult?: { data: Record<string, unknown> | null; error: unknown };
  capture?: InsertCapture[];
}): SupabaseClient {
  const captures = opts.capture ?? [];
  const result = opts.insertResult ?? { data: null, error: null };
  const fromMock = vi.fn().mockImplementation((table: string) => ({
    insert(payload: Record<string, unknown>) {
      captures.push({ table, payload });
      return {
        select() {
          return {
            single: vi.fn().mockResolvedValue(result),
          };
        },
      };
    },
  }));
  return { from: fromMock } as unknown as SupabaseClient;
}

describe('MemoryRepository.insertNode', () => {
  it('writes row to memory_nodes and returns inserted shape', async () => {
    const stored = {
      id: NODE_ID,
      household_id: HOUSEHOLD_ID,
      node_type: 'allergy',
      facet: 'peanut',
      subject_child_id: null,
      prose_text: 'Declared allergy: peanut',
      soft_forget_at: null,
      hard_forgotten: false,
      created_at: '2026-04-30T00:00:00.000Z',
      updated_at: '2026-04-30T00:00:00.000Z',
    };
    const captures: InsertCapture[] = [];
    const client = buildMockClient({
      insertResult: { data: stored, error: null },
      capture: captures,
    });
    const repo = new MemoryRepository(client);

    const out = await repo.insertNode({
      household_id: HOUSEHOLD_ID,
      node_type: 'allergy',
      facet: 'peanut',
      prose_text: 'Declared allergy: peanut',
      subject_child_id: null,
    });

    expect(out.id).toBe(NODE_ID);
    expect(out.node_type).toBe('allergy');
    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe('memory_nodes');
    expect(captures[0].payload).toMatchObject({
      household_id: HOUSEHOLD_ID,
      node_type: 'allergy',
      facet: 'peanut',
    });
  });

  it('throws when supabase returns an error', async () => {
    const client = buildMockClient({
      insertResult: { data: null, error: { message: 'unique_violation', code: '23505' } },
    });
    const repo = new MemoryRepository(client);

    await expect(
      repo.insertNode({
        household_id: HOUSEHOLD_ID,
        node_type: 'allergy',
        facet: 'peanut',
        prose_text: 'x',
        subject_child_id: null,
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('MemoryRepository.insertProvenance', () => {
  it('writes row to memory_provenance with source_ref jsonb shape', async () => {
    const stored = {
      id: PROVENANCE_ID,
      memory_node_id: NODE_ID,
      source_type: 'onboarding',
      source_ref: { thread_id: THREAD_ID, turn_id: TURN_ID },
      captured_at: '2026-04-30T00:00:00.000Z',
      captured_by: USER_ID,
      confidence: 0.8,
      superseded_by: null,
    };
    const captures: InsertCapture[] = [];
    const client = buildMockClient({
      insertResult: { data: stored, error: null },
      capture: captures,
    });
    const repo = new MemoryRepository(client);

    const out = await repo.insertProvenance({
      memory_node_id: NODE_ID,
      source_type: 'onboarding',
      source_ref: { thread_id: THREAD_ID, turn_id: TURN_ID },
      captured_by: USER_ID,
      confidence: 0.8,
    });

    expect(out.id).toBe(PROVENANCE_ID);
    expect(out.confidence).toBe(0.8);
    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe('memory_provenance');
    expect(captures[0].payload).toMatchObject({
      memory_node_id: NODE_ID,
      source_type: 'onboarding',
      captured_by: USER_ID,
      confidence: 0.8,
    });
  });

  it('throws when supabase returns an error', async () => {
    const client = buildMockClient({
      insertResult: { data: null, error: { message: 'fk_violation', code: '23503' } },
    });
    const repo = new MemoryRepository(client);

    await expect(
      repo.insertProvenance({
        memory_node_id: NODE_ID,
        source_type: 'onboarding',
        source_ref: {},
        captured_by: null,
        confidence: 0.5,
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
