# Story 1.5: Scope charter + ESLint scope-allowlist rules + dev-mode runtime assertions

Status: done

## Story

As a developer,
I want the four UX scopes enforced by a written charter plus an ESLint rule plus dev-mode runtime assertions,
so that scope leakage is caught at three independent layers (review, lint, runtime).

## Acceptance Criteria

1. `packages/design-system/SCOPE_CHARTER.md` exists as canonical spec for what renders where (`.app-scope` / `.child-scope` / `.grandparent-scope` / `.ops-scope` — allowed/forbidden components and voice register per scope).

2. `packages/eslint-config-hivekitchen/` is a workspace package (`@hivekitchen/eslint-config`) that exports a flat ESLint v9 config with:
   - (a) Custom rule `no-cross-scope-component` that reads scope restrictions via rule options (populated from `packages/ui/src/scope-allowlist.config.ts`); forbids importing scope-locked components into wrong scope's route tree.
   - (b) Custom rule `no-dialog-outside-allowlist` that forbids importing any Radix/Shadcn dialog primitive outside the four allowlisted feature directories: auth re-entry, safety-block explainer, command palette, hard-forget Phase 2+ stub.
   - (c) `eslint-plugin-jsx-a11y` strict configuration.
   - (d) Custom rule `logical-properties-only` forbidding `marginLeft`/`marginRight`/`paddingLeft`/`paddingRight` in JSX `style` props, and forbidding Tailwind physical spacing classes `ml-*`/`mr-*`/`pl-*`/`pr-*` in `className` string literals.
   - (e) `eslint-plugin-boundaries` configured with API module boundary rules: agents/ cannot import fastify/routes; files outside `plugins/` cannot import vendor SDKs; files outside `*/repository.ts` cannot import Supabase client; files outside `audit/` cannot write to `audit_log` directly.

3. `packages/ui/src/scope-allowlist.config.ts` exists with `ScopeClass` type and `scopeAllowlist` record that defines `forbiddenComponents` per scope.

4. Route group layout shells exist at `apps/web/src/routes/(app)/layout.tsx`, `(child)/layout.tsx`, `(grandparent)/layout.tsx`, `(ops)/layout.tsx` — each layout applies the corresponding scope class to `document.documentElement` on mount and removes it on unmount.

5. `packages/ui/src/hooks/use-scope-guard.ts` exports `useScopeGuard(scope: ScopeClass): void` — DEV-only hook that throws if the expected scope class is not present on `<html>` at mount time; no-op in production.

6. `packages/eslint-config-hivekitchen/__fixtures__/` contains one valid + one invalid file per custom rule demonstrating each rule firing correctly.

7. ESLint is wired into `apps/web` (via `apps/web/eslint.config.mjs`) and `apps/api` (via `apps/api/eslint.config.mjs`); `pnpm lint` from workspace root passes with 0 errors against the current codebase.

8. `pnpm typecheck` and `pnpm test` remain green with no regressions from Story 1.4's state.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight** (no AC)
  - [x] Confirm Story 1.4 is `done` in `sprint-status.yaml`.
  - [x] Confirm `packages/eslint-config-hivekitchen/` does NOT yet exist.
  - [x] Confirm root `package.json` has no `eslint` devDependency.
  - [x] Confirm `apps/web/eslint.config.*` does NOT yet exist.
  - [x] Confirm `packages/ui/src/scope-allowlist.config.ts` does NOT yet exist.

- [x] **Task 2 — Install ESLint dependencies at workspace root** (AC: #2, #6)
  - [x] In root `package.json` devDependencies, add: `eslint ^9.x`, `typescript-eslint ^8.x`, `eslint-plugin-jsx-a11y ^6.x`, `eslint-plugin-boundaries ^4.x`, `eslint-plugin-react ^7.x`, `eslint-plugin-react-hooks ^5.x`.
  - [x] Note: use `typescript-eslint` (the modern monorepo package) — NOT the legacy `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` split. See **Architecture Doc Discrepancy** in Dev Notes.
  - [x] Run `pnpm install` at workspace root.

- [x] **Task 3 — Create `packages/eslint-config-hivekitchen/` workspace package** (AC: #2)
  - [x] Create `packages/eslint-config-hivekitchen/package.json` per **Exact package.json** in Dev Notes.
  - [x] Create `packages/eslint-config-hivekitchen/tsconfig.json` extending `@hivekitchen/tsconfig/base.json` with `"module": "ESNext"`, `"target": "ES2022"`, `"exclude": ["node_modules", "dist", "__fixtures__"]` (fixtures excluded from typecheck — see Completion Notes).
  - [x] Add `@hivekitchen/eslint-config` as a dev-dependency to `apps/web/package.json`, `apps/api/package.json`, `packages/ui/package.json`.
  - [x] Create `packages/eslint-config-hivekitchen/src/index.ts` as the main exports entry.
  - [x] Create `packages/eslint-config-hivekitchen/src/rules/` directory.

- [x] **Task 4 — Create `packages/ui/src/scope-allowlist.config.ts`** (AC: #3)
  - [x] Define and export `ScopeClass` type: `'app-scope' | 'child-scope' | 'grandparent-scope' | 'ops-scope'`.
  - [x] Define and export `ScopeRestrictions` interface: `{ forbiddenComponents: string[] }`.
  - [x] Export `scopeAllowlist: Record<ScopeClass, ScopeRestrictions>`.
  - [x] Add `export * from './scope-allowlist.config.js'` to `packages/ui/src/index.ts`.

- [x] **Task 5 — Write custom rule: `no-cross-scope-component`** (AC: #2a, #6)
  - [x] Create `packages/eslint-config-hivekitchen/src/rules/no-cross-scope-component.ts`.
  - [x] Rule determines current file's scope from its path.
  - [x] Rule schema option: `scopeAllowlist: Record<ScopeClass, { forbiddenComponents: string[] }>`.
  - [x] Visits `ImportDeclaration` and reports each forbidden `ImportSpecifier`.
  - [x] Create `__fixtures__/no-cross-scope/valid.tsx` and `invalid.tsx`.

- [x] **Task 6 — Write custom rule: `no-dialog-outside-allowlist`** (AC: #2b, #6)
  - [x] Create `packages/eslint-config-hivekitchen/src/rules/no-dialog-outside-allowlist.ts`.
  - [x] Flags dialog sources and matching named imports.
  - [x] Schema option: `allowlist: string[]`; path-substring match.
  - [x] Create `__fixtures__/no-dialog/valid.tsx` and `invalid.tsx`.

- [x] **Task 7 — Write custom rule: `logical-properties-only`** (AC: #2d, #6)
  - [x] Create `packages/eslint-config-hivekitchen/src/rules/logical-properties-only.ts`.
  - [x] Check A — JSX `style` prop object: reports `marginLeft` / `marginRight` / `paddingLeft` / `paddingRight`.
  - [x] Check B — `className` string literals: reports `ml-*` / `mr-*` / `pl-*` / `pr-*` Tailwind tokens.
  - [x] Create `__fixtures__/logical-props/valid.tsx` and `invalid.tsx`.

- [x] **Task 8 — Configure `eslint-plugin-boundaries` for API module boundaries** (AC: #2e)
  - [x] `apiConfig()` exports boundaries elements + `no-restricted-imports` for vendor SDK / Supabase + `no-restricted-syntax` for direct `audit_log` writes outside `audit/`.
  - [x] Create `__fixtures__/boundaries/valid.ts` and `invalid.ts`.

- [x] **Task 9 — Write ESLint rule unit tests** (AC: #2a, #2b, #2d)
  - [x] `no-cross-scope-component.test.ts`, `no-dialog-outside-allowlist.test.ts`, `logical-properties-only.test.ts` — each 2 valid + 2 invalid (12 tests total, all green).
  - [x] Uses `RuleTester` from `eslint` directly (ESLint v9 — see Completion Notes: `@eslint/rule-tester` is not a published package).
  - [x] Added `vitest.config.ts` for the package.

- [x] **Task 10 — Create `packages/design-system/SCOPE_CHARTER.md`** (AC: #1)
  - [x] Scope definitions, inventory, voice register, typography minimums, three-layer enforcement, prohibited items index.

- [x] **Task 11 — Create route group layout shells** (AC: #4)
  - [x] `(app)/layout.tsx`, `(child)/layout.tsx`, `(grandparent)/layout.tsx`, `(ops)/layout.tsx` — each toggles its scope class on mount/unmount.
  - [x] `apps/web/index.html` → `<html lang="en" class="app-scope">`.

- [x] **Task 12 — Create `useScopeGuard` hook** (AC: #5)
  - [x] `packages/ui/src/hooks/use-scope-guard.ts` — `useEffect` unconditional, DEV guard inside effect body.
  - [x] Exported from `packages/ui/src/index.ts`; `ScopeClass` re-exported via `scope-allowlist.config.ts`.

- [x] **Task 13 — Build step and ESLint configs for apps** (AC: #7)
  - [x] `build`/`prebuild` scripts on `@hivekitchen/eslint-config`; `tsconfig.build.json` emits to `dist/`.
  - [x] Root `turbo.json` already runs `lint` with `dependsOn: ["^build"]` — no edit needed.
  - [x] `apps/web/eslint.config.mjs` + `apps/api/eslint.config.mjs`.
  - [x] `apps/api/package.json` already had `"lint": "eslint src"`.

- [x] **Task 14 — Verification** (AC: #7, #8)
  - [x] `pnpm lint` — 0 errors across web/api/marketing.
  - [x] `pnpm typecheck` — 9 tasks successful.
  - [x] `pnpm test` — contracts (74) + design-system (14) + eslint-config (12) all green, no regressions.
  - [x] Scratch violation planted and removed — `no-cross-scope-component` fires with the expected message.
  - [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` — updated to `review` (workflow Step 9; `done` is set by code-review, not the dev agent).
  - [x] Story Status set to `review` per workflow Step 9.

### Review Findings

- [x] [Review][Decision] Scope class lifecycle — **Resolved (D1=1, central controller):** Introduced `useScope(scope)` hook that atomically removes all known scope classes and adds the target before paint (`useLayoutEffect`). All four layouts now use it. No cleanup needed; next layout's mount swaps atomically. [packages/ui/src/hooks/use-scope.ts, apps/web/src/routes/(*)/layout.tsx]
- [x] [Review][Decision] `no-dialog-outside-allowlist` scope — **Resolved (D2=3, expand narrowly):** Removed fake `@radix-ui/react-sheet`; added `vaul` and `cmdk` to the exact-match source set; default/namespace specifiers on `@radix-ui/*` now also reported. Shadcn wrappers left to `no-cross-scope-component` (redundant coverage avoided). [packages/eslint-config-hivekitchen/src/rules/no-dialog-outside-allowlist.ts]
- [x] [Review][Decision] Dynamic import / require of vendor SDKs — **Resolved (D3=1, block all forms):** Added `no-restricted-syntax` selectors for `ImportExpression` and `require()` call expressions targeting Supabase/OpenAI/ElevenLabs/Stripe/SendGrid/Twilio/ioredis/bullmq. Scoped to non-plugin / non-repository paths. [packages/eslint-config-hivekitchen/src/index.ts]
- [x] [Review][Patch] Renamed exported `ScopeRestriction` → `ScopeRestrictions` in eslint-config to match spec AC #3
- [x] [Review][Patch] `useScopeGuard` moved to `useLayoutEffect`; guard is now pre-paint and no longer racing layout class-add
- [x] [Review][Patch] `no-cross-scope-component` now visits `ImportDefaultSpecifier`, `ImportNamespaceSpecifier`, and re-exports via `ExportNamedDeclaration`
- [x] [Review][Patch] `logical-properties-only` now walks TemplateLiterals, `clsx`/`cn`/`classnames`/`twMerge`/`twJoin` CallExpressions, ConditionalExpressions, LogicalExpressions, ArrayExpressions — Tailwind variant prefixes (`sm:`, `hover:`, `group-hover:`, `dark:`) match via updated regex
- [x] [Review][Patch] Added deep-equal sync test for `scope-allowlist.config.ts` ↔ `scope-allowlist.eslint.js`
- [x] [Review][Patch] `useScopeGuard` now emits `console.error` instead of throwing — no more tree teardown on stale scope class
- [x] [Review][Patch] Added `"lint": "echo 'no self-lint'"` script to eslint-config `package.json`
- [x] [Review][Patch] Removed blanket `Literal[value='audit_log']` selector — keep only the `.insert`-scoped write restriction per AC #2(e)
- [x] [Review][Patch] Added `allowTypeImports: true` to both Supabase and vendor-SDK `no-restricted-imports` pattern groups
- [x] [Review][Patch] Changed `@supabase/*` → `@supabase/**` to catch deep imports
- [x] [Review][Patch] Scope detection anchored to `apps/web/src/routes/(X)/` with fallback to `/routes/` or bare `(X)/` prefix for relative filenames
- [x] [Review][Patch] Added `JSXSpreadAttribute` visitor in `logical-properties-only` covering both `className` and nested `style` objects
- [x] [Review][Patch] Style-prop visitor accepts `Literal` (quoted-string) keys as well as `Identifier` keys
- [x] [Review][Patch] Added `packages/eslint-config-hivekitchen/src/index.test.ts` — 8 tests asserting React + react-hooks + jsx-a11y strict + 3 hivekitchen rules load into `webConfig()`, plus `boundaries/element-types`, `no-restricted-imports`, `no-restricted-syntax` in `apiConfig()`
- [x] [Review][Defer] Shorthand `margin: '0 0 0 8px'` / `padding: '…'` physical values — deferred, spec scope was long-hand properties only
- [x] [Review][Defer] `left`/`right`/`top`/`bottom`/`borderLeft`/`borderRight`/`textAlign: 'left'` not in the logical map — deferred, spec scope limited to margin/padding
- [x] [Review][Defer] `import.meta.env.DEV` may be undefined under Vitest — deferred, no hook tests yet; setup belongs with those tests
- [x] [Review][Defer] Relative `../../packages/ui/...` path in `apps/web/eslint.config.mjs` — deferred, cleanup when a proper package export is added
- [x] [Review][Defer] Re-export barrel inside `apps/api/src/plugins/` circumvents `no-restricted-imports` — deferred, plugins/ is small today
- [x] [Review][Defer] Dynamic `import()` / `require()` not visited by `no-cross-scope-component` — deferred, rare in Vite/React apps
- [x] [Review][Defer] Type-only imports flagged identically by `no-cross-scope-component` — deferred, cosmetic
- [x] [Review][Defer] Low-severity edge collection — allowlist substring positional-agnostic, arbitrary value with spaces, computed style keys, runtime ScopeClass string validation, DOM MutationObserver — deferred

---

## Dev Notes

### Architecture References (authoritative sources)
- [UX-DR12] `no-cross-scope-component` rule — epics.md §Additional Requirements
- [UX-DR13] `SCOPE_CHARTER.md` — epics.md
- [UX-DR14] Three-layer scope enforcement — epics.md
- [UX-DR63] `eslint-plugin-jsx-a11y` strict + logical-property rule — epics.md
- Architecture §6 boundaries (`eslint-plugin-boundaries`) — `_bmad-output/planning-artifacts/architecture.md` §"Project Structure & Boundaries"
- Scope class descriptions — `_bmad-output/planning-artifacts/ux-design-specification.md` §"Implementation Approach" (Evolution 5)

### Architecture Doc Discrepancy
The architecture install command lists `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser`. These are the **legacy split packages**. Starting with typescript-eslint v6+, the unified `typescript-eslint` package is the correct dependency — it re-exports both and provides the `tseslint.config()` factory used in flat config. Use `typescript-eslint` (the monorepo package), not the split packages.

### ESLint v9 Flat Config — Critical Notes
- ESLint 9 uses flat config (`eslint.config.js`/`.mjs`) by default. Do NOT use `.eslintrc.*` format.
- `eslint.config.mjs` (plain JavaScript ESM) is the recommended format for consuming apps because ESLint cannot natively parse TypeScript config files without a loader.
- The `packages/eslint-config-hivekitchen` package needs a **build step** (see below) because ESLint runs as a Node.js CLI and cannot consume TypeScript sources directly (unlike Vite which transpiles on the fly).
- The `tseslint.config()` helper returns a `FlatConfig.ConfigArray` (array of config objects). Spread it in the app-level config.

### Build Step for `packages/eslint-config-hivekitchen`
This package is the **only exception** to the "no build step" convention for packages. The reason: ESLint is a Node.js CLI tool, not a Vite bundler — it cannot consume TypeScript source files directly.

Build command: `tsc` using a separate `tsconfig.build.json`:
```json
// packages/eslint-config-hivekitchen/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "declaration": true,
    "declarationDir": "dist",
    "noEmit": false
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "__fixtures__/**/*"]
}
```

`package.json` build script: `"build": "tsc -p tsconfig.build.json"`
`package.json` prebuild: `"prebuild": "node -e \"import('node:fs').then(fs => fs.rmSync('dist', { recursive: true, force: true }))\""` (same pattern used in other packages)

The `dist/` directory is `.gitignore`d. Turborepo rebuilds it before any lint task that depends on this package.

### Exact `packages/eslint-config-hivekitchen/package.json`

```json
{
  "name": "@hivekitchen/eslint-config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "prebuild": "node -e \"import('node:fs').then(fs => fs.rmSync('dist', { recursive: true, force: true }))\"",
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no self-lint'",
    "test": "vitest run"
  },
  "devDependencies": {
    "@hivekitchen/tsconfig": "workspace:*",
    "typescript": "^5.5.0"
  },
  "peerDependencies": {
    "eslint": ">=9.0.0",
    "typescript-eslint": ">=8.0.0",
    "eslint-plugin-jsx-a11y": ">=6.0.0",
    "eslint-plugin-boundaries": ">=4.0.0",
    "eslint-plugin-react": ">=7.0.0",
    "eslint-plugin-react-hooks": ">=5.0.0"
  }
}
```

### Main Export Shape (`packages/eslint-config-hivekitchen/src/index.ts`)

Export three named config factories:

```ts
import type { FlatConfig } from '@typescript-eslint/utils/ts-eslint';

// Base rules shared by all packages/apps (jsx-a11y strict, logical-properties)
export function baseConfig(): FlatConfig.ConfigArray { ... }

// Web app rules (adds no-cross-scope-component, no-dialog-outside-allowlist)
export function webConfig(opts: { scopeAllowlist: ScopeAllowlistOptions }): FlatConfig.ConfigArray { ... }

// API rules (adds eslint-plugin-boundaries for backend module boundaries)
export function apiConfig(): FlatConfig.ConfigArray { ... }

// Also export custom rules for advanced consumers
export { noCrossScopeComponent } from './rules/no-cross-scope-component.js';
export { noDialogOutsideAllowlist } from './rules/no-dialog-outside-allowlist.js';
export { logicalPropertiesOnly } from './rules/logical-properties-only.js';
```

### Custom Rule — `no-cross-scope-component`

**File:** `src/rules/no-cross-scope-component.ts`

**Logic:**
1. Determine file scope from `context.filename`:
   - Contains `/routes/(child)/` → `child-scope`
   - Contains `/routes/(grandparent)/` → `grandparent-scope`
   - Contains `/routes/(ops)/` → `ops-scope`
   - Anything else → `app-scope` (no restriction — return early)
2. From rule options `scopeAllowlist[currentScope].forbiddenComponents`, build a `Set<string>`.
3. Visit `ImportDeclaration` nodes. For each `ImportSpecifier`, check `imported.name` against the forbidden set.
4. Report: `"'${name}' is forbidden in .${scope} — see SCOPE_CHARTER.md"`.

**Schema:**
```ts
schema: [{
  type: 'object',
  properties: {
    scopeAllowlist: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: { forbiddenComponents: { type: 'array', items: { type: 'string' } } },
        required: ['forbiddenComponents'],
      },
    },
  },
  required: ['scopeAllowlist'],
}]
```

### Custom Rule — `no-dialog-outside-allowlist`

**File:** `src/rules/no-dialog-outside-allowlist.ts`

**Trigger imports (report these unless file is in allowlist):**
- Source: `@radix-ui/react-dialog`, `@radix-ui/react-alert-dialog`
- Any import from `@radix-ui/*` where imported name matches `/Dialog|AlertDialog/`
- Default allowlist path substrings: `features/auth`, `features/safety`, `features/command-palette`, `features/memory`

**Schema:** `[{ type: 'object', properties: { allowlist: { type: 'array', items: { type: 'string' } } }, required: ['allowlist'] }]`

### Custom Rule — `logical-properties-only`

**File:** `src/rules/logical-properties-only.ts`

Physical → Logical map:
- CSS: `marginLeft → marginInlineStart`, `marginRight → marginInlineEnd`, `paddingLeft → paddingInlineStart`, `paddingRight → paddingInlineEnd`
- Tailwind prefix: `ml → ms`, `mr → me`, `pl → ps`, `pr → pe`

**AST visitors:**
- `JSXAttribute[name.name='style'] ObjectExpression > Property[key.name=/^(margin|padding)(Left|Right)$/]` → report CSS violation
- `JSXAttribute[name.name='className'] Literal` → check `.value` string with regex `\b(ml|mr|pl|pr)-` → report Tailwind violation

### `eslint-plugin-boundaries` Configuration (API module boundaries)

```js
// Elements (path patterns relative to repo root)
const elements = [
  { type: 'api-agents',  pattern: 'apps/api/src/agents/**/*' },
  { type: 'api-routes',  pattern: ['apps/api/src/**/*.routes.ts', 'apps/api/src/routes/**/*'] },
  { type: 'api-plugins', pattern: 'apps/api/src/plugins/**/*' },
  { type: 'api-modules', pattern: 'apps/api/src/modules/**/*' },
  { type: 'api-audit',   pattern: 'apps/api/src/audit/**/*' },
  { type: 'api-repository', pattern: 'apps/api/src/**/repository.ts' },
];

// Rules
rules: {
  'boundaries/element-types': ['error', {
    default: 'allow',
    rules: [
      // agents cannot import from routes or fastify
      { from: 'api-agents', disallow: ['api-routes'], message: 'Agent modules cannot import route handlers' },
      // only plugins can import vendor SDKs — enforced via no-restricted-imports (see below)
    ],
  }],
}
```

For SDK import restrictions (simpler as `no-restricted-imports` than `boundaries`):
```js
rules: {
  'no-restricted-imports': ['error', {
    patterns: [
      { group: ['@supabase/*'], message: 'Supabase must be imported only in plugins/ or repository.ts files', allowImportNames: [] },
      { group: ['openai', '@openai/*', '@elevenlabs/*', 'stripe', '@sendgrid/*', 'twilio', 'ioredis', 'bullmq'], message: 'SDK clients must only be imported inside apps/api/src/plugins/' },
    ],
  }],
}
```

Apply `no-restricted-imports` only to non-plugin API files by using file-level ESLint config overrides.

### Exact `packages/ui/src/scope-allowlist.config.ts`

```ts
export type ScopeClass = 'app-scope' | 'child-scope' | 'grandparent-scope' | 'ops-scope';

export interface ScopeRestrictions {
  forbiddenComponents: string[];
}

export const scopeAllowlist: Record<ScopeClass, ScopeRestrictions> = {
  'app-scope': {
    forbiddenComponents: [],  // no restrictions — full component inventory
  },
  'child-scope': {
    // Lunch Link only: no nav chrome, no app shell, no settings affordances
    // Only HeartNote + FlavorPassport + bag preview + rating surface
    forbiddenComponents: [
      'Command', 'CommandDialog', 'CommandPalette',
      'AlertDialog', 'AlertDialogContent', 'AlertDialogTrigger',
      'Toast', 'Toaster',
      'NavigationMenu', 'NavigationMenuList', 'NavigationMenuTrigger',
      'MobileNavAnchor',
      'Sidebar', 'SidebarProvider',
      'Sheet', 'SheetContent',     // Sheet is a dialog variant
    ],
  },
  'grandparent-scope': {
    // /gift and /guest-author: simplified flow, no command palette
    forbiddenComponents: [
      'Command', 'CommandDialog', 'CommandPalette',
      'MobileNavAnchor',  // grandparent uses single-column layout
    ],
  },
  'ops-scope': {
    forbiddenComponents: [],  // intentionally utilitarian — no restrictions
  },
};
```

### `useScopeGuard` Hook Spec

```ts
// packages/ui/src/hooks/use-scope-guard.ts
import { useEffect } from 'react';
import type { ScopeClass } from '../scope-allowlist.config.js';

export function useScopeGuard(expectedScope: ScopeClass): void {
  // IMPORTANT: useEffect is called unconditionally (React hooks rule).
  // The DEV guard is inside the effect body, not wrapping useEffect.
  useEffect(() => {
    if (import.meta.env.DEV) {
      if (!document.documentElement.classList.contains(expectedScope)) {
        throw new Error(
          `useScopeGuard: this component requires .${expectedScope} on <html>. ` +
          `Current classes: "${document.documentElement.className}". ` +
          `See packages/design-system/SCOPE_CHARTER.md.`
        );
      }
    }
  }, [expectedScope]);
}
```

**Critical:** `useEffect` is a React hook and must be called at the top level of the hook, not conditionally. The `import.meta.env.DEV` check belongs INSIDE the effect body. Vite's tree-shaker eliminates `import.meta.env.DEV` blocks in production builds.

### Route Layout Shell Pattern

```tsx
// apps/web/src/routes/(child)/layout.tsx
import { useEffect } from 'react';

interface LayoutProps { children: React.ReactNode; }

export default function ChildScopeLayout({ children }: LayoutProps) {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('child-scope');
    return () => { html.classList.remove('child-scope'); };
  }, []);
  return <>{children}</>;
}
```

Repeat for `(app)/layout.tsx` (→ `app-scope`), `(grandparent)/layout.tsx` (→ `grandparent-scope`), `(ops)/layout.tsx` (→ `ops-scope`).

**Default scope in `index.html`:** Also add `class="app-scope"` to the `<html>` element in `apps/web/index.html` so the scope class is present before React mounts:
```html
<html lang="en" class="app-scope">
```

### Exact `apps/web/eslint.config.mjs`

```js
// apps/web/eslint.config.mjs
import { webConfig } from '@hivekitchen/eslint-config';
import { scopeAllowlist } from '@hivekitchen/ui';  // built dist import
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...webConfig({ scopeAllowlist }),
);
```

Note: `@hivekitchen/ui` is source-imported by Vite but ESLint runs in Node.js. Since `packages/ui` has no build step, this import will fail for ESLint. **Solution:** import the scopeAllowlist from the source file with a path alias, or inline the allowlist directly in the web ESLint config. Simplest: define a standalone `scope-allowlist.eslint.js` (plain JS) in `packages/ui/src/` that the ESLint config can import without TypeScript:

Create `packages/ui/src/scope-allowlist.eslint.js`:
```js
// Plain JS version for ESLint consumption (synced with scope-allowlist.config.ts)
export const scopeAllowlist = {
  'app-scope': { forbiddenComponents: [] },
  'child-scope': { forbiddenComponents: ['Command', 'CommandDialog', 'AlertDialog', /* ... */] },
  'grandparent-scope': { forbiddenComponents: ['Command', 'CommandDialog', 'MobileNavAnchor'] },
  'ops-scope': { forbiddenComponents: [] },
};
```

This file is the ESLint-consumable twin of `scope-allowlist.config.ts`. Keep them in sync (they're adjacent files — the TS one is the source of truth, the JS one is its ESLint mirror). Add a comment in each: `// SYNC: Keep in sync with scope-allowlist.config.ts (TS) / scope-allowlist.eslint.js (JS for ESLint)`.

Revised `apps/web/eslint.config.mjs`:
```js
import { webConfig } from '@hivekitchen/eslint-config';
import { scopeAllowlist } from '../../packages/ui/src/scope-allowlist.eslint.js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...webConfig({ scopeAllowlist }),
);
```

### Exact `apps/api/eslint.config.mjs`

```js
// apps/api/eslint.config.mjs
import { apiConfig } from '@hivekitchen/eslint-config';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...apiConfig(),
);
```

### RuleTester Pattern (ESLint v9)

```ts
// src/rules/no-cross-scope-component.test.ts
import { RuleTester } from '@eslint/rule-tester';
import { describe, it } from 'vitest';
import noCrossScopeComponent from './no-cross-scope-component.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-cross-scope-component', noCrossScopeComponent, {
  valid: [
    {
      filename: '/project/apps/web/src/routes/(child)/lunch-link.tsx',
      code: `import { HeartNote } from '@hivekitchen/ui';`,
      options: [{ scopeAllowlist: { 'child-scope': { forbiddenComponents: ['Command'] } } }],
    },
  ],
  invalid: [
    {
      filename: '/project/apps/web/src/routes/(child)/lunch-link.tsx',
      code: `import { Command } from '@hivekitchen/ui';`,
      options: [{ scopeAllowlist: { 'child-scope': { forbiddenComponents: ['Command'] } } }],
      errors: [{ message: "'Command' is forbidden in .child-scope — see SCOPE_CHARTER.md" }],
    },
  ],
});
```

Note: `RuleTester.describe` and `RuleTester.it` must be assigned before `run` for Vitest integration.

### SCOPE_CHARTER.md Content Template

The file must cover:
1. **Purpose** — Why scope enforcement exists (RTL support, child-safe surfaces, ops density)
2. **The Four Scopes** — For each scope: class name, route prefix, description, typography requirements, component inventory (allowed/forbidden), voice register
3. **Enforcement Mechanism** — Three layers: (a) SCOPE_CHARTER.md review, (b) ESLint `no-cross-scope-component` lint, (c) dev-mode `useScopeGuard` runtime assertion
4. **Scope Class Application** — How route layouts apply scope classes to `<html>`
5. **Adding New Components** — Process: determine scope eligibility, update `scope-allowlist.config.ts`, update charter
6. **Prohibited Items Index** — Quick reference table of component → allowed scopes

Scope summaries for the charter:

| Scope | Class | Routes | Component Inventory |
|---|---|---|---|
| App | `.app-scope` | `(app)/` | Full inventory — all components available |
| Child | `.child-scope` | `(child)/` | Restricted: HeartNote, FlavorPassport, LunchBagPreview, EmojiRater only. No nav, no Command, no AlertDialog, no Toast, no Sheet |
| Grandparent | `.grandparent-scope` | `(grandparent)/` | Simplified: no Command palette, no MobileNavAnchor. Larger typography minimums (18pt body, 56pt touch targets) |
| Ops | `.ops-scope` | `(ops)/` | Full inventory — intentionally utilitarian, dense tables allowed, breaks presentational-silence rules |

Voice register per scope:
- **App scope:** Full Lumi voice range — casual, warm, occasionally playful
- **Child scope:** Simple, direct, image-first. No AI-generated text on Lunch Link (sacred channel rule — Heart Note is parent-authored verbatim, not modified by AI)
- **Grandparent scope:** Warm, large-print-friendly, one instruction per screen
- **Ops scope:** Clinical, factual, audit-ready copy

### Previous Story Learnings (from Story 1.4)

Key patterns to carry forward:
- **TypeScript `moduleResolution: "bundler"`** is in the base tsconfig — use `.js` extension on relative imports in TypeScript source files (e.g., `import { foo } from './bar.js'` resolves to `bar.ts`).
- **`module: "ESNext"` + `target: "ES2022"`** must be explicitly set in each package's `tsconfig.json` — the base tsconfig has `moduleResolution: bundler` but no explicit `module` value, which causes TS5095 without these.
- **`@types/node`** is needed for any file that uses `node:*` imports in test files, even though Node.js provides these at runtime. Add to devDependencies of packages that test Node.js APIs.
- **Vitest `it.skipIf(!!process.env.CI)`** — use this pattern for any test that checks the local filesystem (fonts, generated files) but shouldn't fail in CI.
- **Remove explicit type annotations** if they cause TypeScript to distribute over union types unexpectedly. Let TypeScript infer the concrete object type when the annotation would introduce `| undefined`.
- **The `import.meta.env.DEV` guard in `app.tsx`** was the correct pattern for dev-only routes — use the same for `useScopeGuard` assertions.

### `turbo.json` Updates Required

Add `@hivekitchen/eslint-config` with a `build` pipeline task that the consuming apps' `lint` tasks depend on:

```json
// In turbo.json tasks section, add:
"build": {
  "dependsOn": ["^build"],
  "outputs": ["dist/**"]
},
"lint": {
  "dependsOn": ["^build"],  // ensure eslint-config is built before linting
  "outputs": []
}
```

The `^build` dependency means each package's `lint` task waits for all workspace dependency `build` tasks to complete first — this ensures `@hivekitchen/eslint-config/dist/` exists before `apps/web` tries to `eslint src`.

### Project Structure Notes

New files created by this story:
```
packages/
├── eslint-config-hivekitchen/         NEW workspace package
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   ├── src/
│   │   ├── index.ts
│   │   └── rules/
│   │       ├── no-cross-scope-component.ts
│   │       ├── no-cross-scope-component.test.ts
│   │       ├── no-dialog-outside-allowlist.ts
│   │       ├── no-dialog-outside-allowlist.test.ts
│   │       ├── logical-properties-only.ts
│   │       └── logical-properties-only.test.ts
│   └── __fixtures__/
│       ├── no-cross-scope/valid.tsx + invalid.tsx
│       ├── no-dialog/valid.tsx + invalid.tsx
│       ├── logical-props/valid.tsx + invalid.tsx
│       └── boundaries/valid.ts + invalid.ts
├── design-system/
│   └── SCOPE_CHARTER.md               NEW charter doc
└── ui/
    └── src/
        ├── scope-allowlist.config.ts  NEW
        ├── scope-allowlist.eslint.js  NEW (plain JS twin for ESLint)
        ├── hooks/
        │   └── use-scope-guard.ts     NEW
        └── index.ts                   MODIFIED (add new exports)

apps/web/
├── index.html                         MODIFIED (add class="app-scope" to <html>)
├── eslint.config.mjs                  NEW
└── src/routes/
    ├── (app)/layout.tsx               NEW (shell only)
    ├── (child)/layout.tsx             NEW (shell only)
    ├── (grandparent)/layout.tsx       NEW (shell only)
    └── (ops)/layout.tsx               NEW (shell only)

apps/api/
└── eslint.config.mjs                  NEW
```

Root-level changes:
- `package.json` — add ESLint devDependencies
- `turbo.json` — update lint task dependsOn

### References

- [UX-DR12, UX-DR13, UX-DR14] epics.md lines 339–341
- [UX-DR63] epics.md line 426
- Architecture §"Project Structure & Boundaries" — `architecture.md` lines 673–677, 833–835
- UX Spec §"Implementation Approach" (Evolution 5 scope classes) — `ux-design-specification.md` lines 619–626
- ESLint v9 flat config: https://eslint.org/docs/latest/use/configure/configuration-files
- typescript-eslint v8: https://typescript-eslint.io/getting-started/
- eslint-plugin-boundaries v4: https://www.npmjs.com/package/eslint-plugin-boundaries
- RuleTester (ESLint v9): https://eslint.org/docs/latest/integrate/nodejs-api#ruletester

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- TypeScript plugin typings for `eslint-plugin-jsx-a11y`, `eslint-plugin-boundaries`, `eslint-plugin-react`, `eslint-plugin-react-hooks` are incomplete or missing. Handled via a minimal ambient declaration at `packages/eslint-config-hivekitchen/src/plugin-shims.d.ts` plus `as unknown as NonNullable<Linter.Config['plugins']>[string]` casts in `src/index.ts`.
- `@eslint/rule-tester` (named in Dev Notes) is not a published npm package; `RuleTester` is imported from `eslint` directly in ESLint v9. Bridged to Vitest by assigning `describe`/`it` onto `globalThis` in each `*.test.ts`.
- `packages/eslint-config-hivekitchen/tsconfig.json` excludes `__fixtures__/**/*` — fixtures reference modules not installed in this package (`@radix-ui/*`, `openai`, `@supabase/supabase-js`) and are linter-input only, never compiled. Build tsconfig already excluded them; the non-build tsconfig was adjusted to match.
- `packages/ui` needed a small `src/vite-env.d.ts` ambient declaring `ImportMeta.env.DEV` so `useScopeGuard` typechecks in isolation (the package is source-imported by Vite in `apps/web`, which carries the full `vite/client` types).

### Completion Notes List

- ✅ All 8 acceptance criteria satisfied.
- ✅ Three-layer scope enforcement is live: `SCOPE_CHARTER.md` (review), ESLint custom rules `no-cross-scope-component` / `no-dialog-outside-allowlist` / `logical-properties-only` (lint), `useScopeGuard` dev-only hook (runtime).
- ✅ Full workspace: `pnpm lint` 0 errors, `pnpm typecheck` 9/9 green, `pnpm test` 100/100 green (was 88/88 before — 12 new rule tests).
- ✅ Scratch violation round-trip verified: planted `import { Command }` into `(child)/` → lint fails with "'Command' is forbidden in .child-scope — see SCOPE_CHARTER.md"; removed → lint green.
- ⚠️ Story task 14 said set Status to `done` and mark sprint-status `done`. Workflow Step 9 overrides this — status is `review` pending `bmad-code-review`. Aligned with the `DS → CR → DS` cycle.
- ⚠️ `apps/marketing` is linted via its existing `astro check` script, not via the new `@hivekitchen/eslint-config`. The ACs only called for `apps/web` and `apps/api` wiring (AC #7), so marketing was left unchanged.
- ℹ️ `turbo.json` already had `lint: { dependsOn: ["^build"] }` — the cross-package build dependency the Dev Notes asked for was already in place. No edit needed.

### File List

**New files:**
- `packages/eslint-config-hivekitchen/package.json`
- `packages/eslint-config-hivekitchen/tsconfig.json`
- `packages/eslint-config-hivekitchen/tsconfig.build.json`
- `packages/eslint-config-hivekitchen/vitest.config.ts`
- `packages/eslint-config-hivekitchen/src/index.ts`
- `packages/eslint-config-hivekitchen/src/plugin-shims.d.ts`
- `packages/eslint-config-hivekitchen/src/rules/no-cross-scope-component.ts`
- `packages/eslint-config-hivekitchen/src/rules/no-cross-scope-component.test.ts`
- `packages/eslint-config-hivekitchen/src/rules/no-dialog-outside-allowlist.ts`
- `packages/eslint-config-hivekitchen/src/rules/no-dialog-outside-allowlist.test.ts`
- `packages/eslint-config-hivekitchen/src/rules/logical-properties-only.ts`
- `packages/eslint-config-hivekitchen/src/rules/logical-properties-only.test.ts`
- `packages/eslint-config-hivekitchen/__fixtures__/no-cross-scope/valid.tsx`
- `packages/eslint-config-hivekitchen/__fixtures__/no-cross-scope/invalid.tsx`
- `packages/eslint-config-hivekitchen/__fixtures__/no-dialog/valid.tsx`
- `packages/eslint-config-hivekitchen/__fixtures__/no-dialog/invalid.tsx`
- `packages/eslint-config-hivekitchen/__fixtures__/logical-props/valid.tsx`
- `packages/eslint-config-hivekitchen/__fixtures__/logical-props/invalid.tsx`
- `packages/eslint-config-hivekitchen/__fixtures__/boundaries/valid.ts`
- `packages/eslint-config-hivekitchen/__fixtures__/boundaries/invalid.ts`
- `packages/design-system/SCOPE_CHARTER.md`
- `packages/ui/src/scope-allowlist.config.ts`
- `packages/ui/src/scope-allowlist.eslint.js`
- `packages/ui/src/hooks/use-scope-guard.ts`
- `packages/ui/src/vite-env.d.ts`
- `apps/web/src/routes/(app)/layout.tsx`
- `apps/web/src/routes/(child)/layout.tsx`
- `apps/web/src/routes/(grandparent)/layout.tsx`
- `apps/web/src/routes/(ops)/layout.tsx`
- `apps/web/eslint.config.mjs`
- `apps/api/eslint.config.mjs`

**Modified:**
- `package.json` — added `eslint`, `typescript-eslint`, `eslint-plugin-jsx-a11y`, `eslint-plugin-boundaries`, `eslint-plugin-react`, `eslint-plugin-react-hooks` devDependencies.
- `packages/ui/src/index.ts` — exports `scope-allowlist.config` + `useScopeGuard`.
- `packages/ui/package.json` — added `@hivekitchen/eslint-config`, `@types/react`, `react` devDependencies.
- `apps/web/package.json` — added `@hivekitchen/eslint-config`, `@hivekitchen/ui` devDependencies.
- `apps/api/package.json` — added `@hivekitchen/eslint-config` devDependency.
- `apps/web/index.html` — `<html lang="en" class="app-scope">`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions tracked during the story cycle.

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-24 | Story 1.5 implementation — scope charter, three ESLint custom rules, API module-boundaries config, fixtures, rule unit tests (12 green), route-group layout shells for all four scopes, `useScopeGuard` dev-only runtime assertion, ESLint v9 flat configs wired into `apps/web` and `apps/api`. All ACs satisfied; `pnpm lint`/`typecheck`/`test` green across the workspace. | Dev Agent (claude-opus-4-7[1m]) |
| 2026-04-24 | Addressed code-review findings — 3 decisions resolved (D1=central `useScope` controller; D2=narrow dialog allowlist expansion fixing the fake `@radix-ui/react-sheet` and adding vaul/cmdk + default/namespace imports; D3=block dynamic `import()` and `require()` of vendor SDKs), 14 patches applied (ScopeRestrictions rename, useLayoutEffect for guard, default/namespace/re-export visitors on no-cross-scope-component, clsx/cn/TemplateLiteral/variant handling in logical-properties-only, sync test, non-throwing console.error guard, spec-aligned package.json script, audit_log over-restriction removed, allowTypeImports, `@supabase/**`, anchored scope detection, JSXSpreadAttribute visitor, Literal-key style props, config-shape test). 8 items formally deferred. Tests: 109 passing (was 100). Lint + typecheck green workspace-wide. | Dev Agent (claude-opus-4-7[1m]) |
