import { describe, it, expect, vi } from 'vitest';
import type { SignalRow } from '@hivekitchen/types';
import { applyLunchRatingSignal, projectLunchRatings } from './child-preferences.projection.js';
import type { ChildPreferencesRepository } from './child-preferences.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_A = '22222222-2222-4222-8222-222222222222';
const CHILD_B = '33333333-3333-4333-8333-333333333333';
const RECIPE_X = '44444444-4444-4444-8444-444444444444';
const RECIPE_Y = '55555555-5555-4555-8555-555555555555';

const DAY = '2026-06-03';

let seq = 0;
function signal(overrides: Partial<SignalRow> = {}): SignalRow {
  seq += 1;
  const id = `66666666-6666-4666-8666-${String(seq).padStart(12, '0')}`;
  return {
    id,
    household_id: HOUSEHOLD_ID,
    child_id: CHILD_A,
    kind: 'lunch_rating',
    subject_ref: { recipe_id: RECIPE_X, slot_kind: 'main' },
    payload: { kind: 'lunch_rating', rating: 'loved', date: DAY },
    occurred_at: '2026-06-03T12:00:00.000Z',
    source: 'lunch_link',
    created_at: '2026-06-03T12:00:00.000Z',
    ...overrides,
  } as SignalRow;
}

function buildLogger() {
  const warn = vi.fn();
  return { logger: { warn }, warn };
}

describe('projectLunchRatings', () => {
  it('maps one signal to one child_preferences row with the live writer source', () => {
    const rows = projectLunchRatings([signal()]);

    expect(rows).toEqual([
      {
        household_id: HOUSEHOLD_ID,
        child_id: CHILD_A,
        recipe_id: RECIPE_X,
        slot_kind: 'main',
        signal_type: 'loved',
        signal_date: DAY,
        // signals.source ('lunch_link' | 'import') is a DIFFERENT vocabulary —
        // child_preferences.source keeps the live writer's default.
        source: 'layer1_emoji',
      },
    ]);
  });

  it('collapses N re-ratings of the same slot-day to 1 row — latest occurred_at wins', () => {
    const rows = projectLunchRatings([
      signal({ occurred_at: '2026-06-03T12:00:00.000Z', payload: { kind: 'lunch_rating', rating: 'loved', date: DAY } }),
      signal({ occurred_at: '2026-06-03T15:00:00.000Z', payload: { kind: 'lunch_rating', rating: 'not-really', date: DAY } }),
      signal({ occurred_at: '2026-06-03T13:00:00.000Z', payload: { kind: 'lunch_rating', rating: 'ok', date: DAY } }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.signal_type).toBe('not-really');
  });

  it('tie-breaks equal occurred_at on created_at, then on id', () => {
    const sameMoment = '2026-06-03T12:00:00.000Z';
    const byCreatedAt = projectLunchRatings([
      signal({ occurred_at: sameMoment, created_at: '2026-06-03T12:00:02.000Z', payload: { kind: 'lunch_rating', rating: 'ok', date: DAY } }),
      signal({ occurred_at: sameMoment, created_at: '2026-06-03T12:00:01.000Z', payload: { kind: 'lunch_rating', rating: 'loved', date: DAY } }),
    ]);
    expect(byCreatedAt[0]?.signal_type).toBe('ok');

    const byId = projectLunchRatings([
      signal({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', occurred_at: sameMoment, created_at: sameMoment, payload: { kind: 'lunch_rating', rating: 'ok', date: DAY } }),
      signal({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', occurred_at: sameMoment, created_at: sameMoment, payload: { kind: 'lunch_rating', rating: 'not-really', date: DAY } }),
    ]);
    expect(byId[0]?.signal_type).toBe('not-really');
  });

  it('keeps main and snack of the same recipe apart (FR124 slot_kind isolation)', () => {
    const rows = projectLunchRatings([
      signal({ subject_ref: { recipe_id: RECIPE_X, slot_kind: 'main' } }),
      signal({ subject_ref: { recipe_id: RECIPE_X, slot_kind: 'snack' } }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.slot_kind).sort()).toEqual(['main', 'snack']);
  });

  it('keys on payload.date, never on occurred_at — a late-night rating stays on its rated day', () => {
    const rows = projectLunchRatings([
      signal({ occurred_at: '2026-06-04T02:00:00.000Z', payload: { kind: 'lunch_rating', rating: 'ok', date: DAY } }),
      signal({ occurred_at: '2026-06-04T03:00:00.000Z', payload: { kind: 'lunch_rating', rating: 'loved', date: '2026-06-04' } }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.signal_date).sort()).toEqual([DAY, '2026-06-04']);
  });

  it('separates children and recipes', () => {
    const rows = projectLunchRatings([
      signal({ child_id: CHILD_A }),
      signal({ child_id: CHILD_B }),
      signal({ subject_ref: { recipe_id: RECIPE_Y, slot_kind: 'main' } }),
    ]);

    expect(rows).toHaveLength(3);
  });

  it('skips (never throws) rows with a bad subject_ref, bad payload, or null child_id — count surfaced', () => {
    const { logger, warn } = buildLogger();

    const rows = projectLunchRatings(
      [
        signal(),
        signal({ subject_ref: { recipe_id: 'not-a-uuid', slot_kind: 'main' } }),
        signal({ subject_ref: null }),
        signal({ payload: { kind: 'extra_removal', component_type: 'cucumber' } as never }),
        signal({ child_id: null }),
      ],
      logger,
    );

    expect(rows).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      skipped: 4,
      reasons: { subject_ref: 2, payload: 1, child_id: 1 },
    });
  });

  it('is order-independent — shuffling the input does not change the result', () => {
    const a = signal({ occurred_at: '2026-06-03T10:00:00.000Z', payload: { kind: 'lunch_rating', rating: 'ok', date: DAY } });
    const b = signal({ occurred_at: '2026-06-03T11:00:00.000Z', payload: { kind: 'lunch_rating', rating: 'loved', date: DAY } });

    expect(projectLunchRatings([a, b])).toEqual(projectLunchRatings([b, a]));
    expect(projectLunchRatings([b, a])[0]?.signal_type).toBe('loved');
  });

  it('returns an empty array for no signals (FR125: absent, never a zero row)', () => {
    expect(projectLunchRatings([])).toEqual([]);
  });
});

describe('applyLunchRatingSignal', () => {
  function buildRepo() {
    return {
      upsertSignal: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChildPreferencesRepository & { upsertSignal: ReturnType<typeof vi.fn> };
  }

  it('upserts the projected row through the existing single write primitive', async () => {
    const repo = buildRepo();
    const { logger } = buildLogger();

    await applyLunchRatingSignal(repo, signal({ subject_ref: { recipe_id: RECIPE_Y, slot_kind: 'extra' } }), logger);

    expect(repo.upsertSignal).toHaveBeenCalledTimes(1);
    expect(repo.upsertSignal.mock.calls[0]?.[0]).toEqual({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_A,
      recipe_id: RECIPE_Y,
      slot_kind: 'extra',
      signal_type: 'loved',
      signal_date: DAY,
      source: 'layer1_emoji',
    });
  });

  it('warns and writes nothing when the signal cannot be projected', async () => {
    const repo = buildRepo();
    const { logger, warn } = buildLogger();

    await applyLunchRatingSignal(repo, signal({ child_id: null }), logger);

    expect(repo.upsertSignal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('propagates an upsert failure so the caller can warn-and-continue per slot', async () => {
    const repo = buildRepo();
    repo.upsertSignal.mockRejectedValueOnce(new Error('slot write failed'));
    const { logger } = buildLogger();

    await expect(applyLunchRatingSignal(repo, signal(), logger)).rejects.toThrow('slot write failed');
  });
});
