import { describe, it, expect } from 'vitest';
import {
  LunchLinkPauseInputSchema,
  LunchLinkPauseResponseSchema,
  LunchLinkDevParamsSchema,
  LunchLinkDevBagSchema,
  LunchLinkDevResponseSchema,
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
