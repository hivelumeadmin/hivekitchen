import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { decryptField } from '../../lib/envelope-encryption.js';
import { SignalsService } from './signals.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
const OCCURRED_AT = '2026-08-02T12:00:00.000Z';

interface InsertCapture {
  rows: Record<string, unknown>[];
  failNext: { value: boolean };
}

// Models only the chain SignalsRepository calls: insert().select().single().
function buildMockSupabase(capture: InsertCapture) {
  return {
    from(table: string) {
      if (table !== 'signals') throw new Error(`unexpected table: ${table}`);
      return {
        insert(row: Record<string, unknown>) {
          return {
            select(_cols: string) {
              return {
                single: async () => {
                  if (capture.failNext.value) {
                    return { data: null, error: { code: '57014', message: 'insert failed' } };
                  }
                  capture.rows.push(row);
                  return {
                    data: { id: '99999999-9999-4999-8999-999999999999', ...row },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function buildService(capture: InsertCapture) {
  const warn = vi.fn();
  // kek null → DEK path resolves to null without touching the DB, and
  // encryptField falls through to the NOOP: dev envelope — same shape
  // discipline as heart-note tests.
  const service = new SignalsService(buildMockSupabase(capture), null, { warn });
  return { service, warn };
}

function freshCapture(): InsertCapture {
  return { rows: [], failNext: { value: false } };
}

const RATING_INPUT = {
  household_id: HOUSEHOLD_ID,
  child_id: CHILD_ID,
  subject_ref: { recipe_id: RECIPE_ID, slot_kind: 'main' },
  payload: { kind: 'lunch_rating' as const, rating: 'loved' as const, date: '2026-08-02' },
  occurred_at: OCCURRED_AT,
  source: 'lunch_link' as const,
};

describe('SignalsService.record', () => {
  it('inserts a lunch_rating signal verbatim (no free text, no encryption)', async () => {
    const capture = freshCapture();
    const { service, warn } = buildService(capture);

    await service.record(RATING_INPUT);

    expect(capture.rows).toHaveLength(1);
    expect(capture.rows[0]).toEqual({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      kind: 'lunch_rating',
      subject_ref: { recipe_id: RECIPE_ID, slot_kind: 'main' },
      payload: { kind: 'lunch_rating', rating: 'loved', date: '2026-08-02' },
      occurred_at: OCCURRED_AT,
      source: 'lunch_link',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('encrypts lunch_request.text before insert — plaintext never lands at rest', async () => {
    const capture = freshCapture();
    const { service } = buildService(capture);

    await service.record({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      subject_ref: null,
      payload: { kind: 'lunch_request', text: 'salmon please' },
      occurred_at: OCCURRED_AT,
      source: 'lunch_link',
    });

    const stored = capture.rows[0]?.payload as { kind: string; text: string };
    expect(stored.kind).toBe('lunch_request');
    expect(stored.text).not.toBe('salmon please');
    expect(decryptField<string>(stored.text, null)).toBe('salmon please');
  });

  it('encrypts preference_edit.item before insert', async () => {
    const capture = freshCapture();
    const { service } = buildService(capture);

    await service.record({
      household_id: HOUSEHOLD_ID,
      child_id: null,
      subject_ref: null,
      payload: {
        kind: 'preference_edit',
        item: 'paneer',
        valence: 'loves',
        enforcement: 'just_for_context',
        scope: 'household',
      },
      occurred_at: OCCURRED_AT,
      source: 'app',
    });

    const stored = capture.rows[0]?.payload as { item: string; valence: string };
    expect(stored.item).not.toBe('paneer');
    expect(decryptField<string>(stored.item, null)).toBe('paneer');
    expect(stored.valence).toBe('loves');
    expect(capture.rows[0]?.child_id).toBeNull();
  });

  it('inserts an extra_removal signal with its plan_item_id subject_ref', async () => {
    const capture = freshCapture();
    const { service } = buildService(capture);

    await service.record({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      subject_ref: { plan_item_id: null },
      payload: { kind: 'extra_removal', component_type: 'cucumber' },
      occurred_at: OCCURRED_AT,
      source: 'app',
    });

    expect(capture.rows[0]?.kind).toBe('extra_removal');
    expect(capture.rows[0]?.subject_ref).toEqual({ plan_item_id: null });
  });

  it('rejects an invalid payload with a warn log and NO insert — never throws', async () => {
    const capture = freshCapture();
    const { service, warn } = buildService(capture);

    await expect(
      service.record({
        household_id: HOUSEHOLD_ID,
        child_id: CHILD_ID,
        subject_ref: null,
        // leftover_log has no producing payload shape — must be rejected.
        payload: { kind: 'leftover_log' } as never,
        occurred_at: OCCURRED_AT,
        source: 'app',
      }),
    ).resolves.toBeUndefined();

    expect(capture.rows).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('swallows an insert failure with a warn log — never throws', async () => {
    const capture = freshCapture();
    capture.failNext.value = true;
    const { service, warn } = buildService(capture);

    await expect(service.record(RATING_INPUT)).resolves.toBeUndefined();

    expect(capture.rows).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('survives a null input — never-throws holds outside the typed surface (15-s2 review patch)', async () => {
    const capture = freshCapture();
    const { service, warn } = buildService(capture);

    // A malformed call from a future JS caller: both the pre-try kind
    // extraction and the catch's household_id access must be null-safe.
    await expect(service.record(null as never)).resolves.toBeUndefined();

    expect(capture.rows).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    const [logObj] = warn.mock.calls[0] ?? [];
    expect(logObj).toMatchObject({ kind: 'unknown' });
  });

  it('never logs payload content — only household_id and kind', async () => {
    const capture = freshCapture();
    capture.failNext.value = true;
    const { service, warn } = buildService(capture);

    await service.record({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      subject_ref: null,
      payload: { kind: 'lunch_request', text: 'secret salmon wish' },
      occurred_at: OCCURRED_AT,
      source: 'lunch_link',
    });

    const [logObj] = warn.mock.calls[0] ?? [];
    expect(JSON.stringify(logObj)).not.toContain('secret salmon wish');
    expect(logObj).toMatchObject({ household_id: HOUSEHOLD_ID, kind: 'lunch_request' });
  });
});
