import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile } from './_helpers.js';

// A syntactically valid HMAC token: {base64url}.{64 hex chars}.
// Server-side HMAC verification is bypassed by the route mock.
const HMAC_TOKEN =
  'dGVzdA.0000000000000000000000000000000000000000000000000000000000000000';
const HMAC_LINK_URL = `/lunch/${HMAC_TOKEN}`;
const HMAC_API_PATTERN = `**/v1/lunch-link/${HMAC_TOKEN}`;
const RATE_PATTERN = `**/v1/lunch-link/${HMAC_TOKEN}/rate`;
const CACHE_KEY = `lunch-link-cache.${HMAC_TOKEN}`;
const PENDING_RATING_KEY = `lunch-link-pending-rating.${HMAC_TOKEN}`;
// Fixed ISO timestamp used when seeding the cache so badge time is predictable.
const CACHE_AT = '2026-06-02T10:30:00.000Z';

function fullPayload() {
  return {
    childName: 'Layla',
    date: '2026-06-02',
    heartNote: {
      body: 'Have a wonderful day, my love.',
      authorDisplayName: 'Parent',
    },
    bag: {
      name: 'Sandwich, apple & water',
      sub: 'Packed for you today',
      safetyNote: 'Nut-free',
    },
    rating: null,
  };
}

function expiredPayload() {
  return {
    last_state_snapshot: {
      childName: 'Layla',
      date: '2026-06-01',
      heartNote: {
        body: 'Hope you had a great lunch!',
        authorDisplayName: 'Parent',
      },
      bag: {
        name: 'Pasta salad',
        sub: 'From last night',
        safetyNote: 'Gluten-free',
      },
      rating: 'loved',
    },
  };
}

async function mockHmacApi(
  page: Page,
  response: { status: number; body: unknown },
) {
  await page.route(HMAC_API_PATTERN, (route) =>
    route.fulfill({
      status: response.status,
      headers: {
        'Content-Type':
          response.status === 200 ? 'application/json' : 'application/problem+json',
      },
      body: JSON.stringify(response.body),
    }),
  );
}

async function mockHmacApiNetworkError(page: Page) {
  await page.route(HMAC_API_PATTERN, (route) => route.abort('failed'));
}

// Pre-seeds the localStorage cache entry before the page loads.
async function seedCache(page: Page) {
  await page.addInitScript(
    (arg: { key: string; payload: unknown; at: string }) => {
      localStorage.setItem(arg.key, JSON.stringify({ payload: arg.payload, at: arg.at }));
    },
    { key: CACHE_KEY, payload: fullPayload(), at: CACHE_AT },
  );
}

// Spoofs navigator.onLine === false before the page loads.
async function setNavigatorOffline(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', {
      get: () => false,
      configurable: true,
    });
  });
}

// Simulates the device coming back online in-page: updates navigator.onLine
// and dispatches the 'online' event so React listeners fire.
async function simulateReconnect(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', {
      get: () => true,
      configurable: true,
    });
    window.dispatchEvent(new Event('online'));
  });
}

test.describe('Story 4-s10: Offline lunch link (HMAC)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()),
      }),
    );
  });

  // AC2 — successful online load writes payload + timestamp to localStorage.
  test('AC2 — successful load caches payload in localStorage', async ({ page }) => {
    await mockHmacApi(page, { status: 200, body: fullPayload() });
    await loginAndNavigate(page, HMAC_LINK_URL);
    await expect(page.getByRole('heading', { name: 'A note from Parent', level: 1 })).toBeVisible();

    const raw = await page.evaluate((key) => localStorage.getItem(key), CACHE_KEY);
    expect(raw).not.toBeNull();
    const { payload, at } = JSON.parse(raw!);
    expect(payload.childName).toBe('Layla');
    expect(payload.bag.name).toBe('Sandwich, apple & water');
    expect(typeof at).toBe('string');
    // at must be a valid ISO timestamp.
    expect(() => new Date(at).toISOString()).not.toThrow();
  });

  // AC2 — cache is refreshed (lastSyncedAt reset to null) on a fresh online load:
  // no stale "last synced" badge when data comes from the network.
  test('AC5 — no offline badge on a fresh online load', async ({ page }) => {
    await mockHmacApi(page, { status: 200, body: fullPayload() });
    await loginAndNavigate(page, HMAC_LINK_URL);

    await expect(page.getByRole('heading', { name: 'A note from Parent', level: 1 })).toBeVisible();
    await expect(page.getByText(/offline · last synced/)).not.toBeVisible();
  });

  // AC3 — offline with cached data: full content + "offline · last synced HH:MM" badge.
  test('AC3 — offline with cached data renders content and offline badge', async ({ page }) => {
    await seedCache(page);
    await setNavigatorOffline(page);
    await mockHmacApiNetworkError(page);
    await loginAndNavigate(page, HMAC_LINK_URL);

    // Full lunch-link content served from cache.
    await expect(page.getByRole('heading', { name: 'A note from Parent', level: 1 })).toBeVisible();
    await expect(page.getByText('Have a wonderful day, my love.')).toBeVisible();
    await expect(page.getByText('Sandwich, apple & water')).toBeVisible();

    // AC5: badge text and time format.
    const badge = page.getByText(/offline · last synced/);
    await expect(badge).toBeVisible();
    // Badge must contain a time value (HH:MM).
    await expect(badge).toContainText(/\d{1,2}:\d{2}/);
  });

  // AC3 — offline without cached data: generic error state, no content.
  test('AC3 — offline without cached data shows generic error', async ({ page }) => {
    await setNavigatorOffline(page);
    await mockHmacApiNetworkError(page);
    await loginAndNavigate(page, HMAC_LINK_URL);

    await expect(
      page.getByText("Couldn't load this lunch link. Please try again."),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /a note from parent/i })).not.toBeVisible();
    await expect(page.getByText(/offline · last synced/)).not.toBeVisible();
  });

  // AC4 + P1 patch — badge clears when device reconnects (isOnline state consumed).
  test('AC4 — offline badge disappears after reconnect', async ({ page }) => {
    await seedCache(page);
    await setNavigatorOffline(page);
    await mockHmacApiNetworkError(page);
    await loginAndNavigate(page, HMAC_LINK_URL);

    // Badge visible while offline.
    await expect(page.getByText(/offline · last synced/)).toBeVisible();

    await simulateReconnect(page);

    // Badge must disappear once isOnline becomes true.
    await expect(page.getByText(/offline · last synced/)).not.toBeVisible();
  });

  // AC6 — emoji tap while offline queues pending rating in localStorage.
  test('AC6 — emoji tap while offline stores pending rating in localStorage', async ({
    page,
  }) => {
    await seedCache(page);
    await setNavigatorOffline(page);
    await mockHmacApiNetworkError(page);
    // Rate endpoint also fails (offline).
    await page.route(RATE_PATTERN, (route) => route.abort('failed'));
    await loginAndNavigate(page, HMAC_LINK_URL);

    await expect(page.getByRole('heading', { name: 'A note from Parent', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Loved it' }).click();

    // FeedbackBlock locks immediately on tap (S4 behavior).
    await expect(page.getByRole('button', { name: 'Loved it' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Pending rating queued.
    const raw = await page.evaluate((key) => localStorage.getItem(key), PENDING_RATING_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).rating).toBe('loved');
  });

  // AC6 — reconnect fires pending rating POST and clears localStorage entry.
  test('AC6 — reconnect replays queued rating and clears the localStorage entry', async ({
    page,
  }) => {
    // Seed both the page cache and the pending rating before load.
    await page.addInitScript(
      (arg: { ratingKey: string; cacheKey: string; pendingValue: string; cacheValue: string }) => {
        localStorage.setItem(arg.ratingKey, arg.pendingValue);
        localStorage.setItem(arg.cacheKey, arg.cacheValue);
      },
      {
        ratingKey: PENDING_RATING_KEY,
        cacheKey: CACHE_KEY,
        pendingValue: JSON.stringify({ rating: 'ok', linkId: HMAC_TOKEN }),
        cacheValue: JSON.stringify({ payload: fullPayload(), at: CACHE_AT }),
      },
    );
    await setNavigatorOffline(page);
    await mockHmacApiNetworkError(page);
    // Rate endpoint succeeds (connectivity restored after reconnect).
    await page.route(RATE_PATTERN, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    );

    await loginAndNavigate(page, HMAC_LINK_URL);
    await expect(page.getByRole('heading', { name: 'A note from Parent', level: 1 })).toBeVisible();

    // Trigger reconnect and wait for the replay POST simultaneously.
    const [rateRequest] = await Promise.all([
      page.waitForRequest(
        (req) => req.url().includes('/rate') && req.method() === 'POST',
      ),
      simulateReconnect(page),
    ]);

    // POST body must carry the queued rating.
    expect((rateRequest.postDataJSON() as { rating: string }).rating).toBe('ok');

    // After successful POST, localStorage entry is cleared.
    await page.waitForFunction(
      (key) => localStorage.getItem(key) === null,
      PENDING_RATING_KEY,
    );
  });

  // Expired link (410) with snapshot — "This link closed at 8pm" + snapshot content.
  test('410 with snapshot renders expired-link state', async ({ page }) => {
    await mockHmacApi(page, { status: 410, body: expiredPayload() });
    await loginAndNavigate(page, HMAC_LINK_URL);

    await expect(page.getByText('This link closed at 8pm')).toBeVisible();
    await expect(page.getByText('Hope you had a great lunch!')).toBeVisible();
    await expect(page.getByText('Pasta salad')).toBeVisible();
    await expect(page.locator('[aria-label="Child rated: loved"]')).toBeVisible();
  });

  // Expired link (410) without snapshot — falls back to generic error.
  test('410 without snapshot falls back to generic error', async ({ page }) => {
    await mockHmacApi(page, {
      status: 410,
      body: { last_state_snapshot: null },
    });
    await loginAndNavigate(page, HMAC_LINK_URL);

    await expect(
      page.getByText("Couldn't load this lunch link. Please try again."),
    ).toBeVisible();
    await expect(page.getByText('This link closed at 8pm')).not.toBeVisible();
  });
});
