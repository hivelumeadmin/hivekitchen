import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { loginAndNavigate, userProfile, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// ---------------------------------------------------------------------------
// Story 13-s1 — UX Regression Baseline (gate for Epic 13 Lumi-led UX rebuild)
//
// CHARACTERIZATION ONLY. No production `src/` code is touched. This spec pins
// the *current* behavior of the surfaces Epic 13 will rebuild (onboarding spine,
// Brief, plan-confirm surface, ambient LumiOrb/Panel) plus the two things that
// MUST NOT regress during the rebuild: accessibility (axe) and safety display
// (AllergyClearedBadge, paused-day indicator).
//
// SCOPE DECISION (Menon, 2026-06-28): pixel snapshots (story AC3/AC4) are
// intentionally NOT included. Epic 13 is a deliberate visual rebuild, so
// pixel-locking the current look would fail CI on every intended improvement.
// The gate is behavioral — flows + a11y + safety-display — which protects the
// things that matter without freezing the design. See Dev Agent Record.
//
// Locators mirror the existing Epic 3 / 12 specs (3-8, 3-9, 3-10, 3-11, 3-12,
// 12-6) so this baseline stays consistent with how those surfaces are already
// asserted.
// ---------------------------------------------------------------------------

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';

type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
const WEEKDAYS: readonly Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

interface ClearedAllergyEntry {
  child_id: string;
  child_name: string;
  allergen: string;
}

interface BriefOverrides {
  cleared_allergies?: ClearedAllergyEntry[];
  scaffolding_diff?: { summary: string; explanation?: string } | null;
  plan_state?: string | null;
  plan_state_message?: string | null;
  paused?: ReadonlyArray<Weekday>;
  moment_headline?: string;
  lumi_note?: string;
}

const DEFAULT_INGREDIENTS: Record<Weekday, string[]> = {
  monday: ['rice', 'beans'],
  tuesday: ['noodles'],
  wednesday: ['pasta'],
  thursday: ['soup'],
  friday: ['wrap'],
};

// Mirrors the brief mock shape used across Epic 3 specs: tile_summaries +
// safety fields live under `brief.payload`; the wire is hkFetch raw JSON (no
// Zod parse on the web side), so the test only needs to send the fields the
// component reads.
function briefResponse(o: BriefOverrides = {}) {
  const paused = new Set(o.paused ?? []);
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      plan_id: PLAN_ID,
      moment_headline: o.moment_headline ?? 'A quiet week, with one small surprise.',
      lumi_note: o.lumi_note ?? 'Tuesday flexes around your late meeting.',
      memory_prose: '',
      payload: {
        cleared_allergies: o.cleared_allergies ?? [],
        scaffolding_diff: o.scaffolding_diff ?? null,
        plan_state: o.plan_state ?? null,
        plan_state_set_at: null,
        plan_state_message: o.plan_state_message ?? null,
        tile_summaries: WEEKDAYS.map((day, i) => ({
          day,
          paused: paused.has(day),
          items: [
            {
              plan_item_id: `55555555-5555-4555-8555-55555555550${i + 1}`,
              child_id: CHILD_ID,
              slot: 'main',
              ingredients: DEFAULT_INGREDIENTS[day],
            },
          ],
        })),
      },
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    },
  };
}

// Drive login → /app with the brief + supporting endpoints mocked. Mirrors the
// navigateToApp helper in 3-9 / 3-10 / 3-12. The clock is pinned to a Monday so
// PlanTile.deriveVariant() renders the week as today/upcoming (see 3-12).
async function navigateToApp(page: Page, o: BriefOverrides = {}) {
  await page.clock.install({ time: new Date('2026-05-04T08:00:00Z') });
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()),
    }),
  );
  await page.route('**/v1/plans*', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: null, plan_items: [], is_draft: false, week_of: '2026-05-04' }),
    }),
  );
  await page.route(BRIEF_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(briefResponse(o)),
    }),
  );
  await loginAndNavigate(page, '/app');
  // Wait on the brief only. `/v1/users/me` is on the critical render path BEFORE
  // the brief fetch (the parental-notice gate must resolve first), so a brief
  // response guarantees users/me already resolved. Waiting on users/me here
  // would race — it can resolve during navigation, before this line registers.
  await page.waitForResponse(BRIEF_URL);
}

// KNOWN A11Y DEBT (characterized on `main`, 2026-06-28): the app chrome +
// design-system amber tokens fail WCAG AA color-contrast today —
//   • `text-amber-warm` wordmark / active-nav on warm-neutral bg (1.71–2.05:1)
//   • "Confirm the week" button: text-bg on bg-amber-warm (2.37:1)
//   • footer links: text-fg-muted on bg (3.43:1)
// 13-s1 may NOT touch src/ (AC7), so this debt is RECORDED, not fixed. An Epic 13
// slice (s2 presence / s7 plan surface) should fix the tokens and then drop
// `color-contrast` from KNOWN_DEBT_RULES to restore a full AA gate. Until then
// the gate is "no violations BEYOND this known debt" — which still catches any
// NEW a11y rule category the rebuild introduces (missing labels, ARIA misuse…).
// Pre-existing WCAG-AA color-contrast debt characterized on `main` (2026-06-28),
// SCOPED TO THE SPECIFIC OFFENDING NODES — not the whole `color-contrast` rule —
// so a NEW contrast failure anywhere else (e.g. an Epic 13 presence component —
// the story's "Why this matters" risk #1) still fails this gate. Each documented
// offender is fingerprinted by the design-system token class that causes it:
//   • text-amber-warm → wordmark + active sidebar nav on warm-neutral bg (1.71–2.05:1)
//   • bg-amber-warm   → "Confirm the week" button: text-bg on bg-amber-warm (2.37:1)
//   • footer text-fg-muted → footer links / brand / copyright (3.43:1)
// An Epic 13 slice (s2 presence / s7 plan surface) should fix these tokens and
// then delete this allowlist to restore a pristine AA gate.
function isKnownContrastDebtNode(node: { html: string; target: unknown }): boolean {
  // Match the element's own markup AND its selector path: axe sometimes reports
  // the failing node as an inner span (e.g. <span class="truncate">Plan</span>)
  // whose own class lacks the token, while the amber-warm token sits on the
  // ancestor <a> and surfaces in the target path (.border-amber-warm > .truncate).
  const hay = `${node.html} ${JSON.stringify(node.target)}`;
  // amber-warm token family: wordmark + active sidebar nav (text-/border-amber-warm)
  // and the "Confirm the week" button (bg-amber-warm).
  if (hay.includes('amber-warm')) return true;
  // NOTE: the former footer text-fg-muted exemption was removed once --fg-muted
  // was darkened to #474339 (Epic 13 contrast-debt fix) — text-fg-muted now
  // clears 4.5:1 on all light surfaces, so any remaining miss is a real regression.
  return false;
}

// Private axe helper (AC2). Not exported. Filters the documented color-contrast
// debt at the NODE level (see isKnownContrastDebtNode) so only NEW violations
// remain; logs what survived so CI output names what regressed.
async function checkA11y(page: Page, selector: string, tags: string[]) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(tags).analyze();
  const newViolations = results.violations
    .map((v) => ({
      ...v,
      nodes:
        v.id === 'color-contrast' ? v.nodes.filter((n) => !isKnownContrastDebtNode(n)) : v.nodes,
    }))
    .filter((v) => v.nodes.length > 0);
  if (results.violations.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `axe on ${selector} [${tags.join(',')}] — total: ${results.violations.length} rule(s); ` +
        `new (after known color-contrast debt): ` +
        `[${newViolations.map((v) => `${v.id}: ${v.help}`).join(' | ') || 'none'}]`,
    );
  }
  expect(newViolations).toHaveLength(0);
}

// ===========================================================================
// AC1.1 — Onboarding spine: the two entry paths
// ===========================================================================
test.describe('13-s1 / AC1.1 — Onboarding spine', () => {
  // Mock the GET /v1/onboarding/state probe so the landing deterministically
  // renders the mode picker ('not_started' → 'select' per onboarding.tsx). The
  // prior code relied on this request ERRORING to fall through to 'select',
  // which breaks the moment any backend answers (completed → /app redirect,
  // in_progress → Resume surface) or merely hangs.
  test.beforeEach(async ({ page }) => {
    await page.route('**/v1/onboarding/state', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'not_started' }),
      }),
    );
  });

  test('/onboarding renders the text-first entry with the continuity promise', async ({ page }) => {
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });

    // Epic 13-s6 (AC7) — text-first entry: primary "Start with Lumi" (→ text)
    // plus the "I'd rather type" secondary (kept, still → text). Voice is
    // deferred (Q2a) — no "Start with voice" CTA; the continuity line stands in.
    await expect(page.getByRole('button', { name: /start with lumi/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /i'd rather type/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /start with voice/i })).toHaveCount(0);
    await expect(page.getByText(/voice is coming soon/i)).toBeVisible();
  });

  test('"I\'d rather type" mounts OnboardingText with Lumi\'s opening greeting', async ({
    page,
  }) => {
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();

    // Opening greeting + the message input (same locators as 2-7).
    await expect(page.getByText(/i'm lumi.*planning lunches/i)).toBeVisible();
    await expect(page.getByLabel(/your message to lumi/i)).toBeVisible();
  });
});

// ===========================================================================
// AC1.2 — Brief render (no-plan / decided week)
// ===========================================================================
test.describe('13-s1 / AC1.2 — Brief render', () => {
  test('renders headline, lumi note, and five weekday tiles', async ({ page }) => {
    await navigateToApp(page);

    await expect(
      page.getByRole('heading', { level: 1, name: 'A quiet week, with one small surprise.' }),
    ).toBeVisible();
    await expect(page.getByText('Tuesday flexes around your late meeting.')).toBeVisible();
    await expect(page.getByLabel('Weekly plan')).toBeVisible();

    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await expect(page.getByRole('article', { name: day })).toBeVisible();
    }
  });
});

// ===========================================================================
// AC1.3 — Plan review / confirm surface
// ===========================================================================
test.describe('13-s1 / AC1.3 — Confirm-week surface', () => {
  test('PlanActionSection renders the confirm-week button, visible and enabled', async ({
    page,
  }) => {
    // DEVIATION: BriefCanvas renders <PlanActionSection> unconditionally when a
    // brief is present; the "Confirm the week" button does not gate on a
    // `plan_state: 'plan_ready'` value (BriefCanvas only special-cases
    // 'degraded'). We send plan_state: 'plan_ready' for intent but assert the
    // always-present, always-enabled button — characterizing actual behavior.
    await navigateToApp(page, { plan_state: 'plan_ready' });

    const actions = page.getByRole('region', { name: 'Plan actions' });
    await expect(actions).toBeVisible();
    const confirm = actions.getByRole('button', { name: /confirm the week/i });
    await expect(confirm).toBeVisible();
    await expect(confirm).toBeEnabled();
  });
});

// ===========================================================================
// AC1.4 — Lumi presence: ambient dot + summoned sheet
//
// REBUILT for Epic 13-s2 (presence primitive). The old orb→complementary-panel
// model was replaced by a quiet dot that summons a focused, modal <Dialog> sheet
// (role=dialog, name "Lumi") which recedes on Escape / close / scrim. This block
// characterizes the NEW model; the durable gates (AC2 axe, AC4 reduced motion,
// AC5 safety) are unchanged.
// ===========================================================================
test.describe('13-s1 / AC1.4 — Lumi presence (dot + summoned sheet)', () => {
  test('dot is visible in AppLayout; tapping summons the sheet; close recedes it', async ({
    page,
  }) => {
    await navigateToApp(page);

    const dot = page.getByRole('button', { name: /open lumi/i });
    await expect(dot).toBeVisible();
    await expect(dot).toHaveAttribute('aria-expanded', 'false');
    await expect(dot).toHaveAttribute('aria-controls', 'lumi-sheet');

    await dot.click();
    const sheet = page.getByRole('dialog', { name: /lumi/i });
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('button', { name: /lumi is open/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await sheet.getByRole('button', { name: /close lumi/i }).click();
    await expect(sheet).not.toBeVisible();
  });

  test('Escape recedes the summoned sheet (Epic 13-s2 improvement — the flipped gap)', async ({
    page,
  }) => {
    await navigateToApp(page);
    await page.getByRole('button', { name: /open lumi/i }).click();
    const sheet = page.getByRole('dialog', { name: /lumi/i });
    await expect(sheet).toBeVisible();

    // 13-s1 originally documented "Escape does NOT close" as a gap; 13-s2's
    // Dialog-based sheet ADDS Escape-to-close, so this expectation is flipped.
    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();
  });

  test('the dot is keyboard-activatable (Enter summons the sheet)', async ({ page }) => {
    await navigateToApp(page);
    await page.getByRole('button', { name: /open lumi/i }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /lumi/i })).toBeVisible();
  });
});

// ===========================================================================
// AC4 — prefers-reduced-motion baseline (behavioral)
//
// The pixel-snapshot half of AC4 is descoped, but reduced-motion coverage lived
// ONLY in AC4 — without this, 13-s2's presence rebuild could regress reduced
// motion undetected. This is the non-pixel substitute: emulate reduced motion
// and assert the dot's transition is actually disabled (no src/ change needed).
// ===========================================================================
test.describe('13-s1 / AC4 — Reduced-motion baseline', () => {
  test('the Lumi presence dot honors prefers-reduced-motion (transitions disabled)', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await navigateToApp(page);

    const dot = page.getByRole('button', { name: /open lumi/i });
    await expect(dot).toBeVisible();

    // The dot carries `transition-colors motion-reduce:transition-none`; under
    // reduced-motion emulation Tailwind's motion-reduce variant resolves the
    // computed transition-property to `none`. (The resting breathing animate-pulse
    // also carries `motion-reduce:animate-none`; that + nudge/voice/thinking
    // states are unit-covered in LumiPresence.test.tsx.)
    const transitionProperty = await dot.evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(transitionProperty).toBe('none');
  });
});

// ===========================================================================
// AC2 — Axe a11y baseline
// ===========================================================================
test.describe('13-s1 / AC2 — Accessibility (axe)', () => {
  test('app surface (.app-scope) has no WCAG 2.0 A/AA violations beyond known color-contrast debt', async ({
    page,
  }) => {
    await navigateToApp(page);
    await expect(
      page.getByRole('heading', { level: 1, name: 'A quiet week, with one small surprise.' }),
    ).toBeVisible();

    // useScope('app-scope') sets the class on <html>, so include the whole
    // authenticated document. wcag2a + wcag2aa = the full AA gate.
    await checkA11y(page, '.app-scope', ['wcag2a', 'wcag2aa']);
  });

  // Epic 13-s2 — the 13-s1 baseline never scanned the OPENED Lumi surface (a
  // documented deferral). The summoned sheet is a modal dialog portaled into
  // <body> (inside <html class="app-scope">), so re-scanning .app-scope with the
  // sheet open covers the new presence component's a11y (focus-trap dialog,
  // labels, contrast). No NEW violation category may appear.
  test('opened Lumi sheet has no new WCAG 2.0 A/AA violations', async ({ page }) => {
    await navigateToApp(page);
    await page.getByRole('button', { name: /open lumi/i }).click();
    await expect(page.getByRole('dialog', { name: /lumi/i })).toBeVisible();

    await checkA11y(page, '.app-scope', ['wcag2a', 'wcag2aa']);
  });

  // DEVIATION (AC2): the AAA child-scope check is UNREACHABLE from E2E without a
  // src/ change. `ChildScopeLayout` (routes/(child)/layout.tsx, the only caller
  // of useScope('child-scope')) is defined but NOT wired into the router — the
  // lunch-link route renders under AppLayout, i.e. `.app-scope`. Per the story,
  // this is documented and skipped rather than forcing a production change.
  test.skip('child surface (.child-scope) has zero WCAG 2.0 AAA violations', async () => {
    // Intentionally unreachable — see deviation note above.
  });
});

// ===========================================================================
// AC5 — Safety-display states (the safety gate Epic 13 reviews will run)
// ===========================================================================
test.describe('13-s1 / AC5 — Safety display', () => {
  test('AllergyClearedBadge appears when cleared_allergies is non-empty', async ({ page }) => {
    await navigateToApp(page, {
      cleared_allergies: [{ child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' }],
    });

    // DEVIATION: the badge renders as a chip in the "Allergy clearances" row
    // ABOVE the headline (not on the affected tile as AC1.5 phrases it). Assert
    // actual placement + label.
    const clearancesRow = page.getByLabel('Allergy clearances');
    await expect(clearancesRow).toBeVisible();
    await expect(page.getByRole('button', { name: "Cleared for Asha's peanut" })).toBeVisible();
  });

  test('no allergy-clearance row renders when cleared_allergies is empty', async ({ page }) => {
    await navigateToApp(page, { cleared_allergies: [] });

    await expect(page.getByLabel('Allergy clearances')).toHaveCount(0);
    // Brief still renders normally — empty safety state is silence.
    await expect(
      page.getByRole('heading', { level: 1, name: 'A quiet week, with one small surprise.' }),
    ).toBeVisible();
  });

  test('a paused day renders its visible "Paused" safety indicator and is non-interactive', async ({
    page,
  }) => {
    await navigateToApp(page, { paused: ['monday'] });

    // The paused affordance is shown so the parent sees the day is parked.
    await expect(page.getByText(/^paused$/i).first()).toBeVisible();

    // Direct non-interactivity characterization: the paused tile carries
    // tabIndex -1 (+ pointer-events-none) so it cannot be focused or clicked.
    const mondayTile = page.getByRole('article', { name: /monday/i });
    await expect(mondayTile).toHaveAttribute('tabindex', '-1');

    // Negative: forcing a click on the paused tile must NOT summon the plan-edit
    // sheet. (Post-13-s10 a tile tap opens LumiSheet with PlanEditPanel; the old
    // DisambiguationPicker role=group flow this test originally pinned is gone.)
    await mondayTile.click({ force: true });
    await expect(page.getByRole('dialog', { name: /lumi/i })).toHaveCount(0);

    // Positive control: a NON-paused day DOES summon the sheet with that day's
    // edit context. This is what proves the negative above is meaningful — the
    // selector is real and would have matched if pausing didn't disable
    // interaction.
    await page.getByRole('article', { name: /tuesday/i }).click();
    const sheet = page.getByRole('dialog', { name: /lumi/i });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/tell me what to change about tuesday/i)).toBeVisible();
  });
});
