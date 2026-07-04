import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MemoryContextService } from './memory-context.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

interface QueryCapture {
  eqs: Array<{ column: string; value: unknown }>;
  is: { column: string; value: unknown } | null;
  in: { column: string; values: unknown[] } | null;
}

function buildClient(opts: {
  rows: Array<{ node_type: string; prose_text: string }>;
  error?: unknown;
  capture?: QueryCapture;
}): SupabaseClient {
  const result = { data: opts.rows, error: opts.error ?? null };
  const builder = {
    select: vi.fn().mockImplementation(() => builder),
    eq: vi.fn().mockImplementation((column: string, value: unknown) => {
      if (opts.capture) opts.capture.eqs.push({ column, value });
      return builder;
    }),
    is: vi.fn().mockImplementation((column: string, value: unknown) => {
      if (opts.capture) opts.capture.is = { column, value };
      return builder;
    }),
    in: vi.fn().mockImplementation((column: string, values: unknown[]) => {
      if (opts.capture) opts.capture.in = { column, values };
      return Promise.resolve(result);
    }),
  };
  const from = vi.fn().mockReturnValue(builder);
  return { from } as unknown as SupabaseClient;
}

describe('MemoryContextService.getContextForPlanning', () => {
  it('returns empty arrays when household has no memory nodes', async () => {
    const client = buildClient({ rows: [] });
    const service = new MemoryContextService(client);

    const result = await service.getContextForPlanning(HOUSEHOLD_ID);

    expect(result).toEqual({ l0Preferences: [], l1MethodPriors: [], culturalObligations: [] });
  });

  it('routes rhythm→L1 and other node types→L0, leaving culturalObligations empty', async () => {
    const client = buildClient({
      rows: [
        { node_type: 'other', prose_text: 'Maya refuses bell peppers.' },
        { node_type: 'rhythm', prose_text: 'Ayaan prefers sandwiches over wraps.' },
        { node_type: 'other', prose_text: 'Friday dinners are vegetarian.' },
        { node_type: 'child_obsession', prose_text: 'Ayaan dislikes strong spices.' },
      ],
    });
    const service = new MemoryContextService(client);

    const result = await service.getContextForPlanning(HOUSEHOLD_ID);

    expect(result.l0Preferences).toEqual([
      'Maya refuses bell peppers.',
      'Friday dinners are vegetarian.',
      'Ayaan dislikes strong spices.',
    ]);
    expect(result.l1MethodPriors).toEqual(['Ayaan prefers sandwiches over wraps.']);
    expect(result.culturalObligations).toEqual([]);
  });

  it('filters by household, excludes hard_forgotten and soft_forget_at, restricts node types', async () => {
    const capture: QueryCapture = { eqs: [], is: null, in: null };
    const client = buildClient({ rows: [], capture });
    const service = new MemoryContextService(client);

    await service.getContextForPlanning(HOUSEHOLD_ID);

    expect(capture.eqs).toEqual([
      { column: 'household_id', value: HOUSEHOLD_ID },
      { column: 'hard_forgotten', value: false },
    ]);
    expect(capture.is).toEqual({ column: 'soft_forget_at', value: null });
    expect(capture.in).toEqual({
      column: 'node_type',
      values: ['rhythm', 'child_obsession', 'other'],
    });
  });

  it('throws when supabase returns an error', async () => {
    const client = buildClient({ rows: [], error: { message: 'kaboom' } });
    const service = new MemoryContextService(client);

    await expect(service.getContextForPlanning(HOUSEHOLD_ID)).rejects.toMatchObject({
      message: 'kaboom',
    });
  });
});
