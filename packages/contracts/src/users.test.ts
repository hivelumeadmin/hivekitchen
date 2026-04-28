import { describe, it, expect } from 'vitest';
import {
  UserProfileSchema,
  UpdateProfileRequestSchema,
  PasswordResetRequestSchema,
  PasswordResetCompleteRequestSchema,
  NotificationPrefsSchema,
  UpdateNotificationPrefsRequestSchema,
  CulturalLanguageSchema,
  UpdateCulturalPreferenceRequestSchema,
  CULTURAL_LANGUAGE_VALUES,
} from './users.js';

describe('UserProfileSchema', () => {
  const validProfile = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'parent@example.com',
    display_name: 'Sample Parent',
    preferred_language: 'en',
    role: 'primary_parent' as const,
    auth_providers: ['email'],
    notification_prefs: { weekly_plan_ready: true, grocery_list_ready: true },
    cultural_language: 'default' as const,
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

  it('rejects a profile missing notification_prefs', () => {
    const { notification_prefs: _omit, ...withoutPrefs } = validProfile;
    expect(UserProfileSchema.safeParse(withoutPrefs).success).toBe(false);
  });

  it('rejects a profile with an unknown cultural_language', () => {
    expect(
      UserProfileSchema.safeParse({ ...validProfile, cultural_language: 'klingon' }).success,
    ).toBe(false);
  });

  it('rejects a profile missing cultural_language', () => {
    const { cultural_language: _omit, ...withoutLang } = validProfile;
    expect(UserProfileSchema.safeParse(withoutLang).success).toBe(false);
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

describe('PasswordResetCompleteRequestSchema', () => {
  const validBody = {
    token: 'recovery-token-hash',
    password: 'a-strong-password-12',
  };

  it('accepts a valid token + password', () => {
    expect(PasswordResetCompleteRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it('accepts password at min 12 chars', () => {
    expect(
      PasswordResetCompleteRequestSchema.safeParse({ ...validBody, password: 'a'.repeat(12) }).success,
    ).toBe(true);
  });

  it('accepts password at max 128 chars', () => {
    expect(
      PasswordResetCompleteRequestSchema.safeParse({ ...validBody, password: 'a'.repeat(128) }).success,
    ).toBe(true);
  });

  it('rejects empty token', () => {
    expect(PasswordResetCompleteRequestSchema.safeParse({ ...validBody, token: '' }).success).toBe(false);
  });

  it('rejects password shorter than 12 chars', () => {
    expect(
      PasswordResetCompleteRequestSchema.safeParse({ ...validBody, password: 'short' }).success,
    ).toBe(false);
  });

  it('rejects password longer than 128 chars', () => {
    expect(
      PasswordResetCompleteRequestSchema.safeParse({ ...validBody, password: 'a'.repeat(129) }).success,
    ).toBe(false);
  });

  it('rejects when token is missing', () => {
    expect(PasswordResetCompleteRequestSchema.safeParse({ password: 'a-strong-password-12' }).success).toBe(false);
  });

  it('rejects when password is missing', () => {
    expect(PasswordResetCompleteRequestSchema.safeParse({ token: 'tok' }).success).toBe(false);
  });
});

describe('NotificationPrefsSchema', () => {
  it('accepts { weekly_plan_ready: true, grocery_list_ready: false }', () => {
    expect(
      NotificationPrefsSchema.safeParse({ weekly_plan_ready: true, grocery_list_ready: false }).success,
    ).toBe(true);
  });

  it('rejects when either field is missing', () => {
    expect(NotificationPrefsSchema.safeParse({ weekly_plan_ready: true }).success).toBe(false);
    expect(NotificationPrefsSchema.safeParse({ grocery_list_ready: true }).success).toBe(false);
  });

  it('rejects when a field is not boolean', () => {
    expect(
      NotificationPrefsSchema.safeParse({ weekly_plan_ready: 'yes', grocery_list_ready: false }).success,
    ).toBe(false);
  });
});

describe('UpdateNotificationPrefsRequestSchema', () => {
  it('rejects an empty object', () => {
    expect(UpdateNotificationPrefsRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a single field', () => {
    expect(
      UpdateNotificationPrefsRequestSchema.safeParse({ weekly_plan_ready: false }).success,
    ).toBe(true);
    expect(
      UpdateNotificationPrefsRequestSchema.safeParse({ grocery_list_ready: true }).success,
    ).toBe(true);
  });

  it('accepts both fields together', () => {
    expect(
      UpdateNotificationPrefsRequestSchema.safeParse({
        weekly_plan_ready: true,
        grocery_list_ready: false,
      }).success,
    ).toBe(true);
  });

  it('rejects non-boolean values', () => {
    expect(
      UpdateNotificationPrefsRequestSchema.safeParse({ weekly_plan_ready: 1 }).success,
    ).toBe(false);
  });
});

describe('CulturalLanguageSchema', () => {
  it('accepts every value in CULTURAL_LANGUAGE_VALUES', () => {
    for (const value of CULTURAL_LANGUAGE_VALUES) {
      expect(CulturalLanguageSchema.safeParse(value).success).toBe(true);
    }
  });

  it('rejects an unknown value', () => {
    expect(CulturalLanguageSchema.safeParse('klingon').success).toBe(false);
  });
});

describe('UpdateCulturalPreferenceRequestSchema', () => {
  it('accepts a valid enum value', () => {
    expect(
      UpdateCulturalPreferenceRequestSchema.safeParse({ cultural_language: 'south_asian' }).success,
    ).toBe(true);
  });

  it('rejects an unknown enum value', () => {
    expect(
      UpdateCulturalPreferenceRequestSchema.safeParse({ cultural_language: 'klingon' }).success,
    ).toBe(false);
  });

  it('rejects when cultural_language is missing', () => {
    expect(UpdateCulturalPreferenceRequestSchema.safeParse({}).success).toBe(false);
  });
});
