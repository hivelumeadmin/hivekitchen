# Story 1.16: Upgrade Zod 3 → 4

Status: done

## Story

As a **developer on the HiveKitchen platform**,
I want to **upgrade the shared `zod` dependency from v3 to v4 across the monorepo**,
So that **`packages/contracts` and all consumers (`apps/api`, `apps/web`) benefit from Zod 4's improved performance, leaner bundle, and first-class TypeScript 5+ inference — and we stay aligned with `fastify-type-provider-zod` v4, which targets Zod 4**.

## Background

Dependabot PR #16 bumped `zod` from `3.25.76` to `4.3.6` and was closed because it introduced two TypeScript errors in `packages/contracts/src/thread.ts`:

```
error TS2554: Expected 2-3 arguments, but got 1.
  packages/contracts/src/thread.ts(23,11) — z.record(z.unknown())
  packages/contracts/src/thread.ts(35,14) — z.record(z.unknown()).optional()
```

**Root cause:** Zod 4 changed `z.record()` to require an explicit key-type as its first argument. In Zod 3, `z.record(valueSchema)` implicitly defaulted the key to `z.string()`. In Zod 4, the call must be `z.record(z.string(), valueSchema)`.

These are the only two `z.record()` calls in the entire codebase. No other Zod 4 breaking changes were detected in the CI failure, but the full breaking-change list must be audited before merging (see Task 2).

## Acceptance Criteria

**AC1 — `z.record()` calls updated.** Both calls in `packages/contracts/src/thread.ts` are updated to the Zod 4 two-argument form:
- Line 23: `diff: z.record(z.unknown())` → `diff: z.record(z.string(), z.unknown())`
- Line 35: `payload: z.record(z.unknown()).optional()` → `payload: z.record(z.string(), z.unknown()).optional()`

**AC2 — Full contracts audit passes.** Every schema in `packages/contracts/src/*.ts` is reviewed against the Zod 4 migration guide for any additional breaking changes (method renames, removed APIs, inference changes). Known Zod 4 changes to check across all contract files:
- `z.record(valueType)` → `z.record(z.string(), valueType)` (the root cause; confirmed only in thread.ts)
- `z.string().email()`, `.uuid()`, `.url()` etc. — still present in Zod 4; verify they accept the same options objects used in `packages/contracts/src/auth.ts`
- `z.discriminatedUnion()` — still present; verify `events.ts` and `thread.ts` usage compiles
- `ZodError` and `.issues` — `ZodError` is still exported from `zod` in v4; `apps/api/src/app.ts` usage with `err.issues.map(...)` is verified compatible
- `z.coerce.bigint()` in `SequenceId` (thread.ts, events.ts) — verify Zod 4 still exports `z.coerce`

**AC3 — `fastify-type-provider-zod` compatibility confirmed.** The monorepo already depends on `fastify-type-provider-zod@^4.0.0`. This version targets Zod 4. Verify that after the `zod` bump, the existing route schemas (`LoginRequestSchema`, `LoginResponseSchema`, `RefreshResponseSchema`, `OAuthCallbackRequestSchema`) still typecheck correctly inside `apps/api/src/modules/auth/auth.routes.ts`. Run `pnpm --filter @hivekitchen/api typecheck` — 0 errors.

**AC4 — `packages/contracts` tests pass.** `pnpm --filter @hivekitchen/contracts test` exits 0. All existing schema tests (`auth.test.ts`, `thread.test.ts`, `events.test.ts`, `memory.test.ts`, `plan.test.ts`, `presence.test.ts`) pass with Zod 4.

**AC5 — Full monorepo typecheck and tests green.** `pnpm typecheck` and `pnpm test` exit 0 across the workspace. No new type errors introduced in `apps/api` or `apps/web` by the Zod 4 upgrade.

**AC6 — CI core checks pass.** After merging, the `Typecheck · Lint · Test · Contracts · Manifest` job on main is green. Pre-existing `E2E · A11y` and Perf/LHCI failures are acceptable.

## Tasks / Subtasks

- [x] **Task 1 — Apply the two known `z.record()` fixes** (AC: #1)
  - [x] In `packages/contracts/src/thread.ts` line 23: change `diff: z.record(z.unknown())` → `diff: z.record(z.string(), z.unknown())`
  - [x] In `packages/contracts/src/thread.ts` line 35: change `payload: z.record(z.unknown()).optional()` → `payload: z.record(z.string(), z.unknown()).optional()`
  - [x] Run `pnpm --filter @hivekitchen/contracts typecheck` — confirm these two errors are gone

- [x] **Task 2 — Audit all contracts against the Zod 4 migration guide** (AC: #2)
  - [x] Read the official Zod 4 migration guide at https://v4.zod.dev/v4
  - [x] Search for any remaining `z.record(` calls with a single argument: `grep -rn "z\.record(" packages/ apps/`
  - [x] Verify `z.string().email()`, `.uuid()`, `.url()`, `.datetime()`, `.date()` still compile in `auth.ts`, `thread.ts`, `presence.ts`, and `memory.ts`
  - [x] Verify `z.discriminatedUnion('type', [...])` compiles in `thread.ts` and `events.ts`
  - [x] Verify `z.coerce.bigint()` is available in Zod 4 (used in `SequenceId` in `thread.ts` and `events.ts`)
  - [x] Verify `ZodError` import and `.issues` property still valid in `apps/api/src/app.ts`
  - [x] Document any additional fixes required here before continuing

- [x] **Task 3 — Verify `fastify-type-provider-zod` integration** (AC: #3)
  - [x] Run `pnpm --filter @hivekitchen/api typecheck` — confirm 0 errors on route schemas
  - [x] Run `pnpm --filter @hivekitchen/api test` — confirm `auth.routes.test.ts` and `auth.service.test.ts` pass

- [x] **Task 4 — Run full workspace validation** (AC: #4, #5)
  - [x] Run `pnpm --filter @hivekitchen/contracts test` — all schema unit tests pass
  - [x] Run `pnpm typecheck` at root — 0 errors workspace-wide
  - [x] Run `pnpm test` at root — all test suites pass
  - [x] Run `pnpm contracts:check` — manifest check passes

- [x] **Task 5 — Update lockfile and close dependabot PR** (AC: #6)
  - [x] Run `pnpm install` to regenerate lockfile with `zod@^4`
  - [ ] Once this story's PR merges to main, close dependabot PR #16 with a comment referencing this story

### Review Findings (Chunk 1: Zod 3→4 upgrade — 2026-04-25)

- [x] [Review][Patch] `patchedDependencies` pinned to exact `"fastify-type-provider-zod@4.0.2"` while `apps/api/package.json` dep is `"^4.0.0"` — when pnpm resolves any `4.0.x > 4.0.2`, the patch key doesn't match and is silently skipped; `error.errors.map(...)` throws `TypeError` at runtime on every schema validation failure, returning 500 instead of 400. Fix: pin `fastify-type-provider-zod` to `"4.0.2"` exactly in `apps/api/package.json`. [`package.json:43`, `apps/api/package.json:39`]

- [x] [Review][Patch] `WEEK_ID = '00000000-0000-0000-0000-000000000001'` in perf test uses old UUID format (variant nibble `0`) — `InvalidationEvent.safeParse()` is called in the SSE bridge with `week_id: z.string().uuid()`; Zod 4's stricter UUID validation rejects the old format → event silently dropped → query invalidation never fires → perf test broken or gives meaningless timing. Fix: update to RFC 4122 v4 format. [`apps/web/test/perf/sse-invalidation.spec.ts:6`]

- [x] [Review][Patch] `@hookform/resolvers@^4.0.0` installed but entirely unused — custom `zod-resolver.ts` fully replaces it; dead dependency adds install weight and will mislead future developers who may import `@hookform/resolvers/zod` directly (which has the `ZodError.errors` bug). Remove from `apps/web/package.json`. [`apps/web/package.json:19`]

- [x] [Review][Defer] `zod-resolver.ts` silently drops root-level schema refinement errors — `if (path && !errors[path])` skips issues with empty `path` array (e.g., `.refine()` on the full object); no root-level refinement currently used in `LoginRequestSchema`. [`apps/web/src/lib/zod-resolver.ts:15`] — deferred, latent; LoginRequestSchema has no root-level refinements

- [x] [Review][Defer] `zod-resolver.ts` produces flat dot-path keys for nested errors (`"address.zip"`) but RHF resolver contract expects nested `{ address: { zip: {...} } }` objects — requires `toNestErrors` equivalent; not active with current flat `LoginRequestSchema` but breaks any future nested form schema. [`apps/web/src/lib/zod-resolver.ts:14`] — deferred, latent; all current schemas using this resolver are flat

- [x] [Review][Defer] `zod-resolver.ts` inner function omits `context` and `options` params from `Resolver<T>` signature — `criteriaMode: 'all'` (collect all errors per field) and native validation reporting silently ignored; `as unknown as Resolver<T>` cast suppresses the type error. [`apps/web/src/lib/zod-resolver.ts:9`] — deferred, latent; no current form uses criteriaMode

- [x] [Review][Defer] Old-format UUIDs surviving in `auth.service.test.ts`, `authenticate.hook.test.ts`, `login.test.tsx` — inconsistent with RFC 4122 v4 fix applied to 6 other test files; these IDs don't currently flow through Zod `.uuid()` validators in the affected tests, so no functional breakage today. [`apps/api/src/modules/auth/auth.service.test.ts:27`, `apps/api/src/middleware/authenticate.hook.test.ts:9`, `apps/web/src/routes/auth/login.test.tsx:20`] — deferred, inconsistency only; not causing current test failures

- [x] [Review][Defer] `lists.ts` and `voice.ts` contract files not explicitly audited per AC2 ("every `*.ts` file") — both compile correctly under Zod 4 with no breaking changes (verified: only `z.string()`, `.uuid()`, `.boolean()`, `.array()` used); documentation gap only. [`packages/contracts/src/lists.ts`, `packages/contracts/src/voice.ts`] — deferred, no code bugs; spec documentation gap

- [x] [Review][Defer] `z.discriminatedUnion()` and `ZodError.issues` Zod 4 compatibility not explicitly documented in Dev Agent Record — implicitly verified by passing typecheck and tests. [`packages/contracts/src/events.ts`, `apps/api/src/app.ts`] — deferred, documentation gap only

- [x] [Review][Defer] pnpm patch fixes a runtime correctness bug (`error.errors.map(...)` → TypeError) not covered by AC3 (typecheck only) — necessary addition but creates an untested code path: no integration test exercises a request-body validation failure hitting the patched `createValidationError` function end-to-end. [`patches/fastify-type-provider-zod@4.0.2.patch`, `apps/api/src/app.ts`] — deferred, pre-existing test gap

---

## Dev Notes

- The only confirmed breaking change in this codebase is `z.record()` signature. The two affected lines are both in `packages/contracts/src/thread.ts`. No `z.record()` calls exist in `apps/api/src/` or `apps/web/src/`.
- `fastify-type-provider-zod@^4` was already installed targeting Zod 4. Running on Zod 3 was technically a mismatch; this upgrade aligns them properly.
- Zod 4 ships a leaner core and defers some validators (like `.email()`) to a new `z.string().email()` API that is backwards-compatible. No codebase changes expected beyond `z.record()`, but Task 2's audit is not optional — do it before declaring the migration done.
- If `z.coerce.bigint()` has been removed in Zod 4 (check migration guide), the `SequenceId` type in `thread.ts` and `events.ts` will need a manual coercion via `.transform()`. This would be a non-trivial change as `SequenceId` is used across SSE events.
- The existing `pnpm contracts:check` script validates that all exported names in contracts are consumed somewhere — run it after any schema renames to catch dead exports early.

## Dev Agent Record

### Implementation Notes

**Additional breaking changes discovered beyond the story's known z.record() fix:**

1. **Zod 4 strict RFC 4122 UUID validation** — Zod 4's `z.string().uuid()` enforces RFC 4122 variant bits (4th group first nibble must be 8/9/a/b). All test UUID constants of the form `00000000-0000-0000-0000-000000000001` (variant nibble `0`) and `11111111-1111-1111-1111-111111111111` (variant nibble `1`) were rejected. Fixed across 6 test files by updating to RFC 4122 v4 format (version nibble `4`, variant nibble `8`).

2. **`@hookform/resolvers@3.x` dropped** — upgraded to `@hookform/resolvers@4.0.0`, but v4.1.3 still has a latent bug (`isZodError` checks `Array.isArray(error?.errors)` which doesn't exist in Zod 4). Resolved by shipping a custom `apps/web/src/lib/zod-resolver.ts` that reads `result.error.issues` directly. `apps/web/src/routes/auth/login.tsx` updated to import from this module.

3. **`fastify-type-provider-zod@4.0.2` bug** — `createValidationError` calls `error.errors.map(...)` but Zod 4 `ZodError` removed `.errors` (only `.issues` exists). Without a fix, request schema validation errors produce 500 instead of 400. Applied a pnpm patch (`patches/fastify-type-provider-zod@4.0.2.patch`) that changes `error.errors` → `error.issues ?? error.errors` for forward-compatibility.

**Files changed:**
- `packages/contracts/src/thread.ts` — z.record() fixes (2 calls)
- `apps/api/package.json`, `apps/web/package.json`, `packages/contracts/package.json`, `packages/types/package.json` — zod: ^3.x → ^4.0.0
- `apps/web/package.json` — @hookform/resolvers: ^3 → ^4.0.0
- `packages/contracts/src/{thread,memory,presence,plan,events}.test.ts` — UUID constants RFC 4122 fix (5 files)
- `apps/web/src/lib/realtime/sse.test.ts` — UUID constants RFC 4122 fix
- `apps/api/src/modules/auth/auth.routes.test.ts` — UUID constants RFC 4122 fix
- `apps/web/src/lib/zod-resolver.ts` — NEW: custom Zod-4-compatible resolver
- `apps/web/src/routes/auth/login.tsx` — import updated to use custom resolver
- `patches/fastify-type-provider-zod@4.0.2.patch` — NEW: pnpm patch for ZodError.errors bug
- `pnpm-lock.yaml` — updated

**Final validation:**
- `pnpm typecheck` — 9/9 packages ✓
- `pnpm lint` — 9/9 packages ✓
- `pnpm test` — all suites pass (contracts: 78/78, web: 35/35, api: 49/49) ✓
- `pnpm contracts:check` — 31 exports verified ✓
