import { describe, it, expect } from 'vitest';
import type { FlavorPassportStamp } from '@hivekitchen/contracts';
import { FlavorPassportService } from './flavor-passport.service.js';
import type { FlavorPassportRepository } from './flavor-passport.repository.js';

const CHILD_ID = '22222222-2222-4222-8222-222222222222';

function stamp(overrides: Partial<FlavorPassportStamp> = {}): FlavorPassportStamp {
  return {
    recipe_id: '44444444-4444-4444-8444-444444444444',
    recipe_name: 'Tikka wrap',
    slot_kind: 'main',
    signal_type: 'loved',
    signal_date: '2026-06-01',
    cuisine_tags: ['indian'],
    method_caption: null,
    child_voice_quote: null,
    ...overrides,
  };
}

function makeStamps(count: number): FlavorPassportStamp[] {
  return Array.from({ length: count }, (_, i) =>
    stamp({
      recipe_id: `0000000${i}-0000-4000-8000-00000000000${i % 10}`.slice(0, 36),
      signal_date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    }),
  );
}

function serviceWith(stamps: FlavorPassportStamp[]): FlavorPassportService {
  const repo = {
    getStampsForChild: async () => stamps,
  } as unknown as FlavorPassportRepository;
  return new FlavorPassportService(repo);
}

describe('FlavorPassportService.buildPassport', () => {
  it('returns the empty state for 0 stamps', async () => {
    const result = await serviceWith([]).buildPassport(CHILD_ID, 'hh', { childFirst: false });

    expect(result).toEqual({ child_id: CHILD_ID, state: 'empty', stamps: [] });
    expect(result.available_filters).toBeUndefined();
  });

  it('is "developing" with no available_filters at 8 stamps', async () => {
    const result = await serviceWith(makeStamps(8)).buildPassport(CHILD_ID, 'hh', {
      childFirst: false,
    });

    expect(result.state).toBe('developing');
    expect(result.stamps).toHaveLength(8);
    expect(result.available_filters).toBeUndefined();
  });

  it('is "established" with available_filters at 9 stamps', async () => {
    const stamps = makeStamps(9).map((s, i) =>
      stamp({
        ...s,
        cuisine_tags: i % 2 === 0 ? ['indian'] : ['italian'],
        slot_kind: i === 0 ? 'snack' : 'main',
      }),
    );
    const result = await serviceWith(stamps).buildPassport(CHILD_ID, 'hh', { childFirst: false });

    expect(result.state).toBe('established');
    expect(result.available_filters).toBeDefined();
    expect(result.available_filters?.cuisines).toEqual(['indian', 'italian']); // deduped + sorted
    expect(result.available_filters?.slot_kinds).toEqual(['main', 'snack']); // deterministic slot order
  });

  it('childFirst=true orders loved before ok, chronological within each tier', async () => {
    const stamps = [
      stamp({ recipe_id: 'aaaaaaaa-0000-4000-8000-000000000001', signal_type: 'ok', signal_date: '2026-06-02' }),
      stamp({ recipe_id: 'bbbbbbbb-0000-4000-8000-000000000002', signal_type: 'loved', signal_date: '2026-06-05' }),
      stamp({ recipe_id: 'cccccccc-0000-4000-8000-000000000003', signal_type: 'loved', signal_date: '2026-06-01' }),
      stamp({ recipe_id: 'dddddddd-0000-4000-8000-000000000004', signal_type: 'ok', signal_date: '2026-06-04' }),
    ];
    const result = await serviceWith(stamps).buildPassport(CHILD_ID, 'hh', { childFirst: true });

    expect(result.stamps.map((s) => s.signal_type)).toEqual(['loved', 'loved', 'ok', 'ok']);
    expect(result.stamps.map((s) => s.signal_date)).toEqual([
      '2026-06-01',
      '2026-06-05',
      '2026-06-02',
      '2026-06-04',
    ]);
  });

  it('childFirst=false orders all stamps chronologically regardless of signal_type', async () => {
    const stamps = [
      stamp({ recipe_id: 'aaaaaaaa-0000-4000-8000-000000000001', signal_type: 'loved', signal_date: '2026-06-05' }),
      stamp({ recipe_id: 'bbbbbbbb-0000-4000-8000-000000000002', signal_type: 'ok', signal_date: '2026-06-01' }),
      stamp({ recipe_id: 'cccccccc-0000-4000-8000-000000000003', signal_type: 'loved', signal_date: '2026-06-03' }),
    ];
    const result = await serviceWith(stamps).buildPassport(CHILD_ID, 'hh', { childFirst: false });

    expect(result.stamps.map((s) => s.signal_date)).toEqual([
      '2026-06-01',
      '2026-06-03',
      '2026-06-05',
    ]);
  });
});
