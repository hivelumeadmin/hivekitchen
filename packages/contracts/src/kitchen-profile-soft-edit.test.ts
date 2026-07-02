import { describe, it, expect } from 'vitest';
import {
  LumiSurfaceSchema,
  SetCulturalStateRequestSchema,
  SetFavoriteLunchesRequestSchema,
} from './index.js';

describe('SetCulturalStateRequestSchema', () => {
  it('accepts a valid opt_in payload', () => {
    const parsed = SetCulturalStateRequestSchema.parse({ key: 'halal', action: 'opt_in' });
    expect(parsed).toEqual({ key: 'halal', action: 'opt_in' });
  });

  it('accepts forget', () => {
    expect(SetCulturalStateRequestSchema.parse({ key: 'kosher', action: 'forget' }).action).toBe(
      'forget',
    );
  });

  it('rejects an unknown action', () => {
    expect(
      SetCulturalStateRequestSchema.safeParse({ key: 'halal', action: 'tell_lumi_more' }).success,
    ).toBe(false);
  });

  it('rejects an empty key', () => {
    expect(SetCulturalStateRequestSchema.safeParse({ key: '', action: 'opt_in' }).success).toBe(
      false,
    );
  });
});

describe('SetFavoriteLunchesRequestSchema', () => {
  it('accepts up to 10 items', () => {
    const items = Array.from({ length: 10 }, (_, i) => `Lunch ${i}`);
    expect(SetFavoriteLunchesRequestSchema.parse({ items }).items).toHaveLength(10);
  });

  it('accepts an empty list (clears all favorites)', () => {
    expect(SetFavoriteLunchesRequestSchema.parse({ items: [] }).items).toEqual([]);
  });

  it('rejects 11 items', () => {
    const items = Array.from({ length: 11 }, (_, i) => `Lunch ${i}`);
    expect(SetFavoriteLunchesRequestSchema.safeParse({ items }).success).toBe(false);
  });

  it('rejects an empty-string item', () => {
    expect(SetFavoriteLunchesRequestSchema.safeParse({ items: [''] }).success).toBe(false);
  });
});

describe('LumiSurfaceSchema', () => {
  it("accepts 'kitchen-profile'", () => {
    expect(LumiSurfaceSchema.parse('kitchen-profile')).toBe('kitchen-profile');
  });
});
