import { test, expect, type Page } from '@playwright/test';

// Fixed UUIDs matching the spec demo path.
const GUEST_AUTHOR_USER_ID = '99999999-9999-4999-8999-999999999999';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const NOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPOSE_URL = '/guest-author/compose';

const CAP_API_PATTERN = '**/v1/guest-author/cap';
const HEART_NOTES_PATTERN = '**/v1/heart-notes';

// Fixed next-month date used in all cap responses so button copy is predictable.
const NEXT_MONTH_OPENS = '2026-07-01';

function capResponse(
  notesUsed: number,
  opts: { grandparentName?: string; grandparentTerm?: string | null } = {},
) {
  const grandparentName = opts.grandparentName ?? 'Nani Ayaan';
  const grandparentTerm = opts.grandparentTerm !== undefined ? opts.grandparentTerm : 'Nani';
  return {
    child_id: CHILD_ID,
    child_name: 'Ayaan',
    grandparent_name: grandparentName,
    grandparent_term: grandparentTerm,
    notes_used: notesUsed,
    cap: 2,
    next_month_opens: NEXT_MONTH_OPENS,
  };
}

function notePayload(overrides: { scheduled_for?: string | null } = {}) {
  return {
    note: {
      id: NOTE_ID,
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      author_user_id: GUEST_AUTHOR_USER_ID,
      content: '',
      status: overrides.scheduled_for ? 'scheduled' : 'draft',
      scheduled_for: overrides.scheduled_for ?? null,
      delivered_at: null,
      cancelled_at: null,
      created_at: '2026-06-03T12:00:00.000Z',
      updated_at: '2026-06-03T12:00:00.000Z',
    },
  };
}

async function loginAsGrandparent(
  page: Page,
  opts: { displayName?: string } = {},
) {
  const displayName = opts.displayName ?? 'Nani Ayaan';
  await page.route('**/v1/auth/login', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: 'grandparent-test-token',
        expires_in: 900,
        user: {
          id: GUEST_AUTHOR_USER_ID,
          email: 'nani@example.com',
          display_name: displayName,
          current_household_id: HOUSEHOLD_ID,
          role: 'guest_author',
        },
        is_first_login: false,
        is_onboarded: true,
        is_onboarding_in_progress: false,
      }),
    }),
  );
  await page.goto(`/auth/login?next=${encodeURIComponent(COMPOSE_URL)}`);
  await page.getByLabel('Email Address', { exact: true }).fill('nani@example.com');
  await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
  await page.getByRole('button', { name: /enter kitchen/i }).click();
  await page.waitForURL(/\/guest-author\/compose/);
}

async function mockCapApi(
  page: Page,
  response: { status: number; body: unknown },
) {
  await page.route(CAP_API_PATTERN, (route) =>
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

async function mockHeartNotesPost(
  page: Page,
  response: { status: number; body: unknown },
) {
  await page.route(HEART_NOTES_PATTERN, (route) => {
    if (route.request().method() === 'POST') {
      void route.fulfill({
        status: response.status,
        headers: {
          'Content-Type':
            response.status === 201 ? 'application/json' : 'application/problem+json',
        },
        body: JSON.stringify(response.body),
      });
    } else {
      void route.continue();
    }
  });
}

test.describe('Story 4-s13: Grandparent Composer with At-Cap Rhythm', () => {
  // AC6 — Writable state: composer loads and shows textarea + cap counter.
  test('AC6/AC7 — writable state: textarea editable, cap counter visible', async ({ page }) => {
    await mockCapApi(page, { status: 200, body: capResponse(0) });
    await loginAsGrandparent(page);

    await expect(page.getByLabel('Heart Note')).toBeVisible();
    await expect(page.getByLabel('Heart Note')).not.toHaveAttribute('readonly');
    await expect(page.getByText('Note 1 of 2 this month')).toBeVisible();
  });

  // AC7 — Soft-cap warning: when 1 note used, counter turns amber (notesUsed = cap - 1).
  test('AC7 — soft-cap: counter shows "Note 2 of 2 this month" with amber colour', async ({
    page,
  }) => {
    await mockCapApi(page, { status: 200, body: capResponse(1) });
    await loginAsGrandparent(page);

    const counter = page.getByText('Note 2 of 2 this month');
    await expect(counter).toBeVisible();
    // Amber class applied at soft-cap.
    await expect(counter).toHaveClass(/text-amber/);
  });

  // AC7 — Send affordance: button copy includes child name and next school day.
  test('AC7 — send button label includes child name', async ({ page }) => {
    await mockCapApi(page, { status: 200, body: capResponse(0) });
    await loginAsGrandparent(page);

    // The exact day varies by when the test runs — match the stable child-name part.
    await expect(page.getByRole('button', { name: /Tuck into Ayaan's/i })).toBeVisible();
  });

  // AC7 — Send button disabled until content is entered.
  test('AC7 — send button disabled while textarea is empty', async ({ page }) => {
    await mockCapApi(page, { status: 200, body: capResponse(0) });
    await loginAsGrandparent(page);

    const sendBtn = page.getByRole('button', { name: /Tuck into Ayaan's/i });
    await expect(sendBtn).toBeDisabled();

    await page.getByLabel('Heart Note').fill('Love you!');
    await expect(sendBtn).toBeEnabled();
  });

  // AC7 — Successful send transitions to "Sent ✓" confirmation.
  test('AC7 — successful send shows "Sent ✓" confirmation', async ({ page }) => {
    await mockCapApi(page, { status: 200, body: capResponse(0) });
    await loginAsGrandparent(page);
    await mockHeartNotesPost(page, { status: 201, body: notePayload() });

    await page.getByLabel('Heart Note').fill('Love you!');
    await page.getByRole('button', { name: /Tuck into Ayaan's/i }).click();

    await expect(page.getByText('Sent ✓')).toBeVisible();
    await expect(page.getByText("Your note is on its way to Ayaan.")).toBeVisible();
    // Composer is gone.
    await expect(page.getByLabel('Heart Note')).not.toBeVisible();
  });

  // AC8 — At-cap state: rhythm copy, read-only textarea, schedule button.
  test('AC8 — at-cap state renders rhythm copy and read-only textarea', async ({ page }) => {
    await mockCapApi(page, { status: 200, body: capResponse(2) });
    await loginAsGrandparent(page);

    // Rhythm copy paragraph.
    await expect(page.getByText(/Ayaan has both of your notes this month/)).toBeVisible();
    await expect(page.getByText(/The next one opens/)).toBeVisible();

    // Textarea is read-only.
    const textarea = page.getByLabel(/Heart Note.*read-only/i);
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveAttribute('readonly', '');

    // Cap label in red.
    await expect(page.getByText('Both notes used this month')).toBeVisible();

    // "Save for Jul 1" button visible.
    await expect(page.getByRole('button', { name: /Save for Jul 1/i })).toBeVisible();
  });

  // AC9 — Cultural recognition: grandparent term underlined with sacred-plum decoration.
  test('AC9 — grandparent term "Nani" rendered inside TermHighlight span', async ({ page }) => {
    await mockCapApi(page, { status: 200, body: capResponse(2, { grandparentTerm: 'Nani' }) });
    await loginAsGrandparent(page);

    // TermHighlight wraps the term in a span with decoration-sacred class.
    const highlight = page.locator('span.decoration-sacred');
    await expect(highlight).toBeVisible();
    await expect(highlight).toHaveText('Nani');
  });

  // AC9 — No term highlight when grandparentTerm is null.
  test('AC9 — no TermHighlight span when grandparentTerm is null', async ({ page }) => {
    await mockCapApi(
      page,
      { status: 200, body: capResponse(2, { grandparentName: 'Mary Smith', grandparentTerm: null }) },
    );
    await loginAsGrandparent(page, { displayName: 'Mary Smith' });

    // Rhythm copy shown but no sacred-plum decoration span.
    await expect(page.getByText(/Ayaan has both of your notes this month/)).toBeVisible();
    await expect(page.locator('span.decoration-sacred')).not.toBeVisible();
  });

  // AC8 — Schedule next month: "Save for Jul 1" button creates empty draft and shows confirmation.
  test('AC8 — "Save for Jul 1" creates scheduled draft and shows confirmation', async ({
    page,
  }) => {
    await mockCapApi(page, { status: 200, body: capResponse(2) });
    await loginAsGrandparent(page);
    await mockHeartNotesPost(page, {
      status: 201,
      body: notePayload({ scheduled_for: NEXT_MONTH_OPENS }),
    });

    await page.getByRole('button', { name: /Save for Jul 1/i }).click();

    await expect(page.getByText(/Saved for 1 July/)).toBeVisible();
    await expect(
      page.getByText("You'll be able to write your note then."),
    ).toBeVisible();
  });

  // AC6 — Loading state: "Loading…" shown while cap fetch is in flight.
  test('AC6 — shows "Loading…" while cap fetch is in flight', async ({ page }) => {
    let unblock!: () => void;
    const block = new Promise<void>((resolve) => { unblock = resolve; });

    await page.route(CAP_API_PATTERN, async (route) => {
      await block;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(capResponse(0)),
      });
    });

    await loginAsGrandparent(page);

    // While fetch is blocked, loading text is shown.
    await expect(page.getByText('Loading…')).toBeVisible();
    // Composer not yet mounted.
    await expect(page.getByLabel('Heart Note')).not.toBeVisible();

    // Unblock and verify the composer appears.
    unblock();
    await expect(page.getByLabel('Heart Note')).toBeVisible();
  });

  // AC6 — Error state: failed cap fetch shows error message.
  test('AC6 — cap fetch failure shows error message', async ({ page }) => {
    await mockCapApi(page, {
      status: 500,
      body: { type: '/errors/internal', status: 500, title: 'Internal Server Error' },
    });
    await loginAsGrandparent(page);

    await expect(
      page.getByText('Could not load your composer. Please try again.'),
    ).toBeVisible();
    await expect(page.getByLabel('Heart Note')).not.toBeVisible();
  });

  // AC6 — 401 redirects to login with `next` param.
  test('AC6 — 401 from cap endpoint redirects to /auth/login', async ({ page }) => {
    await mockCapApi(page, {
      status: 401,
      body: { type: '/errors/unauthorized', status: 401, title: 'Unauthorized' },
    });
    await loginAsGrandparent(page);

    await page.waitForURL(/\/auth\/login/);
    await expect(page.url()).toContain('next=');
  });

  // AC2 — Invite redirect: guest_author invite redemption navigates to /guest-author/compose.
  test('AC2 — guest_author invite redemption navigates to /guest-author/compose', async ({
    page,
  }) => {
    // Mock the redeem endpoint returning guest_author scope_target.
    await page.route('**/v1/auth/invites/redeem', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'guest_author',
          scope_target: '/guest-author/compose',
          household_id: HOUSEHOLD_ID,
        }),
      }),
    );
    // Mock the cap endpoint so the composer can render (we're now "logged in" via
    // the invite token — the Zustand store already holds the mock access_token).
    await mockCapApi(page, { status: 200, body: capResponse(0) });

    // Set up a logged-in session so InviteRedeemPage can call hkFetch (needs a token).
    await page.route('**/v1/auth/login', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: 'grandparent-test-token',
          expires_in: 900,
          user: {
            id: GUEST_AUTHOR_USER_ID,
            email: 'nani@example.com',
            display_name: 'Nani Ayaan',
            current_household_id: HOUSEHOLD_ID,
            role: 'guest_author',
          },
          is_first_login: false,
          is_onboarded: true,
          is_onboarding_in_progress: false,
        }),
      }),
    );

    // Navigate through login, then to the invite page (InviteRedeemPage calls
    // hkFetch which requires an access token in the Zustand store).
    await page.goto('/auth/login?next=%2Finvite%2Ffaketoken');
    await page.getByLabel('Email Address', { exact: true }).fill('nani@example.com');
    await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
    await page.getByRole('button', { name: /enter kitchen/i }).click();
    await page.waitForURL(/\/invite\/faketoken/);

    // InviteRedeemPage calls redeem → gets scope_target → navigates there.
    await page.waitForURL(/\/guest-author\/compose/);
    // Composer renders with the mocked cap response.
    await expect(page.getByLabel('Heart Note')).toBeVisible();
  });
});
