import { describe, it, expect } from 'vitest';
import {
  ExtraRulesSchema,
  UpdateExtraRulesInputSchema,
  UpdateExtraRulesResponseSchema,
  CreateExtraLibraryItemInputSchema,
  ExtraLibraryItemSchema,
  ListExtraLibraryResponseSchema,
} from './extra-rules.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('ExtraRulesSchema', () => {
  it('accepts empty pin/ban arrays', () => {
    expect(ExtraRulesSchema.safeParse({ pins: [], bans: [] }).success).toBe(true);
  });

  it('accepts populated arrays within caps', () => {
    expect(
      ExtraRulesSchema.safeParse({ pins: ['fruit', 'veggie'], bans: ['sweet treat'] }).success,
    ).toBe(true);
  });

  it('rejects pins arrays longer than 10 entries', () => {
    const tooManyPins = Array.from({ length: 11 }, (_, i) => `pin${i}`);
    expect(ExtraRulesSchema.safeParse({ pins: tooManyPins, bans: [] }).success).toBe(false);
  });

  it('rejects bans arrays longer than 20 entries', () => {
    const tooManyBans = Array.from({ length: 21 }, (_, i) => `ban${i}`);
    expect(ExtraRulesSchema.safeParse({ pins: [], bans: tooManyBans }).success).toBe(false);
  });

  it('rejects empty-string entries', () => {
    expect(ExtraRulesSchema.safeParse({ pins: [''], bans: [] }).success).toBe(false);
    expect(ExtraRulesSchema.safeParse({ pins: [], bans: [''] }).success).toBe(false);
  });

  it('rejects entries longer than 50 characters', () => {
    const tooLong = 'a'.repeat(51);
    expect(ExtraRulesSchema.safeParse({ pins: [tooLong], bans: [] }).success).toBe(false);
  });
});

describe('UpdateExtraRulesInputSchema (== ExtraRulesSchema)', () => {
  it('matches the rules schema for full replacement semantics', () => {
    expect(UpdateExtraRulesInputSchema.safeParse({ pins: ['fruit'], bans: [] }).success).toBe(true);
  });
});

describe('UpdateExtraRulesResponseSchema', () => {
  it('accepts the persisted shape', () => {
    expect(
      UpdateExtraRulesResponseSchema.safeParse({
        child_id: VALID_UUID,
        extra_rules: { pins: ['fruit'], bans: [] },
        updated_at: '2026-05-07T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects a non-uuid child_id', () => {
    expect(
      UpdateExtraRulesResponseSchema.safeParse({
        child_id: 'not-a-uuid',
        extra_rules: { pins: [], bans: [] },
        updated_at: '2026-05-07T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('CreateExtraLibraryItemInputSchema', () => {
  it('accepts a minimal create body and applies the boolean default', () => {
    const parsed = CreateExtraLibraryItemInputSchema.parse({
      name: 'Homemade oat bar',
      component_type: 'grain',
    });
    expect(parsed.is_allergen_free).toBe(false);
    expect(parsed.description).toBeUndefined();
  });

  it('rejects a name longer than 100 characters', () => {
    expect(
      CreateExtraLibraryItemInputSchema.safeParse({
        name: 'a'.repeat(101),
        component_type: 'fruit',
      }).success,
    ).toBe(false);
  });
});

describe('ExtraLibraryItemSchema / ListExtraLibraryResponseSchema', () => {
  const sample = {
    id: VALID_UUID,
    household_id: VALID_UUID,
    name: 'Homemade oat bar',
    description: null,
    component_type: 'grain',
    is_allergen_free: false,
    archived_at: null,
    created_by: VALID_UUID,
    created_at: '2026-05-07T12:00:00.000Z',
    updated_at: '2026-05-07T12:00:00.000Z',
  };

  it('accepts a fully populated item', () => {
    expect(ExtraLibraryItemSchema.safeParse(sample).success).toBe(true);
  });

  it('accepts an archived item with archived_at as a datetime', () => {
    expect(
      ExtraLibraryItemSchema.safeParse({
        ...sample,
        archived_at: '2026-05-08T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('wraps items in a list response', () => {
    expect(
      ListExtraLibraryResponseSchema.safeParse({ items: [sample] }).success,
    ).toBe(true);
    expect(ListExtraLibraryResponseSchema.safeParse({ items: [] }).success).toBe(true);
  });
});
