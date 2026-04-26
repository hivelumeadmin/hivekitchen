import { describe, it, expect } from 'vitest';
import {
  LoginRequestSchema,
  OAuthCallbackRequestSchema,
  AuthUserSchema,
  LoginResponseSchema,
  RefreshResponseSchema,
  CreateInviteRequestSchema,
  CreateInviteResponseSchema,
  RedeemInviteRequestSchema,
  RedeemInviteResponseSchema,
} from './auth.js';

describe('LoginRequestSchema', () => {
  it('accepts a valid email/password', () => {
    expect(
      LoginRequestSchema.safeParse({ email: 'user@example.com', password: 'securepass123' }).success,
    ).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(
      LoginRequestSchema.safeParse({ email: 'not-an-email', password: 'securepass123' }).success,
    ).toBe(false);
  });

  it('rejects a password shorter than 12 chars', () => {
    expect(
      LoginRequestSchema.safeParse({ email: 'user@example.com', password: 'short' }).success,
    ).toBe(false);
  });

  it('rejects an email exceeding 254 chars', () => {
    const longEmail = 'a'.repeat(246) + '@test.com';
    expect(LoginRequestSchema.safeParse({ email: longEmail, password: 'securepass123' }).success).toBe(
      false,
    );
  });
});

describe('OAuthCallbackRequestSchema', () => {
  it('accepts google provider with a code', () => {
    expect(
      OAuthCallbackRequestSchema.safeParse({ provider: 'google', code: 'oauth-code-xyz' }).success,
    ).toBe(true);
  });

  it('accepts apple provider', () => {
    expect(
      OAuthCallbackRequestSchema.safeParse({ provider: 'apple', code: 'oauth-code-abc' }).success,
    ).toBe(true);
  });

  it('rejects an unknown provider', () => {
    expect(
      OAuthCallbackRequestSchema.safeParse({ provider: 'facebook', code: 'oauth-code' }).success,
    ).toBe(false);
  });

  it('rejects an empty code', () => {
    expect(
      OAuthCallbackRequestSchema.safeParse({ provider: 'google', code: '' }).success,
    ).toBe(false);
  });
});

describe('AuthUserSchema', () => {
  const validUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    display_name: 'Alice',
    current_household_id: '22222222-2222-4222-8222-222222222222',
    role: 'primary_parent',
  };

  it('accepts a valid user', () => {
    expect(AuthUserSchema.safeParse(validUser).success).toBe(true);
  });

  it('accepts null display_name and current_household_id', () => {
    expect(
      AuthUserSchema.safeParse({ ...validUser, display_name: null, current_household_id: null }).success,
    ).toBe(true);
  });

  it('rejects an invalid role', () => {
    expect(AuthUserSchema.safeParse({ ...validUser, role: 'admin' }).success).toBe(false);
  });

  it('rejects a non-UUID id', () => {
    expect(AuthUserSchema.safeParse({ ...validUser, id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(AuthUserSchema.safeParse({ ...validUser, email: 'not-an-email' }).success).toBe(false);
  });
});

describe('LoginResponseSchema', () => {
  const validUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    display_name: null,
    current_household_id: null,
    role: 'primary_parent' as const,
  };

  it('accepts a valid login response', () => {
    expect(
      LoginResponseSchema.safeParse({
        access_token: 'header.payload.signature',
        expires_in: 900,
        user: validUser,
        is_first_login: false,
      }).success,
    ).toBe(true);
  });

  it('rejects empty access_token', () => {
    expect(
      LoginResponseSchema.safeParse({
        access_token: '',
        expires_in: 900,
        user: validUser,
        is_first_login: false,
      }).success,
    ).toBe(false);
  });

  it('rejects non-boolean is_first_login', () => {
    expect(
      LoginResponseSchema.safeParse({
        access_token: 'tok',
        expires_in: 900,
        user: validUser,
        is_first_login: 'yes',
      }).success,
    ).toBe(false);
  });
});

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

describe('CreateInviteRequestSchema', () => {
  it('accepts secondary_caregiver role with optional email', () => {
    expect(
      CreateInviteRequestSchema.safeParse({ role: 'secondary_caregiver', email: 'partner@example.com' })
        .success,
    ).toBe(true);
    expect(CreateInviteRequestSchema.safeParse({ role: 'secondary_caregiver' }).success).toBe(true);
  });

  it('rejects guest_author role (Story 8.7 scope)', () => {
    expect(CreateInviteRequestSchema.safeParse({ role: 'guest_author' }).success).toBe(false);
  });
});

describe('CreateInviteResponseSchema', () => {
  it('accepts an invite_url path', () => {
    expect(CreateInviteResponseSchema.safeParse({ invite_url: '/invite/abc123' }).success).toBe(true);
  });

  it('rejects empty invite_url', () => {
    expect(CreateInviteResponseSchema.safeParse({ invite_url: '' }).success).toBe(false);
  });
});

describe('RedeemInviteRequestSchema', () => {
  it('accepts a non-empty token string', () => {
    expect(RedeemInviteRequestSchema.safeParse({ token: 'eyJabc' }).success).toBe(true);
  });

  it('rejects an empty token', () => {
    expect(RedeemInviteRequestSchema.safeParse({ token: '' }).success).toBe(false);
  });
});

describe('RedeemInviteResponseSchema', () => {
  const validHouseholdId = '22222222-2222-4222-8222-222222222222';

  it('accepts a valid response', () => {
    expect(
      RedeemInviteResponseSchema.safeParse({
        role: 'secondary_caregiver',
        scope_target: '/app/household/settings',
        household_id: validHouseholdId,
      }).success,
    ).toBe(true);
  });

  it('accepts guest_author role', () => {
    expect(
      RedeemInviteResponseSchema.safeParse({
        role: 'guest_author',
        scope_target: '/app/household/settings',
        household_id: validHouseholdId,
      }).success,
    ).toBe(true);
  });

  it('rejects an invalid role', () => {
    expect(
      RedeemInviteResponseSchema.safeParse({
        role: 'admin',
        scope_target: '/app/household/settings',
        household_id: validHouseholdId,
      }).success,
    ).toBe(false);
  });
});
