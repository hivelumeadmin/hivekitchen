import { describe, it, expect } from 'vitest';
import {
  LunchLinkPauseInputSchema,
  LunchLinkPauseResponseSchema,
  LunchLinkDevParamsSchema,
  LunchLinkDevBagSchema,
  LunchLinkDevResponseSchema,
  GenerateLunchLinkBodySchema,
  LunchLinkPayloadSchema,
  LunchLinkExpiredPayloadSchema,
  RateLunchLinkBodySchema,
} from './lunch-link.js';

const CHILD_UUID_2 = '55555555-5555-4555-8555-555555555555';

describe('LunchLinkPauseInputSchema', () => {
  it('accepts a valid suppress:true body', () => {
    expect(
      LunchLinkPauseInputSchema.safeParse({ date: '2026-06-09', suppress: true }).success,
    ).toBe(true);
  });

  it('defaults suppress to false when omitted', () => {
    const result = LunchLinkPauseInputSchema.safeParse({ date: '2026-06-09' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.suppress).toBe(false);
  });

  it('accepts suppress:false for un-suppress', () => {
    expect(
      LunchLinkPauseInputSchema.safeParse({ date: '2026-06-09', suppress: false }).success,
    ).toBe(true);
  });

  it('rejects invalid date format', () => {
    expect(
      LunchLinkPauseInputSchema.safeParse({ date: '09/06/2026', suppress: true }).success,
    ).toBe(false);
  });

  it('rejects missing date', () => {
    expect(LunchLinkPauseInputSchema.safeParse({ suppress: true }).success).toBe(false);
  });
});

describe('LunchLinkPauseResponseSchema', () => {
  it('accepts a suppressed response', () => {
    expect(
      LunchLinkPauseResponseSchema.safeParse({
        child_id: CHILD_UUID_2,
        date: '2026-06-09',
        suppressed: true,
        suppressed_at: '2026-06-09T08:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('accepts a resumed response with suppressed_at:null', () => {
    expect(
      LunchLinkPauseResponseSchema.safeParse({
        child_id: CHILD_UUID_2,
        date: '2026-06-09',
        suppressed: false,
        suppressed_at: null,
      }).success,
    ).toBe(true);
  });

  it('rejects missing child_id', () => {
    expect(
      LunchLinkPauseResponseSchema.safeParse({
        date: '2026-06-09',
        suppressed: false,
        suppressed_at: null,
      }).success,
    ).toBe(false);
  });
});

const CHILD_UUID = '11111111-1111-4111-8111-111111111111';

const validBag = {
  name: 'Sandwich, apple & water',
  sub: 'Packed for you today',
  safetyNote: 'Nut-free',
};

describe('LunchLinkDevParamsSchema', () => {
  it('accepts a uuid childId and ISO date', () => {
    expect(
      LunchLinkDevParamsSchema.safeParse({ childId: CHILD_UUID, date: '2026-05-17' }).success,
    ).toBe(true);
  });

  it('rejects non-uuid childId', () => {
    expect(
      LunchLinkDevParamsSchema.safeParse({ childId: 'not-a-uuid', date: '2026-05-17' }).success,
    ).toBe(false);
  });

  it('rejects malformed date', () => {
    expect(
      LunchLinkDevParamsSchema.safeParse({ childId: CHILD_UUID, date: 'today' }).success,
    ).toBe(false);
  });
});

describe('LunchLinkDevBagSchema', () => {
  it('accepts a complete bag', () => {
    expect(LunchLinkDevBagSchema.safeParse(validBag).success).toBe(true);
  });

  it('rejects missing name', () => {
    const { name: _unused, ...rest } = validBag;
    expect(LunchLinkDevBagSchema.safeParse(rest).success).toBe(false);
  });
});

describe('LunchLinkDevResponseSchema', () => {
  it('accepts response with heartNote: null', () => {
    expect(
      LunchLinkDevResponseSchema.safeParse({
        childName: 'Layla',
        date: '2026-05-17',
        heartNote: null,
        bag: validBag,
      }).success,
    ).toBe(true);
  });

  it('accepts response with populated heartNote', () => {
    expect(
      LunchLinkDevResponseSchema.safeParse({
        childName: 'Layla',
        date: '2026-05-17',
        heartNote: { body: 'hello', authorDisplayName: 'Parent' },
        bag: validBag,
      }).success,
    ).toBe(true);
  });

  it('rejects response missing bag', () => {
    expect(
      LunchLinkDevResponseSchema.safeParse({
        childName: 'Layla',
        date: '2026-05-17',
        heartNote: null,
      }).success,
    ).toBe(false);
  });
});

// ── Slice 4-S3: real signed token schemas ──────────────────────────────────

const VALID_UUID = '77777777-7777-4777-8777-777777777777';
const validPublicBag = { name: 'Sandwich', sub: 'Packed', safetyNote: 'Nut-free' };

describe('GenerateLunchLinkBodySchema', () => {
  it('accepts a valid body', () => {
    expect(
      GenerateLunchLinkBodySchema.safeParse({
        child_id: VALID_UUID,
        date: '2026-09-01',
      }).success,
    ).toBe(true);
  });

  it('rejects a non-UUID child_id', () => {
    expect(
      GenerateLunchLinkBodySchema.safeParse({
        child_id: 'not-a-uuid',
        date: '2026-09-01',
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid date format', () => {
    expect(
      GenerateLunchLinkBodySchema.safeParse({
        child_id: VALID_UUID,
        date: '09-01-2026',
      }).success,
    ).toBe(false);
  });
});

describe('LunchLinkPayloadSchema', () => {
  it('accepts a valid payload with a heart note', () => {
    expect(
      LunchLinkPayloadSchema.safeParse({
        childName: 'Layla',
        date: '2026-09-01',
        heartNote: { body: 'Hi!', authorDisplayName: 'Parent' },
        bag: validPublicBag,
        expired: false,
      }).success,
    ).toBe(true);
  });

  it('accepts a valid payload with null heartNote', () => {
    expect(
      LunchLinkPayloadSchema.safeParse({
        childName: 'Layla',
        date: '2026-09-01',
        heartNote: null,
        bag: validPublicBag,
        expired: false,
      }).success,
    ).toBe(true);
  });

  it('rejects expired: true on the 200 schema', () => {
    expect(
      LunchLinkPayloadSchema.safeParse({
        childName: 'Layla',
        date: '2026-09-01',
        heartNote: null,
        bag: validPublicBag,
        expired: true,
      }).success,
    ).toBe(false);
  });
});

describe('LunchLinkExpiredPayloadSchema', () => {
  it('accepts an expired payload with a rating', () => {
    expect(
      LunchLinkExpiredPayloadSchema.safeParse({
        expired: true,
        last_state_snapshot: {
          heartNote: null,
          rating: 'loved',
          bag: validPublicBag,
        },
      }).success,
    ).toBe(true);
  });

  it('accepts an expired payload with null rating', () => {
    expect(
      LunchLinkExpiredPayloadSchema.safeParse({
        expired: true,
        last_state_snapshot: {
          heartNote: null,
          rating: null,
          bag: validPublicBag,
        },
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown rating value', () => {
    expect(
      LunchLinkExpiredPayloadSchema.safeParse({
        expired: true,
        last_state_snapshot: {
          heartNote: null,
          rating: 'thumbs-up',
          bag: validPublicBag,
        },
      }).success,
    ).toBe(false);
  });
});

// ── Slice 4-S4: emoji rating ─────────────────────────────────────────────────

describe('RateLunchLinkBodySchema', () => {
  it('accepts loved', () => {
    expect(() => RateLunchLinkBodySchema.parse({ rating: 'loved' })).not.toThrow();
  });
  it('accepts ok', () => {
    expect(() => RateLunchLinkBodySchema.parse({ rating: 'ok' })).not.toThrow();
  });
  it('accepts not-really', () => {
    expect(() => RateLunchLinkBodySchema.parse({ rating: 'not-really' })).not.toThrow();
  });
  it('rejects thumbs-up (out-of-enum)', () => {
    expect(() => RateLunchLinkBodySchema.parse({ rating: 'thumbs-up' })).toThrow();
  });
  it('rejects missing rating', () => {
    expect(() => RateLunchLinkBodySchema.parse({})).toThrow();
  });
});

describe('LunchLinkPayloadSchema (S4: rating field)', () => {
  const validBase = {
    childName: 'Layla',
    date: '2026-09-01',
    heartNote: null,
    bag: { name: 'Sandwich', sub: 'Packed', safetyNote: 'Nut-free' },
    expired: false as const,
  };
  it('defaults rating to null when omitted', () => {
    const result = LunchLinkPayloadSchema.parse(validBase);
    expect(result.rating).toBeNull();
  });
  it('accepts rating: loved', () => {
    const result = LunchLinkPayloadSchema.parse({ ...validBase, rating: 'loved' });
    expect(result.rating).toBe('loved');
  });
  it('rejects invalid rating value', () => {
    expect(() => LunchLinkPayloadSchema.parse({ ...validBase, rating: 'thumbs-up' })).toThrow();
  });
});
