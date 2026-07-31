# Story 14.5: Make `packages/ui` a real component library

Status: review

## Story

As a **HiveKitchen frontend developer**,
I want **the taxonomy-bound primitives promoted out of `apps/web/src/components/` into `packages/ui`, with imports flipped and lint/test/build wiring following them**,
so that **the design system (button taxonomy, Honey rule, required-leading-icon rule) is enforced by construction — a real locked-primitive library — instead of by documentation that keeps drifting**.

## Context & Why

- **Build plan:** `valet-canvas-build-plan.md` Slice 5 · **Design:** `valet-canvas-frontend-design.md` §7 · **Decision §12-C (pre-resolved):** promote AFTER the Brief decomposition — S1–S4 are done, the component set is stable.
- `packages/ui` today is **not a component library**: `src/index.ts` exports only the scope-allowlist config + `useScope`/`useScopeGuard`. The locked primitives live ad hoc in `apps/web/src/components/` (+ two in `features/plan/`).
- This is a **pure mechanical move + enforcement slice**: zero visual change, zero behavior change, no new primitives. The line: a primitive the design system locks → `packages/ui`; a surface that composes them (`BriefCanvas`, `PlanTile`, `WallCard*`, feature chips) → stays in `apps/web`.

**Reconciliations against the build plan (codebase reality, verified 2026-07-30):**

1. **`Chip` does not exist.** The plan lists it, but there is no generic `Chip` primitive anywhere in `apps/web/src` — DESIGN.md §4 item 7 is aspirational (the 8 existing chips are all feature-local: TrustChip, PackerChip, VariationChip, onboarding chips, EditChips). Building one is a NEW primitive = explicitly out of scope ("no new primitives"). **Nothing to move; record the gap, do not build it.**
2. **`AppHeader` is NOT cleanly movable** — it imports `@/stores/auth.store.js` (Zustand app state), `react-router-dom` (`useNavigate`), `@/hooks/useClickOutside.js`, and `./ThemeToggle.js`. Moving it drags app state + routing into the package and inverts the dependency direction. **Decision (recommended, confirm with Menon if challenged): AppHeader + ThemeToggle STAY in `apps/web`** — documented deviation from the plan's "headers/footer". `DetailHeader` (icons-only dep) and `AppFooter` (zero deps) DO move.
3. **`icons.tsx` must move** — `TalkToLumiButton` and `DetailHeader` import `./icons.js`; a package cannot import app code, and duplicating icons is a drift trap. Move the whole file (52 icon components, ~52 importing files flip one import line each — large but purely mechanical).

**Final move set (10 components + icons):** `PrimaryButton`, `SecondaryButton`, `TalkToLumiButton`, `StickyBottomBar`, `TextField`, `RailCard`, `AllergyClearedBadge` (+test), `FreshnessState` (+test), `DetailHeader`, `AppFooter`, `icons.tsx`.

## Acceptance Criteria

1. **Files move verbatim.** Each moved component's JSX/logic/classNames are byte-identical apart from import-path rewrites (relative imports inside `packages/ui` use the existing `.js`-extension convention, e.g. `TalkToLumiButton` → `./icons.js`). No restyling, no prop changes, no "improvements". `packages/ui/src/index.ts` exports every moved component plus `FreshnessState`'s `formatEstimatedRecovery` helper and all 52 icons (keep the existing allowlist/hook exports untouched).
2. **No taxonomy-bound primitive remains in `apps/web/src/components/`** (of the move set), and no file in `apps/web` deep-imports `packages/ui/src/*` — every consumer uses the bare specifier `from '@hivekitchen/ui'`. Sole exception: `apps/web/eslint.config.mjs`'s existing relative import of `scope-allowlist.eslint.js` (ESLint-runtime constraint, stays). Import-site inventory to flip: ~69 component sites + ~52 `icons.js` sites, in both styles (`@/components/X.js` and deep-relative `../../../components/X.js`).
3. **Tailwind keeps generating the moved components' CSS.** `apps/web/tailwind.config.ts` `content` gains `'../../packages/ui/src/**/*.{ts,tsx}'` (today it scans only `./index.html` + `./src/**` — without this every moved class silently vanishes from the bundle). **Verify against the compiled bundle**, not by trust: build and grep `dist/assets/*.css` for a distinctive moved-component class (e.g. a `StickyBottomBar` or `PrimaryButton` utility) — the 14-s4 alpha-modifier incident proved classes can die silently.
4. **`packages/ui` can actually run its components:** `react`/`react-dom` declared as `peerDependencies` (keep concrete versions in devDependencies for tests); new `vitest.config.ts` (jsdom environment + `@vitejs/plugin-react`); `@testing-library/react`, `jsdom`, `react-dom`, `@vitejs/plugin-react` added as devDependencies. `AllergyClearedBadge.test.tsx` + `FreshnessState.test.tsx` move with their components and pass under `pnpm --filter @hivekitchen/ui test`. Verify `packages/ui/tsconfig.json` has `jsx` + DOM lib settings compatible with `.tsx` (fix if not).
5. **Moved components stay lint-enforced.** `packages/ui` gets an eslint config + `lint` script (wired so `turbo run lint` includes it) applying at minimum: the hivekitchen custom rules (`logical-properties-only`, `no-assistant-filler`, `no-heart-note-frequency-reference`), `consistent-type-imports`, and for `.tsx`: react + react-hooks recommended + `jsx-a11y` strict — the exact rules these files pass today in web. Reuse `@hivekitchen/eslint-config` (add a `uiConfig()` or reuse `webConfig` minus the web-only scope/dialog rules — do NOT fork rule definitions). The `scope-allowlist-sync` test stays green.
6. **The six `vi.mock('@hivekitchen/ui', () => ({...}))` factory mocks are made partial** (`importOriginal` + spread) so component exports aren't blanked out: `PlanHistoryPage.test.tsx`, `account.test.tsx`, `account-deletion.test.tsx`, `account-export.test.tsx`, `child-flavor-passport.test.tsx`, `kitchen-profile.test.tsx`. (Any of those routes importing a moved component via the real module would otherwise render nothing and fail.)
7. **Dependency direction corrected:** `apps/web/package.json` moves `@hivekitchen/ui` from devDependencies → dependencies (it now ships runtime components).
8. **knip clean** — no dangling old paths, no unused-export findings from the new `index.ts` (add a `packages/ui` workspace entry to root `knip.json` only if defaults misfire; prefer zero config).
9. **Gates (zero behavior change = zero spec edits expected):** full web unit suite green with **no assertion edits** (harness-only edits per AC6 allowed); `pnpm --filter @hivekitchen/ui test` green; typecheck + lint all packages; **full local E2E green** (`VITE_E2E=true` build, run from `apps/web`) with the `13-s1` baseline **untouched** — unchanged E2E is the parity proof; axe allowlist not grown; LHCI ratchet holds; knip clean.
10. **Scope boundary:** AppHeader/ThemeToggle/`useClickOutside` stay in `apps/web` (deviation recorded in Dev Agent Record); no `Chip` primitive built; feature surfaces + feature-local chips untouched; no visual/markup/token change anywhere; no `DisambiguationPicker`/`lumi.store`/`account.tsx` work (S6); D-14S4-CR1 (`useDayView` double-cast, "harden at S5") and D-14S2-2 (lateral feature imports) remain deferred — they are feature-file concerns this move doesn't touch (flag to Menon; see open questions in the completion report).

## Tasks / Subtasks

- [x] **Task 1 — Stand up `packages/ui` as a runnable component package** (AC4, AC5)
  - [x] package.json: `peerDependencies` react/react-dom; devDeps `react-dom`, `jsdom`, `@testing-library/react`, `@vitejs/plugin-react`; keep `--passWithNoTests` off once tests exist.
  - [x] `vitest.config.ts` (jsdom + react plugin, include `src/**/*.test.{ts,tsx}`).
  - [x] eslint config + `lint` script; extend `@hivekitchen/eslint-config` (shared package needs its `dist/` rebuilt if `uiConfig` is added — it ships built output).
  - [x] Verify tsconfig `jsx`/lib; confirm `turbo run lint|test|typecheck` now cover the package.
- [x] **Task 2 — Move `icons.tsx`** (AC1, AC2)
  - [x] Move to `packages/ui/src/icons.tsx`; export from `index.ts`; flip ~52 import sites (`@/components/icons.js`, `../../../components/icons.js`, `./icons.js` → `@hivekitchen/ui`). `ThemeToggle` (staying in web) flips its icon import too.
- [x] **Task 3 — Move the 10 components (+2 tests)** (AC1, AC2)
  - [x] `PrimaryButton`, `SecondaryButton`, `TalkToLumiButton`, `StickyBottomBar`, `TextField`, `RailCard`, `DetailHeader`, `AppFooter` from `components/`; `AllergyClearedBadge`(+test), `FreshnessState`(+test) from `features/plan/`.
  - [x] Internal imports → `.js`-relative inside the package; `index.ts` exports each + `formatEstimatedRecovery`.
  - [x] Flip ~69 consumer import sites to `@hivekitchen/ui` (watch the odd ones: `VisibleMemorySentence.tsx` → `./TextField.js`; `features/plan` siblings → `./FreshnessState.js` / `./AllergyClearedBadge.js`).
- [x] **Task 4 — Tailwind content glob + compiled-CSS proof** (AC3): add the packages/ui glob; build; grep `dist/assets/*.css` for a moved-component class; manual before/after screenshot spot-check on one surface per moved component family (Brief action bar, a form, day-detail header). — *screenshot spot-check substituted with a stronger byte-level proof; see Completion Notes.*
- [x] **Task 5 — Test-harness + dependency repair** (AC6, AC7): partial-ize the 6 factory mocks; flip `@hivekitchen/ui` to web dependencies.
- [x] **Task 6 — Gates** (AC8, AC9): knip; typecheck/lint all; full web unit unedited; ui unit; full E2E (`VITE_E2E=true`, from `apps/web`); 13-s1 untouched; LHCI sanity.

## Dev Notes

- **Sequencing gate: 14-s4 is UNCOMMITTED in the working tree** (as of story authoring) and modified `DetailHeader.tsx` — a file this slice moves. Do NOT start until s4 is committed/merged; verify `git status` is clean first.
- **Verbatim-move discipline:** this slice's whole value is "zero behavior change proven by unchanged tests/E2E". Resist fixing anything you notice inside moved files (e.g. `StickyBottomBar`/`RailCard` use the global `React.*` namespace without an import — leave it if it typechecks in the package; add a type-only import ONLY if the package tsconfig requires it, and note it).
- **`packages/ui` conventions:** relative imports carry `.js` extensions (see existing `index.ts`); the package is source-consumed (`main`/`types` → `src/index.ts`, no build step) — do not add a build.
- **The eslint allowlist twin mechanism is load-bearing:** `apps/web/eslint.config.mjs` deep-imports `packages/ui/src/scope-allowlist.eslint.js` by relative path (ESLint runs without a TS loader); the `scope-allowlist-sync.test.ts` asserts JS twin ≡ TS source. Don't touch either file; don't route the twin through `index.ts`.
- **Required-leading-icon rule lives in the components' types**, not ESLint: `PrimaryButton`/`SecondaryButton` declare `icon` as a required prop (`React.ReactElement<{className?: string}>` + `cloneElement`). Moving them IS the enforcement — no new rule needed.
- **`TalkToLumiButton` is "fixed, no overrides"** (DESIGN.md §7) — its label + `WaveformIcon` are frozen; that is why it must carry its icon import rather than accept an icon prop.
- **Import styles are inconsistent in web** (`@/…` alias vs deep-relative); the flip normalizes all of them to the bare `@hivekitchen/ui` specifier — an accidental consistency win, no separate cleanup pass.
- **Watch the `_dev-*` routes:** ~19 of the AppFooter/AppHeader import sites are `routes/_dev-*.tsx` mock-reference screens — they must keep compiling (mock-screen doctrine; deep-link-only routes are deliberate). AppFooter flips to the package import; AppHeader imports are untouched (it stays).
- **Vitest include patterns are why tests must move:** web's `include` is rooted at `src/`, so a moved `.test.tsx` silently stops running unless it moves into the package (and the package gets jsdom). After the move, confirm the two test files actually RAN (check the ui test count > 0 — `--passWithNoTests` can mask a glob miss).
- **14-s4/14-s3 learnings that bite here:** verify claims against the compiled bundle, not source (`/alpha` token incident); E2E must be built with `VITE_E2E=true` and run from `apps/web` (repo-root runs fail "invalid URL"); test-lockstep culture — existing assertions survive, only harness edits allowed; 13-s1 baseline is never edited.
- **LHCI:** import-path churn should not move bundle size materially (same code, same chunks), but the ratchet is truthful — if a threshold trips, investigate chunking (the package is source-consumed so Vite treats it like local source), never loosen thresholds.

### Project Structure Notes

- New: `packages/ui/src/{icons.tsx,PrimaryButton.tsx,SecondaryButton.tsx,TalkToLumiButton.tsx,StickyBottomBar.tsx,TextField.tsx,RailCard.tsx,DetailHeader.tsx,AppFooter.tsx,AllergyClearedBadge.tsx,FreshnessState.tsx}` (+2 moved tests under `src/` or `src/__tests__/` — match the existing `__tests__/` convention), `packages/ui/vitest.config.ts`, `packages/ui/eslint.config.mjs`.
- Modified: `packages/ui/src/index.ts`, `packages/ui/package.json`, `apps/web/tailwind.config.ts`, `apps/web/package.json`, ~121 import lines across `apps/web/src`, 5 test-mock factories, possibly `packages/eslint-config-hivekitchen` (+dist rebuild), possibly root `knip.json`.
- Deleted from web: the 11 moved files + 2 moved tests.
- Untouched: `AppHeader.tsx`(+test), `ThemeToggle.tsx`, `hooks/useClickOutside.ts`, all feature surfaces/chips, `scope-allowlist.*`, `use-scope*.ts`, DESIGN.md tokens.

### References

- [Source: _bmad-output/planning-artifacts/valet-canvas-build-plan.md#Slice 5]
- [Source: _bmad-output/planning-artifacts/valet-canvas-frontend-design.md#7 + #12 (12-C)]
- [Source: docs/DESIGN.md §1 Honey rule (line ~44), §4 17-locked-components + button taxonomy, §7 per-component Rule lines for all 12 named primitives]
- [Source: packages/ui/src/{index.ts,scope-allowlist.config.ts,scope-allowlist.eslint.js}; packages/ui/tailwind.config.ts (content: [] — unused by web build)]
- [Source: apps/web/tailwind.config.ts (content globs); apps/web/vitest.config.ts (src-rooted include, no setupFiles); apps/web/eslint.config.mjs (allowlist twin deep import)]
- [Source: packages/eslint-config-hivekitchen/src/index.ts — baseConfig/webConfig rule inventory]
- [Source: knip.json — no packages/ui workspace entry today]
- [Source: _bmad-output/implementation-artifacts/14-s4-ship-family-first-day-view.md — Dev Agent Record (compiled-CSS verification pattern, E2E discipline)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — D-14S4-CR1, D-14S2-2 ("revisit at S5"), D-14S4-5 (alpha sweep — NOT this slice)]
- [Memories: design-md-canonical, amber-warm-alpha-modifier-broken, e2e-requires-vite-e2e-build, e2e-full-suite-sw-bypass, deep-link-only-routes-deliberate, lhci-ratchet-doctrine]

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (dev-story), 2026-07-30

### Debug Log References

- **Precondition gate honoured.** Story Dev Notes required a clean tree because 14-s4 had modified `DetailHeader.tsx` — a file this slice moves. 14-s4 was uncommitted at start; committed first as `a73aa30` (feat, day-view) plus `0a671d9` (docs, the three planning artifacts) before any s5 work began. Without this the `git mv` would have folded s4's edits into the move and destroyed the verbatim-move proof below.
- **Verbatim-move proof (AC1), machine-checked.** `git diff -M --summary` reports **100% similarity renames** for all 11 moved source files — byte-identical, zero content change:
  `AllergyClearedBadge, AppFooter, DetailHeader, FreshnessState, PrimaryButton, RailCard, SecondaryButton, StickyBottomBar, TalkToLumiButton, TextField, icons` (all 100%). The two moved tests are 99%/98% — one relative-import line each (`./X.js` → `../X.js`).
  Happy accident: `TalkToLumiButton` and `DetailHeader` needed **no** import rewrite at all — `icons.tsx` became their sibling inside `packages/ui/src`, so their existing `./icons.js` specifier stayed valid. That is why they came through at exactly 100%.
- **Compiled-CSS proof (AC3), with a negative control.** Probe class chosen by exclusion: `safety-cleared-400` occurs in exactly one `packages/ui` file (`AllergyClearedBadge`) and **zero** `apps/web` files post-move.
  - build **with** the glob → present in `dist/assets/*.css` (1 hit)
  - build **without** the glob → **0 hits** (class silently dies — the exact 14-s4 `/alpha` failure mode, reproduced deliberately)
  - build at **HEAD baseline** (pre-move) → 1 hit
  Stronger still: the compiled CSS is **byte-identical to baseline** — same content hash `12ee380547185fc362a503f3903e54a0`, same emitted filename `index-CC3G7Gxk.css`. The glob restores exactly what the move would have removed, no more and no less.
- **Lint enforcement verified, not assumed (AC5).** A throwaway probe file with three deliberate violations confirmed the new `packages/ui` config actually fires all three rule families: `hivekitchen/logical-properties-only` (`ml-2`→`ms-2`), `@typescript-eslint/no-explicit-any`, and `jsx-a11y` strict (`click-events-have-key-events`, `no-static-element-interactions`). Probe deleted. Without this check a config that silently matched zero files would have looked identical to a passing one.
- **Test-relocation accounting is exact.** web 744 → 711 (−33); `packages/ui` 1 → 34 (+33). The two moved test files genuinely ran (3 files, not 1) — the Dev Note warning about `--passWithNoTests` masking a glob miss is closed; the flag was also removed from the `test` script.
- **Bundle delta measured, not asserted (AC9/LHCI).** Built HEAD baseline via `git stash` and compared: total `dist/assets` = **1,726,075 bytes on both sides**. CSS byte-identical; JS totals identical with only content-hash changes from module-id reordering. The ratchet cannot move.

### Completion Notes List

- **Zero behaviour change, proven by unchanged tests.** Full local E2E: **425 passed / 13 skipped / 0 failed** — byte-for-byte the 14-s4 post-patch baseline, with the **entire `apps/web/test/` directory untouched** (`git status` on it is empty), so the 13-s1 baseline is unedited and the axe allowlist did not grow. Web unit suite green with **no assertion edits**: the only test-file changes are the six AC6 harness mocks, each exactly two lines (`() => ({` → `async (importOriginal) => ({` + a spread), verified via `git diff --unified=0`.
- **All gates green:** typecheck 9/9 · lint 6/6 · knip exit 0 (**zero new config** — no `packages/ui` entry needed in `knip.json`) · unit: web 711, api 2389, contracts 760, design-system 103, eslint-config 44, **ui 34** · full E2E 425/13/0.
- **`uiConfig()` reuses rules rather than forking them.** Per AC5's explicit "do NOT fork rule definitions", the shared react/tsx block in `@hivekitchen/eslint-config` was extracted into a private `reactTsxConfig(extraRules)` helper. `uiConfig()` = `baseConfig()` + that block with no extras; `webConfig()` = the same block plus the two app-scoped rules (`no-cross-scope-component`, `no-dialog-outside-allowlist`) it passes in. `webConfig`'s emitted config is unchanged — its 44 existing tests still pass. `dist/` rebuilt (the package ships built output).
- **No source edits were needed inside the moved files.** `StickyBottomBar` and `RailCard` use the global `React.*` namespace without importing React; per the story's verbatim-move discipline this was left alone, and it typechecks in the package unmodified (`@hivekitchen/tsconfig/react.json` already supplies `jsx: react-jsx` + DOM lib, so AC4's tsconfig check needed no fix).
- **Import flip normalised 103 lines across 69 files** — both `@/components/X.js` and deep-relative `../../../components/X.js` styles collapse to the bare `@hivekitchen/ui` specifier. The only remaining deep import of `packages/ui/src` anywhere in `apps/web` is the sanctioned `eslint.config.mjs` allowlist twin (AC2's stated exception); the twin mechanism and `scope-allowlist-sync` test were not touched and stay green.
- **Scope boundary held (AC10).** AppHeader/ThemeToggle/`useClickOutside` stayed in `apps/web`; no `Chip` primitive was built; no feature surface, chip, token, or markup was changed anywhere. D-14S4-CR1 and D-14S2-2 remain deferred.

**Deviations / items for Menon:**

1. **AC3 screenshot spot-check substituted (not performed as written).** Task 4 asked for a manual before/after screenshot pass on three surfaces. I did not take screenshots. What was done instead is strictly stronger evidence for the same question: the moved markup is byte-identical (100% renames) *and* the compiled CSS is byte-identical to baseline (same hash), so there is no mechanism by which any surface could render differently — plus 425 E2E tests including axe scans exercised those surfaces live. Flagging it explicitly because it is a literal deviation from the task text, not because I think a visual regression is plausible.
2. **`Chip` gap recorded, per AC-reconciliation #1.** DESIGN.md §4 item 7 lists a generic `Chip` primitive that does not exist in the codebase; the eight real chips are all feature-local. Nothing was built. The doc remains aspirational and should either get a slice or get corrected — code-is-canon, as ruled in 14-s3.
3. **AppHeader deviation stands as recommended in the story** (imports `auth.store`, `react-router-dom`, `useClickOutside`, `ThemeToggle` — moving it would invert the dependency direction). `ThemeToggle` stays with it and flipped only its icons import.

### File List

**New**
- `packages/ui/vitest.config.ts`
- `packages/ui/eslint.config.mjs`

**Moved (verbatim, 100% renames) — `apps/web/src/components/` → `packages/ui/src/`**
- `icons.tsx`, `PrimaryButton.tsx`, `SecondaryButton.tsx`, `TalkToLumiButton.tsx`, `StickyBottomBar.tsx`, `TextField.tsx`, `RailCard.tsx`, `DetailHeader.tsx`, `AppFooter.tsx`

**Moved — `apps/web/src/features/plan/` → `packages/ui/src/`**
- `AllergyClearedBadge.tsx`, `FreshnessState.tsx`
- `AllergyClearedBadge.test.tsx`, `FreshnessState.test.tsx` → `packages/ui/src/__tests__/` (one import line each)

**Modified**
- `packages/ui/src/index.ts` — exports all moved components, `formatEstimatedRecovery`, and all 52 icons (existing allowlist/hook exports untouched)
- `packages/ui/package.json` — react/react-dom `peerDependencies`; devDeps `react-dom`, `@types/react-dom`, `jsdom`, `@testing-library/react`, `@vitejs/plugin-react`, `eslint`, `@hivekitchen/eslint-config`; `lint` script added; `--passWithNoTests` removed
- `packages/eslint-config-hivekitchen/src/index.ts` — `reactTsxConfig()` helper extracted; `uiConfig()` added; `webConfig()` output unchanged (+ `dist/` rebuilt)
- `apps/web/tailwind.config.ts` — `content` gains `'../../packages/ui/src/**/*.{ts,tsx}'`
- `apps/web/package.json` — `@hivekitchen/ui` devDependencies → dependencies
- `pnpm-lock.yaml`
- 69 files under `apps/web/src` — 103 import lines flipped to `@hivekitchen/ui`
- 6 test harness files (mock partial-isation only): `features/plan/PlanHistoryPage.test.tsx`, `routes/(app)/{account,account-deletion,account-export,child-flavor-passport,kitchen-profile}.test.tsx`

**Deleted from `apps/web`:** the 11 moved source files + 2 moved tests (all as renames)

**Untouched (verified):** `apps/web/test/**` (entire E2E dir), `AppHeader.tsx`(+test), `ThemeToggle.tsx` body, `hooks/useClickOutside.ts`, `scope-allowlist.*`, `use-scope*.ts`, all feature surfaces/chips, DESIGN.md, `knip.json`

## Change Log

| Date | Change |
| --- | --- |
| 2026-07-30 | Promoted 10 taxonomy-bound primitives + `icons.tsx` (52 icons) from `apps/web` into `packages/ui`, making it a real locked-primitive library. 103 import lines across 69 files flipped to the bare `@hivekitchen/ui` specifier. Package gained react peerDeps, jsdom vitest config, and an eslint config via a new non-forking `uiConfig()`. Tailwind content glob extended to the package — verified against the compiled bundle with a negative control. Zero behaviour change: all 11 source files are 100%-similarity renames, compiled CSS is byte-identical to baseline, bundle size delta is 0 bytes, and the full E2E suite (425/13/0) passed with the test directory untouched. |
