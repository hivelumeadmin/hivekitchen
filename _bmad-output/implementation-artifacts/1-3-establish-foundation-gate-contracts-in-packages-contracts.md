# Story 1.3: Establish Foundation Gate contracts in packages/contracts

Status: done

## Story

As a developer,
I want all five Foundation Gate Zod schemas (Turn, PlanUpdatedEvent with inline AllergyVerdict, ForgetRequest/Completed soft-only, PresenceEvent, ApiError) authored and exported from `packages/contracts`,
So that Epic 2+ features build over a stable substrate where multi-writer races, plan-vs-guardrail divergence, forget semantics, presence events, and error shapes are all single-source-of-truth.

## Acceptance Criteria

**Given** Story 1.1 is complete,
**When** Story 1.3 is complete,
**Then** `packages/contracts/src/thread.ts` exports `Turn` schema (`id`, `thread_id`, `server_seq: z.coerce.bigint()`, `created_at`, `role: 'user'|'lumi'|'system'`, `body: TurnBody`), `TurnBody` discriminated union (`message`/`plan_diff`/`proposal`/`system_event`/`presence`), and all five body variant schemas.
**And** `packages/contracts/src/plan.ts` exports `PlanUpdatedEvent` with `guardrail_verdict: AllergyVerdict` inline, with `AllergyVerdict` as a discriminated union of `cleared|blocked|pending|degraded` shapes including `CULTURAL_INTERSECTION_EMPTY` reason and `try_alternating_sovereignty` suggestion.
**And** `packages/contracts/src/memory.ts` exports `ForgetRequest` with `mode: z.literal('soft')` (TypeScript type prevents `'hard'` — Phase 1 only) and `ForgetCompletedEvent`.
**And** `packages/contracts/src/presence.ts` exports `PresenceEvent` and `SurfaceKind` enum (`brief|plan_tile|lunch_link|heart_note_composer|thread|memory_node`) with `expires_at` TTL field.
**And** `packages/contracts/src/errors.ts` exports `ErrorCode` enum, `FieldError` (`path`, `code`, `message`), and `ApiError` (`code`, `message`, `fields?`, `trace_id`).
**And** `packages/contracts/src/events.ts` exports the Zod-discriminated `InvalidationEvent` union (7 events from architecture §4.1 + `thread.resync` extension) replacing the existing `SSEEvent` stub.
**And** `packages/contracts/src/index.ts` is updated to re-export from all new/renamed files (`./thread`, `./plan`, `./memory`, `./presence`, `./errors`) and no longer exports from `./threads` or `./plans`.
**And** all five contract files have unit tests in `packages/contracts/src/*.test.ts` verifying that valid payloads parse and invalid payloads reject with appropriate Zod errors.
**And** `packages/types/src/index.ts` re-exports `z.infer<>` types for every schema exported from `packages/contracts/src/`.
**And** `pnpm contracts:check` (new root script) verifies every exported schema in `contracts` is imported by at least one downstream module OR explicitly tagged `@unused-by-design`.
**And** `pnpm typecheck` and `pnpm test` pass across the full workspace — no regression to Story 1.2's green state.

### AC → Task mapping (Definition of Done)

| AC | Satisfied by |
|---|---|
| Turn + TurnBody in thread.ts | Task 3 |
| plan.ts PlanUpdatedEvent + AllergyVerdict | Task 4 |
| memory.ts ForgetRequest + ForgetCompletedEvent | Task 5 |
| presence.ts PresenceEvent + SurfaceKind | Task 6 |
| errors.ts ErrorCode + FieldError + ApiError | Task 7 |
| events.ts InvalidationEvent replaces SSEEvent | Task 8 |
| index.ts updated | Tasks 3–8 |
| Unit tests in *.test.ts | Task 9 |
| types package updated | Task 10 |
| contracts:check script | Task 11 |
| typecheck + test pass | Task 12 |

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight verification** (no AC)
  - [x] Confirm Story 1.1 and Story 1.2 are `done` in `_bmad-output/implementation-artifacts/sprint-status.yaml`.
  - [x] Confirm `packages/contracts/src/` current state: `auth.ts`, `plans.ts`, `lists.ts`, `threads.ts`, `voice.ts`, `events.ts`, `index.ts`. Note their exports — these are the Story 1.1 stubs being extended/replaced.
  - [x] Confirm `packages/types/src/index.ts` current imports: imports `ThreadTurn`, `Thread` from threads.ts and `SSEEvent` from events.ts — BOTH will be removed in Task 10.
  - [x] Confirm `packages/contracts/package.json` has no `test` script and no `vitest` dep — both land in Task 9.
  - [x] Do NOT add any deps beyond `vitest` (and optionally `@vitest/ui`). See **Dependency Exceptions**.

- [x] **Task 2 — Install Vitest in packages/contracts** (prerequisite for Task 9)
  - [x] Add `"vitest": "^2.2.0"` to `packages/contracts/devDependencies` in `packages/contracts/package.json`.
  - [x] Add `"test": "vitest run"` to `packages/contracts/package.json` scripts.
  - [x] Run `pnpm install` from workspace root to update lockfile.
  - [x] Verify `pnpm test` from root runs Turbo and finds the `packages/contracts` test task (it will report 0 tests until Task 9 creates them — that is expected and correct).

- [x] **Task 3 — Create `packages/contracts/src/thread.ts` (replaces threads.ts)** (AC: Turn + TurnBody)
  - [x] Create `packages/contracts/src/thread.ts` per **Exact thread.ts** in Dev Notes.
  - [x] Exports: `TurnBodyMessage`, `TurnBodyPlanDiff`, `TurnBodyProposal`, `TurnBodySystemEvent`, `TurnBodyPresence`, `TurnBody` (discriminated union), `Turn`.
  - [x] Delete `packages/contracts/src/threads.ts` — it is replaced entirely. The old exports (`ThreadTurn`, `Thread`) are stub-quality and superseded.
  - [x] Update `packages/contracts/src/index.ts`: replace `export * from "./threads"` with `export * from "./thread"`.
  - [x] `server_seq` uses `z.coerce.bigint()` — see **bigint serialization note** in Dev Notes.

- [x] **Task 4 — Create `packages/contracts/src/plan.ts` (replaces plans.ts)** (AC: PlanUpdatedEvent + AllergyVerdict)
  - [x] Create `packages/contracts/src/plan.ts` per **Exact plan.ts** in Dev Notes.
  - [x] Keep existing schemas from `plans.ts` (`MealItem`, `DayPlan`, `WeeklyPlan`, `CreatePlanResponse`) — they are not stubs, they are real schemas used by downstream consumers.
  - [x] Add new schemas: `AllergyVerdict` (discriminated union on `verdict` field), `PlanUpdatedEvent`.
  - [x] Delete `packages/contracts/src/plans.ts`.
  - [x] Update `packages/contracts/src/index.ts`: replace `export * from "./plans"` with `export * from "./plan"`.

- [x] **Task 5 — Create `packages/contracts/src/memory.ts`** (AC: ForgetRequest + ForgetCompletedEvent)
  - [x] Create `packages/contracts/src/memory.ts` per **Exact memory.ts** in Dev Notes.
  - [x] `ForgetRequest.mode` is `z.literal('soft')` — this is intentional Phase 1 gate. Do NOT use `z.enum(['soft', 'hard'])`.
  - [x] Add `export * from "./memory"` to `packages/contracts/src/index.ts`.

- [x] **Task 6 — Create `packages/contracts/src/presence.ts`** (AC: PresenceEvent + SurfaceKind)
  - [x] Create `packages/contracts/src/presence.ts` per **Exact presence.ts** in Dev Notes.
  - [x] `SurfaceKind` must match the 6 enum values exactly: `brief`, `plan_tile`, `lunch_link`, `heart_note_composer`, `thread`, `memory_node`.
  - [x] `expires_at` is `z.string().datetime()` — ISO 8601, not a JavaScript `Date`.
  - [x] Add `export * from "./presence"` to `packages/contracts/src/index.ts`.

- [x] **Task 7 — Create `packages/contracts/src/errors.ts`** (AC: ErrorCode + FieldError + ApiError)
  - [x] Create `packages/contracts/src/errors.ts` per **Exact errors.ts** in Dev Notes.
  - [x] `ErrorCode` must include all 10 values from the AC exactly (case-sensitive).
  - [x] `FieldError.path` is `z.array(z.string())` — array of path segments (e.g., `['body', 'email']`).
  - [x] Add `export * from "./errors"` to `packages/contracts/src/index.ts`.

- [x] **Task 8 — Replace `packages/contracts/src/events.ts`** (AC: InvalidationEvent)
  - [x] Rewrite `packages/contracts/src/events.ts` per **Exact events.ts** in Dev Notes.
  - [x] Import `Turn` from `./thread` for the `thread.turn` member.
  - [x] Import `AllergyVerdict` from `./plan` for the `allergy.verdict` member.
  - [x] Define `PantryDelta` as an unexported internal schema within `events.ts` (not exported — pantry domain lands in a later story).
  - [x] Remove the old `SSEEvent` export entirely — it was a stub; nothing real used it yet.
  - [x] The `thread.resync` member uses `from_seq: z.coerce.bigint()` for the same reason as `server_seq` — see **bigint serialization note**.
  - [x] `index.ts` already exports from `./events` — no change needed there.

- [x] **Task 9 — Write unit tests** (AC: *.test.ts for all 5 new files)
  - [x] Create `packages/contracts/src/thread.test.ts` per **Testing guidance**.
  - [x] Create `packages/contracts/src/plan.test.ts`.
  - [x] Create `packages/contracts/src/memory.test.ts`.
  - [x] Create `packages/contracts/src/presence.test.ts`.
  - [x] Create `packages/contracts/src/errors.test.ts`.
  - [x] Each test file: at minimum one happy-path parse test and one rejection test per schema.
  - [x] Run `pnpm test` from workspace root. Expect: `packages/contracts` tests run and pass.

- [x] **Task 10 — Update `packages/types/src/index.ts`** (AC: re-export z.infer<> for every schema)
  - [x] Replace the full content of `packages/types/src/index.ts` per **Exact packages/types/src/index.ts** in Dev Notes.
  - [x] Remove old type exports: `ThreadTurn`, `Thread`, `SSEEvent`.
  - [x] Add new type exports for every schema: `Turn`, `TurnBody`, all five TurnBody variants, `AllergyVerdict`, `PlanUpdatedEvent`, `ForgetRequest`, `ForgetCompletedEvent`, `SurfaceKind`, `PresenceEvent`, `ErrorCode`, `FieldError`, `ApiError`, `InvalidationEvent`.
  - [x] Keep existing type exports: `LoginRequest`, `LoginResponse`, `RefreshRequest`, `RefreshResponse`, `MealItem`, `DayPlan`, `WeeklyPlan`, `CreatePlanResponse`, `GroceryItem`, `GroceryList`, `VoiceTokenResponse`, `ElevenLabsWebhookPayload`.

- [x] **Task 11 — Create contracts:check script** (AC: pnpm contracts:check)
  - [x] Create `packages/contracts/scripts/check.ts` per **contracts:check script** in Dev Notes.
  - [x] Add `"contracts:check": "tsx packages/contracts/scripts/check.ts"` to root `package.json` scripts.
  - [x] Verify: `pnpm contracts:check` from workspace root runs and exits 0 (all exports are consumed by `packages/types`).

- [x] **Task 12 — Verify** (AC: typecheck + test pass)
  - [x] Run `pnpm typecheck` from workspace root. Expect: 6/6 passes — no regression.
  - [x] Run `pnpm test` from workspace root. Expect: `packages/contracts` tests pass; all other workspaces report 0 tests (no `test` script yet) and exit 0.
  - [x] Run `pnpm contracts:check` from workspace root. Expect: exits 0.
  - [x] Run `pnpm build` from workspace root. Expect: 3/3 passes (marketing, api, web).

- [x] **Task 13 — Commit** (no AC — workflow discipline)
  - [x] Branch: cut from `main` as `feat/story-1-3-foundation-gate-contracts`.
  - [x] Commit: `feat(contracts): establish Foundation Gate Zod schemas` — scope `contracts`.
  - [x] Push with upstream tracking. Do NOT force-push. Do NOT merge to `main` from local.
  - [x] PR: title `feat(contracts): establish Foundation Gate Zod schemas`. Body summarizes AC coverage.

## Dev Notes

### Scope of this story

Schema definitions, test scaffolding, and the contracts:check script only. No API routes, no service implementations, no UI components, no database migrations. Pure `packages/contracts`, `packages/types`, and tooling.

### Out of scope (explicit punts)

- ❌ `pantry.ts` — pantry domain is Epic 3+. `PantryDelta` is defined inline in `events.ts` as an unexported stub.
- ❌ `household.ts`, `children.ts`, `lunch-links.ts`, `heart-notes.ts`, `billing.ts`, etc. — later epics.
- ❌ Zod env validation (`apps/api/src/common/env.ts`) — Story 1.6.
- ❌ SSE gateway implementation (`apps/web/src/lib/realtime/sse.ts`) — Story 1.10.
- ❌ `apps/api` routes that consume these schemas — each epic story wires its own routes.
- ❌ Hard-forget semantics (`mode: 'hard'`) — legally blocked until Phase 2 review. `z.literal('soft')` is the gate.
- ❌ TanStack Query setup in `apps/web` — Story 1.10 + Epic 2.
- ❌ Adding `@types/node` to `packages/contracts` — not needed; no Node APIs used.

### Anti-patterns to reject

- ❌ Using `z.enum(['soft', 'hard'])` for `ForgetRequest.mode` — this story's Phase 1 gate requires `z.literal('soft')`.
- ❌ Using `z.bigint()` (non-coercing) for `server_seq` / `from_seq` — JSON cannot encode BigInt natively; `z.coerce.bigint()` accepts string input from SSE JSON payloads.
- ❌ Importing from `@hivekitchen/contracts/dist/...` — shared packages are source-imported. Never create `dist/` outputs in `packages/contracts`.
- ❌ Adding path aliases to `packages/contracts` — shared packages use relative imports only.
- ❌ Using `z.any()` or `z.unknown()` for discriminated union members — only `PantryDelta` (internal stub) uses `z.record(z.unknown())`.
- ❌ `const enum` — banned by `isolatedModules`. Use `z.enum([...])` and `as const` unions.
- ❌ Default exports — use named exports everywhere.
- ❌ Adding `console.log` to the check script — use `process.stderr.write` for errors and `process.stdout.write` for diagnostics.
- ❌ Hand-writing TypeScript types in `packages/types` that duplicate a contract — always `z.infer<typeof Schema>`.
- ❌ Adding `rm -rf dist` clean script to `packages/contracts` — it already has one; do NOT remove it.

### Bigint serialization note

`server_seq` and `from_seq` represent monotonic sequence IDs. They are `bigint` in the database schema (`BIGINT GENERATED BY DEFAULT AS IDENTITY`). JSON does not support BigInt natively — `JSON.stringify(BigInt(1))` throws. The contracts schema uses `z.coerce.bigint()` which:
- Accepts `bigint`, `string`, `number` inputs at parse time
- Returns TypeScript type `bigint`
- The SSE emitter (Story 1.10+) must serialize as a JSON string; the receiver (Story 1.10 `sse.ts`) will parse with the Zod schema which coerces back to `bigint`

Do NOT change to `z.string()` here — the contract intent is `bigint` semantics; coerce is the wire-format adapter.

### Exact `packages/contracts/src/thread.ts` (new — replaces `threads.ts`)

```ts
import { z } from 'zod';

export const TurnBodyMessage = z.object({
  type: z.literal('message'),
  content: z.string(),
});

export const TurnBodyPlanDiff = z.object({
  type: z.literal('plan_diff'),
  week_id: z.string().uuid(),
  diff: z.record(z.unknown()),
});

export const TurnBodyProposal = z.object({
  type: z.literal('proposal'),
  proposal_id: z.string().uuid(),
  content: z.string(),
});

export const TurnBodySystemEvent = z.object({
  type: z.literal('system_event'),
  event: z.string(),
  payload: z.record(z.unknown()).optional(),
});

export const TurnBodyPresence = z.object({
  type: z.literal('presence'),
  user_id: z.string().uuid(),
});

export const TurnBody = z.discriminatedUnion('type', [
  TurnBodyMessage,
  TurnBodyPlanDiff,
  TurnBodyProposal,
  TurnBodySystemEvent,
  TurnBodyPresence,
]);

export const Turn = z.object({
  id: z.string().uuid(),
  thread_id: z.string().uuid(),
  server_seq: z.coerce.bigint(),
  created_at: z.string().datetime(),
  role: z.enum(['user', 'lumi', 'system']),
  body: TurnBody,
});
```

### Exact `packages/contracts/src/plan.ts` (replaces `plans.ts`, keeps existing schemas + adds Foundation Gate schemas)

```ts
import { z } from 'zod';

// --- Existing meal-planning schemas (kept unchanged) ---

export const MealItem = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const DayPlan = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  meal: MealItem,
});

export const WeeklyPlan = z.object({
  id: z.string().uuid(),
  weekOf: z.string(),
  status: z.enum(['draft', 'confirmed']),
  days: z.array(DayPlan),
});

export const CreatePlanResponse = z.object({
  plan: WeeklyPlan,
});

// --- Foundation Gate schemas ---

export const AllergyVerdict = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('cleared') }),
  z.object({
    verdict: z.literal('blocked'),
    allergens: z.array(z.string()),
    reason: z.string().optional(),
  }),
  z.object({ verdict: z.literal('pending') }),
  z.object({
    verdict: z.literal('degraded'),
    reason: z.string(),
    suggestion: z.string().optional(),
  }),
]);

export const PlanUpdatedEvent = z.object({
  type: z.literal('plan.updated'),
  week_id: z.string().uuid(),
  guardrail_verdict: AllergyVerdict,
});
```

Notes:
- `AllergyVerdict` discriminates on `verdict` (not `status`) to avoid conflict with future plan-status fields.
- `degraded.reason` accepts any string, but canonical values are `'CULTURAL_INTERSECTION_EMPTY'` (matches `ErrorCode`). Do not constrain to a literal — future reasons will be added.
- `degraded.suggestion` accepts any string, but canonical value is `'try_alternating_sovereignty'`. Same reason.

### Exact `packages/contracts/src/memory.ts` (new)

```ts
import { z } from 'zod';

export const ForgetRequest = z.object({
  node_id: z.string().uuid(),
  mode: z.literal('soft'),
  reason: z.string().optional(),
});

export const ForgetCompletedEvent = z.object({
  type: z.literal('memory.forget.completed'),
  node_id: z.string().uuid(),
  mode: z.literal('soft'),
  completed_at: z.string().datetime(),
});
```

The `z.literal('soft')` for `mode` is the Phase 1 enforcement mechanism. TypeScript will refuse to compile `ForgetRequest.parse({ node_id: '...', mode: 'hard' })` because `'hard'` is not assignable to `'soft'`. This is intentional.

### Exact `packages/contracts/src/presence.ts` (new)

```ts
import { z } from 'zod';

export const SurfaceKind = z.enum([
  'brief',
  'plan_tile',
  'lunch_link',
  'heart_note_composer',
  'thread',
  'memory_node',
]);

export const PresenceEvent = z.object({
  type: z.literal('presence.partner-active'),
  thread_id: z.string().uuid(),
  user_id: z.string().uuid(),
  surface: SurfaceKind,
  expires_at: z.string().datetime(),
});
```

### Exact `packages/contracts/src/errors.ts` (new)

```ts
import { z } from 'zod';

export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'AGENT_UNAVAILABLE',
  'GUARDRAIL_BLOCKED',
  'CULTURAL_INTERSECTION_EMPTY',
  'SCOPE_FORBIDDEN',
]);

export const FieldError = z.object({
  path: z.array(z.string()),
  code: ErrorCode,
  message: z.string(),
});

export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
  fields: z.array(FieldError).optional(),
  trace_id: z.string(),
});
```

`FieldError.path` is an array of string segments matching the request body path (e.g., `['body', 'children', '0', 'name']`). This matches `react-hook-form`'s error path convention on the client.

### Exact `packages/contracts/src/events.ts` (replaces `SSEEvent`)

```ts
import { z } from 'zod';
import { Turn } from './thread.js';
import { AllergyVerdict } from './plan.js';

// Stub for pantry delta — refined when packages/contracts/src/pantry.ts is created (Epic 3+).
const PantryDelta = z.object({
  items_added: z.array(z.string().uuid()).optional(),
  items_removed: z.array(z.string().uuid()).optional(),
});

export const InvalidationEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('plan.updated'), week_id: z.string().uuid() }),
  z.object({ type: z.literal('memory.updated'), node_id: z.string().uuid() }),
  z.object({ type: z.literal('thread.turn'), thread_id: z.string().uuid(), turn: Turn }),
  z.object({ type: z.literal('packer.assigned'), date: z.string().date(), packer_id: z.string().uuid() }),
  z.object({ type: z.literal('pantry.delta'), delta: PantryDelta }),
  z.object({ type: z.literal('allergy.verdict'), plan_id: z.string().uuid(), verdict: AllergyVerdict }),
  z.object({ type: z.literal('presence.partner-active'), thread_id: z.string().uuid(), user_id: z.string().uuid() }),
  z.object({ type: z.literal('thread.resync'), thread_id: z.string().uuid(), from_seq: z.coerce.bigint() }),
]);
```

**CRITICAL**: Relative imports inside `packages/contracts/src/` must use `.js` extensions: `import { Turn } from './thread.js'`. The contracts package uses ESM and TypeScript emits `.js`. `tsx` (used in dev/seed) handles `.ts` → `.js` resolution automatically, but the `.js` extension is required for correctness per project-context ESM rules.

### Exact `packages/contracts/src/index.ts` (final state after all tasks)

```ts
export * from './auth.js';
export * from './plan.js';
export * from './lists.js';
export * from './thread.js';
export * from './voice.js';
export * from './events.js';
export * from './memory.js';
export * from './presence.js';
export * from './errors.js';
```

**All exports must use `.js` extensions** — this is required for ESM + TypeScript compilation. The tsconfig `moduleResolution: "bundler"` in packages resolves `.js` → `.ts` sources at build time.

### Exact `packages/types/src/index.ts` (complete replacement)

```ts
import type { z } from 'zod';
import type {
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  RefreshResponse,
  MealItem,
  DayPlan,
  WeeklyPlan,
  CreatePlanResponse,
  AllergyVerdict,
  PlanUpdatedEvent,
  GroceryItem,
  GroceryList,
  Turn,
  TurnBody,
  TurnBodyMessage,
  TurnBodyPlanDiff,
  TurnBodyProposal,
  TurnBodySystemEvent,
  TurnBodyPresence,
  VoiceTokenResponse,
  ElevenLabsWebhookPayload,
  InvalidationEvent,
  ForgetRequest,
  ForgetCompletedEvent,
  SurfaceKind,
  PresenceEvent,
  ErrorCode,
  FieldError,
  ApiError,
} from '@hivekitchen/contracts';

// Auth
export type LoginRequest = z.infer<typeof LoginRequest>;
export type LoginResponse = z.infer<typeof LoginResponse>;
export type RefreshRequest = z.infer<typeof RefreshRequest>;
export type RefreshResponse = z.infer<typeof RefreshResponse>;

// Plans
export type MealItem = z.infer<typeof MealItem>;
export type DayPlan = z.infer<typeof DayPlan>;
export type WeeklyPlan = z.infer<typeof WeeklyPlan>;
export type CreatePlanResponse = z.infer<typeof CreatePlanResponse>;
export type AllergyVerdict = z.infer<typeof AllergyVerdict>;
export type PlanUpdatedEvent = z.infer<typeof PlanUpdatedEvent>;

// Lists
export type GroceryItem = z.infer<typeof GroceryItem>;
export type GroceryList = z.infer<typeof GroceryList>;

// Threads
export type Turn = z.infer<typeof Turn>;
export type TurnBody = z.infer<typeof TurnBody>;
export type TurnBodyMessage = z.infer<typeof TurnBodyMessage>;
export type TurnBodyPlanDiff = z.infer<typeof TurnBodyPlanDiff>;
export type TurnBodyProposal = z.infer<typeof TurnBodyProposal>;
export type TurnBodySystemEvent = z.infer<typeof TurnBodySystemEvent>;
export type TurnBodyPresence = z.infer<typeof TurnBodyPresence>;

// Voice
export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponse>;
export type ElevenLabsWebhookPayload = z.infer<typeof ElevenLabsWebhookPayload>;

// Events
export type InvalidationEvent = z.infer<typeof InvalidationEvent>;

// Memory
export type ForgetRequest = z.infer<typeof ForgetRequest>;
export type ForgetCompletedEvent = z.infer<typeof ForgetCompletedEvent>;

// Presence
export type SurfaceKind = z.infer<typeof SurfaceKind>;
export type PresenceEvent = z.infer<typeof PresenceEvent>;

// Errors
export type ErrorCode = z.infer<typeof ErrorCode>;
export type FieldError = z.infer<typeof FieldError>;
export type ApiError = z.infer<typeof ApiError>;
```

**Use `import type` for all imports.** The types package re-exports types only — no runtime values. `isolatedModules` + `import type` is the correct pattern.

**IMPORTANT**: `z` itself is imported as `import type { z } from 'zod'` to satisfy the `import type` constraint needed for `z.infer<>`. The `z.infer<>` utility is a purely compile-time operation.

Wait — `z.infer` requires the runtime `z` in normal usage, but since `typeof Schema` captures the schema's Zod type at compile time, and `z.infer<>` operates on that type, `import type { z }` is sufficient for type-only files. Actually this is tricky — `z.infer<typeof X>` needs `z` as a type namespace. Let me use the simpler pattern actually used in the existing types file:

```ts
import { z } from 'zod';
import {
  // ...all schemas
} from '@hivekitchen/contracts';
```

The import of `z` from zod is needed for `z.infer<>`. Since the types file only exports types (not schemas), and `z.infer<>` is a type-level operation, this compiles correctly. The `import { z }` is a value import of the `z` object, but since only `z.infer<>` (which is a type utility) is used, TypeScript can handle this. This matches the existing file pattern.

### Testing guidance

**Framework**: Vitest v2.x, installed in `packages/contracts/devDependencies`. ESM-native. No config file needed — defaults auto-discover `src/**/*.test.ts`.

**Pattern for each test file**:
```ts
import { describe, it, expect } from 'vitest';
import { Turn, TurnBody } from './thread.js';

describe('Turn', () => {
  it('parses a valid message turn', () => {
    const result = Turn.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      thread_id: '00000000-0000-0000-0000-000000000002',
      server_seq: '1',  // coerced from string
      created_at: '2026-04-23T00:00:00Z',
      role: 'user',
      body: { type: 'message', content: 'Hello' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.server_seq).toBe(BigInt(1));
  });

  it('rejects invalid role', () => {
    const result = Turn.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      thread_id: '00000000-0000-0000-0000-000000000002',
      server_seq: '1',
      created_at: '2026-04-23T00:00:00Z',
      role: 'admin',  // invalid
      body: { type: 'message', content: 'Hello' },
    });
    expect(result.success).toBe(false);
  });
});
```

**Required coverage per file**:
- `thread.test.ts`: `Turn` (valid parse + invalid role + invalid body type), `TurnBody` (each variant + invalid discriminant)
- `plan.test.ts`: `AllergyVerdict` (each verdict + invalid discriminant), `PlanUpdatedEvent` (valid + missing guardrail_verdict)
- `memory.test.ts`: `ForgetRequest` (valid soft + rejection of 'hard' value), `ForgetCompletedEvent` (valid)
- `presence.test.ts`: `PresenceEvent` (valid + invalid surface value), `SurfaceKind` (valid enum value)
- `errors.test.ts`: `ApiError` (valid with fields + valid without fields), `FieldError` (valid), `ErrorCode` (valid value + invalid value)

**Note on bigint test values**: Use string `'1'` as input to test `z.coerce.bigint()` — this simulates SSE JSON delivery. Verify the parsed value equals `BigInt(1)`.

**Note on ForgetRequest.mode 'hard' rejection**:
```ts
it('rejects hard mode (Phase 1 gate)', () => {
  const result = ForgetRequest.safeParse({ node_id: '00000000-0000-0000-0000-000000000001', mode: 'hard' });
  expect(result.success).toBe(false);
});
```

### contracts:check script

Create `packages/contracts/scripts/check.ts`. This script:
1. Reads all `.ts` files in `packages/contracts/src/` (excluding `*.test.ts` and `index.ts`)
2. Extracts export names via regex `export const (\w+)\s*=`
3. Reads all `.ts` files in the workspace (packages/types, apps/api/src, apps/web/src)
4. For each export name: checks if it appears in at least one non-source-file as an import
5. OR the export line has a JSDoc comment containing `@unused-by-design`
6. Exits 1 with a list of violations; exits 0 on success

Minimal implementation:

```ts
#!/usr/bin/env tsx
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { globSync } from 'node:fs';  // Node 22 has glob

const ROOT = resolve(import.meta.dirname, '../../..');
const CONTRACTS_SRC = resolve(import.meta.dirname, '../src');

// Step 1: gather exported names from contracts/src/*.ts (not tests, not index)
const exportedNames = new Map<string, string>(); // name → file
for (const file of readdirSync(CONTRACTS_SRC)) {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'index.ts') continue;
  const content = readFileSync(join(CONTRACTS_SRC, file), 'utf8');
  for (const match of content.matchAll(/export const (\w+)\s*=/g)) {
    exportedNames.set(match[1], file);
  }
}

// Step 2: gather all imports from downstream consumers
const consumerFiles = [
  ...globSync('packages/types/src/**/*.ts', { cwd: ROOT }),
  ...globSync('apps/api/src/**/*.ts', { cwd: ROOT }),
  ...globSync('apps/web/src/**/*.ts', { cwd: ROOT }),
].map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');

// Step 3: check each export
const violations: string[] = [];
for (const [name, file] of exportedNames) {
  const isImported = new RegExp(`\\b${name}\\b`).test(consumerFiles);
  const isTagged = readFileSync(join(CONTRACTS_SRC, file), 'utf8').includes(`@unused-by-design`);
  if (!isImported && !isTagged) violations.push(`${file}: ${name} is not imported by any downstream module`);
}

if (violations.length > 0) {
  process.stderr.write(`contracts:check FAILED:\n${violations.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`contracts:check PASSED: ${exportedNames.size} exports verified.\n`);
```

**Note**: Node 22's `glob` is available as `import { globSync } from 'node:fs'`. If this fails on the specific Node/pnpm setup, use `readdirSync` + manual recursion, or add `glob` as a devDep to `packages/contracts`. Document the approach used.

**Note**: The `import.meta.dirname` requires `moduleResolution: "bundler"` (already set in tsconfig) and `tsx` which is already at root.

### File structure requirements

Post-story the tree changes exactly as follows:

```
packages/
  contracts/
    src/
      auth.ts              Unchanged
      lists.ts             Unchanged
      voice.ts             Unchanged
      thread.ts            New — replaces threads.ts (Turn, TurnBody, 5 variants)
      plan.ts              New — replaces plans.ts (keeps existing + AllergyVerdict, PlanUpdatedEvent)
      memory.ts            New — ForgetRequest, ForgetCompletedEvent
      presence.ts          New — SurfaceKind, PresenceEvent
      errors.ts            New — ErrorCode, FieldError, ApiError
      events.ts            Modified — SSEEvent removed, InvalidationEvent added
      index.ts             Modified — updated exports for all new/renamed files
      thread.test.ts       New — vitest unit tests
      plan.test.ts         New
      memory.test.ts       New
      presence.test.ts     New
      errors.test.ts       New
      threads.ts           DELETED (replaced by thread.ts)
      plans.ts             DELETED (replaced by plan.ts)
    scripts/
      check.ts             New — contracts:check script
    package.json           Modified — vitest devDep + test script added
  types/
    src/
      index.ts             Modified — remove old types, add new types
package.json               Modified — contracts:check root script added
pnpm-lock.yaml             Modified — vitest added
```

### Architecture compliance (must-follow)

- **Shared packages are source-imported**: Never import from `@hivekitchen/contracts/dist/`. Never add a build step to contracts. The `main: "./src/index.ts"` must remain.
- **No path aliases in shared packages**: Relative imports only inside `packages/contracts/src/`. All relative imports need `.js` extensions for ESM correctness.
- **No `const enum`**: `z.enum([...])` is used for all enumerations. `ErrorCode` and `SurfaceKind` are Zod enums, not TypeScript enums.
- **Contracts are the wire truth**: The types in `packages/types` are derived from contracts via `z.infer<>`. No hand-written duplicates.
- **`isolatedModules`**: The types file uses `import type` for all schema imports to satisfy isolatedModules requirements.
- **ESM `import.meta.dirname`**: Used in the check script instead of `__dirname`.

### Library/framework requirements

- **Zod ^3.23.0** (already in `packages/contracts/dependencies`). `z.coerce.bigint()` is available in Zod 3.x.
- **Vitest ^2.2.0** — added to `packages/contracts/devDependencies`. Vitest 2.x has native ESM support without extra config. Vitest 1.x also works but 2.x is preferred.
- **tsx ^4.19.0** — already at root devDependencies (Story 1.2). Used by the check script via `pnpm contracts:check`.

### Dependency exceptions

Per project-context: "Never introduce a new external dependency without a recorded reason."

1. **`vitest@^2.2.0` in `packages/contracts/devDependencies`** — required by this story's AC which mandates unit tests. Vitest is the project-recommended test runner per `project-context.md` ("recommended: Vitest for `web`, `api`, and shared packages"). Story 1.3 is the first story to introduce tests in any shared package; this placement is correct (deps go in the package that uses them).

No other new deps. The check script uses only `node:fs`, `node:path`, and `tsx` (already installed at root).

### Previous story intelligence

**From Story 1.2 (done, code-review passed 2026-04-23):**

- **packages/contracts + packages/types TypeScript sources in Docker deploy closure**: The code review flagged that `packages/contracts` and `packages/types` have `.ts` source files as their `main` export, which means when `pnpm deploy` copies the API's closure into the Docker image, these packages' TypeScript sources end up in the runner's `node_modules`. Currently `apps/api/src/server.ts` only imports `fastify`, so the runner never hits `.ts` at runtime. This story adds substantial content to contracts; the risk remains latent. Do NOT add a build step to `packages/contracts` to fix this — that decision is deferred to Story 1.3/1.6's first workspace-package import introduction (decision: bundle API with esbuild/tsup OR add tsc build step to shared packages). Story 1.3 does NOT make this decision.
- **ESM `.js` extension discipline**: Story 1.2 established the `"type": "module"` pattern. Within `packages/contracts/src/`, inter-file imports (e.g., `events.ts` importing from `thread.ts`) need `.js` extensions: `import { Turn } from './thread.js'`. TypeScript's `moduleResolution: "bundler"` resolves this to `.ts` at build time.
- **Clean script `rm -rf dist`**: `packages/contracts/package.json` already has `"clean": "rm -rf dist"`. The code review flagged this as a Windows cross-platform risk. Do NOT change it in this story — it was deferred to Story 1.5. Do NOT add a new cross-platform clean script.

### Git intelligence

Recent commits:
- `8bbdbce feat(scaffold): wire root scripts, api Dockerfile, per-app env templates` — Story 1.2 work
- `87af79d fix(story-1-1): apply code review patches; mark story done`

Commit scope for Story 1.3: `feat(contracts): ...`. The scope `contracts` matches the `@hivekitchen/contracts` package and the project's commit scoping convention.

### Project structure notes

- **`packages/contracts/src/threads.ts` and `plans.ts` are Story 1.1 stubs** — they contain minimal placeholder implementations. The rename to `thread.ts`/`plan.ts` (singular) matches the Story 1.3 AC. The singular naming convention will be maintained for all future `packages/contracts/src/*.ts` files.
- **`packages/contracts/src/index.ts` currently lacks `.js` extensions** on its re-exports. While this worked under the Story 1.1 setup, Story 1.3 should add `.js` extensions to ALL exports in `index.ts` for correctness.
- **Existing types package consumer pattern**: `packages/types/src/index.ts` currently uses `import { z } from 'zod'` for `z.infer<>`. Keep this pattern — it's correct and consistent with the existing file.
- **No `test/` folder in `packages/contracts`**: Tests are colocated in `src/` as `*.test.ts`, matching the project-context testing rule ("Unit tests: colocated as *.test.ts next to the source file").

### References

- Epic 1 §Story 1.3 — acceptance criteria source. [Source: `_bmad-output/planning-artifacts/epics.md#Story-1.3`]
- Architecture §4.1 — SSE InvalidationEvent contract (7 base events + thread.resync). [Source: `_bmad-output/planning-artifacts/architecture.md#L742-L756`]
- Architecture §1.4 — Event naming conventions (`<resource>.<verb>`). [Source: `_bmad-output/planning-artifacts/architecture.md#L581-L584`]
- UX Design — Foundation Gate definitions (UX-DR6 through UX-DR10). [Source: `_bmad-output/planning-artifacts/ux-design-specification.md`]
- Project context — cross-cutting implementation rules. [Source: `_bmad-output/project-context.md`]
- Previous story learnings. [Source: `_bmad-output/implementation-artifacts/1-2-wire-workspace-package-json-scripts-dockerfile-per-app-env-local-example.md`]
- Deferred work log. [Source: `_bmad-output/implementation-artifacts/deferred-work.md`]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Claude Code)

### Debug Log References

- Vitest ^2.2.0 not available in registry (latest 4.1.5); used ^4.0.0 instead.
- Vitest exits 1 with no test files; added `--passWithNoTests` to test script.
- Story 1.2 not yet merged to main; branched from `feat/story-1-2-scripts-dockerfile-env` tip to include its root scripts and tsx dependency.
- `globSync` from `node:fs` available (Node 24.15.0); used directly in check.ts without fallback.

### Completion Notes List

- All 5 Foundation Gate schema files created: `thread.ts`, `plan.ts`, `memory.ts`, `presence.ts`, `errors.ts`.
- `threads.ts` and `plans.ts` deleted; replaced by singular-named counterparts.
- `events.ts` fully rewritten: `SSEEvent` removed, `InvalidationEvent` 8-member discriminated union added. `PantryDelta` defined as unexported internal stub.
- `index.ts` updated with `.js` extensions on all re-exports.
- `packages/types/src/index.ts` updated: 3 old types removed (`ThreadTurn`, `Thread`, `SSEEvent`), 17 new types added.
- `packages/contracts/scripts/check.ts` created using `globSync` from `node:fs` (Node 22+).
- `contracts:check` added to root `package.json` scripts.
- 53 unit tests across 5 test files — all pass.
- `pnpm typecheck` 6/6, `pnpm test` 53/53, `pnpm contracts:check` 29 exports, `pnpm build` 3/3.

### File List

- `packages/contracts/src/thread.ts` (new — replaces threads.ts)
- `packages/contracts/src/plan.ts` (new — replaces plans.ts)
- `packages/contracts/src/memory.ts` (new)
- `packages/contracts/src/presence.ts` (new)
- `packages/contracts/src/errors.ts` (new)
- `packages/contracts/src/events.ts` (modified — SSEEvent removed, InvalidationEvent added)
- `packages/contracts/src/index.ts` (modified — .js extensions, new exports)
- `packages/contracts/src/thread.test.ts` (new — 17 tests)
- `packages/contracts/src/plan.test.ts` (new — 12 tests)
- `packages/contracts/src/memory.test.ts` (new — 8 tests)
- `packages/contracts/src/presence.test.ts` (new — 6 tests)
- `packages/contracts/src/errors.test.ts` (new — 10 tests)
- `packages/contracts/scripts/check.ts` (new — contracts:check script)
- `packages/contracts/package.json` (modified — vitest ^4.0.0 + test script)
- `packages/types/src/index.ts` (modified — removed 3 old types, added 17 new types)
- `package.json` (root) (modified — contracts:check script added)
- `pnpm-lock.yaml` (modified — vitest added)
- `packages/contracts/src/threads.ts` (deleted)
- `packages/contracts/src/plans.ts` (deleted)

### Change Log

- 2026-04-23: Implemented all 13 tasks. Created 5 Foundation Gate schema files, 5 test files, contracts:check script. 53 tests pass. All workspace checks green.
- 2026-04-23: Code review completed. 3 decision-needed, 3 patches, 8 deferred, 10 dismissed (see Review Findings).
- 2026-04-23: Review patches applied — D1 unified (`InvalidationEvent` embeds `PlanUpdatedEvent` + `PresenceEvent`), D2 added (`ForgetCompletedEvent` is an `InvalidationEvent` member), D3 hardened (`check.ts` rewritten with import-statement regex, `.tsx` globs, broader export-form detection, duplicate-name detection, `z.infer<>` plumbing verification), P1 `SequenceId` union replaces `z.coerce.bigint()`, P2 `.min(1)` on `AllergyVerdict.blocked.allergens` + `degraded.reason`. New `events.test.ts` added; 53 → 74 tests. Typecheck 6/6, build 3/3, `contracts:check` PASS (29 exports).

### Review Findings

**Summary:** 3 decision-needed, 3 patch, 8 defer, 10 dismissed (false positives / known/deferred by spec). All 11 ACs satisfied literally. Typecheck 6/6, tests 53/53, `contracts:check` passes.

#### Decision-Needed (resolved)

- [x] [Review][Decision] `InvalidationEvent` members shadow `PlanUpdatedEvent` and `PresenceEvent` with lossy shapes — **Resolved (a): unified.** `InvalidationEvent` now references `PlanUpdatedEvent` and `PresenceEvent` directly; full shapes (including `guardrail_verdict`, `surface`, `expires_at`) are preserved on the wire. [packages/contracts/src/events.ts]
- [x] [Review][Decision] `ForgetCompletedEvent` has no transport channel — **Resolved (a): added.** `ForgetCompletedEvent` is now a member of `InvalidationEvent` so `memory.forget.completed` has a real SSE transport. [packages/contracts/src/events.ts]
- [x] [Review][Decision] `contracts:check` script meets AC literally but not its spirit — **Resolved (b): hardened.** Rewritten `check.ts` uses import-statement regex (not bare-word match), globs `.ts` and `.tsx` in `apps/api` and `apps/web`, broadens export-form detection (`const` / `function` / `class` / `type` / `interface` / `enum` / `export { ... }`), detects duplicate export names across files, and verifies `packages/types` plumbing via actual `z.infer<typeof X>` sites instead of free-text name match. Note: `packages/types` is retained as a valid plumbing signal (not fully excluded), because apps/api and apps/web do not yet import any contract schema in Story 1.3's bootstrap state; the hardened check still catches missing-plumbing bugs (contract export absent from types barrel) that the old tautological check would have missed. [packages/contracts/scripts/check.ts]

#### Patch (applied)

- [x] [Review][Patch] `z.coerce.bigint()` coerces `''` and `[]` to `0n` — **Fixed.** Replaced `z.coerce.bigint()` with a `SequenceId` union (`bigint | int | numeric-string`) in both `thread.ts` (`server_seq`) and `events.ts` (`thread.resync.from_seq`). Added tests covering `''`, `[]`, and `'1e3'` rejection. [packages/contracts/src/thread.ts, events.ts; thread.test.ts, events.test.ts]
- [x] [Review][Patch] `AllergyVerdict.blocked` accepts `allergens: []`; `AllergyVerdict.degraded` accepts `reason: ''` — **Fixed.** `.min(1)` added to `blocked.allergens`, each element, and `degraded.reason`. Rejection tests added. [packages/contracts/src/plan.ts; plan.test.ts]
- [x] [Review][Patch] `contracts:check` glob misses `.tsx` in apps/web — **Fixed** as part of D3 hardening (folded into the check.ts rewrite). [packages/contracts/scripts/check.ts]

#### Deferred (pre-existing or out-of-story scope)

- [x] [Review][Defer] `WeeklyPlan.weekOf: z.string()` unconstrained — pre-existing from Story 1.1; not touched by 1.3.
- [x] [Review][Defer] UUID validators across all schemas accept the nil UUID `00000000-0000-0000-0000-000000000000` — sentinel-rejection policy belongs with Story 1.6 env/boundary work or architecture guidance.
- [x] [Review][Defer] `Turn.created_at` / `expires_at` / `completed_at` accept ISO strings without seconds (e.g. `'2026-04-23T00:00Z'`) — Zod `.datetime()` default; tighten when wire-format precision is pinned.
- [x] [Review][Defer] `PantryDelta` accepts empty delta `{}` — unexported internal stub; pantry domain refinement is Epic 3+.
- [x] [Review][Defer] `ApiError.fields[].code` reuses `ErrorCode` which mixes request-level and field-level semantics — future split into `FieldErrorCode` (e.g., `FIELD_REQUIRED`, `FIELD_INVALID_FORMAT`) recommended when downstream routes start emitting real field errors.
- [x] [Review][Defer] `contracts:check` soft spots beyond the P3 fix: file-scoped `@unused-by-design` exemption; regex misses `export function` / `export type` / `export { X }` / multiline exports; `exportedNames` map silently overwrites on duplicate names. All currently latent (no violations in tree).
- [x] [Review][Defer] `z.string().datetime()` rejects timezone offsets (accepts only `Z`-suffixed UTC) — Zod default; `{ offset: true }` option needed if downstream producers emit offsets. Defer until Story 1.10 SSE wire-format decision.
- [x] [Review][Defer] No `engines.node` declared at root or in `packages/contracts` but `check.ts` relies on Node 22+ APIs (`globSync`, `import.meta.dirname`) — add `"engines": { "node": ">=22" }` in a root-hygiene or Story 1.6 pass.

#### Dismissed (false positive / out-of-scope)

- Blind Hunter: `z.string().date()` unavailable in Zod 3.x — installed Zod is 3.25.76; `.date()` is available and rejects `'2026-02-30'`.
- Blind Hunter: `globSync` not exported from `node:fs` — confirmed working on Node 24 (dev env and target).
- Blind Hunter: `import.meta.dirname` undefined — works on Node 24.
- Blind Hunter: rename `plans→plan` / `threads→thread` breaks stale imports in apps — typecheck 6/6 passes; grep found no stale refs (apps already use new names where applicable).
- Blind Hunter: `JSON.stringify(BigInt)` throws — known and explicitly deferred by spec to Story 1.10 SSE emitter (spec "bigint serialization note").
- Blind Hunter: `.js` specifiers break bundler resolution — typecheck and `pnpm build` 3/3 pass; moduleResolution handles it.
- Edge Case: `z.string().date()` accepts `'2026-02-30'` — live parse rejects.
- Edge Case: `exportedNames` map collision — currently no collisions in tree; latent risk captured in the deferred `contracts:check` soft-spot bundle.
- Auditor: vitest `^4.0.0` vs spec `^2.2.0` — debug log documents the deviation; 4.x works; downgrading to 2.x would be a regression; spec's `^2.2.0` was stale guidance.
- Auditor: `--passWithNoTests` flag — harmless; no meaningful failure mode masked given tests exist.
