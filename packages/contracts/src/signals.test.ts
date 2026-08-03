import { describe, expect, it } from 'vitest';

import {
  LunchRatingSubjectRefSchema,
  RecordSignalInputSchema,
  SignalKindSchema,
  SignalPayloadSchema,
  SignalRowSchema,
  SignalSourceSchema,
} from './signals.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '55555555-5555-4555-8555-555555555555';
const OCCURRED_AT = '2026-08-02T12:00:00.000Z';

function input(payload: unknown, overrides: Record<string, unknown> = {}) {
  return {
    household_id: HOUSEHOLD_ID,
    child_id: CHILD_ID,
    subject_ref: null,
    payload,
    occurred_at: OCCURRED_AT,
    source: 'app',
    ...overrides,
  };
}

describe('SignalPayloadSchema', () => {
  it('round-trips a lunch_rating payload', () => {
    const payload = { kind: 'lunch_rating', rating: 'loved', date: '2026-08-02' };

    expect(SignalPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('round-trips a lunch_request payload (ciphertext string)', () => {
    const payload = { kind: 'lunch_request', text: 'NOOP:c2FsbW9uIHBsZWFzZQ==' };

    expect(SignalPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('round-trips an extra_removal payload', () => {
    const payload = { kind: 'extra_removal', component_type: 'cucumber' };

    expect(SignalPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('round-trips a preference_edit payload', () => {
    const payload = {
      kind: 'preference_edit',
      item: 'NOOP:cGFuZWVy',
      valence: 'refuses',
      enforcement: 'just_for_context',
      scope: 'child',
    };

    expect(SignalPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('rejects a leftover_log payload — the kind is enum-reserved with no producing shape', () => {
    expect(() => SignalPayloadSchema.parse({ kind: 'leftover_log' })).toThrow();
  });

  it('rejects a payload whose fields belong to a different kind', () => {
    expect(() =>
      SignalPayloadSchema.parse({ kind: 'lunch_rating', text: 'salmon please' }),
    ).toThrow();
  });

  it('rejects unknown payload keys (strict members)', () => {
    expect(() =>
      SignalPayloadSchema.parse({
        kind: 'extra_removal',
        component_type: 'cucumber',
        smuggled: true,
      }),
    ).toThrow();
  });

  it('rejects an invalid rating value', () => {
    expect(() =>
      SignalPayloadSchema.parse({ kind: 'lunch_rating', rating: 'hated', date: '2026-08-02' }),
    ).toThrow();
  });

  it('rejects an enforcement value outside the enforcement_level enum', () => {
    // 'strict' is the classic typo for 'strong' — a loose string here would
    // append it permanently into the immutable log (15-s2 review patch).
    expect(() =>
      SignalPayloadSchema.parse({
        kind: 'preference_edit',
        item: 'NOOP:cGFuZWVy',
        valence: 'refuses',
        enforcement: 'strict',
        scope: 'child',
      }),
    ).toThrow();
  });
});

describe('SignalKindSchema / SignalSourceSchema', () => {
  it('accepts all five kinds including the reserved leftover_log', () => {
    for (const kind of ['lunch_rating', 'lunch_request', 'leftover_log', 'extra_removal', 'preference_edit']) {
      expect(SignalKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('rejects unknown kind and source values', () => {
    expect(() => SignalKindSchema.parse('vibe_check')).toThrow();
    expect(() => SignalSourceSchema.parse('carrier_pigeon')).toThrow();
  });
});

describe('RecordSignalInputSchema', () => {
  it('accepts a child-scoped input', () => {
    const parsed = RecordSignalInputSchema.parse(
      input({ kind: 'lunch_rating', rating: 'ok', date: '2026-08-02' }),
    );

    expect(parsed.child_id).toBe(CHILD_ID);
    expect(parsed.source).toBe('app');
  });

  it('accepts a household-level input (child_id null)', () => {
    const parsed = RecordSignalInputSchema.parse(
      input(
        {
          kind: 'preference_edit',
          item: 'NOOP:bWlsaw==',
          valence: 'dislikes',
          enforcement: 'strong',
          scope: 'household',
        },
        { child_id: null },
      ),
    );

    expect(parsed.child_id).toBeNull();
  });

  it('carries a typed subject_ref through', () => {
    const parsed = RecordSignalInputSchema.parse(
      input(
        { kind: 'lunch_request', text: 'NOOP:cGl6emE=' },
        { subject_ref: { request_id: REQUEST_ID, session_id: SESSION_ID }, source: 'lunch_link' },
      ),
    );

    expect(parsed.subject_ref).toEqual({ request_id: REQUEST_ID, session_id: SESSION_ID });
  });

  it('rejects a non-datetime occurred_at', () => {
    expect(() =>
      RecordSignalInputSchema.parse(
        input({ kind: 'extra_removal', component_type: 'cucumber' }, { occurred_at: '2026-08-02' }),
      ),
    ).toThrow();
  });
});

describe('LunchRatingSubjectRefSchema', () => {
  it('round-trips a lunch_rating subject_ref', () => {
    const ref = { recipe_id: RECIPE_ID, slot_kind: 'snack' };

    expect(LunchRatingSubjectRefSchema.parse(ref)).toEqual(ref);
  });

  it('accepts all three slot kinds', () => {
    for (const slot_kind of ['main', 'snack', 'extra']) {
      expect(LunchRatingSubjectRefSchema.parse({ recipe_id: RECIPE_ID, slot_kind }).slot_kind).toBe(
        slot_kind,
      );
    }
  });

  it('rejects an unknown key (strict) — the projection must not read smuggled fields', () => {
    expect(() =>
      LunchRatingSubjectRefSchema.parse({
        recipe_id: RECIPE_ID,
        slot_kind: 'main',
        signal_date: '2026-08-02',
      }),
    ).toThrow();
  });

  it('rejects a slot_kind outside the child_preferences CHECK', () => {
    expect(() =>
      LunchRatingSubjectRefSchema.parse({ recipe_id: RECIPE_ID, slot_kind: 'dessert' }),
    ).toThrow();
  });

  it('rejects a non-uuid recipe_id', () => {
    expect(() =>
      LunchRatingSubjectRefSchema.parse({ recipe_id: 'not-a-uuid', slot_kind: 'main' }),
    ).toThrow();
  });
});

describe('SignalRowSchema', () => {
  it('round-trips a stored row', () => {
    const row = {
      id: '66666666-6666-4666-8666-666666666666',
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      kind: 'lunch_rating',
      subject_ref: { recipe_id: RECIPE_ID, slot_kind: 'main' },
      payload: { kind: 'lunch_rating', rating: 'loved', date: '2026-08-02' },
      occurred_at: OCCURRED_AT,
      source: 'lunch_link',
      created_at: OCCURRED_AT,
    };

    expect(SignalRowSchema.parse(row)).toEqual(row);
  });
});
