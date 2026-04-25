import { describe, it, expect } from 'vitest';
import { RefreshResponseSchema } from './auth.js';

describe('RefreshResponseSchema', () => {
  it('accepts a valid refresh response', () => {
    const result = RefreshResponseSchema.safeParse({
      access_token: 'header.payload.signature',
      expires_in: 900,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty access_token', () => {
    expect(
      RefreshResponseSchema.safeParse({ access_token: '', expires_in: 900 }).success,
    ).toBe(false);
  });

  it('rejects non-positive expires_in', () => {
    expect(
      RefreshResponseSchema.safeParse({ access_token: 'tok', expires_in: 0 }).success,
    ).toBe(false);
    expect(
      RefreshResponseSchema.safeParse({ access_token: 'tok', expires_in: -1 }).success,
    ).toBe(false);
  });

  it('rejects non-integer expires_in', () => {
    expect(
      RefreshResponseSchema.safeParse({ access_token: 'tok', expires_in: 1.5 }).success,
    ).toBe(false);
  });
});
