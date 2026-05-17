import { describe, it, expect } from 'vitest';
import {
  LunchLinkDevParamsSchema,
  LunchLinkDevBagSchema,
  LunchLinkDevResponseSchema,
} from './lunch-link.js';

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
