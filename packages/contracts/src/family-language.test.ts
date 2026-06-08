import { describe, it, expect } from 'vitest';
import {
  FamilyLanguageTermSchema,
  FamilyLanguageRatifyBodySchema,
  FamilyLanguageRatifyResponseSchema,
} from './family-language.js';

const validTerm = {
  term: 'Nani',
  maps_to: 'grandmother',
  usage_count: 2,
  state: 'active' as const,
  first_seen_at: '2026-06-08T10:00:00.000Z',
  ratified_at: '2026-06-08T10:05:00.000Z',
};

describe('FamilyLanguageTermSchema', () => {
  it('accepts a valid term', () => {
    expect(FamilyLanguageTermSchema.safeParse(validTerm).success).toBe(true);
  });

  it('accepts a candidate term with ratified_at null', () => {
    expect(
      FamilyLanguageTermSchema.safeParse({
        ...validTerm,
        state: 'candidate',
        ratified_at: null,
      }).success,
    ).toBe(true);
  });

  it('rejects an empty term', () => {
    expect(FamilyLanguageTermSchema.safeParse({ ...validTerm, term: '' }).success).toBe(false);
  });

  it('rejects an unknown state', () => {
    expect(
      FamilyLanguageTermSchema.safeParse({ ...validTerm, state: 'dormant' }).success,
    ).toBe(false);
  });
});

describe('FamilyLanguageRatifyBodySchema', () => {
  it('accepts each valid action', () => {
    for (const action of ['opt_in', 'forget', 'tell_lumi_more'] as const) {
      expect(FamilyLanguageRatifyBodySchema.safeParse({ term: 'Nani', action }).success).toBe(true);
    }
  });

  it('rejects an unknown action', () => {
    expect(
      FamilyLanguageRatifyBodySchema.safeParse({ term: 'Nani', action: 'opt_out' }).success,
    ).toBe(false);
  });

  it('rejects a missing term', () => {
    expect(FamilyLanguageRatifyBodySchema.safeParse({ action: 'opt_in' }).success).toBe(false);
  });
});

describe('FamilyLanguageRatifyResponseSchema', () => {
  it('round-trips without lumi_response', () => {
    expect(FamilyLanguageRatifyResponseSchema.safeParse({ term: validTerm }).success).toBe(true);
  });

  it('round-trips with lumi_response', () => {
    expect(
      FamilyLanguageRatifyResponseSchema.safeParse({
        term: validTerm,
        lumi_response: 'Tell me — what should I call them?',
      }).success,
    ).toBe(true);
  });
});
