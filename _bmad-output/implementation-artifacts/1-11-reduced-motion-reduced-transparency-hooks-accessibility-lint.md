# Story 1.11: Reduced-motion + reduced-transparency hooks + accessibility lint

Status: done

## Story

As a developer,
I want `useReducedMotion()` and `useReducedTransparency()` hooks plus verified `eslint-plugin-jsx-a11y` strict configuration,
So that every component built in Epic 2+ has access to the reduced-motion/transparency OS preference state for fallback rendering, and accessibility violations are caught at lint-time.

## Acceptance Criteria

1. `apps/web/src/lib/a11y/use-reduced-motion.ts` exports `useReducedMotion()` returning `boolean` derived from `window.matchMedia('(prefers-reduced-motion: reduce)')`, updating reactively when the OS preference changes.

2. `apps/web/src/lib/a11y/use-reduced-transparency.ts` exports `useReducedTransparency()` returning `boolean` derived from `window.matchMedia('(prefers-reduced-transparency: reduce)')`, updating reactively when the OS preference changes.

3. `apps/web/src/lib/a11y/index.ts` barrel re-exports both hooks as the public surface; consumers import from `@/lib/a11y`.

4. Unit tests in `apps/web/src/lib/a11y/a11y.test.tsx` verify:
   - Each hook returns the correct initial `boolean` when `matchMedia.matches` is `true` and when it is `false`
   - Each hook updates reactively when a simulated `MediaQueryList` `change` event fires with `matches: true` and then `matches: false`
   - The `change` event listener is removed on component unmount (no listener leak)

5. `eslint-plugin-jsx-a11y` strict rules are already active in `apps/web/` through `webConfig()` in `packages/eslint-config-hivekitchen` (wired in Story 1.5 — no config changes needed). A violation fixture at `packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/invalid.tsx` demonstrates that running ESLint against it reports a jsx-a11y violation. A valid counterpart at `packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/valid.tsx` demonstrates a passing file.

6. `pnpm typecheck`, `pnpm lint`, and `pnpm test` remain green workspace-wide.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight** (no AC)
  - [x] Confirm Story 1.10 is `done` in `sprint-status.yaml`
  - [x] Confirm `apps/web/src/lib/a11y/` does NOT yet exist
  - [x] Confirm `@testing-library/react` is NOT yet in `apps/web/package.json` (install in Task 2)
  - [x] Confirm jsx-a11y is active: search for `jsx-a11y` in `packages/eslint-config-hivekitchen/src/index.ts` — the `webConfig()` function must apply `jsxA11y.flatConfigs?.strict?.rules`

- [x] **Task 2 — Install @testing-library/react in apps/web** (AC: #4)
  - [x] Run `pnpm --filter @hivekitchen/web add -D @testing-library/react@^16.0.0`
  - [x] Verify `apps/web/package.json` devDependencies now lists `@testing-library/react`
  - [x] Run `pnpm typecheck` from workspace root — confirm still green

- [x] **Task 3 — Create useReducedMotion hook** (AC: #1)
  - [x] Create `apps/web/src/lib/a11y/` directory
  - [x] Create `apps/web/src/lib/a11y/use-reduced-motion.ts` per **useReducedMotion Spec** in Dev Notes

- [x] **Task 4 — Create useReducedTransparency hook** (AC: #2)
  - [x] Create `apps/web/src/lib/a11y/use-reduced-transparency.ts` per **useReducedTransparency Spec** in Dev Notes

- [x] **Task 5 — Create a11y barrel** (AC: #3)
  - [x] Create `apps/web/src/lib/a11y/index.ts` re-exporting both hooks

- [x] **Task 6 — Write tests** (AC: #4)
  - [x] Create `apps/web/src/lib/a11y/a11y.test.tsx` per **Test Spec** in Dev Notes
  - [x] Run `pnpm test` — all tests pass (new + prior)

- [x] **Task 7 — Add jsx-a11y fixtures** (AC: #5)
  - [x] Create `packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/invalid.tsx` per **Fixture Spec** in Dev Notes
  - [x] Create `packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/valid.tsx`
  - [x] Run `pnpm lint` — confirms 0 errors workspace-wide (fixtures are NOT linted by default; they exist for reference)

- [x] **Task 8 — Verification** (AC: #6)
  - [x] `pnpm typecheck` — all packages green (9/9 successful)
  - [x] `pnpm lint` — 0 errors workspace-wide (5/5 successful)
  - [x] `pnpm test` — all tests green (7/7 successful — 32 web + 22 eslint-config + 74 contracts + 20 api + 14 design-system + 1 ui)
  - [x] Update `sprint-status.yaml` story to `review`

---

## Dev Notes

### Architecture References

- `_bmad-output/planning-artifacts/architecture.md` — Non-functional requirements: "WCAG 2.1/2.2 AA; readability CI check; TTS caption fallback"
- `_bmad-output/planning-artifacts/architecture.md` §Starter Options — `eslint-plugin-jsx-a11y` listed in lint tooling (workspace root devDependency)
- `_bmad-output/planning-artifacts/epics.md` Story 1.4 — `motion.css` defines `--sacred-ease` cubic-bezier with reduced-motion fallback; `useReducedMotion` hooks into this system
- `_bmad-output/planning-artifacts/epics.md` Story 1.5 — jsx-a11y strict wired in `webConfig()`; this story verifies + demonstrates it, does NOT rewire
- `apps/web/CLAUDE.md` — "lib/ — API client, SSE client, utilities" — `lib/a11y/` is a utility, correct location

### CRITICAL: jsx-a11y is Already Configured

**Do NOT modify `packages/eslint-config-hivekitchen/src/index.ts` or `apps/web/eslint.config.mjs`.**

Story 1.5 already wired jsx-a11y strict into `webConfig()`:

```ts
// packages/eslint-config-hivekitchen/src/index.ts (already exists, DO NOT MODIFY)
...(jsxA11y.flatConfigs?.strict?.rules ?? jsxA11y.configs?.strict?.rules ?? {})
```

And `apps/web/eslint.config.mjs` already calls `webConfig({ scopeAllowlist })`.

This means jsx-a11y strict is **already active** on all `.tsx` files in `apps/web/`. Story 1.11's AC #5 is satisfied by Story 1.5's code. This story only adds the fixtures to demonstrate it.

### useReducedMotion Spec

```ts
// apps/web/src/lib/a11y/use-reduced-motion.ts
import { useState, useEffect } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Returns true when the user's OS has enabled the "reduce motion" accessibility setting.
 * Updates reactively when the setting changes without a page reload.
 * Use this hook to suppress or simplify CSS animations in Epic 2+ components.
 */
export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(
    () => window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };
    mql.addEventListener('change', handler);
    return () => {
      mql.removeEventListener('change', handler);
    };
  }, []);

  return prefersReducedMotion;
}
```

**Why `useState(() => window.matchMedia(QUERY).matches)` (lazy initializer)?** The lazy function form ensures `matchMedia` is only called once on mount, not on every render during the initial evaluation phase. The `useEffect` then attaches the listener for future changes. This avoids a potential mismatch between initial render value and the OS setting.

**SSR safety note:** Vite SPA has no SSR. `window` is always defined. No `typeof window !== 'undefined'` guard needed — it adds noise without protection. If this codebase ever adds SSR (which the architecture explicitly rules out for `apps/web`), revisit.

### useReducedTransparency Spec

```ts
// apps/web/src/lib/a11y/use-reduced-transparency.ts
import { useState, useEffect } from 'react';

const QUERY = '(prefers-reduced-transparency: reduce)';

/**
 * Returns true when the user's OS has enabled the "reduce transparency" accessibility setting.
 * Updates reactively when the setting changes without a page reload.
 * Use this hook to substitute solid backgrounds for translucent/blur surfaces in Epic 2+ components.
 */
export function useReducedTransparency(): boolean {
  const [prefersReducedTransparency, setPrefersReducedTransparency] = useState<boolean>(
    () => window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => {
      setPrefersReducedTransparency(e.matches);
    };
    mql.addEventListener('change', handler);
    return () => {
      mql.removeEventListener('change', handler);
    };
  }, []);

  return prefersReducedTransparency;
}
```

The two hooks are intentionally symmetric — same structure, different `QUERY` constant.

### a11y Barrel Spec

```ts
// apps/web/src/lib/a11y/index.ts
export { useReducedMotion } from './use-reduced-motion.js';
export { useReducedTransparency } from './use-reduced-transparency.js';
```

Consumers use: `import { useReducedMotion, useReducedTransparency } from '@/lib/a11y';`

### Test Spec

**Key challenge:** jsdom (used by Vitest in `apps/web`) does not implement `window.matchMedia`. Every test that uses hooks calling `matchMedia` must mock it in `beforeEach`.

**Approach:** Manual mock of `window.matchMedia` with a controlled `listeners` array so tests can simulate `change` events. Use `@testing-library/react`'s `renderHook` and `act` for React integration.

```tsx
// apps/web/src/lib/a11y/a11y.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReducedMotion } from './use-reduced-motion.js';
import { useReducedTransparency } from './use-reduced-transparency.js';

// --- matchMedia mock factory ---
// jsdom does not implement window.matchMedia. This factory creates a controllable mock.

type ChangeHandler = (e: MediaQueryListEvent) => void;

function makeMockMql(initialMatches: boolean) {
  const handlers: ChangeHandler[] = [];
  const mql = {
    matches: initialMatches,
    addEventListener: vi.fn((type: string, handler: ChangeHandler) => {
      if (type === 'change') handlers.push(handler);
    }),
    removeEventListener: vi.fn((type: string, handler: ChangeHandler) => {
      if (type === 'change') {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      }
    }),
    // Test helper — simulates the OS preference changing
    __fireChange: (matches: boolean) => {
      mql.matches = matches;
      handlers.forEach(fn => fn({ matches } as MediaQueryListEvent));
    },
    __listenerCount: () => handlers.length,
  };
  return mql;
}

type MockMql = ReturnType<typeof makeMockMql>;

let motionMql: MockMql;
let transparencyMql: MockMql;

beforeEach(() => {
  motionMql = makeMockMql(false);
  transparencyMql = makeMockMql(false);

  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    if (query === '(prefers-reduced-motion: reduce)') {
      return motionMql as unknown as MediaQueryList;
    }
    if (query === '(prefers-reduced-transparency: reduce)') {
      return transparencyMql as unknown as MediaQueryList;
    }
    return { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- useReducedMotion ---

describe('useReducedMotion', () => {
  it('returns false when OS prefers-reduced-motion is off', () => {
    motionMql = makeMockMql(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => motionMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns true when OS prefers-reduced-motion is on', () => {
    motionMql = makeMockMql(true);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => motionMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('updates to true when OS preference changes to reduce-motion', () => {
    motionMql = makeMockMql(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => motionMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      motionMql.__fireChange(true);
    });

    expect(result.current).toBe(true);
  });

  it('updates back to false when OS preference reverts', () => {
    motionMql = makeMockMql(true);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => motionMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useReducedMotion());

    act(() => {
      motionMql.__fireChange(false);
    });

    expect(result.current).toBe(false);
  });

  it('removes the change listener on unmount', () => {
    motionMql = makeMockMql(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => motionMql as unknown as MediaQueryList);
    const { unmount } = renderHook(() => useReducedMotion());

    expect(motionMql.__listenerCount()).toBe(1);
    unmount();
    expect(motionMql.__listenerCount()).toBe(0);
  });
});

// --- useReducedTransparency ---

describe('useReducedTransparency', () => {
  it('returns false when OS prefers-reduced-transparency is off', () => {
    transparencyMql = makeMockMql(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => transparencyMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useReducedTransparency());
    expect(result.current).toBe(false);
  });

  it('returns true when OS prefers-reduced-transparency is on', () => {
    transparencyMql = makeMockMql(true);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => transparencyMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useReducedTransparency());
    expect(result.current).toBe(true);
  });

  it('updates to true when OS preference changes to reduce-transparency', () => {
    transparencyMql = makeMockMql(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => transparencyMql as unknown as MediaQueryList);
    const { result } = renderHook(() => useReducedTransparency());

    act(() => {
      transparencyMql.__fireChange(true);
    });

    expect(result.current).toBe(true);
  });

  it('removes the change listener on unmount', () => {
    transparencyMql = makeMockMql(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => transparencyMql as unknown as MediaQueryList);
    const { unmount } = renderHook(() => useReducedTransparency());

    expect(transparencyMql.__listenerCount()).toBe(1);
    unmount();
    expect(transparencyMql.__listenerCount()).toBe(0);
  });
});
```

**Critical test notes:**

1. **`vi.spyOn(window, 'matchMedia')`** — Must be called AFTER `beforeEach` sets `motionMql`/`transparencyMql`. Tests that need specific `matches` values override the spy with a new `makeMockMql` call inside the test body, then re-apply `vi.spyOn`. This is the pattern used above.

2. **`renderHook` from `@testing-library/react`** — Renders the hook inside a minimal React component tree managed by the test framework. No need to create your own wrapper component.

3. **`act` from `@testing-library/react`** — Wraps state updates that happen outside of React events (like `__fireChange`) so React processes them synchronously before the assertion. Without `act`, `result.current` would reflect the pre-update value.

4. **File extension `.tsx`** — The test file uses `.tsx` extension even though it has no JSX, because `@testing-library/react` renders into a DOM and some versions require the React import in scope. Vitest's `include` pattern in `apps/web/vitest.config.ts` already covers `.test.tsx` via `src/**/*.test.tsx`.

5. **`@testing-library/react` version**: Install `@testing-library/react@^16.0.0` — this is the version compatible with React 19 (v16 targets React 18+; for React 19, verify the specific minor version supports React 19 at install time).

### jsx-a11y Fixture Spec

These fixtures are for **documentation/demonstration** only. They are NOT included in the lint run (the `__fixtures__/` directory is excluded via `{ ignores: ['dist/**', 'node_modules/**', '.turbo/**'] }` in `apps/web/eslint.config.mjs`, and the eslint config in `packages/eslint-config-hivekitchen/` does not lint its own fixtures directory in CI).

```tsx
// packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/invalid.tsx
// Demonstrates jsx-a11y strict violations that webConfig() catches.
// DO NOT fix these — they are intentional violation examples.
/* eslint-disable */

// violation: img element must have an alt attribute
export function MissingAlt() {
  return <img src="/logo.png" />;
}

// violation: anchor element must have discernible text
export function EmptyAnchor() {
  return <a href="/home"></a>;
}

// violation: interactive elements must be focusable
export function NonFocusableButton() {
  return <div onClick={() => {}} />;
}
```

```tsx
// packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/valid.tsx
// Demonstrates jsx-a11y-compliant equivalents of the invalid.tsx examples.
/* eslint-disable */

export function WithAlt() {
  return <img src="/logo.png" alt="HiveKitchen logo" />;
}

export function AnchorWithText() {
  return <a href="/home">Go home</a>;
}

export function FocusableButton() {
  return <button type="button" onClick={() => {}}>Click me</button>;
}
```

### Critical ESM / TypeScript Invariants (from Stories 1.9 + 1.10)

- All relative imports use `.js` extension: `import { useReducedMotion } from './use-reduced-motion.js'` ✅
- `import type` for type-only imports ✅
- NO `__dirname` or `__filename` — use `import.meta.url` + `fileURLToPath` if path resolution is needed (not needed in this story)
- No `any` — the `as unknown as MediaQueryList` double-cast in tests is acceptable test-only bypass
- `import.meta.env.DEV` — NOT used in these hooks (no dev-mode guards needed; the hooks have no side effects that need to be dev-only)
- `no-console` rule is NOT active in `apps/web/` (only `apps/api/src/**/*.ts`) — per Story 1.10 debug log

### Boundary Rules

- Files in `apps/web/src/lib/` are cross-feature utilities — they CAN import from `react` and `@hivekitchen/contracts` / `@hivekitchen/types`
- `lib/a11y/` files CANNOT import from feature modules (`features/plan/`, etc.) — dependency flows inward only
- No `framer-motion` imports anywhere in `apps/web/` (ESLint ban per architecture §4.3)
- No Zustand store from `lib/` — hooks use local `useState` only; global preference store is NOT needed (OS preference is queried per-mount, state is local)

### File Structure

**New files (create):**
```
apps/web/src/lib/a11y/
  ├── use-reduced-motion.ts          useReducedMotion() hook
  ├── use-reduced-transparency.ts    useReducedTransparency() hook
  ├── a11y.test.tsx                  Unit tests for both hooks
  └── index.ts                       Public barrel re-export

packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/
  ├── invalid.tsx                    jsx-a11y violation examples (for reference)
  └── valid.tsx                      Compliant equivalents
```

**Modified files:**
```
apps/web/package.json               Add @testing-library/react devDependency
```

**No changes to:**
```
packages/eslint-config-hivekitchen/src/index.ts   (jsx-a11y already configured)
apps/web/eslint.config.mjs                        (already calls webConfig())
apps/web/vitest.config.ts                         (already covers .test.tsx)
```

### Architecture Compliance Invariants

| Rule | Source | Impact on This Story |
|---|---|---|
| WCAG 2.1/2.2 AA | Architecture NFR | `useReducedMotion` and `useReducedTransparency` are the primary building blocks for AA-compliant motion/transparency handling in Epic 2+ components |
| jsx-a11y strict | Story 1.5 / Architecture | Already active via `webConfig()`. Do NOT add a second jsx-a11y config block. |
| `lib/` dependency direction | Architecture §4 | `lib/a11y/` imports only from `react` — no feature or store imports |
| No `framer-motion` | Architecture §4.3 | Not relevant to this story (hooks deal with OS preferences, not animation libraries) |
| ESM `.js` extensions | Story 1.9 convention | All relative imports in `apps/web/src/` use `.js` suffix |
| `no-console` ban scope | Story 1.10 debug log | Applies only to `apps/api/src/**/*.ts`, NOT `apps/web/src/` |

### Previous Story Intelligence (from Story 1.10)

- `vi.spyOn` approach for `window.*` APIs — mirrors how Story 1.10 mocked `sessionStorage` and `crypto.randomUUID` via `vi.stubGlobal`
- `vi.restoreAllMocks()` in `afterEach` — restores spies after each test; the Story 1.10 equivalent was `vi.unstubAllGlobals()`
- `jsdom` environment already configured in `apps/web/vitest.config.ts` — no setup file needed
- `@vitest/coverage-v8` already installed — coverage runs automatically with `pnpm test`
- `@testing-library/react` installs into `apps/web` devDependencies alongside `vitest` and `jsdom`

### Deferred Items (out of scope for Story 1.11)

1. **Axe-core / Playwright accessibility audit** — `@axe-core/playwright` integration belongs in Story 1.13 (Lighthouse CI / a11y gate in `.github/workflows/`)
2. **Reduced motion CSS variables** — `motion.css` with `--sacred-ease` and `@media (prefers-reduced-motion)` override is Story 1.4 scope (already delivered). `useReducedMotion()` provides the React-level interface; CSS-level handling is the token layer.
3. **`useScopeGuard` hook tests** — Story 1.5 deferred: "import.meta.env.DEV may be undefined under Vitest when hook tests land". The `use-reduced-motion` and `use-reduced-transparency` hooks do NOT use `import.meta.env.DEV`, so this deferred concern does not apply here.
4. **Global `matchMedia` mock in vitest setup** — Could be added to `apps/web/vitest.config.ts` `setupFiles`. Not done here since only this story's tests need it currently; address in a test-hygiene pass when more hooks that call `matchMedia` are added.
5. **`prefers-contrast` hook** — Not in Epic 1 scope; add in a future a11y story if needed.

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- Stripped `/* eslint-disable */` from jsx-a11y fixtures to align with the existing fixture convention (no-cross-scope, no-dialog, logical-props): fixtures are not linted by `pnpm lint` (the eslint-config package self-lints to `echo 'no self-lint'` and `apps/web` only lints `src/`), and `__fixtures__/` is excluded from typecheck via `tsconfig.json#exclude`.
- Added two ESLint API tests to `packages/eslint-config-hivekitchen/src/index.test.ts` that programmatically lint `__fixtures__/jsx-a11y/invalid.tsx` and `valid.tsx`: confirms `jsx-a11y/alt-text`, `jsx-a11y/anchor-has-content`, and one of `click-events-have-key-events`/`no-static-element-interactions` fire on the invalid fixture, and the valid fixture reports zero jsx-a11y violations.
- Workspace-wide turbo orchestration: `pnpm test`/`pnpm lint`/`pnpm typecheck` from root sometimes restricts scope to `@hivekitchen/web` only; ran `pnpm exec turbo run <task> --filter="*"` to force full coverage for verification. Individual `pnpm --filter <pkg> <task>` runs also confirmed each package green.
- jsdom (apps/web vitest environment) does not implement `window.matchMedia`; mocked it via `vi.spyOn(window, 'matchMedia').mockImplementation(...)` in `beforeEach`, restored with `vi.restoreAllMocks()` in `afterEach`.

### Completion Notes List

- All 8 tasks completed.
- 10 new tests in `apps/web/src/lib/a11y/a11y.test.tsx` — all pass (5 per hook: initial-false, initial-true, change-to-true, change-to-false, listener-cleanup-on-unmount).
- 2 new tests in `packages/eslint-config-hivekitchen/src/index.test.ts` — programmatic verification that jsx-a11y rules fire on the invalid fixture and that the valid fixture is clean.
- `eslint-plugin-jsx-a11y` strict configuration was already wired by Story 1.5; no changes to `packages/eslint-config-hivekitchen/src/index.ts` or `apps/web/eslint.config.mjs` were required.
- Both hooks use the exact pattern from the spec: lazy `useState` initializer + `useEffect` with `addEventListener('change')` + cleanup on unmount.
- Barrel at `apps/web/src/lib/a11y/index.ts` re-exports `useReducedMotion` and `useReducedTransparency`; consumers import via `@/lib/a11y`.

### Verification Gates

```
pnpm exec turbo run typecheck --filter="*"   → Tasks: 9 successful, 9 total
pnpm exec turbo run lint --filter="*"        → Tasks: 5 successful, 5 total (0 errors)
pnpm exec turbo run test --filter="*"        → Tasks: 7 successful, 7 total
  - @hivekitchen/contracts:    74 passed
  - @hivekitchen/api:          20 passed (11 integration tests skipped — Docker)
  - @hivekitchen/design-system: 14 passed
  - @hivekitchen/ui:            1 passed
  - @hivekitchen/eslint-config: 22 passed (incl. 2 new fixture tests)
  - @hivekitchen/web:          32 passed (incl. 10 new a11y hook tests)
pnpm -w run tools:check       → Exits 0 (no tools/ directory; nothing to cross-check)
```

### File List

**New:**
- `apps/web/src/lib/a11y/use-reduced-motion.ts`
- `apps/web/src/lib/a11y/use-reduced-transparency.ts`
- `apps/web/src/lib/a11y/index.ts`
- `apps/web/src/lib/a11y/a11y.test.tsx`
- `packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/invalid.tsx`
- `packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/valid.tsx`

**Modified:**
- `apps/web/package.json` (added `@testing-library/react@^16.0.0` to devDependencies)
- `packages/eslint-config-hivekitchen/src/index.test.ts` (added two fixture-verification tests + node:fs/url/path imports + Linter import)

### Review Findings

- [x] [Review][Patch] Fixture header comments show wrong `@file:` path — both files claim `apps/web/src/features/example.tsx`; actual paths are `packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/invalid.tsx` and `valid.tsx` [`packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/invalid.tsx:1`, `valid.tsx:1`]

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-24 | Story created | Story Context Engine |
| 2026-04-24 | Implementation complete | claude-opus-4-7 |
| 2026-04-24 | Code review | claude-sonnet-4-6 |
