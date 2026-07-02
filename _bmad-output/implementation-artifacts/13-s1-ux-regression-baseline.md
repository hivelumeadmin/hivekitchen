# Story 13-s1: UX Regression Baseline (gate, built first)

**Status:** done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Source brief:** `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` § Phase 0, 13-s1. **WALL: baseline — gate for every surface-touching slice.**
> This is the **first** slice of Epic 13 and the **gate** every downstream slice (s2–s11) must pass. It is **characterization only**: it captures current UI behavior and changes **NO** production code (`src/`).

---

## Story

As a **HiveKitchen engineer about to rebuild the Lumi-led UX across onboarding, the Brief, and the planner**,
I want **a Playwright-based regression baseline — E2E flows, axe a11y checks, and visual snapshots — captured against current `main` behavior and wired into CI**,
so that **every later Epic 13 slice (presence primitive, whisper, Brief pilot, onboarding rebuild, planner surface, route collapse) can be proven not to regress safety display, accessibility, or locked-component visuals before it merges**.

---

## Acceptance Criteria

### AC1 — E2E flows for surfaces being rebuilt (current behavior only)

A single spec file `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts` is created (no existing spec modified). Six sub-flows in six `test.describe` blocks:

1. **Onboarding spine:** `/onboarding` loads and renders the two entry paths. "I'd rather type" mounts `OnboardingText` with Lumi's opening greeting. "Start talking" renders the voice-entry path (or the TTS read-aloud landing per 2-S20).
2. **Brief render:** `/app` with a mocked `/v1/households/:id/brief` response renders a moment-headline, a lumi-note paragraph, and 5 plan tiles (one per weekday). `plan_state: null` (no-plan draft state).
3. **Plan review confirm surface:** A Brief response with `plan_state: 'plan_ready'` renders the `PlanActionSection` / sticky-bar area with the confirm-week button. Assert it is visible and enabled.
4. **LumiOrb/LumiPanel ambient:** Orb is visible inside AppLayout; clicking it opens the panel; pressing Escape closes it.
5. **Safety display — AllergyClearedBadge:** A brief response with `cleared_allergies: [{ child_id, allergen }]` renders `AllergyClearedBadge` on the affected tile. Assert it appears and is visible.
6. **Safety display — paused/locked tile:** A tile payload that includes a `pause_state` renders a visual pause indicator (text or aria label). Assert it appears.

All API calls are mocked via `page.route()`; no real server is hit.

### AC2 — Axe a11y: AA on `.app-scope`, AAA on `.child-scope`

- Install `@axe-core/playwright` as a `devDependency` in `apps/web/package.json`. This is the **only new dependency**.
- For the `/app` surface: run axe against the `.app-scope` wrapper element with `['wcag2aa']` tags; assert zero violations.
- For the child-facing surface (`/app/lunch-link/...` or wherever `.child-scope` applies): run axe with `['wcag2aaa']` tags; assert zero violations. If `.child-scope` is unreachable from E2E without a production `src/` change, document as a **Dev Agent Record deviation** and skip.
- The axe helper is a private function inside the spec, not an export.

### AC3 — Visual snapshots of locked-component states

Use Playwright's `toHaveScreenshot()` to capture and commit baseline PNGs for:

- `PlanTile` — all 5 variants: **past**, **today**, **default**, **pending-input**, **locked/paused**. Snapshot each variant's locator (not full page).
- `QuietDiff` — with a `scaffolding_diff` present (inject via the brief mock).
- `FreshnessState` — stale state rendered (trigger by intercepting the brief fetch with a delay or specific `generated_at` in the past).
- `AllergyClearedBadge` — cleared state.
- `LumiOrb` — at rest (closed panel), open panel.
- `Button` — all 5 variants (primary, secondary, tertiary, proposal, destructive). Find them on a page that already renders all variants (the kitchen-profile page or account page renders several; alternatively inject a hidden test surface — but NO `src/` change).
- Key surface wide-shots: onboarding landing page, BriefCanvas with full plan data.

Snapshots are generated with `--update-snapshots` on first run and committed. CI fails on any divergence.

### AC4 — `prefers-reduced-motion` baseline captured

For the LumiOrb breathing animation and any CSS transition-heavy surface:
- Call `await page.emulateMedia({ reducedMotion: 'reduce' })` before navigating.
- Snapshot the LumiOrb locator and the Brief surface.
- Commit the `reduced-motion` variant PNGs separately (Playwright names them automatically when emulation differs).

### AC5 — Safety-display states captured explicitly

The spec must contain at least one explicit assertion for each of:
- `AllergyClearedBadge` visible on a tile when `cleared_allergies` is non-empty (overlaps AC1.5 — assert it here as a standalone safety gate, not just inside AC1).
- A paused/locked tile renders its safety indicator (overlaps AC1.6 — same; deduplicate by referencing the same `test.describe` block).

These tests are what Epic 13 slices' code reviews will run to confirm safety display is unregressed.

### AC6 — CI wiring, no new failures

- The spec is in `apps/web/test/e2e/` and picked up automatically by `playwright.config.ts` (`testDir: './test'`). No config change needed.
- `pnpm --filter @hivekitchen/web exec playwright test` (or the project's e2e invocation) runs the new spec alongside the existing suite.
- Zero pre-existing E2E failures are worsened.

### AC7 — No production code changes

No file under `apps/web/src/` is created or modified. No new Zustand store, no component, no route. Only artifacts: `13-s1-ux-regression-baseline.spec.ts` + committed snapshot PNGs. If a state is unreachable from E2E without a `src/` change, document in Dev Agent Record and skip.

### AC8 — Green on `main`

The spec passes against `pnpm preview` build of `apps/web` at current `main`. `pnpm typecheck` passes with zero new errors. All snapshot PNGs are committed.

---

## Tasks / Subtasks

> **SCOPE CHANGE (Menon, 2026-06-28):** Pixel-snapshot ACs (AC3, AC4) and their
> tasks (Task 4, Task 5) are **DESCOPED**. Epic 13 is a deliberate visual rebuild,
> so committing `toHaveScreenshot()` PNG baselines would fail CI on every intended
> improvement (and would also require Linux-container generation to match the
> ubuntu CI runner from this Windows dev box). The gate is behavioral — flows +
> a11y + safety-display. See Dev Agent Record → Deviations.

- [x] **Task 1 — Dependency install + setup (AC: 2, 6)**
  - [x] Run `pnpm add -D @axe-core/playwright --filter @hivekitchen/web`. Confirmed in `apps/web/package.json` devDependencies (`@axe-core/playwright@^4.12.1`).
  - [x] Confirmed no pre-existing axe dep before install.
  - [x] Verified `playwright.config.ts` (`testDir: './test'`) picks up the new spec — `--list` shows it among 64 files / 483 tests, no config change.

- [x] **Task 2 — E2E flow spec scaffolding (AC: 1, 5)**
  - [x] Created `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts`.
  - [x] Imports `loginAndNavigate`, `userProfile`, `SAMPLE_HOUSEHOLD_ID` from `./_helpers.js`.
  - [x] Local `briefResponse()` helper (extended from 3-8/3-12) — supports `cleared_allergies`, `scaffolding_diff`, `plan_state`, and `paused` tiles. NOTE: the real per-tile field is `paused`, not the story's `pause_state` (deviation).
  - [x] Local `navigateToApp()` helper — mocks `/v1/users/me`, `/v1/plans*`, brief; pins the clock to a Monday (mirrors 3-12); navigates to `/app`.
  - [x] Implemented the flow `test.describe` blocks (AC1.1 onboarding, AC1.2 brief render, AC1.3 confirm surface, AC1.4 orb/panel) + safety-display (AC5). AC1.5/AC1.6 are asserted as standalone AC5 safety gates (deduplicated per AC5).

- [x] **Task 3 — Axe a11y integration (AC: 2)**
  - [x] Imports `AxeBuilder` from `@axe-core/playwright`.
  - [x] Private `checkA11y(page, selector, tags)` inside the spec (not exported).
  - [x] `.app-scope` is set on `<html>` by `useScope('app-scope')` (via `packages/ui` `use-scope.ts`, called in `routes/(app)/layout.tsx`), so the axe `include('.app-scope')` covers the whole authenticated document. AA gate uses `['wcag2a','wcag2aa']`.
  - [x] `.child-scope` is UNREACHABLE from E2E without a src/ change — `ChildScopeLayout` (the only `useScope('child-scope')` caller) is defined but not wired into the router; `/lunch/:linkId` renders under AppLayout (`.app-scope`). Documented + AAA test `test.skip`-ped (deviation).
  - [x] `test.describe('AC2 — Accessibility (axe)')` with the AA app-scope test (passing) and the skipped AAA child-scope test.

- [~] **Task 4 — Visual snapshots (AC: 3, 4)** — **DESCOPED** (see scope-change note above). No `toHaveScreenshot()`, no committed PNGs.
- [~] **Task 5 — Button variants (AC: 3)** — **DESCOPED** (snapshot-only task).

- [x] **Task 6 — Green confirmation (AC: 6, 7, 8)**
  - [x] Ran the new spec alone: 10 passed, 1 skipped (child-scope AAA), 0 failed.
  - [x] No pre-existing failures worsened: change is purely additive (one new spec file + one devDep); no `src/` or shared-spec edits, so other specs are unaffected. Full collection (`--list`) succeeds for all 64 files.
  - [x] `pnpm --filter @hivekitchen/web typecheck` → exit 0 (e2e specs are outside `tsconfig include:["src"]`; `pnpm build` also ran `tsc` clean).
  - [x] Spec committed-ready. No snapshot PNGs (descoped).

---

### Review Findings

_Code review 2026-06-29 (3-layer adversarial: Blind Hunter / Edge Case Hunter / Acceptance Auditor). 2 decision-needed (both resolved → patched), 5 patch (all applied), 3 deferred, 9 dismissed as noise. 1 Blind-Hunter finding (P3) reclassified to dismissed — false positive from a truncated review-paste; the DEVIATION note does exist in the spec above the `test.skip`._

**Decision-needed (resolved):**

- [x] [Review][Decision→Patch] AA axe gate was blind to NEW color-contrast regressions — `KNOWN_DEBT_RULES = ['color-contrast']` filtered the rule *globally*, so a new contrast failure (the story's risk #1) passed silently. **Resolved (Menon): scope the allowlist to nodes.** Replaced the rule-level filter with `isKnownContrastDebtNode()` — color-contrast violations are filtered at the NODE level (fingerprinted by `text-amber-warm` / `bg-amber-warm` / footer-scoped `text-fg-muted`), so a NEW contrast miss anywhere else fails the gate. [spec: `isKnownContrastDebtNode` + `checkA11y`]
- [x] [Review][Decision→Patch] `prefers-reduced-motion` coverage was zero (lived only in the descoped AC4). **Resolved (Menon): add a behavioral check.** New `AC4 — Reduced-motion baseline` describe: `emulateMedia({reducedMotion:'reduce'})` then asserts the LumiOrb's computed `transition-property` is `none`. No `src/` change. [spec: `13-s1 / AC4 — Reduced-motion baseline`]

**Patch (all applied):**

- [x] [Review][Patch] Removed racy `waitForResponse('**/v1/users/me')` in `navigateToApp` — `/v1/users/me` resolves before the brief on the critical path, so `waitForResponse(BRIEF_URL)` already gates render; the users/me wait could race and hang [13-s1-ux-regression-baseline.spec.ts → navigateToApp]
- [x] [Review][Patch] Strengthened the paused-day test — added a direct `tabindex=-1` assertion on the paused tile AND a positive control (a non-paused day DOES open its edit picker), so the `toHaveCount(0)` negative is now meaningful [13-s1-ux-regression-baseline.spec.ts → AC5 paused test]
- [x] [Review][Patch] Mocked `/v1/onboarding/state` (`{status:'not_started'}`) via `beforeEach` in the AC1.1 describe — the landing no longer relies on the probe *erroring* to reach the 'select' mode picker [13-s1-ux-regression-baseline.spec.ts → AC1.1 describe]
- [x] [Review][Patch→Dismiss] Skipped-AAA "deviation note above" — DISMISSED as a false positive: the DEVIATION comment block does exist in the spec immediately above the `test.skip`; the Blind Hunter saw a truncated paste, not the file.

**Deferred (pre-existing / enhancement):**

- [x] [Review][Defer] Confirm-week button is an inert no-op in production — `BriefCanvas.tsx:689` renders `<PlanActionSection>` with no `onConfirm`, so the button has no handler at all; AC1.3's visible+enabled assertion is met but pins a confirm surface that does not confirm — deferred, pre-existing product issue
- [x] [Review][Defer] Axe a11y never scans the opened LumiPanel/picker, and `aria-expanded`/`aria-controls` on the orb/panel are unasserted — the story claims to protect "ambient LumiOrb/Panel" a11y but the gate only scans the default brief view — deferred, coverage enhancement (AC2 as written is met)
- [x] [Review][Defer] PlanTile `past`/`today`/`locked` visual variants are uncovered after the AC3 snapshot descope, with no behavioral substitute (only `paused` is covered behaviorally) — deferred, consequence of user-approved descope

---

## Dev Notes

### What this story IS and IS NOT

- **IS:** an additive test-only artifact in `apps/web/test/e2e/` plus committed `.png` snapshots. Zero behavior change.
- **IS NOT:** any change to `apps/web/src/`. No new component, store, route, or hook. If a desired state is only reachable by modifying `src/`, skip it and log a Dev Agent Record deviation — do not bend this rule.

---

### Existing E2E patterns — reuse, don't reinvent

**`_helpers.ts`** (`apps/web/test/e2e/_helpers.ts`):
```ts
export const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
export const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
export function userProfile(overrides?: UserProfileOverrides): {...}  // builds a complete UserProfile fixture
export function authUser(overrides?: AuthUserOverrides): {...}
export async function loginAndNavigate(page, path, opts?): Promise<void>
export async function mockLogin(page): Promise<void>
```

**BriefCanvas mock** (from `3-8-brief-canvas.spec.ts`):
```ts
// ALWAYS mock /v1/plans* — BriefCanvas calls usePlanQuery on every mount
await page.route('**/v1/plans*', (route) =>
  route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: null, plan_items: [], is_draft: false, week_of: '2026-05-04' }) }),
);
await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`, (route) =>
  route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(briefResponse()) }),
);
await mockAcknowledgedProfile(page);  // mocks /v1/users/me with userProfile()
await loginAndNavigate(page, '/app');
await page.waitForResponse('**/v1/users/me');
```

**LumiStore seeding** (from `12-6-lumi-orb-panel.spec.ts`): Requires `VITE_E2E=true` build (exposes `window.__lumiStore`). If the E2E build does not set this flag, the store injection silently fails — check the build config before relying on it.

---

### Axe integration pattern (no existing baseline — new)

```ts
import { AxeBuilder } from '@axe-core/playwright';

async function checkA11y(page: import('@playwright/test').Page, selector: string, tags: string[]) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(tags)
    .analyze();
  if (results.violations.length > 0) {
    console.log(results.violations.map(v => `${v.id}: ${v.description}`).join('\n'));
  }
  expect(results.violations).toHaveLength(0);
}
```

The `@axe-core/playwright` API: `new AxeBuilder({ page })` is the Playwright-v1.x pattern (NOT the older `checkA11y(page)` from the community `axe-playwright` package, which is a different dep). Use the official Deque package.

---

### Locating `.app-scope` and `.child-scope`

These are CSS class names or data attributes that define accessibility scope. Per the brief and memory `lumi-valet-not-chat-app`:

- **`.app-scope`** — wraps the authenticated parental app (AppLayout or the root layout div). **Read `apps/web/src/app.tsx` to find the exact element.** It is listed as a CSS class (`.app-scope`) in DESIGN.md §8 scope discipline.
- **`.child-scope`** — wraps child-facing surfaces (LunchLink, FlavorPassport, child-scope Stationery). **Read `apps/web/src/features/lunch-link/`** to confirm. The child lunch-link route is public (`/app/lunch-link/:token`) — mock the lunch-link API if needed for the axe check.
- **`.grandparent-scope`** — HeartNoteComposer. Out of scope for this story's a11y checks.

If these are data attributes (`data-scope="app"`) rather than CSS classes, adjust the axe `include()` call to `[data-scope="app"]`.

---

### Visual snapshot stability — key rules

1. **Snapshot component locators, not full page.** Full-page snapshots break on unrelated layout shifts. Use `page.locator('[data-testid="plan-tile-monday"]').screenshot()` not `page.screenshot()`.
2. **Tolerance:** `toHaveScreenshot({ maxDiffPixels: 20 })` for minor anti-aliasing.
3. **Headless only:** Generate and commit snapshots in headless mode (CI default). Never commit snapshots generated in headed mode — pixel values differ.
4. **Animation stabilization:** Before snapshotting an animated component (LumiOrb), either use `reducedMotion: 'reduce'` emulation or `await page.waitForTimeout(500)` after mount to let transitions settle.
5. **PlanTile variants:** Inject the correct tile state via the `briefResponse()` mock. The `past` state is a tile whose `day` date is in the past (mock a `generated_at` from last week). The `today` state matches the current date — use `new Date().toISOString().split('T')[0]` to compute the current weekday and match it.
6. **Snapshot storage:** Playwright stores PNGs at `test/e2e/13-s1-ux-regression-baseline.spec.ts-snapshots/` by default. These must be committed. Add to `.gitignore` exclusion if they're currently ignored — check root `.gitignore`.

---

### BriefCanvas `briefResponse()` with safety states

The `cleared_allergies` array in the brief response triggers `AllergyClearedBadge`. Structure (from `3-8-brief-canvas.spec.ts` baseline + contracts):

```ts
function briefResponseWithClearedAllergen() {
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      moment_headline: 'A quiet week, with one small surprise.',
      lumi_note: 'Tuesday flexes around your late meeting.',
      memory_prose: '',
      payload: {
        cleared_allergies: [{ child_id: CHILD_ID, allergen: 'peanut' }],
        scaffolding_diff: null,
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        tile_summaries: [
          { day: 'monday', items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans'] }] },
          // ... 4 more days
        ],
      },
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    },
  };
}
```

Check the actual `BriefStatePayloadSchema` in `@hivekitchen/contracts` for the exact field names — use `z.infer<>` shapes from `@hivekitchen/types` if types are needed in the spec.

---

### Why this story matters (the gate logic)

Epic 13 slices s2–s11 will replace `LumiOrb.tsx`, `LumiPanel.tsx`, `LumiFAB.tsx`, `OnboardingText.tsx` (~2,460 lines), `PlanPage.tsx`, `PlanActionSection.tsx`, and the route graph. Without a snapshot + a11y + safety-display baseline, any one of these could silently:

- Drop an `AllergyClearedBadge` (direct safety regression)
- Introduce a WCAG contrast failure in the new presence component
- Break the `PlanTile` locked/paused variant
- Strip `aria-expanded`/`aria-controls` from the new summoned sheet
- Regress `prefers-reduced-motion` behavior

The `13-s1` baseline is what lets the code-review step of each subsequent slice say "no regression" from evidence — not from inspection.

---

### Previous work intelligence

**From `2.7-s1-onboarding-golden-eval-harness`** (the closest analog — golden-set-first discipline applied to a different layer):
- The gate-first slice lands a characterization harness against **unmodified** behavior.
- Every later slice's code review references "X/Y tests green, baseline unchanged."
- This story plays the same role for the UI as 2.7-s1 plays for the onboarding backend and 3.5-s1 plays for the planner.

**From `3.5-s1-planner-golden-set-eval-harness`** (the exact pattern template):
- "Characterization parity — zero behavior change" is the invariant.
- Characterization includes capturing what is currently WRONG (e.g., `PlanActionSection` is NOT using `StickyBottomBar`) so later slices' diffs are provably outcome-neutral.
- The baseline intentionally captures the current state, warts and all.

**Key surfaces that will be rebuilt in later slices (capture their current state here):**

| Surface | File | Rebuilt in |
|---|---|---|
| `LumiOrb` / `LumiPanel` / `LumiFAB` | `src/components/Lumi*.tsx` | 13-s2 |
| Brief / BriefCanvas | `src/features/plan/BriefCanvas.tsx` | 13-s4 |
| `PlanActionSection` (NOT using StickyBottomBar) | `src/features/plan/PlanActionSection.tsx` | 13-s7 |
| `OnboardingText.tsx` (focused/history mode, chip-bracket) | `src/features/onboarding/OnboardingText.tsx` | 13-s5 |
| Duplicate onboarding mockups | `src/features/onboarding-mockups/` | 13-s5 (delete) |

---

## Dev Agent Record

Implemented by dev-story (claude-opus-4-8[1m]), 2026-06-28. Characterization-only:
no `apps/web/src/` file created or modified (AC7 honored). Deliverables: one new
E2E spec + one devDependency.

### Implementation Plan / approach

Behavioral baseline (flows + a11y + safety-display), no pixel snapshots. Locators
and brief-mock shape reuse the existing Epic 3 / 12 specs (3-8, 3-9, 3-10, 3-11,
3-12, 12-6) so the baseline stays consistent with how these surfaces are already
asserted. The spec navigates a real `pnpm preview` build with all API calls
mocked via `page.route()`.

### Deviations

1. **Pixel snapshots descoped (AC3, AC4 / Task 4, Task 5).** User decision (Menon,
   2026-06-28): Epic 13 is a deliberate visual rebuild, so `toHaveScreenshot()`
   baselines would fail CI on every intended improvement; also CI runs on
   `ubuntu-latest` while dev is Windows, and Playwright PNGs are renderer/OS
   specific (committing Windows PNGs → guaranteed CI red). Gate is behavioral.

2. **`.child-scope` AAA unreachable (AC2).** `ChildScopeLayout`
   (`routes/(child)/layout.tsx`) is the only `useScope('child-scope')` caller and
   is NOT wired into the router; the lunch-link route renders under `AppLayout`
   (`.app-scope`). The AAA test is `test.skip`-ped. Reaching child-scope would
   require a `src/` change (forbidden by AC7).

3. **Pre-existing WCAG AA color-contrast debt (AC2).** On current `main`, the app
   chrome + design-system amber tokens fail AA color-contrast (the ONLY failing
   axe rule): `text-amber-warm` wordmark / active-nav on warm-neutral bg
   (1.71–2.05:1), the "Confirm the week" button `text-bg` on `bg-amber-warm`
   (2.37:1), and footer links `text-fg-muted` (3.43:1). 13-s1 can't fix this
   (AC7). The gate is therefore "no violations BEYOND known `color-contrast`
   debt" (`KNOWN_DEBT_RULES`), which still catches any NEW a11y rule category the
   rebuild introduces. An Epic 13 slice (s2 presence / s7 plan surface) should
   fix the tokens then drop `color-contrast` from `KNOWN_DEBT_RULES`.

4. **LumiPanel has no Escape-to-close (AC1.4).** Story says Escape closes the
   panel; today neither LumiPanel nor LumiOrb implements an Escape handler. Real
   close affordances are the panel dismiss button and re-tapping the orb. Both
   the actual close path AND the Escape-gap are asserted (the gap test flips when
   Epic 13 adds Escape-to-close — an improvement).

5. **"Confirm the week" button is unconditional (AC1.3).** BriefCanvas renders
   `<PlanActionSection>` whenever a brief is present; the confirm button does NOT
   gate on `plan_state: 'plan_ready'` (BriefCanvas only special-cases
   `'degraded'`). We send `plan_state: 'plan_ready'` for intent and assert the
   always-present, always-enabled button.

6. **AllergyClearedBadge placement (AC1.5).** The badge renders as a chip in the
   `aria-label="Allergy clearances"` row ABOVE the headline, not on the affected
   tile. Asserted at actual placement.

7. **Onboarding voice CTA copy.** Label is "Start with voice", not the story's
   "Start talking". Characterized actual copy.

8. **`data-testid` mostly absent.** PlanTile / AllergyClearedBadge / QuietDiff /
   FreshnessState have no `data-testid`; role+name locators are used (article by
   weekday, button by accessible name, label by `aria-label`) — matching the
   existing Epic 3 specs.

### Completion Notes

- ✅ `@axe-core/playwright@4.12.1` added as the only new devDependency (`apps/web`).
- ✅ AA axe gate green on `.app-scope` apart from documented `color-contrast` debt
  (axe run log: `known debt: [color-contrast]; new: [none]`).
- ✅ Safety display gated: AllergyClearedBadge present/absent on `cleared_allergies`;
  paused day shows its "Paused" indicator and is non-interactive.
- ✅ Flows gated: onboarding two entry paths + text greeting; brief headline / note
  / 5 tiles; confirm-week button; orb opens panel + dismiss closes.

### Baseline test counts

- 13-s1 spec: **11 tests** — 10 passing, 1 skipped (child-scope AAA deviation).
- Snapshots: **0** (descoped).
- Axe surfaces covered: 1 (`.app-scope`, WCAG 2.0 A + AA). Child-scope AAA: skipped.
- Full Playwright collection: 64 files / 483 tests, no collection errors.

## File List

- `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts` — NEW (E2E flow + axe a11y + safety-display baseline).
- `apps/web/package.json` — MODIFIED (added `@axe-core/playwright` devDependency).
- `pnpm-lock.yaml` — MODIFIED (lockfile entry for `@axe-core/playwright`).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED (13-s1 status).

## Change Log

| Date | Change |
|---|---|
| 2026-06-28 | Implemented 13-s1 UX regression baseline: new Playwright spec covering onboarding spine, Brief render, confirm surface, ambient Lumi orb/panel, axe AA a11y, and safety-display (AllergyClearedBadge + paused tile). Added `@axe-core/playwright`. Pixel snapshots (AC3/AC4) descoped per Menon. 10 pass / 1 skip; typecheck clean. Status → review. |
