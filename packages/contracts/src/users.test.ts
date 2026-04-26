import { describe, it, expect } from 'vitest';
import {
  UserProfileSchema,
  UpdateProfileRequestSchema,
  PasswordResetRequestSchema,
} from './users.js';

describe('UserProfileSchema', () => {
  const validProfile = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'parent@example.com',
    display_name: 'Sample Parent',
    preferred_language: 'en',
    role: 'primary_parent' as const,
    auth_providers: ['email'],
  };

  it('accepts a valid profile with email provider', () => {
    expect(UserProfileSchema.safeParse(validProfile).success).toBe(true);
  });

  it('accepts null display_name and an empty providers array', () => {
    expect(
      UserProfileSchema.safeParse({ ...validProfile, display_name: null, auth_providers: [] }).success,
    ).toBe(true);
  });

  it('rejects an invalid role', () => {
    expect(UserProfileSchema.safeParse({ ...validProfile, role: 'admin' }).success).toBe(false);
  });

  it('rejects auth_providers when it is not an array', () => {
    expect(
      UserProfileSchema.safeParse({ ...validProfile, auth_providers: 'email' as unknown as string[] })
        .success,
    ).toBe(false);
  });
});

describe('UpdateProfileRequestSchema', () => {
  it('accepts an empty object (service-level validation rejects later)', () => {
    expect(UpdateProfileRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a single field', () => {
    expect(UpdateProfileRequestSchema.safeParse({ display_name: 'Alice' }).success).toBe(true);
  });

  it('accepts all three fields together', () => {
    expect(
      UpdateProfileRequestSchema.safeParse({
        display_name: 'Alice',
        email: 'alice@example.com',
        preferred_language: 'es',
      }).success,
    ).toBe(true);
  });

  it('rejects empty display_name', () => {
    expect(UpdateProfileRequestSchema.safeParse({ display_name: '' }).success).toBe(false);
  });

  it('rejects display_name exceeding 100 chars', () => {
    expect(
      UpdateProfileRequestSchema.safeParse({ display_name: 'a'.repeat(101) }).success,
    ).toBe(false);
  });

  it('rejects malformed email', () => {
    expect(UpdateProfileRequestSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects preferred_language shorter than 2 chars', () => {
    expect(UpdateProfileRequestSchema.safeParse({ preferred_language: 'e' }).success).toBe(false);
  });
});

describe('PasswordResetRequestSchema', () => {
  it('accepts a valid email', () => {
    expect(PasswordResetRequestSchema.safeParse({ email: 'user@example.com' }).success).toBe(true);
  });

  it('accepts email at max 254 chars', () => {
    // 245 'a's + '@test.com' (9 chars) = 254 total — exactly at the limit
    const exactMaxEmail = 'a'.repeat(245) + '@test.com';
    expect(PasswordResetRequestSchema.safeParse({ email: exactMaxEmail }).success).toBe(true);
  });

  it('rejects malformed email', () => {
    expect(PasswordResetRequestSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects email exceeding 254 chars (255 chars)', () => {
    // 246 'a's + '@test.com' (9 chars) = 255 total — one over the limit
    const tooLongEmail = 'a'.repeat(246) + '@test.com';
    expect(PasswordResetRequestSchema.safeParse({ email: tooLongEmail }).success).toBe(false);
  });
});
