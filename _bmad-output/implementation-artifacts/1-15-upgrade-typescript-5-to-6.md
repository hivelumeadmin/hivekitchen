# Story 1.15: Upgrade TypeScript 5 → 6

Status: done

## Story

As a **developer on the HiveKitchen platform**,
I want to **run TypeScript 6 across the entire monorepo**,
So that **we stay on a supported compiler, pick up improved type inference, and clear the way for TS7's planned removal of the deprecated `baseUrl` option before it becomes a hard error**.

## Background

Dependabot PR #13 bumped `typescript` from `5.9.3` to `6.0.3` and was closed because two concrete compile errors blocked the merge:

1. **`apps/web/tsconfig.json` — `baseUrl` deprecated (TS5101).** TypeScript 6 emits `error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0.` The `baseUrl: "."` entry exists solely to anchor the `@/*` path alias. TypeScript 6 supports `paths` without a `baseUrl` anchor for bundler-based projects; removing `baseUrl` and keeping `paths` is the clean fix.

2. **`packages/design-system` — `node:*` types not found (TS2591).** `contrast-audit.test.ts` and `src/tokens/fonts.test.ts` import `node:fs`, `node:path`, `node:url`, and reference `process`. TypeScript 6 no longer auto-includes ambient Node types unless the tsconfig or a typeRoot makes them available. Adding `"types": ["node"]` to `packages/design-system/tsconfig.json` resolves this, provided `@types/node` is already in `devDependencies` (it is — also a direct devDep on the package itself).

A full sweep on TS6 also surfaced one additional error not covered above (see Task 4 / Completion Notes).

## Acceptance Criteria

**AC1 — `apps/web/tsconfig.json` `baseUrl` removed.** The `"baseUrl": "."` entry is deleted from `apps/web/tsconfig.json`. The `"paths"` block (`"@/*": ["./src/*"]`) remains. The `@/*` alias continues to resolve correctly because `moduleResolution: "bundler"` in `packages/tsconfig/react.json` supports `paths` without `baseUrl`. `pnpm --filter @hivekitchen/web typecheck` passes with TypeScript 6.

**AC2 — `packages/design-system` resolves Node built-in types.** `packages/design-system/tsconfig.json` adds `"types": ["node"]` inside `"compilerOptions"`. `pnpm --filter @hivekitchen/design-system typecheck` passes with TypeScript 6. The `@types/node` devDependency is confirmed present in the workspace (it is in the root `devDependencies`); no new install is required unless the package runs typecheck in isolation outside the workspace context, in which case `@types/node` must be added to `packages/design-system/package.json#devDependencies`.

**AC3 — TypeScript version pinned at workspace root.** `packages/tsconfig/package.json` (or the root `package.json`) documents `typescript@^6` as the required compiler. The `turbo-and-build` devDependency group is updated to `^6.0.3`. The old `5.x` constraint is replaced.

**AC4 — Full monorepo typecheck green.** `pnpm typecheck` (workspace-wide) exits 0 with TypeScript 6. This covers `apps/api`, `apps/web`, `apps/marketing`, `packages/contracts`, `packages/types`, `packages/design-system`, and any other packages with a `typecheck` script.

**AC5 — No `ignoreDeprecations` hack.** The workaround `"ignoreDeprecations": "6.0"` is **not** used. The two issues are resolved at source rather than suppressed.

**AC6 — CI core checks pass.** After merging, the `Typecheck · Lint · Test · Contracts · Manifest` job on main is green. Pre-existing `E2E · A11y` and Perf/LHCI failures (unrelated to this story) are acceptable.

## Tasks / Subtasks

- [x] **Task 1 — Verify the two known errors reproduce locally**
  - [x] Install TypeScript 6 locally: `pnpm add -D typescript@^6 --filter @hivekitchen/tsconfig` (or root)
  - [x] Run `pnpm typecheck` and confirm only the two known errors appear (TS5101 in web, TS2591 in design-system). Document any additional errors discovered here before proceeding.
        → Two known errors confirmed (TS5101 in `apps/web`, eight TS2591 errors in `packages/design-system`). One **additional** error surfaced: `packages/eslint-config-hivekitchen/tsconfig.build.json` failed `tsc -p` with `TS5011: 'rootDir' setting must be explicitly set` — a new TS6 strictness on emit configurations. Resolved in Task 4.

- [x] **Task 2 — Fix `apps/web/tsconfig.json`** (AC: #1)
  - [x] Remove the `"baseUrl": "."` line from `apps/web/tsconfig.json`
  - [x] Leave `"paths": { "@/*": ["./src/*"] }` intact
  - [x] Run `pnpm --filter @hivekitchen/web typecheck` — confirm 0 errors
  - [x] Verify a sample `@/` import compiles (e.g., `@/stores/auth.store.ts`) to confirm the alias still resolves
        → Verified: 4 files in `apps/web/src` use `@/` imports (`routes/auth/login.tsx`, `routes/auth/callback.tsx`, `lib/fetch.ts`, `providers/query-provider.tsx`); typecheck passes with no errors.

- [x] **Task 3 — Fix `packages/design-system/tsconfig.json`** (AC: #2)
  - [x] Add `"types": ["node"]` to `compilerOptions` in `packages/design-system/tsconfig.json`
  - [x] Confirm `@types/node` is resolvable from the package (workspace hoisting should cover this; if `pnpm --filter @hivekitchen/design-system typecheck` still fails with TS2688, add `@types/node` to `packages/design-system/package.json#devDependencies`)
        → `@types/node@^22.0.0` was already declared as a direct devDep on `packages/design-system/package.json` — no further install needed.
  - [x] Run `pnpm --filter @hivekitchen/design-system typecheck` — confirm 0 errors

- [x] **Task 4 — Full workspace sweep** (AC: #4)
  - [x] Run `pnpm typecheck` at root — confirm 0 errors across all packages
        → Final result: `Tasks: 9 successful, 9 total` (Turbo). All packages pass.
  - [x] If new errors surface in other packages, fix them and document here
        → Fixed TS5011 in `packages/eslint-config-hivekitchen/tsconfig.build.json` by adding `"rootDir": "./src"`. TS6 now requires an explicit rootDir when the inferred common source directory is non-trivial, even when `outDir` is set; previously TS5 inferred this silently.
  - [x] Run `pnpm lint` — confirm no new lint errors introduced by the tsconfig changes
        → `Tasks: 5 successful, 5 total`. Also re-ran tests (`Tasks: 7 successful, 7 total`; 49 api + 35 web + 22 eslint-config tests pass) and full build (`Tasks: 4 successful, 4 total`) for completeness.

- [x] **Task 5 — Update TypeScript version constraint** (AC: #3)
  - [x] Update `typescript` devDependency to `^6.0.3` in the root `package.json` and/or the `turbo-and-build` group
        → The repo doesn't centralize TS at the root; each workspace package declares its own `typescript` devDep. Bumped `^5.5.0` → `^6.0.3` in all eight package.json files: `apps/api`, `apps/web`, `apps/marketing`, `packages/contracts`, `packages/design-system`, `packages/types`, `packages/ui`, `packages/eslint-config-hivekitchen`. `@hivekitchen/tsconfig` has no devDeps and required no change.
  - [x] Run `pnpm install` to regenerate lockfile
        → Resolved to `typescript@6.0.3` across all 8 packages. Two peer-dep warnings recorded (`@astrojs/check@0.9.8`, `tsconfck@3.1.6` via Astro 6) — both still function under TS6 (`astro check` returns 0 errors); they're upstream advisories that will clear as the Astro toolchain bumps its peer range.
  - [x] Confirm `pnpm typecheck` and `pnpm test` still pass after lockfile update

- [ ] **Task 6 — Close dependabot PR #13**
  - [ ] Once this story is merged, close dependabot PR #13 with a comment referencing this story's PR
        → Deferred to post-merge (the PR exists upstream; closing is a one-click action after this branch lands on `main`).

## Dev Notes

- TypeScript 6 made `baseUrl` a deprecated warning, not an error it ignores. TS7 will make it a hard error. Removing it now is the right call; `paths` alone has been sufficient for bundler-resolution since TS5.
- The `"types": ["node"]` fix works because `@types/node` is already installed at the monorepo root and hoisted by pnpm. If this package is ever run in an isolated Docker stage without workspace node_modules, the explicit devDependency on `@types/node` will be needed.
- TypeScript 6 tightened several inference edge cases. If the workspace sweep in Task 4 surfaces unexpected errors in `apps/api` or `packages/contracts`, investigate before suppressing — they likely represent real type unsafety that TS5 happened to overlook.
- Do not add `"ignoreDeprecations": "6.0"` anywhere. That is a stall tactic that defers the problem to TS7.

## Dev Agent Record

### Implementation Plan

1. Bump `typescript@^5.5.0` → `typescript@^6.0.3` in all 8 workspace `package.json` files in one coordinated edit, then `pnpm install` to refresh the lockfile.
2. Run `pnpm exec turbo run typecheck --continue` to surface ALL errors at once (turbo's default fail-fast otherwise hides downstream packages).
3. Apply the two known fixes (drop `baseUrl` in web, add `types: ["node"]` in design-system) plus any newly surfaced TS6 errors at source — never suppress.
4. Re-run the full quality gate suite: typecheck, lint, test, build, contracts:check, tools:check.

### Debug Log

| Step | Command | Outcome |
| --- | --- | --- |
| Install TS6 | `pnpm install` (after package.json bumps) | TS@6.0.3 resolved across all 8 packages; 2 peer-dep warnings (Astro toolchain) |
| Initial typecheck | `pnpm exec turbo run typecheck --continue` | 6/9 ✓, 3 ✗: web (TS5101 baseUrl), design-system (8× TS2591 node:* / process), eslint-config build (TS5011 rootDir) |
| Post-fix typecheck | `pnpm exec turbo run typecheck --continue` | 9/9 ✓ |
| Lint | `pnpm exec turbo run lint --continue` | 5/5 ✓ |
| Test | `pnpm exec turbo run test --continue` | 7/7 ✓ (49 api + 35 web + 22 eslint-config) |
| Build | `pnpm exec turbo run build --continue` | 4/4 ✓ |
| Contracts | `pnpm contracts:check` | 31 exports verified |
| Tool manifest | `pnpm tools:check` | OK (no tools/ yet) |

### Completion Notes

- All 6 ACs satisfied (AC6 will be verified by CI after merge).
- **One unanticipated TS6 error surfaced**: `packages/eslint-config-hivekitchen/tsconfig.build.json` failed `tsc -p` with `TS5011: The common source directory of 'tsconfig.build.json' is './src'. The 'rootDir' setting must be explicitly set`. TS6 now requires an explicit `rootDir` when emitting `.js` + `.d.ts` from a config that uses `outDir` and could ambiguously layer outputs. Fixed by adding `"rootDir": "./src"` — semantically a no-op (it matched the inferred root) but TS6 wants it written down.
- **No `ignoreDeprecations` workaround anywhere** (AC5 satisfied). The two structural issues were resolved at source.
- **Two upstream peer-dep warnings** recorded but non-blocking: `@astrojs/check@0.9.8` and `tsconfck@3.1.6` (transitive via `astro@6.1.9`) declare `peer typescript@^5.0.0`. `astro check` still passes with TS6 (0 errors). These will clear when the Astro toolchain widens its peer range; no action required in this story.
- Story 1.15 was in `draft` status (not in `sprint-status.yaml`'s `development_status` block). Per workflow Step 1's user-provided story-path branch, implementation proceeded against the explicit story file. Sprint-status entries for 1-15 and 1-16 should be added by the next sprint-status update if desired — not in scope here.

### File List

**Modified — tsconfig changes (the substantive fixes):**
- `apps/web/tsconfig.json` — removed `"baseUrl": "."`; kept `"paths"` block
- `packages/design-system/tsconfig.json` — added `"types": ["node"]` to `compilerOptions`
- `packages/eslint-config-hivekitchen/tsconfig.build.json` — added `"rootDir": "./src"` (newly required by TS6)

**Modified — TypeScript version bump (`^5.5.0` → `^6.0.3`):**
- `apps/api/package.json`
- `apps/web/package.json`
- `apps/marketing/package.json`
- `packages/contracts/package.json`
- `packages/design-system/package.json`
- `packages/eslint-config-hivekitchen/package.json`
- `packages/types/package.json`
- `packages/ui/package.json`

**Modified — generated:**
- `pnpm-lock.yaml`

### Review Findings

- [x] [Review][Patch] Node globals leak into design-system production source via overly broad `"types": ["node"]` [`packages/design-system/tsconfig.json`]
- [x] [Review][Patch] Astro peer-dep violation — `@astrojs/check@0.9.8` + `tsconfck@3.1.6` declare `peer typescript: ^5.0.0`; TS 6.0.3 is outside that range [`apps/marketing/package.json`]
- [x] [Review][Defer] `@hivekitchen/tsconfig` package has no `typescript` devDependency — pre-existing condition, not caused by this story [`packages/tsconfig/package.json`] — deferred, pre-existing

## Change Log

| Date | Change | Author |
| --- | --- | --- |
| 2026-04-25 | Initial implementation: TypeScript 5.9.3 → 6.0.3 across all 8 workspace packages. Resolved TS5101 (web baseUrl deprecation), TS2591 (design-system node types), and a newly surfaced TS5011 (eslint-config rootDir). All quality gates green: typecheck 9/9, lint 5/5, test 7/7, build 4/4, contracts:check OK. | Amelia (dev agent) |
