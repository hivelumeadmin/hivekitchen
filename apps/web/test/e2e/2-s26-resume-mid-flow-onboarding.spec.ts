import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, mockLogin } from './_helpers.js';

const IN_PROGRESS_THREAD_ID = '11111111-1111-4111-8111-111111111111';
const PRIOR_USER_TURN_ID = '22222222-2222-4222-8222-222222222222';
const PRIOR_LUMI_TURN_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Slice 2-S26 — resume mid-flow onboarding.
 *
 * The Resume surface is driven entirely by GET /v1/onboarding/state. Tests
 * mock the state endpoint to return each of the three statuses (not_started
 * / in_progress / completed) and assert routing + transcript hydration.
 */

async function mockState(
  page: Page,
  body:
    | { status: 'not_started' }
    | { status: 'completed' }
    | {
        status: 'in_progress';
        thread_id: string;
        modality: 'text' | 'voice';
        started_at: string;
        last_activity_at: string;
        turns: Array<{ id: string; role: 'user' | 'lumi'; content: string; created_at: string }>;
      },
): Promise<void> {
  await page.route('**/v1/onboarding/state', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

test.describe('Slice 2-s26: resume mid-flow onboarding', () => {
  test('in_progress: Resume surface renders with prior transcript and Continue rehydrates', async ({
    page,
  }) => {
    await mockLogin(page, { isOnboarded: false, isOnboardingInProgress: true });
    await mockState(page, {
      status: 'in_progress',
      thread_id: IN_PROGRESS_THREAD_ID,
      modality: 'text',
      started_at: '2026-05-14T10:00:00.000Z',
      last_activity_at: '2026-05-14T10:05:00.000Z',
      turns: [
        {
          id: PRIOR_USER_TURN_ID,
          role: 'user',
          content: 'My grandmother made daal.',
          created_at: '2026-05-14T10:00:30.000Z',
        },
        {
          id: PRIOR_LUMI_TURN_ID,
          role: 'lumi',
          content: 'That sounds wonderful — tell me more.',
          created_at: '2026-05-14T10:00:45.000Z',
        },
      ],
    });

    await loginAndNavigate(page, '/onboarding');

    // Resume surface visible, mode picker hidden.
    await expect(page.getByRole('heading', { name: /You started a text interview/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Continue$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Start over/i })).toBeVisible();
    // Mode picker primary CTA is "Start with voice" — must NOT be visible.
    await expect(page.getByRole('button', { name: /Start with voice/i })).toHaveCount(0);

    // Tap Continue → text mode mounts with prior turns + the synthetic greeting.
    await page.getByRole('button', { name: /^Continue$/i }).click();
    await expect(page.getByText('My grandmother made daal.')).toBeVisible();
    await expect(page.getByText('That sounds wonderful — tell me more.')).toBeVisible();
    // Greeting still renders — it's a client-render constant.
    await expect(page.getByText(/i'm lumi.*your family/i)).toBeVisible();
  });

  test('Start over: posts reset and reveals the mode picker', async ({ page }) => {
    await mockLogin(page, { isOnboarded: false, isOnboardingInProgress: true });
    await mockState(page, {
      status: 'in_progress',
      thread_id: IN_PROGRESS_THREAD_ID,
      modality: 'text',
      started_at: '2026-05-14T10:00:00.000Z',
      last_activity_at: '2026-05-14T10:05:00.000Z',
      turns: [
        {
          id: PRIOR_USER_TURN_ID,
          role: 'user',
          content: 'prior turn',
          created_at: '2026-05-14T10:00:30.000Z',
        },
      ],
    });
    let resetCalled = false;
    await page.route('**/v1/onboarding/state/reset', (route) => {
      resetCalled = true;
      return route.fulfill({ status: 204 });
    });

    await loginAndNavigate(page, '/onboarding');
    await page.getByRole('button', { name: /Start over/i }).click();

    // Mode picker now renders (the v2.0 "I'd rather type" link is the canonical secondary).
    await expect(page.getByRole('button', { name: /i'd rather type/i })).toBeVisible();
    expect(resetCalled).toBe(true);
  });

  test('not_started: state endpoint returns not_started → mode picker renders', async ({
    page,
  }) => {
    await mockLogin(page, { isOnboarded: false });
    await mockState(page, { status: 'not_started' });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });

    // Mode picker visible, Resume surface absent.
    await expect(page.getByRole('button', { name: /i'd rather type/i })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /You started a .* interview/i }),
    ).toHaveCount(0);
  });

  test('completed: state endpoint says completed → bounces to /app', async ({ page }) => {
    await mockLogin(page, { isOnboarded: true });
    await mockState(page, { status: 'completed' });

    await loginAndNavigate(page, '/app');
    // Already on /app from login — onboarding-side defensive redirect would
    // additionally kick if the user visits /onboarding manually. Verify by
    // navigating there with the completed-state response.
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/app$/);
  });

  test('voice-modality variant labels the primary CTA "Switch to text"', async ({ page }) => {
    await mockLogin(page, { isOnboarded: false, isOnboardingInProgress: true });
    await mockState(page, {
      status: 'in_progress',
      thread_id: IN_PROGRESS_THREAD_ID,
      modality: 'voice',
      started_at: '2026-05-14T10:00:00.000Z',
      last_activity_at: '2026-05-14T10:05:00.000Z',
      turns: [
        {
          id: PRIOR_USER_TURN_ID,
          role: 'user',
          content: 'transcribed voice turn',
          created_at: '2026-05-14T10:00:30.000Z',
        },
      ],
    });

    await loginAndNavigate(page, '/onboarding');
    await expect(page.getByRole('button', { name: /Switch to text/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Continue$/i })).toHaveCount(0);
  });
});
