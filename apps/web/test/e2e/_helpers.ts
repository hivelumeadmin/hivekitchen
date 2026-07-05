import { type Page } from '@playwright/test';

// Stable UUIDs used across all e2e specs so seeded state is deterministic.
export const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
export const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

export interface AuthUserOverrides {
  id?: string;
  email?: string;
  display_name?: string | null;
  current_household_id?: string | null;
  role?: string;
}

export function authUser(overrides: AuthUserOverrides = {}) {
  return {
    id: SAMPLE_USER_ID,
    email: 'parent@example.com',
    display_name: 'Parent',
    current_household_id: SAMPLE_HOUSEHOLD_ID,
    role: 'primary_parent',
    ...overrides,
  };
}

export interface UserProfileOverrides {
  email?: string;
  display_name?: string | null;
  preferred_language?: string;
  role?: string;
  auth_providers?: string[];
  notification_prefs?: { weekly_plan_ready: boolean; grocery_list_ready: boolean };
  cultural_language?: string;
  parental_notice_acknowledged_at?: string | null;
  parental_notice_acknowledged_version?: string | null;
  is_onboarded?: boolean;
  // 2-S26: mirrors LoginResponse — mutually exclusive with is_onboarded.
  is_onboarding_in_progress?: boolean;
  // 5-S13: caption-only accessibility preference.
  caption_only_mode?: boolean;
  // 5-S15: voice transcript retention mode.
  voice_retention_mode?: 'standard' | 'immediate_delete';
}

export function userProfile(overrides: UserProfileOverrides = {}) {
  // 2-S19: UserProfileSchema requires `is_onboarded`. Derive a sensible
  // default from `parental_notice_acknowledged_at` (matches the server-side
  // derivation), but let callers override explicitly.
  const ackAt =
    overrides.parental_notice_acknowledged_at === undefined
      ? '2026-04-01T10:00:00.000Z'
      : overrides.parental_notice_acknowledged_at;
  const isOnboarded = overrides.is_onboarded ?? ackAt !== null;
  return {
    id: SAMPLE_USER_ID,
    email: 'parent@example.com',
    display_name: 'Parent',
    preferred_language: 'en',
    role: 'primary_parent',
    auth_providers: ['email'],
    notification_prefs: {
      weekly_plan_ready: true,
      grocery_list_ready: true,
      proactive_lumi_nudges: true,
    },
    cultural_language: 'default',
    parental_notice_acknowledged_at: ackAt,
    parental_notice_acknowledged_version: 'v1',
    is_onboarded: isOnboarded,
    // 2-S26: default false. Tests that exercise the resume surface override.
    is_onboarding_in_progress: overrides.is_onboarding_in_progress ?? false,
    // 5-S13: default false (matches DB DEFAULT false).
    caption_only_mode: overrides.caption_only_mode ?? false,
    // 5-S15: default 'standard' (matches DB DEFAULT 'standard').
    voice_retention_mode: overrides.voice_retention_mode ?? 'standard',
    ...overrides,
  };
}

export async function mockLogin(
  page: Page,
  opts: {
    isFirstLogin?: boolean;
    isOnboarded?: boolean;
    // 2-S26: when true, the login response includes `is_onboarding_in_progress: true`.
    // Drives the /onboarding page to render the Resume surface on mount.
    isOnboardingInProgress?: boolean;
    user?: ReturnType<typeof authUser>;
  } = {},
) {
  // 2-S19: is_onboarded must be present in the response or login.tsx routes
  // every test to /onboarding (the field reads as `undefined → falsy`).
  // Default behavior: returning users (isFirstLogin=false) are onboarded;
  // first-login users (isFirstLogin=true) are not — they shouldn't be able
  // to land on /app yet.
  const isFirstLogin = opts.isFirstLogin ?? false;
  const isOnboarded = opts.isOnboarded ?? !isFirstLogin;
  const isOnboardingInProgress = opts.isOnboardingInProgress ?? false;
  await page.route('**/v1/auth/login', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: 'jwt-test-token',
        expires_in: 900,
        user: opts.user ?? authUser(),
        is_first_login: isFirstLogin,
        is_onboarded: isOnboarded,
        is_onboarding_in_progress: isOnboardingInProgress,
      }),
    }),
  );
}

/**
 * Drive the SPA login flow to seed an authenticated session and land on a
 * protected route. The Zustand auth store is in-memory only — `page.goto()`
 * would wipe it — so we always reach the destination by navigating *through*
 * login.
 *
 * We go directly to `/auth/login?next=<dest>` rather than to `<dest>` first,
 * because not every route redirects unauthenticated visitors to login (e.g.
 * `/app` and `/onboarding` render statically when accessTokenis null). This
 * relies on login.tsx honoring the `next` param when `is_first_login` is
 * false; for first-login users the SPA forces /onboarding regardless.
 */
export async function loginAndNavigate(
  page: Page,
  destination: string,
  opts: { isFirstLogin?: boolean } = {},
) {
  // The SSE bridge (13-s2.5) opens GET /v1/events on every authenticated app
  // mount. Without a mock it hits the preview server (connection refused) and
  // the bridge retries in a loop for the life of the test. Registered FIRST so
  // any spec's own **/v1/events** route (registered later) takes precedence.
  await page.route('**/v1/events**', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: ':ok\n\n',
    }),
  );
  await mockLogin(page, { isFirstLogin: opts.isFirstLogin ?? false });
  await page.goto(`/auth/login?next=${encodeURIComponent(destination)}`);
  // v2.0 labels — see login.tsx loginCopyMock. Exact-match the email and
  // password labels because the password field's eye-toggle has aria-label
  // "Show password" / "Hide password" which would also match /password/i.
  // CTA was renamed from "Sign in" to "Enter Kitchen" in γ Phase 1.
  await page.getByLabel('Email Address', { exact: true }).fill('parent@example.com');
  await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
  await page.getByRole('button', { name: /enter kitchen/i }).click();
  if (opts.isFirstLogin === true) {
    await page.waitForURL(/\/onboarding$/);
  } else {
    const escaped = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page.waitForURL(new RegExp(escaped + '(\\?.*)?$'));
  }
}
