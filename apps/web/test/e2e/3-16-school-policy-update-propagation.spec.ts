import { test, expect } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

// ------------------------------------------------------------------
// Story 3-16: School Policy Update + Propagation — E2E spec
//
// Page under test: /app/children/:childId/school-policies?name=Asha
// API under test:  GET  /v1/children/:id/school-policies
//                  PATCH /v1/children/:id/school-policies
// ------------------------------------------------------------------

const SAMPLE_CHILD_ID = '44444444-4444-4444-8444-444444444444';
const SAMPLE_POLICY_ID = '55555555-5555-4555-8555-555555555555';
const PLAN_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAN_ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHILD_NAME = 'Asha';
const PAGE_URL = `/app/children/${SAMPLE_CHILD_ID}/school-policies?name=${CHILD_NAME}`;

// ------------------------------------------------------------------
// Fixture builders
// ------------------------------------------------------------------

function makePolicy(overrides: {
  policy_type?: string;
  is_active?: boolean;
  slot_scope?: string;
} = {}) {
  return {
    id: SAMPLE_POLICY_ID,
    child_id: SAMPLE_CHILD_ID,
    policy_type: overrides.policy_type ?? 'nut_free',
    policy_description: null,
    slot_scope: overrides.slot_scope ?? 'bag_wide',
    is_active: overrides.is_active ?? true,
    created_at: '2026-05-05T11:00:00.000Z',
    updated_at: '2026-05-05T11:00:00.000Z',
  };
}

function policiesGetResponse(policies: ReturnType<typeof makePolicy>[]) {
  return { policies };
}

function patchResponse(opts: { policy: ReturnType<typeof makePolicy>; regen: boolean }) {
  return {
    policy: opts.policy,
    regeneration_triggered: opts.regen,
    affected_plan_ids: opts.regen ? [PLAN_ID_A, PLAN_ID_B] : [],
  };
}

// ------------------------------------------------------------------
// Common setup
// ------------------------------------------------------------------

async function reachSchoolPoliciesPage(
  page: Parameters<typeof loginAndNavigate>[0],
  opts: { initialPolicies?: ReturnType<typeof makePolicy>[] } = {},
) {
  // GET /v1/users/me — required by auth-aware components in the layout.
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()),
    }),
  );

  // GET school-policies for this child.
  await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/school-policies`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(policiesGetResponse(opts.initialPolicies ?? [])),
    });
  });

  // Mock the household brief to silence any AppLayout data calls.
  await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: null }),
    }),
  );

  await loginAndNavigate(page, PAGE_URL);
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

test.describe('Story 3-16: school policy update propagation', () => {
  test('renders heading and all five policy rows', async ({ page }) => {
    await reachSchoolPoliciesPage(page);

    await expect(
      page.getByRole('heading', { name: new RegExp(`school food policies for ${CHILD_NAME}`, 'i') }),
    ).toBeVisible();

    for (const label of ['Nut-free', 'No heating', 'No pork', 'No shellfish', 'Vegetarian only']) {
      await expect(page.getByLabel(new RegExp(label, 'i'))).toBeVisible();
    }
  });

  test('active policies load as checked, inactive as unchecked', async ({ page }) => {
    await reachSchoolPoliciesPage(page, {
      initialPolicies: [makePolicy({ policy_type: 'nut_free', is_active: true })],
    });

    await expect(page.getByLabel(/^nut.free/i)).toBeChecked();
    await expect(page.getByLabel(/^no heating/i)).not.toBeChecked();
    await expect(page.getByLabel(/^no pork/i)).not.toBeChecked();
  });

  test('enabling a policy PATCHes the endpoint and shows regen confirmation', async ({ page }) => {
    let patchedBody: Record<string, unknown> | null = null;

    await reachSchoolPoliciesPage(page);

    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/school-policies`, (route, request) => {
      if (request.method() !== 'PATCH') return route.fallback();
      patchedBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          patchResponse({ policy: makePolicy({ policy_type: 'nut_free', is_active: true }), regen: true }),
        ),
      });
    });

    // Controlled checkbox — use .click() not .check() because the checked state
    // is server-driven and only updates once the PATCH response arrives.
    await page.getByLabel(/^nut.free/i).click();

    await expect(page.getByRole('status')).toContainText(/saved.*updating future plans/i);
    expect(patchedBody).toMatchObject({ policy_type: 'nut_free', is_active: true, slot_scope: 'bag_wide' });
  });

  test('disabling a policy PATCHes the endpoint and shows simple "Saved." message (no regen)', async ({
    page,
  }) => {
    await reachSchoolPoliciesPage(page, {
      initialPolicies: [makePolicy({ policy_type: 'nut_free', is_active: true })],
    });

    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/school-policies`, (route, request) => {
      if (request.method() !== 'PATCH') return route.fallback();
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          patchResponse({ policy: makePolicy({ policy_type: 'nut_free', is_active: false }), regen: false }),
        ),
      });
    });

    await page.getByLabel(/^nut.free/i).click();

    await expect(page.getByRole('status')).toHaveText(/^saved\.$/i);
    // Deactivated policy should be unchecked in the updated UI.
    await expect(page.getByLabel(/^nut.free/i)).not.toBeChecked();
  });

  test('GET failure surfaces a load error and hides the policy list', async ({ page }) => {
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()),
      }),
    );
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: null }),
      }),
    );
    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/school-policies`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await loginAndNavigate(page, PAGE_URL);

    await expect(page.getByRole('alert')).toContainText(/couldn.t load school policies/i);
    await expect(page.getByLabel(/^nut.free/i)).toHaveCount(0);
  });

  test('5xx PATCH surfaces an error message without removing the toggle', async ({ page }) => {
    await reachSchoolPoliciesPage(page);

    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/school-policies`, (route, request) => {
      if (request.method() !== 'PATCH') return route.fallback();
      return route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await page.getByLabel(/^no pork/i).click();

    await expect(page.getByRole('status')).toContainText(/couldn.t save school policy/i);
    // Toggle row should still be visible so the user can retry.
    await expect(page.getByLabel(/^no pork/i)).toBeVisible();
  });

  test('checkboxes are disabled while a PATCH is in flight', async ({ page }) => {
    let resolvePatch: (() => void) | null = null;

    await reachSchoolPoliciesPage(page);

    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/school-policies`, (route, request) => {
      if (request.method() !== 'PATCH') return route.fallback();
      resolvePatch = () =>
        void route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            patchResponse({ policy: makePolicy({ policy_type: 'nut_free', is_active: true }), regen: false }),
          ),
        });
    });

    await page.getByLabel(/^nut.free/i).click();

    // While in-flight all checkboxes are disabled.
    for (const label of ['Nut-free', 'No heating', 'No pork', 'No shellfish', 'Vegetarian only']) {
      await expect(page.getByLabel(new RegExp(label, 'i'))).toBeDisabled();
    }

    resolvePatch?.();
  });

  test('toggling two different policies in sequence works independently', async ({ page }) => {
    await reachSchoolPoliciesPage(page, {
      initialPolicies: [makePolicy({ policy_type: 'nut_free', is_active: true })],
    });

    let callCount = 0;
    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/school-policies`, (route, request) => {
      if (request.method() !== 'PATCH') return route.fallback();
      callCount++;
      const body = JSON.parse(request.postData() ?? '{}') as { policy_type: string; is_active: boolean };
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          patchResponse({
            policy: makePolicy({ policy_type: body.policy_type, is_active: body.is_active }),
            regen: body.is_active,
          }),
        ),
      });
    });

    await page.getByLabel(/^no heating/i).click();
    await expect(page.getByRole('status')).toContainText(/saved/i);

    await page.getByLabel(/^nut.free/i).click();
    await expect(page.getByRole('status')).toHaveText(/^saved\.$/i);

    expect(callCount).toBe(2);
  });
});
