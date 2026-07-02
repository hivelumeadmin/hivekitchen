# Story 13.7: Planner Finished Surface + StickyBottomBar

Status: done

> **Source brief:** `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` § Phase 4, 13-s7 (lines 194–198).
> **Vision:** `_bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md` §4a/§4c/§4d.
> **Reference mock:** `apps/web/src/routes/_dev-weekly-plan.tsx` + `features/weekly-plan/components/ActionRow.tsx` — the correct StickyBottomBar pattern already implemented here. Converge the live `features/plan` to this pattern.
> **Design system:** `docs/DESIGN.md` §StickyBottomBar (line 244), §PrimaryButton (line 268), §TalkToLumiButton (line 299) — **READ these before touching any button/action surface**.
> **Gate:** `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts` + all existing `BriefCanvas.test.tsx` + `PlanTile.test.tsx` + `PlanPage.test.tsx` must stay green. `pnpm --filter @hivekitchen/web typecheck` + `build` clean.

---

## Story

As a **parent reviewing my weekly plan**,
I want **a calm, finished planner surface where the primary action is always reachable at the bottom and I can focus on any day to see Main/Snack/Extra separately**,
so that **I can confirm or adjust the week without hunting for the action button, and I can tweak a snack without touching the Main**.

---

## Scope Decisions (locked — do not re-litigate)

1. **PlanActionSection → StickyBottomBar.** The in-flow `PlanActionSection.tsx` diverges from DESIGN.md. This slice replaces it with the locked `StickyBottomBar` + `PrimaryButton` ("Confirm the week") + `TalkToLumiButton` in the right slot. This is the **entire pattern correction** — nothing else in the action surface changes.

2. **Progressive slot disclosure is CSS-focus-first, not a new component.** At rest: flat dish line (existing `deriveDishLine`). On tile-focus (`group-focus-visible:`): reveal Main/Snack/Extra grouped rows below the dish line. No new state variable. No new component. Pure Tailwind focus utilities on the existing `PlanTile`.

3. **`features/weekly-plan` is deleted after convergence.** `_dev-weekly-plan.tsx` and `features/weekly-plan/` are dev-only mock infra. Their sole value was the `ActionRow.tsx` pattern which this slice ports to the live code. Delete both after the live code matches.

4. **`BriefCanvas.tsx` is patched surgically.** `BriefCanvas` also imports `PlanActionSection` — it gets the same StickyBottomBar treatment in one localized patch. Do NOT refactor BriefCanvas beyond this one change (13-s8/s9 work is in-progress there).

5. **No data-model or backend changes.** Zero backend work in this story. The `slot` field (`'main' | 'snack' | 'extra'`) is already in `PlanTileItem` from the contract — read it for grouping.

6. **All PlanTile states and safety affordances are preserved without modification.** The tile states (`decided`, `pending-input`, `swap-in-progress`, `proposal-pending`, `locked`, `mutability-frozen`, `paused`), `ChildChip`, `TrustChip`, `AllergyClearedBadge`, `onWhyThis`, `onPauseLunchLink`, `onVariantChoice` — touch none of these.

---

## Acceptance Criteria

### AC1 — StickyBottomBar replaces PlanActionSection

- `PlanPage.tsx` no longer renders `<PlanActionSection />`. Instead, a `<StickyBottomBar>` is rendered (can be inline or as a thin wrapper component) with:
  - **Left group:** `<PrimaryButton icon={<CheckCircleIcon />}>Confirm the week</PrimaryButton>` (+ optional SecondaryButton if needed — see AC3)
  - **Right slot:** `<TalkToLumiButton onClick={onTalkToLumi} />`
- `PlanPage.tsx` main element gains `pb-28` (or `pb-32` if the bar is taller than default) so content isn't hidden behind the bar. Check that the footer is still visible.
- The same change applies to wherever `BriefCanvas.tsx` renders `<PlanActionSection />`.
- `PlanActionSection.tsx` is either deleted (preferred) or left only if BriefCanvas usage is complex. If deleted, remove its import from every consumer.

### AC2 — Progressive slot disclosure on tile focus

- `PlanTile` renders a **slot-expanded view** when the `<article>` is focused (`group-focus-visible:` pattern). The flat dish line remains visible at rest. On focus:
  - A grouped breakdown appears **below the dish line**: for each slot present in `summary.items` (in order: Main → Snack → Extra), a labelled row: `<span class="text-[10px] uppercase tracking-wider text-fg-muted/70">Main</span><span>…dish text…</span>`.
  - "Present" means at least one `item.slot === 'main'` (or 'snack', or 'extra') in the summary.
  - Slot grouping: use `item.slot` from `PlanTileItem` — values are `'main'`, `'snack'`, `'extra'`. Group items by slot, concatenate names/ingredients per group (same dedup + cap-3 logic as `deriveDishLine`).
  - If a slot has no items with a name or ingredients, omit that slot row.
  - Empty plan (`dishLine === ''`) falls through to "Plan pending" as today — no slot breakdown.
- The breakdown is hidden at rest (`hidden group-focus-visible:flex` or similar).
- Keyboard accessibility: the article is already focusable (`tabIndex={0}` when interactive); the expanded view appears on `focus-visible` only (not `focus:`, to avoid mouse-click expansion).
- `prefers-reduced-motion`: the breakdown can appear without animation (no `transition` needed — it's a disclosure, not a motion).

### AC3 — Confirm-week action wiring

- The `PrimaryButton`'s `onClick` wires to the existing confirmation flow. Check how `PlanActionSection.onConfirm` was wired in `PlanPage` and replicate in the new StickyBottomBar.
- If `PlanPage` did not yet wire `onConfirm` (the old `PlanActionSection` was rendered with no props), leave it as `undefined` for now — match the existing behavior exactly.
- Do NOT add new confirmation logic in this slice (that belongs to s10).

### AC4 — `features/weekly-plan` deleted

- `apps/web/src/features/weekly-plan/` directory is deleted.
- `apps/web/src/routes/_dev-weekly-plan.tsx` is deleted (or replaced with a simple redirect to `/app/plan` — delete is simpler if no dev route is needed).
- Any import of the deleted folder in `apps/web/src/app/` or elsewhere is cleaned up.
- The dev-route router registration (if any) is removed.
- TypeScript build stays clean (`pnpm --filter @hivekitchen/web typecheck`).

### AC5 — Tests green

- `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts` stays green — especially any plan-surface assertions (AllergyClearedBadge snapshots, action-surface assertions).
- `apps/web/src/features/plan/PlanTile.test.tsx` — add or update tests: (a) at rest renders flat dish line; (b) keyboard focus on tile reveals slot groups; (c) all existing state tests (paused, locked, frozen, swap-in-progress, proposal-pending) are unbroken.
- `apps/web/src/features/plan/PlanPage.test.tsx` — verify the StickyBottomBar renders with the correct role / aria-label. The existing plan-loading / empty-state / week-tab tests must not regress.
- `apps/web/src/features/plan/BriefCanvas.test.tsx` — if it tests `PlanActionSection` specifically, update to expect the StickyBottomBar button instead. All BriefCanvas loading/empty/plan-ready tests must pass.
- `pnpm --filter @hivekitchen/web typecheck` + `pnpm --filter @hivekitchen/web build` clean.

---

## Tasks / Subtasks

### Task Group A — StickyBottomBar (AC1, AC3)

- [x] **A1 — Port `PlanActionSection.tsx` to StickyBottomBar.**
  - Change `PlanActionSection.tsx` internals to use `<StickyBottomBar>` + `<PrimaryButton icon={<CheckCircleIcon />}>Confirm the week</PrimaryButton>` on the left + `<TalkToLumiButton />` on the right.
  - Keep the same props interface (`onConfirm`, `onTalkToLumi`, `onSwapDay`). If `onSwapDay` had a SecondaryButton, use `<SecondaryButton icon={<RefreshIcon />}>Swap a day</SecondaryButton>` — check whether the old code exposed this in PlanPage (it didn't pass props, so leave `onSwapDay` wired but not rendered unless the prop is provided).
  - Import `StickyBottomBar` from `@/components/StickyBottomBar.js`, `PrimaryButton` from `@/components/PrimaryButton.js`, `TalkToLumiButton` from `@/components/TalkToLumiButton.js`, `CheckCircleIcon` (+ `RefreshIcon` if needed) from `@/components/icons.js`.

- [x] **A2 — Add `pb-28` to `PlanPage.tsx` main element.**
  - `PlanPage` renders `<main className="mx-auto w-full max-w-7xl flex-grow px-8 pb-0">`. Change `pb-0` → `pb-28`.
  - Verify the footer (`PlanPageFooter`) is not buried — the footer sits inside the same `<main>`, so `pb-28` should give sufficient clearance. If not, use `pb-32`.

- [x] **A3 — Patch `BriefCanvas.tsx` (surgical).**
  - Find the `<PlanActionSection .../>` render call in `BriefCanvas.tsx`. Replace with the same `<StickyBottomBar>` + `<PrimaryButton>` + `<TalkToLumiButton>` pattern inline (or reuse the updated `<PlanActionSection />` — either is fine; the point is the StickyBottomBar renders).
  - Add `pb-28` to BriefCanvas's main/scroll container if it doesn't have it yet.
  - Touch NOTHING ELSE in `BriefCanvas.tsx` — s8/s9 work is in-progress there.

### Task Group B — Progressive slot disclosure (AC2)

- [x] **B1 — Add `deriveSlotGroups` helper to `PlanTile.tsx`.**
  - Add a pure function `deriveSlotGroups(items: PlanTileSummary['items'])` that returns an array of `{ slot: 'main' | 'snack' | 'extra'; label: string; line: string }` for each slot that has at least one item with a name or ingredients.
  - Slot order: main → snack → extra (always in this order, skip absent slots).
  - Per-slot `line`: collect all `item.name` (non-null) + `item.ingredients` across items of that slot, dedup with `new Set`, cap at 3 with `+N more` overflow — same logic as existing `deriveDishLine`.
  - Labels: `{ main: 'Main', snack: 'Snack', extra: 'Extra' }`.

- [x] **B2 — Render slot-expanded view in PlanTile article.**
  - The `<article>` already has `className="group ..."`. Add the slot breakdown below the dish-line `<p>`, wrapped in a `<div className="hidden group-focus-visible:flex flex-col gap-1 mt-2 mb-2">`:
    ```tsx
    {slotGroups.map(({ slot, label, line }) => (
      <div key={slot} className="flex items-baseline gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-fg-muted/70 w-10 flex-shrink-0">{label}</span>
        <span className="font-sans text-[13px] text-fg">{line}</span>
      </div>
    ))}
    ```
  - Only render when `slotGroups.length > 1` (if only one slot — e.g. main-only — don't show redundant disclosure).
  - The flat dish-line `<p>` stays visible at all times (it's the "at rest" view and stays as context on focus).

### Task Group C — Convergence cleanup (AC4)

- [x] **C1 — Delete `apps/web/src/features/weekly-plan/`.**
  - Remove the entire directory.

- [x] **C2 — Delete or update `apps/web/src/routes/_dev-weekly-plan.tsx`.**
  - Simplest: delete the file. Remove its route registration in the app router (check `apps/web/src/app/` for the route definition).

- [x] **C3 — Verify no broken imports.**
  - `pnpm --filter @hivekitchen/web typecheck` clean.

### Task Group D — Tests (AC5)

- [x] **D1 — Update `PlanTile.test.tsx`.**
  - Add: `'renders slot groups when tile is focused'` — render with a summary that has items for `slot: 'main'` and `slot: 'snack'`; simulate keyboard focus (`userEvent.tab()` or `element.focus()`); assert "Main" and "Snack" labels are visible.
  - Add: `'hides slot groups at rest'` — assert the slot labels are not visible before focus.
  - Verify all existing state tests pass (paused/locked/frozen/swap/proposal-pending are unaffected).

- [x] **D2 — Update `PlanPage.test.tsx`.**
  - Replace any assertion on the old `PlanActionSection` in-flow button with the StickyBottomBar button.
  - The existing loading/empty/plan-ready/next-week-tab tests must pass unchanged.

- [x] **D3 — Update `BriefCanvas.test.tsx` if needed.**
  - If any test queries for the old `PlanActionSection` markup, update to query for the StickyBottomBar / PrimaryButton.

---

## Dev Notes

### What already exists — REUSE, do not reinvent

**StickyBottomBar pattern (already correct in the weekly-plan mock):**
- `apps/web/src/features/weekly-plan/components/ActionRow.tsx` is the canonical reference implementation — it uses `<StickyBottomBar>`, `<PrimaryButton icon={<CheckCircleIcon />}>`, `<SecondaryButton icon={<RefreshIcon />}>`, `<TalkToLumiButton>` exactly as DESIGN.md demands. Port this pattern to PlanActionSection.
- `apps/web/src/components/StickyBottomBar.tsx` — the container. Fixed bottom, backdrop-blur. Pages that mount it **MUST** add `pb-28`/`pb-32` to their scroll container (documented in the component's JSDoc).
- `apps/web/src/components/PrimaryButton.tsx` — amber-warm, `active:scale-95`, **required leading icon** (h-5 w-5). Uses `default` size inside StickyBottomBar.
- `apps/web/src/components/TalkToLumiButton.tsx` — lumi-terracotta, WaveformIcon, `uppercase tracking-widest`. Always in the right slot of StickyBottomBar.
- `apps/web/src/components/SecondaryButton.tsx` — `text-fg-muted → amber-warm hover`, **required leading icon**. Use for "Swap a day" if exposed.

**Icons available** (`apps/web/src/components/icons.tsx`):
- `CheckCircleIcon` — for "Confirm the week" PrimaryButton
- `RefreshIcon` — for "Swap a day" SecondaryButton
- `WaveformIcon` — already used in TalkToLumiButton

**PlanTile architecture (read before touching):**
- `apps/web/src/features/plan/PlanTile.tsx` — the tile. Uses `group` class on `<article>`. Focus-visible ring already there (`focus-visible:ring-2 focus-visible:ring-amber-warm`). Adding `group-focus-visible:` utilities is the canonical pattern — see how s2/s3 used it for the presence primitive.
- `deriveDishLine` is a pure function on `summary.items`. Add `deriveSlotGroups` as a sibling pure function.
- `PlanTileSummary.items[].slot` is a `string` from the contract (`PlanTileItemSchema`), with runtime values `'main' | 'snack' | 'extra'`. Cast as needed: `(item.slot as 'main' | 'snack' | 'extra')` — or just check `=== 'main'` etc.
- `PlanTileItem.name` is `string | undefined` (Story 3-S40 snack-SKU label). `PlanTileItem.ingredients` is `string[]`. Both are already used by `deriveDishLine` — reuse the same extraction logic.

**PlanPage layout:**
- `apps/web/src/features/plan/PlanPage.tsx` — currently renders `<PlanActionSection />` at line 304. Confirm or check exact line. The `PlanActionSection` is rendered with no props (all callbacks undefined). The StickyBottomBar replaces it; pass `onConfirm={undefined}` / `onTalkToLumi={undefined}` for now.
- The main element: `className="mx-auto w-full max-w-7xl flex-grow px-8 pb-0"` → change `pb-0` to `pb-28`.

**BriefCanvas.tsx:**
- Imports `PlanActionSection` at line 22 and renders it somewhere in the tree.
- This file is **heavily modified in the current branch** (feat/catalog-repo-pick for s8/s9). Be surgical: only change the `<PlanActionSection .../>` render to `<StickyBottomBar>...` and add `pb-28` to the scroll container. Find and change ONLY those two lines.

**`_dev-weekly-plan.tsx` router registration:** Check `apps/web/src/app/` (the Vite SPA entry) for where the `_dev-weekly-plan` route is wired. Remove that registration entry when deleting the file. The file is at `apps/web/src/routes/_dev-weekly-plan.tsx` — the router likely imports it lazily.

### Design tokens and colors for slot disclosure

Use existing semantic tokens only:
- Slot labels: `text-fg-muted/70` (muted but readable)
- Slot content: `text-fg` (normal)
- No new tokens. No honey/amber for the slot disclosure (those are reserved — Honey rule, button tokens).

### Test patterns from previous stories

- **13-s5/s6 pattern:** Tests use `@testing-library/react` with `render`, `screen`, `userEvent`; Vitest (`describe`/`it`/`expect`/`vi`). Focus simulation uses `userEvent.tab()` or `fireEvent.focus(element)` / `element.focus()`.
- **`group-focus-visible:` CSS** may not trigger in jsdom tests via `userEvent.tab()`. Prefer `fireEvent.focus(article)` + check for the slot label in the DOM (visible but `hidden` CSS doesn't affect jsdom queries). Use `.not.toBeVisible()` / `.toBeVisible()` via `@testing-library/jest-dom` only if the component uses conditional rendering (not CSS-only hidden). If CSS-only, the element is in the DOM but `hidden` — use `data-testid` + `querySelector` + `classList` checks, OR switch the disclosure to conditional rendering (preferred for testability: `const [expanded, setExpanded] = useState(false)` toggled on `onFocus`/`onBlur`).
  - **Recommendation:** Use React `onFocus`/`onBlur` state in the PlanTile to drive conditional rendering of slot groups — this is testable and avoids CSS-only disclosure. Set `tabIndex`-aware: `isInteractive && !isPast` for the expanded affordance. Do NOT fire expand on past/paused/frozen tiles.

### 13-s1 regression baseline constraints

The 13-s1 spec (`apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts`) has assertions on the plan surface. Check if it queries for:
- `getByRole('button', { name: /confirm/i })` — this must still resolve after the StickyBottomBar swap.
- Plan tile article elements — must still be reachable.
- `AllergyClearedBadge` snapshot — must not regress.
- Focus-trap / keyboard nav — if the spec cycles through tabs, the StickyBottomBar being fixed changes the DOM order; verify Tab navigation still hits the StickyBottomBar buttons.

### Known constraints from the current branch

- `BriefCanvas.tsx` is already modified in this branch (s8/s9 work). Coordinate or rebase carefully: change the absolute minimum in that file. If in doubt, leave `PlanActionSection` in BriefCanvas for now and add a `// TODO 13-s7: replace with StickyBottomBar` comment — discuss with Menon before deferring.
- `13-s9` status is `in-progress` — `routePlanIntent` + `dispatchPlanIntent` backend work is in this branch. The frontend surface (s7) can land independently since it does not call these APIs yet.

---

## Definition of Done

- [x] `PlanPage.tsx` renders `StickyBottomBar` with `PrimaryButton` ("Confirm the week") + `TalkToLumiButton` in right slot. *(via `PlanActionBar` — see Dev Agent Record reconciliation)*
- [x] `PlanPage.tsx` main element has `pb-28`.
- [x] `BriefCanvas.tsx` uses `StickyBottomBar` (not in-flow `PlanActionSection`).
- [x] `PlanTile.tsx` reveals Main/Snack/Extra grouped rows on focus (not at rest).
- [x] `features/weekly-plan/` directory deleted; `_dev-weekly-plan.tsx` deleted; router registration cleaned up.
- [x] `PlanTile.test.tsx`: slot-disclosure tests added; all state tests green.
- [x] `PlanPage.test.tsx`: StickyBottomBar assertion; existing tests green.
- [x] `BriefCanvas.test.tsx`: no regressions.
- [x] `13-s1` e2e baseline green *(plan-surface assertions; one pre-existing 13-s6 onboarding-entry failure is out of scope — see Dev Agent Record)*.
- [x] `pnpm --filter @hivekitchen/web typecheck` clean.
- [x] `pnpm --filter @hivekitchen/web build` clean.
- [x] Lint clean on changed files *(2 pre-existing `eqeqeq` baseline errors in untouched `deriveDishLine` / `hard_fail` lines remain; all new code clean)*.

---

## Dev Agent Record

### Implementation Plan / Decisions

**Action-bar component structure (AC1 reconciliation).** The story offered two paths
(A1 "port PlanActionSection → StickyBottomBar, keep props interface" vs AC1
"PlanPage no longer renders PlanActionSection; delete preferred"). Resolved by
**deleting `PlanActionSection.tsx`** and introducing a single DRY wrapper
`features/plan/PlanActionBar.tsx` that renders the locked
`StickyBottomBar` + `PrimaryButton("Confirm the week")` + conditional
`SecondaryButton("Swap a day")` + `TalkToLumiButton`. Both consumers
(`PlanPage`, `BriefCanvas`) import it. This satisfies AC1 literally (PlanPage no
longer renders `PlanActionSection`), keeps the locked pattern in one place, and
keeps the BriefCanvas patch surgical (one import swap + one `pb` bump — no markup
churn near the in-progress s8/s9 work). The `SecondaryButton` renders only when
`onSwapDay` is provided (PlanPage: absent; BriefCanvas: present) — matches A1's
"leave onSwapDay wired but not rendered unless the prop is provided".

**Region role preservation.** The 13-s1 e2e baseline asserts
`role="region"` name **"Plan actions"** on the visible action bar (BriefCanvas is
rendered at `/app`). `StickyBottomBar` was a plain `<div>`, so a backward-compatible
optional `ariaLabel` prop was added: when set it applies `role="region"` +
`aria-label` to the fixed bar; omitted → unchanged for the other 6 consumers.
`PlanActionBar` passes `ariaLabel="Plan actions"`.

**Slot disclosure via conditional rendering (AC2 vs Dev Notes).** AC2 describes a
CSS `group-focus-visible:` pattern, but Dev Notes B2 explicitly recommends React
`onFocus`/`onBlur` state → conditional rendering because CSS-only `hidden` is
untestable in jsdom (no Tailwind stylesheet loaded) and `:focus-visible` doesn't
fire reliably under `userEvent.tab()`. Followed the Dev Notes recommendation:
`expanded` state toggled on `onFocus`/`onBlur`, gated on `isInteractive` (never
expands past/paused/frozen/swap/proposal tiles), rendered only when
`slotGroups.length > 1`. `deriveSlotGroups` mirrors `deriveDishLine`'s dedup +
cap-3 logic per slot (Main → Snack → Extra order).

**Contrast fix (AC5 — real regression caught by the axe gate).** Placing the
locked `TalkToLumiButton` (lumi-terracotta `#a15838`, DESIGN.md fixes this colour,
no overrides) on the action bar introduced a **new** WCAG-AA color-contrast
failure on the app surface: the fixed bar's translucent `bg-bg/80` let axe 4.12
composite the terracotta over the `surface-2` (`#dccfb5`) "Why this week" panel it
overlaps → 3.43:1 (< 4.5). Verified via TRUE-HEAD rebuild that the isolated
app-surface axe test passes at HEAD and fails with the terracotta button, so this
is a genuine regression, not pre-existing debt (the gate only allowlists
`amber-warm` nodes). axe treats **any** `bg-bg/*` alpha < 1 as see-through
(`/95` still composited to `#dccfb5`), so the fix makes the bar **fully opaque**
`bg-bg` (keeping `backdrop-blur-md` per DESIGN.md's "backdrop-blurred surface"
rule) → axe now resolves the button's bg to `--bg` `#f7f2e9` → 4.71:1 → passes.
This also fixes the same latent contrast issue on the Day-Detail bar (also a
`StickyBottomBar` with a terracotta Lumi action). Chosen over weakening the axe
allowlist (which would defeat the gate's purpose).

### Completion Notes

- **AC1/AC3** — `PlanActionBar` (StickyBottomBar + PrimaryButton "Confirm the week"
  + conditional SecondaryButton "Swap a day" + TalkToLumiButton) replaces
  `PlanActionSection` in both `PlanPage` (no props → confirm/talk undefined, no
  swap button) and `BriefCanvas` (keeps the existing `onSwapDay` wiring). `pb-0`→
  `pb-28` on PlanPage `<main>`; `pb-24`→`pb-28` on BriefCanvas's brief-render
  `<main>`. No new confirmation logic added (deferred to s10, per AC3).
- **AC2** — Focus-only Main/Snack/Extra disclosure on `PlanTile`; flat dish line
  stays visible at rest; all pre-existing tile-state affordances untouched.
- **AC4** — `features/weekly-plan/` (6 files), `routes/_dev-weekly-plan.tsx`, and
  the `app.tsx` import + `/_dev-weekly-plan` pathname registration all deleted.
- **AC5** — Unit: PlanTile 30 + PlanPage 12 + BriefCanvas 45 = **87 pass**
  (5 new slot-disclosure tests, 1 new StickyBottomBar region test). typecheck +
  build + lint clean (new code). e2e (isolated, per the SW-bypass known-issue):
  13-s1 plan-surface assertions all green — AC1.2 five-tiles, AC1.3 confirm-week,
  AC2 app-surface axe + Lumi-sheet axe, AC5 AllergyClearedBadge + paused.
- **Out of scope / not caused by this slice:** the 13-s1 `AC1.1 continuity promise`
  onboarding-entry e2e fails (asserts "start by talking, finish by typing") —
  pre-existing 13-s6 baseline drift (13-s6 still in `review`), untouched here.
  Full-suite web `vitest` shows 7 pre-existing failures in `useLumiVoiceSession.test.ts`
  + `sse.test.ts` (in-progress s8/s9 branch work) — confirmed identical at HEAD.

### File List

**Added**
- `apps/web/src/features/plan/PlanActionBar.tsx`

**Modified**
- `apps/web/src/components/StickyBottomBar.tsx` (optional `ariaLabel`→`role="region"`; `bg-bg/80`→`bg-bg` for AA contrast)
- `apps/web/src/features/plan/PlanPage.tsx` (import swap; `pb-0`→`pb-28`; render `PlanActionBar` after footer)
- `apps/web/src/features/plan/BriefCanvas.tsx` (import swap; `pb-24`→`pb-28`; render `PlanActionBar`)
- `apps/web/src/features/plan/PlanTile.tsx` (`deriveSlotGroups` + focus `expanded` state + slot-breakdown render)
- `apps/web/src/app.tsx` (removed `DevWeeklyPlanPage` import + `/_dev-weekly-plan` registration)
- `apps/web/src/features/plan/PlanTile.test.tsx` (slot-disclosure describe block, 5 tests)
- `apps/web/src/features/plan/PlanPage.test.tsx` (`within` import + action-surface region test)

**Deleted**
- `apps/web/src/features/plan/PlanActionSection.tsx`
- `apps/web/src/routes/_dev-weekly-plan.tsx`
- `apps/web/src/features/weekly-plan/` (ActionRow, ChildChip, PlanGrid, PlanTile, WhyThisWeekPanel, data/mockData)

### Review Findings

- [x] [Review][Decision] D1 — Out-of-scope BriefCanvas additions (13-s4 piggyback): lumi_note→standalone `<p>`, "Lumi is drafting…" loading state, `openPanel()→summon()` — **resolved: keep as-is** (2026-07-02)
- [x] [Review][Patch] P1 — Focus bubbling: `onBlur` now checks `relatedTarget` containment + resets `isPointerFocusRef`. [PlanTile.tsx] ✅
- [x] [Review][Patch] P2 — Case-sensitive dedup in `deriveSlotGroups`: replaced `new Set` with case-insensitive seen-set; first-seen casing preserved. [PlanTile.tsx] ✅
- [x] [Review][Patch] P3 — `expanded` persisted when `isInteractive` → false mid-focus: render now gated on `expanded && isInteractive && slotGroups.length > 1`. [PlanTile.tsx] ✅
- [x] [Review][Patch] P4 — Tab order: `<PlanActionBar />` moved before `<PlanPageFooter />` in DOM. [PlanPage.tsx] ✅
- [x] [Review][Patch] P5 — Mouse-click expansion: `isPointerFocusRef` + `onPointerDown` added; `onFocus` suppresses expansion on pointer-originated focus. [PlanTile.tsx] ✅
- [x] [Review][Defer] W1 — `onConfirm` and `onTalkToLumi` are unwired dead buttons on both render sites — AC3 explicitly acknowledges and defers ("if PlanPage did not yet wire onConfirm, leave it as undefined for now — match the existing behavior exactly. Do NOT add new confirmation logic in this slice (that belongs to s10)"). Pre-existing; not a regression. [PlanActionBar.tsx, PlanPage.tsx, BriefCanvas.tsx] — deferred, pre-existing
- [x] [Review][Defer] W2 — `pb-28` is a hardcoded magic number coupling `<main>` to the bar's fixed height; if the bar wraps on mobile the clearance breaks. StickyBottomBar already documents this requirement as a caller responsibility — pattern is pre-existing across all consumers. [PlanPage.tsx, BriefCanvas.tsx] — deferred, pre-existing

### Change Log

- 2026-07-02 — Implemented 13-s7 (dev-story, claude-opus-4-8[1m]): converged the live
  plan action surface onto the locked StickyBottomBar via new `PlanActionBar`;
  deleted `PlanActionSection` + `features/weekly-plan` mock infra; added focus-only
  Main/Snack/Extra slot disclosure to `PlanTile`; made `StickyBottomBar` opaque to
  clear WCAG-AA contrast for the terracotta Talk-to-Lumi action; 87 unit tests +
  isolated 13-s1 plan-surface e2e green; typecheck/build/lint clean.
