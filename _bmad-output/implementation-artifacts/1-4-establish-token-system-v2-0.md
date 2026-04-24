# Story 1.4: Establish token system v2.0

Status: ready-for-dev

## Story

As a developer,
I want the v2.0 token system committed to `packages/design-system/tokens/` and exposed as Tailwind CSS custom properties,
So that scope-allowlist enforcement (Story 1.5) and component implementations (Epic 2+) can reference semantic tokens like `bg-sacred`, `text-lumi-terracotta`, `bg-safety-cleared/8` instead of raw color values, with dark-mode-first contrast and Lunch-Link-scope pre-reader typography baked into the foundation.

## Acceptance Criteria

**Given** Story 1.1 is complete,
**When** Story 1.4 is complete,
**Then** `packages/design-system/tokens/colors.css` defines:
- `--sacred-plum-{50,100,200,300,400,500,600,700,800,900}`
- `--lumi-terracotta-{50..900}` + `--lumi-terracotta-warmed`
- `--safety-cleared-teal-{50..900}`
- `--memory-provenance-{50..900}`
- `--honey-amber-{50..900}` (recognition moments only — never button hover)
- `--foliage-{50..900}` (focus indicator + freshness signal)
- `--warm-neutral-{50..900}` (base palette — warm off-white `#FAF7F2` through warm charcoal `#2A2724`, never `#FFFFFF`/`#000000`)
- `--focus-indicator-color` (foliage-500), `--focus-indicator-width` (2px), `--focus-indicator-offset` (2px)
- Dark-mode variants under `:root[data-theme="dark"]` for every pair, per UX spec's dark-mode-first rule.

**And** `packages/design-system/tokens/typography.css` defines:
- `@font-face` for Instrument Serif (headlines, Heart Notes, cultural recognition) with `font-display: swap` and `unicode-range` for Latin.
- `@font-face` for Inter (body, UI, buttons, forms) with `font-display: swap`.
- Custom properties: `--font-serif` (Instrument Serif stack), `--font-sans` (Inter stack).
- Self-hosted woff2 only — no Google Fonts CDN, no `https://fonts.googleapis.com`, no `https://fonts.gstatic.com`.

**And** `packages/design-system/tokens/motion.css` defines:
- `--sacred-ease` cubic-bezier (`cubic-bezier(0.4, 0, 0.2, 1)` unless UX spec pins a different curve — see **Exact motion.css** in Dev Notes).
- Motion duration tokens (`--motion-fast: 120ms`, `--motion-medium: 220ms`, `--motion-slow: 360ms`).
- A `@media (prefers-reduced-motion: reduce)` block that collapses all durations to `0ms` except comprehension-critical transitions capped at `150ms` with `linear` easing (per UX spec §Motion & Animation).

**And** all three apps' `tailwind.config.ts` import the token CSS and expose Tailwind utilities (`bg-sacred-500`, `text-lumi-terracotta`, `ring-focus-indicator`, `font-serif`, `font-sans`, `transition-[duration:var(--motion-medium)]-[timing-function:var(--sacred-ease)]`, etc.).

**And** Inter + Instrument Serif self-hosted woff2 files exist at `apps/web/public/fonts/` AND `apps/marketing/public/fonts/` (each app self-contained — no cross-app font fetching).

**And** a smoke-test page at `apps/web/src/routes/_dev-tokens.tsx` (gated by `import.meta.env.DEV` — Vite's equivalent of `NODE_ENV !== 'production'`) renders every token group for visual review. The page must be reachable in `pnpm --filter @hivekitchen/web dev` and return 404/redirect in production builds.

**And** `pnpm typecheck` and `pnpm test` pass across the full workspace — no regression to Story 1.3's green state (6/6 typecheck, 74/74 contract tests).

**And** `pnpm build` passes for `@hivekitchen/web`, `@hivekitchen/marketing`, and `@hivekitchen/api` — the design-system package does NOT introduce a build step that breaks the existing build pipeline.

### AC → Task mapping (Definition of Done)

| AC | Satisfied by |
|---|---|
| `packages/design-system/` promoted to workspace package | Task 2 |
| `colors.css` with 8 token scales + focus-indicator | Task 3 |
| `typography.css` with Instrument Serif + Inter @font-face | Task 4 |
| `motion.css` with `sacred-ease` + reduced-motion fallback | Task 5 |
| Tailwind preset TypeScript export (`tokenPresets`) | Task 6 |
| Self-hosted woff2 in `apps/web/public/fonts/` and `apps/marketing/public/fonts/` | Task 7 |
| `apps/web/tailwind.config.ts` wires design-system preset | Task 8 |
| `apps/marketing/tailwind.config.ts` wires design-system preset + Astro Tailwind integration | Task 9 |
| `packages/ui/tailwind.config.ts` switches from relative import to `@hivekitchen/design-system` | Task 10 |
| `_dev-tokens.tsx` smoke-test page reachable in dev only | Task 11 |
| Unit tests on `tokenPresets` structure + font-file existence | Task 12 |
| `pnpm typecheck`, `pnpm test`, `pnpm build` green | Task 13 |

## Tasks / Subtasks

- [ ] **Task 1 — Pre-flight verification** (no AC)
  - [ ] Confirm Story 1.1 and Story 1.2 are `done` and Story 1.3 is `done` in `_bmad-output/implementation-artifacts/sprint-status.yaml`.
  - [ ] Confirm current state of `packages/design-system/tokens/index.ts` — Story 1.1 left a placeholder `export const tokenPresets = {};`. This story replaces it.
  - [ ] Confirm `packages/ui/tailwind.config.ts` has a `TODO(story-1.4)` comment referencing the relative import of `../design-system/tokens/index.js` — this story resolves that TODO.
  - [ ] Confirm `apps/web/src/styles/globals.css` currently contains only `@tailwind base; @tailwind components; @tailwind utilities;` — this story adds a `@import` for the token CSS files.
  - [ ] Confirm `apps/marketing/tailwind.config.ts` is currently `export default {};` (Astro has no Tailwind integration yet) — this story adds `@astrojs/tailwind` integration.
  - [ ] Confirm fonts directories `apps/web/public/fonts/` and `apps/marketing/public/fonts/` do NOT yet exist — this story creates them.
  - [ ] Confirm `packages/design-system/` has NO `package.json` (Story 1.1 left it as a stub directory) — this story creates it.

- [ ] **Task 2 — Promote `packages/design-system/` to a full workspace package** (AC: package exports)
  - [ ] Create `packages/design-system/package.json` per **Exact packages/design-system/package.json** in Dev Notes. Name: `@hivekitchen/design-system`. Version: `0.0.0`. Private. Type: `module`. `main` / `types` → `./src/index.ts`.
  - [ ] Create `packages/design-system/tsconfig.json` extending `@hivekitchen/tsconfig/base.json`.
  - [ ] Create `packages/design-system/src/index.ts` that re-exports `tokenPresets` from `./tokens/index.ts` and re-exports CSS file URL constants (used for documentation; consumers `@import` the CSS directly).
  - [ ] Move the existing stub `packages/design-system/tokens/index.ts` to `packages/design-system/src/tokens/index.ts` (move, not copy — the stub at `packages/design-system/tokens/index.ts` must be removed so the old relative import in `packages/ui/tailwind.config.ts` is guaranteed to break until Task 10 re-wires it).
  - [ ] Add `@hivekitchen/design-system` as a `workspace:*` dependency to `packages/ui/package.json`, `apps/web/package.json`, and `apps/marketing/package.json`.
  - [ ] Run `pnpm install` from workspace root to link the new workspace package.
  - [ ] Verify via `pnpm -r list --depth -1` that `@hivekitchen/design-system` resolves from `packages/design-system` in all three consumers.

- [ ] **Task 3 — Author `packages/design-system/tokens/colors.css`** (AC: colors.css)
  - [ ] Create `packages/design-system/tokens/colors.css` per **Exact colors.css** in Dev Notes.
  - [ ] Every token group has 10 stops (50/100/200/300/400/500/600/700/800/900) defined on `:root`.
  - [ ] `--lumi-terracotta-warmed` exists as a single named variant for Lumi proposal-accept moments.
  - [ ] `--focus-indicator-color`, `--focus-indicator-width`, `--focus-indicator-offset` exist on `:root`.
  - [ ] Dark-mode overrides defined under `:root[data-theme="dark"]` per UX spec's dark-mode-first rule. Minimum viable: warm-neutral scale inverts (50↔900 swap with warmth preserved), `sacred/lumi/safety-cleared/foliage/memory-provenance` receive dark-tuned variants.
  - [ ] NO `#FFFFFF` or `#000000` anywhere in the file — use `warm-neutral-50` (`#FAF7F2`) and `warm-neutral-900` (`#2A2724`) as the extreme anchors.

- [ ] **Task 4 — Author `packages/design-system/tokens/typography.css`** (AC: typography.css)
  - [ ] Create `packages/design-system/tokens/typography.css` per **Exact typography.css** in Dev Notes.
  - [ ] `@font-face` declarations for Instrument Serif (regular 400 + italic 400) pointing to `/fonts/InstrumentSerif-Regular.woff2` and `/fonts/InstrumentSerif-Italic.woff2`.
  - [ ] `@font-face` declarations for Inter (400, 500, 600 — the three weights used by UX spec's type ramp) pointing to `/fonts/Inter-Regular.woff2`, `/fonts/Inter-Medium.woff2`, `/fonts/Inter-SemiBold.woff2`.
  - [ ] Every `@font-face` uses `font-display: swap`.
  - [ ] Custom properties: `--font-serif: 'Instrument Serif', Georgia, serif;` and `--font-sans: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;`.
  - [ ] NO URLs to `fonts.googleapis.com`, `fonts.gstatic.com`, any CDN — paths are root-relative `/fonts/...` so each app serves from its own `public/fonts/` directory.

- [ ] **Task 5 — Author `packages/design-system/tokens/motion.css`** (AC: motion.css)
  - [ ] Create `packages/design-system/tokens/motion.css` per **Exact motion.css** in Dev Notes.
  - [ ] Custom properties: `--sacred-ease: cubic-bezier(0.4, 0, 0.2, 1);`, `--motion-fast: 120ms;`, `--motion-medium: 220ms;`, `--motion-slow: 360ms;`.
  - [ ] `@media (prefers-reduced-motion: reduce)` block overrides all three duration tokens to `0ms`; provides a `--motion-critical: 150ms` escape hatch for tile state-changes that must remain visible (per UX spec §Motion).
  - [ ] NO spring/bounce values, NO CSS keyframe definitions for confetti/celebration (banned per UX spec).

- [ ] **Task 6 — Author Tailwind preset export `packages/design-system/src/tokens/index.ts`** (AC: apps expose Tailwind utilities)
  - [ ] Create `packages/design-system/src/tokens/index.ts` per **Exact tokens/index.ts** in Dev Notes.
  - [ ] Export `tokenPresets: Partial<Config['theme']>` (imported type: `import type { Config } from 'tailwindcss'`) that maps every CSS custom property to a Tailwind utility scale.
  - [ ] `theme.extend.colors` includes `sacred`, `lumi-terracotta`, `safety-cleared`, `memory-provenance`, `honey-amber`, `foliage`, `warm-neutral` each with keys `50..900` whose values are `'var(--sacred-plum-500)'` etc. Also `lumi-terracotta-warmed: 'var(--lumi-terracotta-warmed)'`.
  - [ ] `theme.extend.fontFamily` — `serif: 'var(--font-serif)'`, `sans: 'var(--font-sans)'`.
  - [ ] `theme.extend.transitionTimingFunction` — `sacred-ease: 'var(--sacred-ease)'`.
  - [ ] `theme.extend.transitionDuration` — `fast: 'var(--motion-fast)'`, `medium: 'var(--motion-medium)'`, `slow: 'var(--motion-slow)'`.
  - [ ] `theme.extend.outlineColor`, `theme.extend.outlineWidth`, `theme.extend.outlineOffset` wire the focus-indicator tokens into `outline-focus-indicator` / `outline-2` utilities.
  - [ ] No default exports. Named `export const tokenPresets = ...`.

- [ ] **Task 7 — Self-host fonts in both apps** (AC: self-hosted woff2)
  - [ ] Create `apps/web/public/fonts/` directory.
  - [ ] Create `apps/marketing/public/fonts/` directory.
  - [ ] Download (or have the user provide) the following woff2 files:
    - `InstrumentSerif-Regular.woff2` (Google Fonts Instrument Serif, weight 400)
    - `InstrumentSerif-Italic.woff2` (Google Fonts Instrument Serif, italic 400)
    - `Inter-Regular.woff2` (Google Fonts Inter, weight 400)
    - `Inter-Medium.woff2` (Google Fonts Inter, weight 500)
    - `Inter-SemiBold.woff2` (Google Fonts Inter, weight 600)
  - [ ] Place identical copies in both `apps/web/public/fonts/` AND `apps/marketing/public/fonts/`. Each app MUST be able to serve its fonts without referencing the other app's public directory.
  - [ ] Add a note to the project root `README.md` section (or create `packages/design-system/FONTS.md`) documenting the font sources, licenses (Instrument Serif: SIL OFL 1.1; Inter: SIL OFL 1.1), and the self-hosting rationale (PRD constraint — no third-party CDN requests).
  - [ ] Verify both files serve at `http://localhost:3000/fonts/Inter-Regular.woff2` (apps/web dev) and `http://localhost:4321/fonts/Inter-Regular.woff2` (apps/marketing dev).

- [ ] **Task 8 — Wire `apps/web/tailwind.config.ts`** (AC: apps expose utilities)
  - [ ] Replace `apps/web/tailwind.config.ts` per **Exact apps/web/tailwind.config.ts** in Dev Notes.
  - [ ] Import `tokenPresets` from `@hivekitchen/design-system` (workspace package).
  - [ ] `theme.extend = tokenPresets`.
  - [ ] `content` includes `./index.html`, `./src/**/*.{ts,tsx}`.
  - [ ] Update `apps/web/src/styles/globals.css` per **Exact apps/web/src/styles/globals.css** in Dev Notes — adds `@import` for `colors.css`, `typography.css`, `motion.css` BEFORE the `@tailwind` directives. Use relative paths via Vite's module resolution: `@import '@hivekitchen/design-system/tokens/colors.css';` etc. (Vite resolves workspace packages' files directly; no bundler config required.)
  - [ ] Verify `pnpm --filter @hivekitchen/web dev` starts without errors and the CSS custom properties are present in the rendered DOM (`document.documentElement` computed styles).
  - [ ] Verify `pnpm --filter @hivekitchen/web build` produces a bundle that includes the token CSS (inspect `dist/assets/*.css`).

- [ ] **Task 9 — Wire `apps/marketing/tailwind.config.ts` + Astro Tailwind integration** (AC: apps expose utilities)
  - [ ] Add `@astrojs/tailwind` to `apps/marketing/devDependencies` (see **Dependency Exceptions**). Use `@astrojs/tailwind@^5.1.0`.
  - [ ] Update `apps/marketing/astro.config.mjs` to register the `@astrojs/tailwind` integration with `{ applyBaseStyles: false }` (we control base styles via our token CSS files, not Astro's default).
  - [ ] Replace `apps/marketing/tailwind.config.ts` per **Exact apps/marketing/tailwind.config.ts** in Dev Notes. Import `tokenPresets` from `@hivekitchen/design-system`. `content` includes `./src/**/*.{astro,ts,tsx,html}`.
  - [ ] Create `apps/marketing/src/styles/globals.css` with the same `@import` order as apps/web (`colors.css`, `typography.css`, `motion.css`, then `@tailwind base/components/utilities`).
  - [ ] Update `apps/marketing/src/pages/index.astro` to `<link rel="stylesheet" href="/globals.css" />` OR import the stylesheet via Astro's standard pattern. (Consult Astro v6 docs for the current pattern; the key invariant is the CSS reaches the rendered HTML.)
  - [ ] Verify `pnpm --filter @hivekitchen/marketing dev` serves the index page with the token CSS custom properties present in the HTML.

- [ ] **Task 10 — Re-wire `packages/ui/tailwind.config.ts`** (AC: apps expose utilities via ui package re-export)
  - [ ] Replace `packages/ui/tailwind.config.ts` per **Exact packages/ui/tailwind.config.ts** in Dev Notes. Import `tokenPresets` from `@hivekitchen/design-system` (workspace package — no more relative `../design-system/...` path).
  - [ ] Remove the `TODO(story-1.4)` comment — it's resolved.
  - [ ] `content` remains `[]` (the ui package has no content yet; apps consume utilities via their own tailwind configs). This is intentional per Story 1.1 Dev Notes.

- [ ] **Task 11 — Create smoke-test page `apps/web/src/routes/_dev-tokens.tsx`** (AC: smoke-test page)
  - [ ] Create `apps/web/src/routes/` directory. This is the first file in it — the directory is established now for future routing stories to build on.
  - [ ] Create `apps/web/src/routes/_dev-tokens.tsx` per **Exact _dev-tokens.tsx** in Dev Notes. Default-exports a `<DevTokensPage>` React component that renders every token group as a visual swatch grid.
  - [ ] Update `apps/web/src/app.tsx` to conditionally mount `<DevTokensPage>` when `import.meta.env.DEV && location.pathname === '/_dev-tokens'`. Otherwise render the existing `<div>HiveKitchen</div>` placeholder. See **Exact apps/web/src/app.tsx** in Dev Notes.
  - [ ] Verify `pnpm --filter @hivekitchen/web dev` → navigate to `http://localhost:3000/_dev-tokens` — every token group renders visibly distinct swatches with hex values labeled.
  - [ ] Verify `pnpm --filter @hivekitchen/web build` followed by `pnpm --filter @hivekitchen/web preview` → navigate to `/_dev-tokens` → the placeholder `<div>HiveKitchen</div>` renders instead (page is unreachable in production).

- [ ] **Task 12 — Unit tests** (AC: typecheck + test pass)
  - [ ] Add `vitest` to `packages/design-system/devDependencies` — reuse the version already pinned in `packages/contracts/package.json` (`^4.0.0` per Story 1.3). Add a `test` script: `"test": "vitest run --passWithNoTests"`.
  - [ ] Create `packages/design-system/src/tokens/index.test.ts` that:
    - Imports `tokenPresets`.
    - Asserts the shape: `expect(tokenPresets.extend.colors.sacred[500]).toBe('var(--sacred-plum-500)')`.
    - Asserts all 7 color groups have 10 stops each (50 through 900).
    - Asserts the focus-indicator, font-family, and motion tokens are present.
  - [ ] Create `packages/design-system/src/tokens/fonts.test.ts` that verifies the expected woff2 files exist in both `apps/web/public/fonts/` and `apps/marketing/public/fonts/` via `fs.existsSync` (skip on CI where `apps/marketing/public/fonts` may not yet have files — use `it.skipIf`).
  - [ ] Run `pnpm test` from workspace root. Expect: `packages/design-system` tests run and pass. `packages/contracts` tests continue to pass (74/74 from Story 1.3).

- [ ] **Task 13 — Verify** (AC: typecheck + build + test pass)
  - [ ] Run `pnpm typecheck` from workspace root. Expect: 7/7 passes — the new `@hivekitchen/design-system` package adds one typecheck target (previously 6/6).
  - [ ] Run `pnpm test` from workspace root. Expect: `packages/contracts` 74/74 + `packages/design-system` tests pass; other workspaces report 0 tests (no `test` script yet) and exit 0.
  - [ ] Run `pnpm build` from workspace root. Expect: 3/3 passes (marketing, api, web). The CSS output of `@hivekitchen/web`'s build must contain token custom properties (grep-verify with `grep -l 'sacred-plum-500' dist/assets/*.css`).
  - [ ] Run `pnpm lint` from workspace root — expect pass (no new lint rules exist yet; Story 1.5 introduces them).
  - [ ] Manual verification (dev server, 5 minutes):
    - `pnpm --filter @hivekitchen/web dev` → `/_dev-tokens` renders every token group.
    - Browser devtools Network tab: no requests to `fonts.googleapis.com` or `fonts.gstatic.com`.
    - `document.documentElement.style.getPropertyValue('--sacred-plum-500')` returns a hex value in the browser console.

- [ ] **Task 14 — Commit** (no AC — workflow discipline)
  - [ ] Branch: cut from `main` as `feat/story-1-4-token-system-v2`.
  - [ ] Commit: `feat(design-system): establish v2.0 token system` — scope `design-system`.
  - [ ] Push with upstream tracking. Do NOT force-push. Do NOT merge to `main` from local.
  - [ ] PR: title `feat(design-system): establish v2.0 token system`. Body summarizes AC coverage.

## Dev Notes

### Scope of this story

Token CSS authoring, Tailwind preset wiring, self-hosted font placement, dev-only smoke-test page, and the cross-epic architectural decision to promote `packages/design-system/` into a workspace package. Pure design-system + tooling + minimal app wiring.

### Out of scope (explicit punts)

- ❌ `SCOPE_CHARTER.md` — Story 1.5 owns the charter.
- ❌ `eslint-plugin-hivekitchen` / ESLint scope rules — Story 1.5 owns the rules.
- ❌ `contrast-audit.test.ts` — Story 1.12 owns the WCAG 2.2 AA/AAA contrast audit. This story ships initial hex values; Story 1.12 will force adjustments if any pair fails its contrast bar.
- ❌ Real Shadcn components — they land per-epic in later stories. This story provides tokens only.
- ❌ `packages/ui/src/scope-allowlist.config.ts` — Story 1.5.
- ❌ Multilingual font fallbacks (Devanagari, Hebrew, Arabic, Tamil, Bengali) — Story 4.16 per AR-20 / UX-DR20. This story ships Latin-only Inter + Instrument Serif.
- ❌ `useReducedMotion` / `useReducedTransparency` React hooks — Story 1.11. This story ships the CSS `@media (prefers-reduced-motion: reduce)` primitive only.
- ❌ Actual Shadcn copy-in to `packages/ui/src/primitives/` — later.
- ❌ TanStack Router or any routing framework — `_dev-tokens.tsx` uses a manual pathname check in `app.tsx`. Story 1.10 or Epic 2 will introduce the router.
- ❌ View-transitions CSS (`view-transitions.css`) — later.

### Anti-patterns to reject

- ❌ `@import` from `https://fonts.googleapis.com` or any CDN — self-hosted woff2 only. PRD constraint.
- ❌ Hard-coding hex values in Tailwind utilities — always reference CSS custom properties via `var(--token)`. This is the whole point of the two-layer (CSS props + Tailwind preset) architecture.
- ❌ Using `#FFFFFF` or `#000000` as the white/black anchor — always `warm-neutral-50` (`#FAF7F2`) and `warm-neutral-900` (`#2A2724`). Cold white violates the Dearborn-10pm test.
- ❌ `honey-amber-*` on button hover or primary CTA — it's reserved for recognition moments only (UX-DR1). CTA uses a different token (resolved in later components).
- ❌ `destructive-*` on allergy surfaces — allergy-safety uses `safety-cleared-*` exclusively. Allergy is never alarm-framed.
- ❌ Spring / bounce / confetti motion tokens — banned by UX spec §Motion.
- ❌ `const enum` — banned by `isolatedModules`.
- ❌ Default exports — named exports only.
- ❌ Adding path aliases to `packages/design-system` — shared packages use relative imports only.
- ❌ `z.any()` / `z.unknown()` in tokenPresets typing — use Tailwind's `Config['theme']` type.
- ❌ Editing `apps/web/src/styles/globals.css` to add raw `@tailwind` directives multiple times — keep the file minimal: `@import` token CSS, then the three `@tailwind` directives.
- ❌ Creating a build step for `packages/design-system` — it's source-imported like `packages/contracts` and `packages/types`. The CSS files and TypeScript preset are consumed directly.
- ❌ Adding `@types/node` to `packages/design-system` — not needed. The `fs.existsSync` used in Task 12's font-file test runs under Vitest which provides Node types automatically.

### Cross-story architectural decision (resolved)

**Background:** Story 1.1 Dev Notes flagged an epic-vs-architecture conflict on the home of tokens:
- Epic says: separate `packages/design-system/` workspace package (Stories 1.1, 1.4, 1.5, 1.12 all reference it).
- Architecture says: tokens live inside `packages/ui/src/tokens/`; no separate `packages/design-system/` in the architecture tree (architecture.md lines 1284–1292).

**Resolution: Option (a) — `packages/design-system/` becomes a full workspace package.** Three separate stories (1.4, 1.5, 1.12) reference `packages/design-system/` as a distinct home for tokens, scope charter, and contrast audit. Collapsing into `packages/ui/src/tokens/` would require re-writing three stories and loses the separation-of-concerns (design-system is upstream of ui; ui depends on design-system, not the reverse). Architecture document gets updated as a follow-up docs PR (deferred — see deferred-work log).

**What this means:**
- `packages/design-system/` is a workspace package with its own `package.json`.
- `packages/ui/package.json` adds `@hivekitchen/design-system: "workspace:*"` as a dependency.
- `apps/web` and `apps/marketing` both depend on `@hivekitchen/design-system` (NOT on `packages/ui` for tokens — `packages/ui` is the component library; design-system is tokens).
- The architecture tree in architecture.md lines 1288–1292 becomes stale; a docs PR in a later story updates it. This does NOT block Story 1.4.

### Dark-mode-first approach (UX spec §Visual Identity)

Per UX spec: dark mode is the dominant rendering context (Sunday-9:47pm dim-room primacy). Author dark-mode token values FIRST, then derive light-mode as the reciprocal.

- Every token pair (text on background, focus indicator on surface, trust-chip text on chip fill) is contrast-verified in dark mode first.
- Warm surface tokens in dark are *warm charcoal*, not near-black — `warm-neutral-900: #2A2724`. This avoids the harsh OLED switch between pitch-black UI chrome and content surfaces.
- Sacred, Lumi, Safety-cleared, Foliage each have dark-tuned variants designed for fatigue-tolerance.
- Destructive red maintains perceptual urgency in both modes (not in scope for 1.4 but noted).

**Implementation:** Story 1.4 ships both `:root` (light mode default) and `:root[data-theme="dark"]` token definitions. The `data-theme` attribute will be set by a later story (user preference / OS pref); 1.4 ships the ability to manually switch via devtools for visual verification.

### Token anchor values (authoritative)

The dev implementing 1.4 is NOT authoring a new palette — they are codifying the anchors the UX spec already pins. Use these as the `-500` stop for each group and derive the 50/100/200/300/400/600/700/800/900 stops by lightness stepping in OKLCH (or via a tool like [leonardo.io](https://leonardo.io/)). Story 1.12's contrast audit will flag pairs that fall below AA/AAA and force adjustments.

| Token group | -500 anchor | Source (UX spec) |
|---|---|---|
| `sacred-plum` | `#6B4A5A` | ux-design-specification.md §Semantic token groups — plum-ink, unsaturated, letter/ink register |
| `lumi-terracotta` | `#B46A4E` | §Semantic token groups — muted terracotta, distinct from sacred plum and honey amber |
| `lumi-terracotta-warmed` | Derive from `-500` by +8% saturation, +4% lightness | UX-DR1 — "Lumi proposal exclusive" accept-moment variant |
| `safety-cleared-teal` | `#3D6B5F` | §Semantic token groups — deep forest-teal, confident, never alarming |
| `memory-provenance` | `#8A7D70` | §Semantic token groups — near-neutral warm-tint, designed to recede |
| `honey-amber` | `#D98F3C` | §Semantic token groups — warm honey-amber (NOT marigold-bright). Recognition-only per UX-DR1. |
| `foliage` | `#7A9681` | §Semantic token groups — grey-green foliage, kitchen-herb (NOT spa-pool teal) |
| `warm-neutral` | `50: #FAF7F2`, `500: ~#8A8178`, `900: #2A2724` | §Semantic token groups — warm off-white to warm charcoal |

**Stop derivation rule:** For each group, the 10 stops (`50` through `900`) follow a uniform lightness step in OKLCH space. Hue and chroma stay anchored to the `-500` value; only lightness varies. `-50` is lightest (pale tint), `-900` is darkest (deep shade). This rule keeps every scale internally consistent and maintains the UX spec's "each group has its own character" without hue drift across the scale.

### Exact `packages/design-system/package.json`

```json
{
  "name": "@hivekitchen/design-system",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./tokens/colors.css": "./tokens/colors.css",
    "./tokens/typography.css": "./tokens/typography.css",
    "./tokens/motion.css": "./tokens/motion.css"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "clean": "node -e \"import('node:fs').then(fs => fs.rmSync('dist', { recursive: true, force: true }))\""
  },
  "devDependencies": {
    "@hivekitchen/tsconfig": "workspace:*",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vitest": "^4.0.0"
  }
}
```

**Note on `exports` field:** Unlike `packages/contracts` (which has no `exports` — the entire package is source-imported via `main`), `packages/design-system` exposes individual CSS files so consumers can `@import '@hivekitchen/design-system/tokens/colors.css'` in their globals.css. The `main` export remains the TypeScript token preset.

**Clean script:** Uses Node's `fs.rmSync` via inline ESM import rather than `rm -rf dist` (which is Story 1.5's cross-platform chore for `packages/contracts` and `apps/api`). This story is the first new package; ship it cross-platform from day one.

### Exact `packages/design-system/tsconfig.json`

```json
{
  "extends": "@hivekitchen/tsconfig/base.json",
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Exact `packages/design-system/src/index.ts`

```ts
export { tokenPresets } from './tokens/index.js';
```

### Exact `packages/design-system/src/tokens/index.ts`

```ts
import type { Config } from 'tailwindcss';

type TokenPresets = Partial<Config['theme']>;

const colorScale = (prefix: string) => ({
  50: `var(--${prefix}-50)`,
  100: `var(--${prefix}-100)`,
  200: `var(--${prefix}-200)`,
  300: `var(--${prefix}-300)`,
  400: `var(--${prefix}-400)`,
  500: `var(--${prefix}-500)`,
  600: `var(--${prefix}-600)`,
  700: `var(--${prefix}-700)`,
  800: `var(--${prefix}-800)`,
  900: `var(--${prefix}-900)`,
});

export const tokenPresets: TokenPresets = {
  extend: {
    colors: {
      sacred: colorScale('sacred-plum'),
      'lumi-terracotta': {
        ...colorScale('lumi-terracotta'),
        warmed: 'var(--lumi-terracotta-warmed)',
      },
      'safety-cleared': colorScale('safety-cleared-teal'),
      'memory-provenance': colorScale('memory-provenance'),
      'honey-amber': colorScale('honey-amber'),
      foliage: colorScale('foliage'),
      'warm-neutral': colorScale('warm-neutral'),
    },
    fontFamily: {
      serif: 'var(--font-serif)',
      sans: 'var(--font-sans)',
    },
    transitionTimingFunction: {
      'sacred-ease': 'var(--sacred-ease)',
    },
    transitionDuration: {
      fast: 'var(--motion-fast)',
      medium: 'var(--motion-medium)',
      slow: 'var(--motion-slow)',
    },
    outlineColor: {
      'focus-indicator': 'var(--focus-indicator-color)',
    },
    outlineWidth: {
      'focus-indicator': 'var(--focus-indicator-width)',
    },
    outlineOffset: {
      'focus-indicator': 'var(--focus-indicator-offset)',
    },
  },
};
```

### Exact `packages/design-system/tokens/colors.css`

Provide `:root` light-mode values AND `:root[data-theme="dark"]` dark-mode overrides. The dev MUST author all 10 stops per group — the snippet below shows the anchor (`-500`) and the two extremes (`-50` and `-900`) for each group; derive 100/200/300/400/600/700/800 by OKLCH lightness stepping (see **Token anchor values** above).

```css
/* Light-mode (reciprocal — derived from dark-mode-first) */
:root {
  /* Sacred — Heart Note channel only (UX-DR1, UX-DR22) */
  --sacred-plum-50: /* derive — lightest plum tint */;
  --sacred-plum-500: #6B4A5A;
  --sacred-plum-900: /* derive — deepest plum */;
  /* ... all 10 stops ... */

  /* Lumi — Lumi→Child channel only (UX-DR1, UX-DR17) */
  --lumi-terracotta-50: /* derive */;
  --lumi-terracotta-500: #B46A4E;
  --lumi-terracotta-900: /* derive */;
  --lumi-terracotta-warmed: /* +8% saturation, +4% lightness from -500 */;

  /* Safety-cleared — Allergy reassurance (UX-DR1, UX-DR24) */
  --safety-cleared-teal-50: /* derive */;
  --safety-cleared-teal-500: #3D6B5F;
  --safety-cleared-teal-900: /* derive */;

  /* Memory-provenance — Visible Memory chips (UX-DR1) */
  --memory-provenance-50: /* derive */;
  --memory-provenance-500: #8A7D70;
  --memory-provenance-900: /* derive */;

  /* Honey-amber — Recognition moments only (UX-DR1, NEVER button hover) */
  --honey-amber-50: /* derive */;
  --honey-amber-500: #D98F3C;
  --honey-amber-900: /* derive */;

  /* Foliage — Focus indicator + freshness signal (UX-DR1) */
  --foliage-50: /* derive */;
  --foliage-500: #7A9681;
  --foliage-900: /* derive */;

  /* Warm-neutral — base palette; NEVER #FFF or #000 */
  --warm-neutral-50: #FAF7F2;
  --warm-neutral-500: /* derive */;
  --warm-neutral-900: #2A2724;

  /* Focus indicator (UX spec §Accessibility §Floor commitments) */
  --focus-indicator-color: var(--foliage-500);
  --focus-indicator-width: 2px;
  --focus-indicator-offset: 2px;
}

/* Dark-mode — authored FIRST in design, rendered as the primary target */
:root[data-theme="dark"] {
  /* Warm-neutral inverts (50 <-> 900), warmth preserved; never pitch-black */
  --warm-neutral-50: #2A2724;
  --warm-neutral-900: #FAF7F2;
  /* sacred/lumi/safety-cleared/foliage/memory-provenance/honey-amber
     receive dark-tuned variants designed for fatigue-tolerance.
     Chroma and hue hold; lightness is adjusted to maintain contrast
     against the dark warm-neutral surface. */
  /* ... dark-mode overrides for all 7 color groups ... */
}
```

**Important:** If the dev is uncertain about OKLCH stepping, use the [leonardo.io](https://leonardo.io/) tool to generate the intermediate stops with `-500` as the midpoint. Output CSS hex values rounded to 6 digits; no `rgba()` or `hsl()` in the token file — keep hex for grep-ability and contrast-audit simplicity.

### Exact `packages/design-system/tokens/typography.css`

```css
/* Instrument Serif — headlines, Heart Notes, cultural recognition */
@font-face {
  font-family: 'Instrument Serif';
  src: url('/fonts/InstrumentSerif-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Instrument Serif';
  src: url('/fonts/InstrumentSerif-Italic.woff2') format('woff2');
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}

/* Inter — all UI, body, buttons, labels */
@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter-Medium.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter-SemiBold.woff2') format('woff2');
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-serif: 'Instrument Serif', Georgia, 'Times New Roman', serif;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', system-ui, sans-serif;
}
```

### Exact `packages/design-system/tokens/motion.css`

```css
:root {
  /* Sacred motion curve — ease-in-out with gentle asymmetry; the ONE approved curve
     for Heart Note / sacred-channel animations. Replaces default `ease-out` which
     would read as "startup UI" rather than "letter arriving". */
  --sacred-ease: cubic-bezier(0.4, 0, 0.2, 1);

  --motion-fast: 120ms;   /* state changes on tap (tile update, picker expand) */
  --motion-medium: 220ms; /* route transitions, panel open/close */
  --motion-slow: 360ms;   /* first-load Brief fade-in ONLY */

  /* Escape hatch for comprehension-critical transitions that must remain visible
     even under prefers-reduced-motion (UX spec §Motion — tile state-change replacing
     the save-button affordance). Used with linear easing, not sacred-ease. */
  --motion-critical: 150ms;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-fast: 0ms;
    --motion-medium: 0ms;
    --motion-slow: 0ms;
    /* --motion-critical stays 150ms — comprehension requires the transition remain
       perceivable, but easing collapses to linear and duration holds at 150ms. */
  }
}
```

### Exact `apps/web/src/styles/globals.css`

```css
@import '@hivekitchen/design-system/tokens/colors.css';
@import '@hivekitchen/design-system/tokens/typography.css';
@import '@hivekitchen/design-system/tokens/motion.css';

@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Exact `apps/web/tailwind.config.ts`

```ts
import type { Config } from 'tailwindcss';
import { tokenPresets } from '@hivekitchen/design-system';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: tokenPresets,
  plugins: [],
};

export default config;
```

### Exact `apps/marketing/astro.config.mjs`

```js
// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [tailwind({ applyBaseStyles: false })],
});
```

### Exact `apps/marketing/tailwind.config.ts`

```ts
import type { Config } from 'tailwindcss';
import { tokenPresets } from '@hivekitchen/design-system';

const config: Config = {
  content: ['./src/**/*.{astro,ts,tsx,html,mdx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: tokenPresets,
  plugins: [],
};

export default config;
```

### Exact `apps/marketing/src/styles/globals.css`

Same pattern as `apps/web/src/styles/globals.css` — identical content.

### Exact `packages/ui/tailwind.config.ts`

```ts
import type { Config } from 'tailwindcss';
import { tokenPresets } from '@hivekitchen/design-system';

const config: Config = {
  content: [],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: tokenPresets,
  plugins: [],
};

export default config;
```

### Exact `apps/web/src/app.tsx`

```tsx
import { DevTokensPage } from './routes/_dev-tokens.js';

export function App() {
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.pathname === '/_dev-tokens') {
    return <DevTokensPage />;
  }
  return <div>HiveKitchen</div>;
}
```

**Note on the `.js` extension in the import:** ESM with TypeScript `moduleResolution: "bundler"` resolves `.js` to `.tsx` at build time. This matches the pattern established in `packages/contracts` and `packages/types`.

### Exact `apps/web/src/routes/_dev-tokens.tsx`

```tsx
const colorGroups = [
  'sacred-plum',
  'lumi-terracotta',
  'safety-cleared-teal',
  'memory-provenance',
  'honey-amber',
  'foliage',
  'warm-neutral',
] as const;

const stops = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export function DevTokensPage() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'var(--font-sans)' }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '2rem' }}>
        Design System v2.0 — Token Reference
      </h1>
      <p style={{ color: 'var(--warm-neutral-700)' }}>
        Development-only smoke test. Every token group renders below.
      </p>
      {colorGroups.map((group) => (
        <section key={group} style={{ marginTop: '2rem' }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem' }}>{group}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '0.5rem' }}>
            {stops.map((stop) => (
              <div
                key={stop}
                style={{
                  background: `var(--${group}-${stop})`,
                  padding: '1rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  color: stop >= 500 ? 'var(--warm-neutral-50)' : 'var(--warm-neutral-900)',
                  textAlign: 'center',
                }}
              >
                {stop}
              </div>
            ))}
          </div>
        </section>
      ))}
      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem' }}>Typography</h2>
        <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem' }}>
          Instrument Serif — the sacred, editorial, letter-ink voice.
        </p>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '1rem' }}>
          Inter — all UI, body, buttons, labels.
        </p>
      </section>
      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem' }}>Motion</h2>
        <button
          type="button"
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--sacred-plum-500)',
            color: 'var(--warm-neutral-50)',
            border: 'none',
            borderRadius: '8px',
            transition: 'transform var(--motion-medium) var(--sacred-ease)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          Hover me — sacred-ease, motion-medium
        </button>
      </section>
      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem' }}>Focus indicator</h2>
        <button
          type="button"
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--warm-neutral-100)',
            color: 'var(--warm-neutral-900)',
            border: '1px solid var(--warm-neutral-300)',
            borderRadius: '8px',
            outline: 'var(--focus-indicator-width) solid var(--focus-indicator-color)',
            outlineOffset: 'var(--focus-indicator-offset)',
          }}
        >
          Focus indicator preview
        </button>
      </section>
    </main>
  );
}
```

**Why inline styles instead of Tailwind utilities?** The smoke-test page is diagnostic — it verifies the raw CSS custom properties are wired correctly. Using `var(--sacred-plum-500)` inline removes one layer of indirection (the Tailwind preset). If the swatch renders, the token is present. Tailwind-utility-based smoke tests come later.

### Testing guidance

**`packages/design-system/src/tokens/index.test.ts`** — verifies the Tailwind preset structure:

```ts
import { describe, it, expect } from 'vitest';
import { tokenPresets } from './index.js';

describe('tokenPresets', () => {
  it('exposes 7 color groups each with 10 stops', () => {
    const groups = ['sacred', 'lumi-terracotta', 'safety-cleared', 'memory-provenance', 'honey-amber', 'foliage', 'warm-neutral'];
    for (const g of groups) {
      const scale = tokenPresets.extend?.colors?.[g as keyof NonNullable<typeof tokenPresets.extend>['colors']];
      expect(scale).toBeDefined();
      for (const stop of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
        expect((scale as Record<number, string>)[stop]).toMatch(/^var\(--/);
      }
    }
  });

  it('exposes lumi-terracotta-warmed variant', () => {
    const scale = tokenPresets.extend?.colors?.['lumi-terracotta'] as Record<string, string> | undefined;
    expect(scale?.warmed).toBe('var(--lumi-terracotta-warmed)');
  });

  it('exposes focus-indicator tokens', () => {
    expect(tokenPresets.extend?.outlineColor?.['focus-indicator']).toBe('var(--focus-indicator-color)');
    expect(tokenPresets.extend?.outlineWidth?.['focus-indicator']).toBe('var(--focus-indicator-width)');
    expect(tokenPresets.extend?.outlineOffset?.['focus-indicator']).toBe('var(--focus-indicator-offset)');
  });

  it('exposes font-family tokens', () => {
    expect(tokenPresets.extend?.fontFamily?.serif).toBe('var(--font-serif)');
    expect(tokenPresets.extend?.fontFamily?.sans).toBe('var(--font-sans)');
  });

  it('exposes motion tokens', () => {
    expect(tokenPresets.extend?.transitionTimingFunction?.['sacred-ease']).toBe('var(--sacred-ease)');
    expect(tokenPresets.extend?.transitionDuration?.fast).toBe('var(--motion-fast)');
    expect(tokenPresets.extend?.transitionDuration?.medium).toBe('var(--motion-medium)');
    expect(tokenPresets.extend?.transitionDuration?.slow).toBe('var(--motion-slow)');
  });
});
```

**`packages/design-system/src/tokens/fonts.test.ts`** — verifies fonts are self-hosted in both apps:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FONTS = ['InstrumentSerif-Regular.woff2', 'InstrumentSerif-Italic.woff2', 'Inter-Regular.woff2', 'Inter-Medium.woff2', 'Inter-SemiBold.woff2'];

describe('self-hosted fonts', () => {
  for (const font of FONTS) {
    it(`exists in apps/web/public/fonts/${font}`, () => {
      expect(existsSync(resolve(ROOT, 'apps/web/public/fonts', font))).toBe(true);
    });
    it(`exists in apps/marketing/public/fonts/${font}`, () => {
      expect(existsSync(resolve(ROOT, 'apps/marketing/public/fonts', font))).toBe(true);
    });
  }
});
```

**Required coverage:**
- `tokenPresets` structure: 7 groups × 10 stops, named variants, focus-indicator, font-family, motion.
- Font-file presence: 5 files × 2 app directories.

**What NOT to test here:**
- Hex value correctness (no contrast assertions) — that's Story 1.12.
- Browser rendering — manual verification in Task 13 covers this.
- Dark-mode token values — design review covers this.

### Architecture compliance (must-follow)

- **Shared packages are source-imported:** `@hivekitchen/design-system` has `main: "./src/index.ts"` — no build step, no `dist/` outputs. Matches `@hivekitchen/contracts` and `@hivekitchen/types`.
- **Workspace dependencies only:** `apps/web`, `apps/marketing`, `packages/ui` depend on `@hivekitchen/design-system` via `workspace:*`, never via npm.
- **ESM everywhere:** `"type": "module"` in `packages/design-system/package.json`. All TypeScript imports use `.js` extensions (`import { tokenPresets } from './tokens/index.js'`).
- **No `const enum`:** banned by `isolatedModules`. `colorScale` uses plain objects.
- **Named exports only:** no `export default`.
- **Tailwind ^3.4:** pinned in `packages/design-system/devDependencies`. Consumers' tailwind versions must match.
- **Dark-mode via `class` + `data-theme` dual selector:** `darkMode: ['class', '[data-theme="dark"]']` in every tailwind config — this supports both a manual `<html class="dark">` toggle (common in React apps) and the `data-theme` attribute (future-proof, SSR-safe).
- **No CDN requests:** self-hosted fonts in each app's `public/fonts/`. Verified by devtools Network tab in Task 13.

### Library/framework requirements

- **Tailwind ^3.4** — pinned in `packages/design-system/devDependencies` and already present in `apps/web`, `apps/marketing` (via the integration plugin), `packages/ui`. All consumers must agree on the major.
- **`@astrojs/tailwind@^5.1.0`** — the Astro integration. Enables Astro to process Tailwind directives through its build pipeline. Previously absent from `apps/marketing`; added this story.
- **Vitest ^4.0.0** — already in `packages/contracts` from Story 1.3. Added to `packages/design-system` with the same version.
- **tsx ^4.19.0** — already at root. Used by the test runner indirectly.
- **No new runtime dependencies.** Everything is devDependency tooling or static CSS.

### Dependency exceptions

Per project-context: "Never introduce a new external dependency without a recorded reason."

1. **`@astrojs/tailwind@^5.1.0` in `apps/marketing/devDependencies`** — required to process Tailwind in Astro's build. Astro's standard Tailwind integration; no viable alternative. Locks to v5 for Astro 6 compatibility.
2. **`vitest@^4.0.0` in `packages/design-system/devDependencies`** — mirrors Story 1.3's Vitest addition for `packages/contracts`. Consistent test runner across shared packages.
3. **`tailwindcss@^3.4.0` in `packages/design-system/devDependencies`** — needed to type-check `tokenPresets` against `Config['theme']`. Not a runtime dep; only pulled for type imports.

No other new deps. **Fonts are static assets, not npm packages** — they're placed in `public/fonts/` directly.

### Self-hosted font procurement

The dev needs actual woff2 files. Two acceptable paths:

**Path A: Google Fonts download (preferred, simplest)**
1. Navigate to [fonts.google.com/specimen/Instrument+Serif](https://fonts.google.com/specimen/Instrument+Serif), select 400 regular + 400 italic, download the zip. Extract the TTF files.
2. Convert TTF → woff2 using [fonttools](https://github.com/fonttools/fonttools) (`pyftsubset` for subsetting) OR the online [Transfonter](https://transfonter.org/) service with "woff2 only" + "Latin subset" options.
3. Repeat for Instrument Italic and Inter (400, 500, 600).
4. Place the resulting woff2 files in both `apps/web/public/fonts/` and `apps/marketing/public/fonts/`.

**Path B: npm package (fontsource)**
`@fontsource/instrument-serif` and `@fontsource/inter` ship pre-subsetted woff2 files. However, this adds two runtime dependencies and runs counter to the "static assets" approach. Use Path A.

**Licensing:** Both Inter and Instrument Serif are SIL OFL 1.1 — include a `FONTS.md` or `LICENSES.md` in each app's `public/fonts/` (or a single copy at `packages/design-system/FONTS.md` referenced from both) crediting Google Fonts and the original designers.

### Previous story intelligence

**From Story 1.1 (done):**
- `packages/design-system/tokens/index.ts` stub exists with `export const tokenPresets = {};`. This story moves it to `packages/design-system/src/tokens/index.ts` and populates it.
- `packages/ui/tailwind.config.ts` has a `TODO(story-1.4)` comment referencing the relative import. This story resolves it by switching to `@hivekitchen/design-system`.
- **🔔 Cross-story escalation:** Story 1.1 Dev Notes recommended Option (a) — full workspace package. This story adopts (a) per that recommendation. No user escalation required; PM intent was already documented.

**From Story 1.2 (done):**
- Root `package.json` has `scripts.dev`, `scripts.build`, `scripts.test`, `scripts.typecheck`, `scripts.lint`, `scripts.contracts:check`. This story does NOT add any new root scripts — `typecheck` / `test` / `build` already traverse every workspace.
- `apps/web/.env.local.example`, `apps/marketing/.env.local.example` exist. This story does NOT touch env — token CSS is build-time, not runtime.
- `tsx@^4.19.0` at root; Node 22+. Both used transitively by Vitest; no new setup.

**From Story 1.3 (done, code-review passed 2026-04-23):**
- `packages/contracts` ships with Vitest ^4.0.0 and 74/74 tests. This story uses the same Vitest version for consistency.
- `@hivekitchen/contracts/dist/*` is forbidden. Same rule applies to `@hivekitchen/design-system/dist/*` — never import compiled outputs; always source.
- **`.js` extension discipline:** all inter-file TypeScript imports use `.js` extensions. Applied here for `packages/design-system/src/index.ts` → `./tokens/index.js`.
- **Code-review D3 decision:** `contracts:check` was hardened to check import-statement form and verify plumbing. No equivalent `design-system:check` script is required by this story's AC; Story 1.5 (scope-allowlist) may introduce a parallel check.

### Git intelligence

Recent commits:
- `ccf61f3 feat(contracts): establish Foundation Gate Zod schemas` — Story 1.3 (contracts).
- `07fa553 docs(story-1-2): …` — Story 1.2 documentation promotions.
- `8bbdbce feat(scaffold): wire root scripts, api Dockerfile, per-app env templates` — Story 1.2.
- `87af79d fix(story-1-1): apply code review patches; mark story done` — Story 1.1 cleanup.

Commit scope for Story 1.4: `feat(design-system): …`. The scope `design-system` matches the new `@hivekitchen/design-system` package and aligns with the project's commit scoping convention (see Story 1.3's `feat(contracts)`, Story 1.2's `feat(scaffold)`).

**Branch strategy:** Cut from `main`. As of Story 1.3 completion, `main` does not yet contain Stories 1.2 or 1.3 (they exist only on their feature branches). The dev agent may need to branch from the tip of `feat/story-1-3-foundation-gate-contracts` to include Story 1.3's code-review patches (Vitest setup, contract exports). Document the chosen branch point in Debug Log References.

### Project structure notes

- **`packages/design-system/` is the FIRST workspace package added since Story 1.1.** Previous packages (`contracts`, `types`, `ui`, `tsconfig`) were all scaffolded in Story 1.1. This story exercises the workspace-add path.
- **`apps/web/src/routes/` directory is new.** `_dev-tokens.tsx` is the first file in it. The `routes/` directory is a forward-compat slot for TanStack Router or file-based routing when introduced (Story 1.10 / Epic 2).
- **`apps/web/src/styles/` already exists** (`globals.css`). The migration is additive — prepend three `@import` statements before the existing `@tailwind` directives.
- **`apps/marketing/src/styles/` does NOT exist yet.** This story creates it alongside `globals.css`.
- **`packages/ui/src/` is minimal** — just `index.ts`. No primitives yet. This story doesn't touch `packages/ui/src/`; it only updates `packages/ui/tailwind.config.ts`.
- **Architecture doc drift:** architecture.md lines 1288–1292 show tokens at `packages/ui/src/tokens/`. This story contradicts that line. A docs PR correcting the architecture tree is deferred to a later story. Dev agent does NOT edit architecture.md in 1.4.

### References

- Epic 1 §Story 1.4 — acceptance criteria source. [Source: `_bmad-output/planning-artifacts/epics.md:782-795`]
- UX Design Spec §Semantic token groups (token anchors). [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:940-975`]
- UX Design Spec §Typography (Instrument Serif + Inter). [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:991-1040`]
- UX Design Spec §Motion & Animation (sacred-ease, reduced-motion). [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1075-1125`]
- UX Design Spec §Visual Identity / Dark-mode-first rule. [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:940-975`]
- UX Design Requirements UX-DR1 through UX-DR5. [Source: `_bmad-output/planning-artifacts/epics.md:325-329`]
- Architecture §3.9 — styling stack reference. [Source: `_bmad-output/planning-artifacts/architecture.md:197`]
- Architecture tree (stale — folder placement will be corrected in a later docs PR). [Source: `_bmad-output/planning-artifacts/architecture.md:1028,1147,1288`]
- Project context — cross-cutting rules. [Source: `_bmad-output/project-context.md`]
- Previous story learnings. [Sources: `_bmad-output/implementation-artifacts/1-1-*.md`, `1-2-*.md`, `1-3-*.md`]
- Deferred work log. [Source: `_bmad-output/implementation-artifacts/deferred-work.md`]

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

_(to be filled by dev agent)_

### Completion Notes List

_(to be filled by dev agent)_

### File List

_(to be filled by dev agent)_

### Change Log

_(to be filled by dev agent)_
