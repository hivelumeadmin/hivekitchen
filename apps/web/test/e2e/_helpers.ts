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
}

export function userProfile(overrides: UserProfileOverrides = {}) {
  return {
    id: SAMPLE_USER_ID,
    email: 'parent@example.com',
    display_name: 'Parent',
    preferred_language: 'en',
    role: 'primary_parent',
    auth_providers: ['email'],
    notification_prefs: { weekly_plan_ready: true, grocery_list_ready: true },
    cultural_language: 'default',
    parental_notice_acknowledged_at: '2026-04-01T10:00:00.000Z',
    parental_notice_acknowledged_version: 'v1',
    ...overrides,
  };
}

export async function mockLogin(
  page: Page,
  opts: { isFirstLogin?: boolean; user?: ReturnType<typeof authUser> } = {},
) {
  await page.route('**/v1/auth/login', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: 'jwt-test-token',
        expires_in: 900,
        user: opts.user ?? authUser(),
        is_first_login: opts.isFirstLogin ?? false,
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
  await mockLogin(page, { isFirstLogin: opts.isFirstLogin ?? false });
  await page.goto(`/auth/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel(/^email$/i).fill('parent@example.com');
  await page.getByLabel(/^password$/i).fill('verylongpassword');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  if (opts.isFirstLogin === true) {
    await page.waitForURL(/\/onboarding$/);
  } else {
    const escaped = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page.waitForURL(new RegExp(escaped + '(\\?.*)?$'));
  }
}
