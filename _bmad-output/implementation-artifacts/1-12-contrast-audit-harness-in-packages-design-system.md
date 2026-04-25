# Story 1.12: Contrast audit harness in packages/design-system

Status: done

## Story

As a developer,
I want `packages/design-system/contrast-audit.test.ts` programmatically verifying every token color pair against required WCAG ratios,
So that token additions cannot silently regress contrast and the WCAG 2.2 AA + AAA carve-out commitments are enforced in CI.

## Acceptance Criteria

1. `packages/design-system/contrast-audit.test.ts` reads token definitions from `tokens/colors.css` using `node:fs` — no external WCAG library; contrast ratio formula implemented inline (~15 lines).

2. The test generates the required-pair matrix: body text (warm-neutral-900) on each surface bg, focus indicator (foliage-500) on each surface bg, and trust chip text on chip bg — for **both light and dark token maps**.

3. WCAG 2.1/2.2 relative luminance and contrast ratio computed inline per the formula in Dev Notes.

4. A failing assertion output names: the pair label, mode (light/dark), fg token + hex, bg token + hex, computed ratio (2 decimal places), and required ratio — enough to identify and fix the token.

5. Required ratios enforced:
   - Body text on surface bg: **AAA 7:1**
   - Focus indicator on bg: **AA 3:1** (WCAG AA non-text / UI components)
   - Trust chip text on chip bg: **4.5:1**

6. Initial committed state produces **zero failures** against the v2.0 token set. If any pair fails on first run, adjust the offending hex values in `tokens/colors.css` until all pass (see **Token Adjustment** section).

7. `pnpm typecheck`, `pnpm lint`, and `pnpm test` remain green workspace-wide. The test runs as part of `pnpm --filter @hivekitchen/design-system test`.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight** (no AC)
  - [x] Confirm Story 1.4 is `done` in `sprint-status.yaml`
  - [x] Confirm `packages/design-system/contrast-audit.test.ts` does NOT yet exist
  - [x] Read `packages/design-system/tokens/colors.css` fully — understand the `:root` (light) and `:root[data-theme="dark"]` (dark) sections
  - [x] Run `pnpm --filter @hivekitchen/design-system test` to confirm baseline: **14 passing tests**

- [x] **Task 2 — Create contrast-audit.test.ts** (AC: #1–5)
  - [x] Create `packages/design-system/contrast-audit.test.ts` per **Full Test File Spec** in Dev Notes
  - [x] Implement `parseTokenMap()`, `linearize()`, `relativeLuminance()`, `contrastRatio()` helpers per spec
  - [x] Define `PAIRS` matrix (8 pairs) covering body text, focus indicator, and trust chip pairs in both modes
  - [x] Use `it.each(PAIRS)` with the `$label ($mode): ≥ $required:1` title pattern

- [x] **Task 3 — Update tsconfig.json for typecheck coverage** (no AC, prevents silent type errors)
  - [x] Update `packages/design-system/tsconfig.json`: add `"contrast-audit.test.ts"` to `include` so `pnpm typecheck` covers the root-level file

- [x] **Task 4 — Token adjustment if needed** (AC: #6)
  - [x] Run `pnpm --filter @hivekitchen/design-system test` — note any failing pairs (see **Potential Failures** in Dev Notes)
  - [x] For each failing pair: determine the minimum luminance delta needed, update the hex value in `tokens/colors.css`
  - [x] Re-run until zero failures; keep changes to the minimum number of stops

- [x] **Task 5 — Verification** (AC: #7)
  - [x] `pnpm typecheck` — all packages green
  - [x] `pnpm lint` — 0 errors workspace-wide
  - [x] `pnpm test` — all tests green (14 existing + new contrast audit tests = 22+ design-system tests)
  - [x] Update `sprint-status.yaml` story to `review`

---

## Dev Notes

### Architecture References

- `_bmad-output/planning-artifacts/architecture.md` NFR: "WCAG 2.1/2.2 AA; readability CI check; TTS caption fallback"
- `_bmad-output/planning-artifacts/ux-design-specification.md` §13 Testing Strategy: "Contrast audit (contrast-audit.test.ts) — every token pair verified against required ratios."
- `_bmad-output/planning-artifacts/ux-design-specification.md` §13 Contrast commitments (verbatim):
  - "Dark-mode-first. Primary palette already hits 7:1 AAA for body Inter 16pt on warm-neutral-900 background."
  - "Light mode must also meet AAA for body text. Verified per-token in `packages/design-system/contrast-audit.test.ts`."
  - "Non-text UI (borders, icons, focus indicators) meets AA floor of 3:1 minimum."
  - "Trust chips (safety-cleared, cultural-template, allergy-cleared) meet 4.5:1 minimum on both modes."
- `packages/design-system/tokens/colors.css` — comment block: _"Story 1.12 contrast audit will validate and adjust any failing AA/AAA pairs."_

### CRITICAL: Token Adjustment Is Expected

The `colors.css` header comment explicitly says: _"Story 1.12 contrast audit will validate and adjust any failing AA/AAA pairs."_ This means **some hex values may fail on the first test run**. The acceptance criterion "initial pass produces zero failures" means the **final committed state** is zero failures — not that the first run must pass.

If a pair fails: identify the failing token stop, compute the minimum luminance needed to hit the required ratio, nudge the hex value, re-run. Changes should be minimal (darken by 10–20% chroma/lightness in OKLCH terms). Preserve the linear stepping between adjacent stops.

### WCAG Contrast Formula (implement inline — no library)

```ts
function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = linearize(parseInt(hex.slice(1, 3), 16) / 255);
  const g = linearize(parseInt(hex.slice(3, 5), 16) / 255);
  const b = linearize(parseInt(hex.slice(5, 7), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
```

### CSS Parsing Approach

`tokens/colors.css` has two sections separated by the `[data-theme="dark"]` selector. Parse both into separate `Record<string, string>` maps; for the dark map, start from light values then layer dark overrides (dark CSS redefines all the same variable names with different values):

```ts
function parseTokenMap(section: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    map[`--${m[1]}`] = m[2];
  }
  return map;
}

const css = readFileSync(resolve(__dirname, 'tokens/colors.css'), 'utf8');
const darkIdx = css.indexOf('[data-theme="dark"]');
const lightMap = parseTokenMap(darkIdx > -1 ? css.slice(0, darkIdx) : css);
const darkMap  = { ...lightMap, ...parseTokenMap(darkIdx > -1 ? css.slice(darkIdx) : '') };
```

**Dark mode warm-neutral inversion**: `colors.css` inverts the warm-neutral scale in dark mode:
- `--warm-neutral-50` dark value = `#2a2724` (the dark background surface)
- `--warm-neutral-900` dark value = `#faf7f2` (the body text on dark)

This means `tok(darkMap, '--warm-neutral-900')` returns `#faf7f2` and `tok(darkMap, '--warm-neutral-50')` returns `#2a2724`. Body text on surface-0 in dark mode is therefore the same token names, different resolved values — the `PAIRS` array correctly reuses the same variable names for both `mode: 'light'` and `mode: 'dark'` entries.

### Full Test File Spec

```ts
// packages/design-system/contrast-audit.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CSS parsing ──────────────────────────────────────────────────────────────

function parseTokenMap(section: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    map[`--${m[1]}`] = m[2];
  }
  return map;
}

const css = readFileSync(resolve(__dirname, 'tokens/colors.css'), 'utf8');
const darkIdx = css.indexOf('[data-theme="dark"]');
const lightMap = parseTokenMap(darkIdx > -1 ? css.slice(0, darkIdx) : css);
const darkMap  = { ...lightMap, ...parseTokenMap(darkIdx > -1 ? css.slice(darkIdx) : '') };
const maps = { light: lightMap, dark: darkMap } as const;

function tok(map: Record<string, string>, name: string): string {
  const v = map[name];
  if (!v) throw new Error(`Token not found: ${name}`);
  return v;
}

// ── WCAG contrast ─────────────────────────────────────────────────────────────

function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = linearize(parseInt(hex.slice(1, 3), 16) / 255);
  const g = linearize(parseInt(hex.slice(3, 5), 16) / 255);
  const b = linearize(parseInt(hex.slice(5, 7), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// ── Pair matrix ───────────────────────────────────────────────────────────────

interface Pair {
  label: string;
  fg: string;
  bg: string;
  required: number;
  mode: 'light' | 'dark';
}

const PAIRS: Pair[] = [
  // Body text on surfaces — AAA 7:1
  { label: 'body/surface-0',       fg: '--warm-neutral-900', bg: '--warm-neutral-50',          required: 7,   mode: 'light' },
  { label: 'body/surface-1',       fg: '--warm-neutral-900', bg: '--warm-neutral-100',         required: 7,   mode: 'light' },
  { label: 'body/surface-0',       fg: '--warm-neutral-900', bg: '--warm-neutral-50',          required: 7,   mode: 'dark'  },
  { label: 'body/surface-1',       fg: '--warm-neutral-900', bg: '--warm-neutral-100',         required: 7,   mode: 'dark'  },
  // Focus indicator on surfaces — AA non-text 3:1
  { label: 'focus/surface-0',      fg: '--foliage-500',      bg: '--warm-neutral-50',          required: 3,   mode: 'light' },
  { label: 'focus/surface-0',      fg: '--foliage-500',      bg: '--warm-neutral-50',          required: 3,   mode: 'dark'  },
  // Safety-cleared trust chip text on chip bg — 4.5:1
  { label: 'safety-chip',          fg: '--safety-cleared-teal-700', bg: '--safety-cleared-teal-50',  required: 4.5, mode: 'light' },
  { label: 'safety-chip',          fg: '--safety-cleared-teal-900', bg: '--safety-cleared-teal-100', required: 4.5, mode: 'dark'  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WCAG contrast audit — token pairs', () => {
  it.each(PAIRS)('$label ($mode): ≥ $required:1', ({ label, fg, bg, required, mode }) => {
    const map = maps[mode];
    const fgHex = tok(map, fg);
    const bgHex = tok(map, bg);
    const ratio = contrastRatio(fgHex, bgHex);
    expect(
      ratio,
      `[${mode}] ${label}: ${fg}(${fgHex}) on ${bg}(${bgHex}) → ${ratio.toFixed(2)}:1 (required ${required}:1)`,
    ).toBeGreaterThanOrEqual(required);
  });
});
```

### tsconfig.json Update

The file at the package root is outside the current `"include": ["src/**/*"]` glob. Add it so `pnpm typecheck` catches type errors:

```json
{
  "extends": "@hivekitchen/tsconfig/base.json",
  "compilerOptions": {
    "module": "ESNext",
    "target": "ES2022"
  },
  "include": ["src/**/*", "contrast-audit.test.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### File Structure

**New files (create):**
```
packages/design-system/contrast-audit.test.ts    WCAG contrast audit harness
```

**Modified files:**
```
packages/design-system/tsconfig.json             Add "contrast-audit.test.ts" to include
packages/design-system/tokens/colors.css         Adjust any failing hex values (Task 4)
```

**No changes to:**
```
packages/design-system/src/tokens/index.ts       (token map export — unchanged)
packages/design-system/src/tokens/index.test.ts  (Tailwind preset tests — unchanged)
packages/design-system/src/tokens/fonts.test.ts  (font file tests — unchanged)
packages/design-system/package.json              (no new deps; vitest already installed)
```

### Potential Token Failures and Fixes

Watch for these marginal pairs on first run:

1. **`foliage-500` on `warm-neutral-50` (focus indicator, light mode)**
   - foliage-500 = `#7a9681`, warm-neutral-50 = `#faf7f2`
   - Approximate ratio: ~3.0:1 — right at the 3:1 floor, may fail by a hair
   - Fix if needed: darken foliage-500 in light map (e.g., `#728e79` or `#6f8c77`). Verify the dark map foliage-500 is unaffected (it's defined separately in the `[data-theme="dark"]` section).

2. **Safety-cleared chip dark mode pair**: `safety-cleared-teal-900` dark value = `#001d15`; `safety-cleared-teal-100` dark value = `#0d342b`. Both are very dark — contrast between them may be low.
   - Fix: swap fg to `safety-cleared-teal-800` dark value or use `safety-cleared-teal-900` dark value on a lighter bg stop (e.g., `safety-cleared-teal-200` or `300` dark).
   - Alternatively, update the pair in `PAIRS` to use a fg/bg combination that semantically matches what the UI renders (e.g., use the 900-dark on 200-dark for the chip).

3. **Body text pairs**: warm-neutral light mode yields ~11:1 (well above 7:1). Dark mode similarly inverts to high contrast. These should pass without adjustment.

**Minimal-change principle**: When adjusting, change the fewest number of stops. Single-stop corrections are preferred. Document any changes in the story's Dev Agent Record.

### Critical ESM / TypeScript Invariants (established by prior stories)

- `node:` prefix for all built-in module imports: `node:fs`, `node:path`, `node:url` — **not** `fs`, `path`, `url`
- `__dirname` does not exist in ESM. Use `dirname(fileURLToPath(import.meta.url))` — established in `fonts.test.ts` and Story 1.7/1.8
- No `require()` — ESM only (`"type": "module"` in package.json)
- No relative imports in this file (only `vitest` and `node:*` builtins imported) — `.js` extension rule does not apply here
- No `any` — use `Record<string, string>` and `as const`
- `import type` not needed in this file (no external types imported)

### CI Wiring Note

`.github/workflows/ci.yml` does not exist yet — it is created in Story 1.14. The contrast audit test is automatically included in CI because:
1. `packages/design-system/package.json` already has `"test": "vitest run --passWithNoTests"` 
2. Turborepo's `test` task runs `pnpm test` across all packages
3. Story 1.14's CI workflow will invoke the turbo `test` task, picking up this test automatically

No workflow changes needed in this story.

### Previous Story Intelligence (from Story 1.11)

- **Node.js pattern for file reads in tests**: `fonts.test.ts` in `packages/design-system/src/tokens/` uses exactly `readFileSync` + `dirname(fileURLToPath(import.meta.url))` + `resolve`. Mirror that pattern — do NOT use `__dirname` directly.
- **`it.each` with object array**: Confirmed working in the workspace; produces `test-name (mode): ...` output format.
- **No DOM / no jsdom**: This test has zero browser APIs; no `environment: 'jsdom'` needed. Vitest runs it in Node environment by default.
- **No mocking**: Read the real `tokens/colors.css`. Pure computation — no stubs, spies, or `vi.*` calls.
- **`vitest` version**: Workspace uses `vitest@^4.0.0` (confirmed from `packages/design-system/package.json`). `it.each` with object array and `$variable` interpolation is stable in v4.

### Architecture Compliance Invariants

| Rule | Source | Impact on This Story |
|---|---|---|
| WCAG 2.1/2.2 AA/AAA | Architecture NFR | Enforced programmatically; failing pair = CI block |
| No new dependencies for trivial utilities | Architecture philosophy | WCAG formula is ~15 lines inline; do not `pnpm add wcag-contrast` or similar |
| `node:` prefix for built-ins | Story 1.7 ESLint rule | `node:fs`, `node:path`, `node:url` only |
| ESM only — no `require()` | Architecture §1 | `import { readFileSync } from 'node:fs'` |
| `fileURLToPath` for path resolution | Established in Stories 1.7, 1.8 | `dirname(fileURLToPath(import.meta.url))` not `__dirname` |

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (Claude Opus 4.7, 1M context)

### Debug Log References

Initial test run produced one failing pair (7/8 pass):

```
[dark] focus/surface-0: --foliage-500(#5a7160) on --warm-neutral-50(#2a2724) → 2.80:1 (required 3:1)
```

Light-mode `focus/surface-0` (foliage-500 light = #7a9681 on warm-neutral-50 light = #faf7f2) passed without adjustment, contrary to the Dev Notes "Potential Failures" prediction (#1) that flagged the light-mode pair as marginal. The dark-mode counterpart was the actual failure.

Computed candidate hex values for foliage-500 dark via inline ratio function (Node, no library):

| Candidate | Ratio vs `#2a2724` | ΔRGB from `#5a7160` |
|---|---|---|
| `#5a7160` (current) | 2.804 | — (fails) |
| `#5d7563` | 2.963 | +3,+4,+3 (fails) |
| `#5e7565` | 2.976 | +4,+4,+5 (fails) |
| `#607766` | **3.061** | **+6,+6,+6 (passes)** |
| `#637a69` | 3.195 | +9,+9,+9 |
| `#647b6a` | 3.241 | +10,+10,+10 |

Selected `#607766` — smallest uniform nudge that crosses 3:1, with 0.06 margin above floor.

### Completion Notes List

- **Single token change** required to reach zero failures: `--foliage-500` in the dark-mode block adjusted from `#5a7160` → `#607766` (+6 per RGB channel). Light-mode foliage-500 (`#7a9681`) was untouched and continues to pass focus/surface-0 (light) cleanly.
- The dark scale R-channel stepping for foliage **improved** as a side effect: prior step 400→500 was +18 and 500→600 was +32 (non-uniform); after the nudge it is 400→500 = +24 and 500→600 = +26 (closer to uniform). Per-channel chroma/lightness relationship preserved.
- The 8 PAIRS in the harness are deterministic and source-of-truth: `--warm-neutral-900` on `--warm-neutral-50` and `--warm-neutral-100` (body, AAA 7:1, both modes) — passing comfortably (~12:1+ in both directions due to scale inversion); `--foliage-500` on `--warm-neutral-50` (focus, AA 3:1, both modes) — passing in light, passing in dark only after the foliage-500 nudge above; `--safety-cleared-teal-{700,900}` on `--safety-cleared-teal-{50,100}` (chip, 4.5:1, light/dark respectively) — passing in both modes.
- Dark-mode safety-cleared-teal chip pair (#cff9ed on #0d342b → ~14:1) was a non-issue contrary to Dev Notes warning #2. The story's selected stops (900-on-100) inverted via the dark-mode token redefinition produce a high-contrast white-on-dark-teal combination, not the dark-on-dark scenario the prediction described.
- No external WCAG library introduced. The contrast formula is implemented inline (~12 lines: `linearize`, `relativeLuminance`, `contrastRatio`) per AC #1.
- ESM/Node patterns honored: `node:fs`, `node:path`, `node:url` prefixed imports; `dirname(fileURLToPath(import.meta.url))` instead of `__dirname`; no `require()`; no `any`; `Record<string, string>` and `as const` for the maps record.
- `tsconfig.json` updated to add `"contrast-audit.test.ts"` to `include` so the root-level test file is covered by `pnpm typecheck` (Task 3).
- Verification gates all green:
  - `pnpm typecheck` — 9 tasks successful (api, web, ui, marketing, eslint-config, design-system, plus build deps)
  - `pnpm lint` — 5 tasks successful, 0 errors
  - `pnpm test` — 7 tasks successful; design-system reports **22 passed** (14 baseline + 8 new contrast pairs)

### Verification Gates

```
pnpm exec turbo run typecheck --filter="*"   → all packages green
pnpm exec turbo run lint --filter="*"        → 0 errors
pnpm exec turbo run test --filter="*"        → all packages green
  - @hivekitchen/design-system: 22+ passed (14 existing + 8 new contrast pairs)
```

### File List

**New:**
- `packages/design-system/contrast-audit.test.ts`

**Modified:**
- `packages/design-system/tsconfig.json`
- `packages/design-system/tokens/colors.css` _(if token adjustment needed)_

## Review Findings

- [x] [Review][Patch] `_color-gen.mjs` committed to repo root — not in story file list; developer utility that served its purpose (foliage-500 dark candidate generation); delete or gitignore before merge [_color-gen.mjs]
- [x] [Review][Defer] `--passWithNoTests` masks silent test discovery failure — pre-existing vitest config; test IS discovered and running (22 passed confirmed) [packages/design-system/package.json] — deferred, pre-existing

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-24 | Story created | Story Context Engine |
| 2026-04-24 | Implementation complete; 22/22 design-system tests passing; foliage-500 dark adjusted #5a7160 → #607766 (single-stop, +6 per channel) to clear focus/surface-0 (dark) at 3:1; status → review | Dev Agent (Opus 4.7) |
