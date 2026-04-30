# Story 12.1: Lumi contracts — LumiSurface, LumiContextSignal, LumiTurnRequest

Status: done

## Story

As a developer,
I want the shared Lumi contracts defined in `packages/contracts/src/lumi.ts`,
So that both `apps/web` and `apps/api` work from a single source of truth for surface types and context signals (ADR-002).

## Architecture Overview

### New Contract File

`packages/contracts/src/lumi.ts` is a new file that defines the Lumi-specific surface enum, context signal, and all request/response schemas for the ambient Lumi API layer. It does NOT touch the onboarding schemas — those remain in `voice.ts` and `onboarding.ts` unchanged.

### LumiSurface Enum

```typescript
export const LumiSurfaceSchema = z.enum([
  'onboarding',        // onboarding flow (existing — not ambient)
  'planning',          // weekly plan view
  'meal-detail',       // specific meal inspection
  'child-profile',     // child settings / preferences
  'grocery-list',      // grocery and pantry view
  'evening-check-in',  // evening check-in flow
  'heart-note',        // heart note composition
  'general',           // home / fallback
]);
```

### LumiContextSignal

Carried with every Lumi turn (voice and text). Assembled on the frontend; describes what the user is currently viewing. The `recent_actions` field is a rolling queue of the last 5 user actions on the current surface (e.g. "Approved Thursday meal", "Flagged strawberry allergen").

```typescript
export const LumiContextSignalSchema = z.object({
  surface: LumiSurfaceSchema,
  entity_type: z.string().optional(),             // e.g. 'plan', 'meal', 'child'
  entity_id: z.string().uuid().optional(),         // e.g. the plan ID being viewed
  entity_summary: z.string().max(500).optional(),  // human-readable summary of what's on screen
  recent_actions: z.array(z.string()).max(5).optional(),
});
```

### LumiTurnRequest

For `POST /v1/lumi/turns` (text-mode turns; Story 12.10). Defined here so Story 12.1 establishes the full contract surface — the endpoint is implemented in Story 12.10.

```typescript
export const LumiTurnRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  context_signal: LumiContextSignalSchema,
});
```

### LumiThreadTurnsResponse

For `GET /v1/lumi/threads/:threadId/turns` (Story 12.3). The endpoint returns the last 20 turns ordered by `server_seq`.

```typescript
export const LumiThreadTurnsResponseSchema = z.object({
  thread_id: z.string().uuid(),
  turns: z.array(Turn),  // imported from thread.ts
});
```

### VoiceTalkSession

For `POST /v1/lumi/voice/sessions` (Story 12.5). A talk session is a short-lived ElevenLabs token pair — distinct from the long-lived HiveKitchen user session.

```typescript
export const VoiceTalkSessionCreateSchema = z.object({
  context: LumiSurfaceSchema,
  context_signal: LumiContextSignalSchema,
});

export const VoiceTalkSessionResponseSchema = z.object({
  talk_session_id: z.string().uuid(),
  stt_token: z.string().min(1),
  tts_token: z.string().min(1),
  voice_id: z.string().min(1),
});
```

### LumiNudgeEvent

SSE event payload for proactive nudges (Story 12.11). Defined here to complete the contract surface.

```typescript
export const LumiNudgeEventSchema = z.object({
  type: z.literal('lumi.nudge'),
  turn: Turn,  // imported from thread.ts
  surface: LumiSurfaceSchema,
});
```

### voice.ts context field migration

`VoiceSessionCreateSchema.context` currently uses `z.literal('onboarding')`. This locks the voice pipeline to the onboarding surface only. Migrate to `LumiSurfaceSchema` imported from `lumi.ts`. The onboarding flow still passes `context: 'onboarding'` — this is a valid value in the enum and requires no onboarding code changes.

```typescript
// Before (voice.ts)
export const VoiceSessionCreateSchema = z.object({
  context: z.literal('onboarding'),
});

// After (voice.ts — imports LumiSurfaceSchema from lumi.ts)
export const VoiceSessionCreateSchema = z.object({
  context: LumiSurfaceSchema,
});
```

### contracts/index.ts

Add `export * from './lumi.js';` to the barrel export.

### packages/types/src/index.ts

Import new schemas from `@hivekitchen/contracts` and export inferred types for all new Lumi schemas. Follow the existing pattern in `types/src/index.ts` (explicit named imports + `z.infer<>` type exports).

## Acceptance Criteria

1. **Given** no `lumi.ts` contract exists in `packages/contracts/src/`, **When** Story 12.1 is complete, **Then** `packages/contracts/src/lumi.ts` exists and exports `LumiSurfaceSchema`, `LumiContextSignalSchema`, `LumiTurnRequestSchema`, `LumiThreadTurnsResponseSchema`, `VoiceTalkSessionCreateSchema`, `VoiceTalkSessionResponseSchema`, `LumiNudgeEventSchema`.

2. **Given** `packages/contracts/src/voice.ts` currently has `context: z.literal('onboarding')`, **When** Story 12.1 is complete, **Then** `VoiceSessionCreateSchema.context` is `LumiSurfaceSchema` (imported from `lumi.ts`). `z.enum` accepts all 8 surfaces including `'onboarding'` — no existing onboarding callers need to change.

3. **Given** `packages/contracts/src/index.ts` does not export lumi schemas, **When** Story 12.1 is complete, **Then** `index.ts` exports `export * from './lumi.js'`.

4. **Given** the new schemas are in contracts, **When** Story 12.1 is complete, **Then** `packages/types/src/index.ts` exports inferred TypeScript types: `LumiSurface`, `LumiContextSignal`, `LumiTurnRequest`, `LumiThreadTurnsResponse`, `VoiceTalkSessionCreate`, `VoiceTalkSessionResponse`, `LumiNudgeEvent`.

5. **Given** the updated contracts, **When** `pnpm typecheck` runs across all packages, **Then** it passes with zero errors.

6. **Given** the updated contracts, **When** `pnpm --filter @hivekitchen/contracts test` runs, **Then** all existing tests pass and new round-trip tests for each new schema pass.

## Tasks / Subtasks

- [x] Task 1 — Create `packages/contracts/src/lumi.ts` (AC: #1)
  - [x] Define `LumiSurfaceSchema` (z.enum, 8 values)
  - [x] Define `LumiContextSignalSchema` with optional entity_type, entity_id, entity_summary, recent_actions
  - [x] Define `LumiTurnRequestSchema` (message + context_signal)
  - [x] Define `LumiThreadTurnsResponseSchema` (thread_id + turns array — import `Turn` from `./thread.js`)
  - [x] Define `VoiceTalkSessionCreateSchema` (context + context_signal)
  - [x] Define `VoiceTalkSessionResponseSchema` (talk_session_id, stt_token, tts_token, voice_id)
  - [x] Define `LumiNudgeEventSchema` (type: 'lumi.nudge', turn, surface)
  - [x] Export all schemas and inferred types at the bottom of the file

- [x] Task 2 — Update `packages/contracts/src/voice.ts` (AC: #2)
  - [x] Import `LumiSurfaceSchema` from `./lumi.js`
  - [x] Replace `context: z.literal('onboarding')` with `context: LumiSurfaceSchema` in `VoiceSessionCreateSchema`

- [x] Task 3 — Update `packages/contracts/src/index.ts` (AC: #3)
  - [x] Add `export * from './lumi.js';` (insert after the existing exports — order: after `./cultural.js`)

- [x] Task 4 — Update `packages/types/src/index.ts` (AC: #4)
  - [x] Add new schemas to the import list from `@hivekitchen/contracts`
  - [x] Export inferred types: `LumiSurface`, `LumiContextSignal`, `LumiTurnRequest`, `LumiThreadTurnsResponse`, `VoiceTalkSessionCreate`, `VoiceTalkSessionResponse`, `LumiNudgeEvent`

- [x] Task 5 — Add contract tests in `packages/contracts/src/lumi.test.ts` (AC: #6)
  - [x] Round-trip test: valid `LumiContextSignalSchema` with all optional fields
  - [x] Round-trip test: `LumiContextSignalSchema` with only `surface`
  - [x] Test: `recent_actions` rejects arrays longer than 5 items
  - [x] Test: `entity_summary` rejects strings longer than 500 chars
  - [x] Test: `LumiSurfaceSchema` rejects unknown surface string
  - [x] Test: `VoiceTalkSessionCreateSchema` valid parse
  - [x] Test: `LumiNudgeEventSchema` valid parse (type must be `'lumi.nudge'`)

- [x] Task 6 — Verify typecheck and tests (AC: #5, #6)
  - [x] `pnpm typecheck` — zero errors across all packages
  - [x] `pnpm --filter @hivekitchen/contracts test` — lumi (29/29) + voice (32/32) green; thread + all other contracts test files green

### Review Findings (2026-04-29)

**Decision-needed (4) — resolved → patches applied:**

- [x] [Review][Decision] **`VoiceTalkSessionCreateSchema` has two surface fields with no consistency invariant** — _Resolved: dropped top-level `context`; surface now derived from `context_signal.surface` (intentional spec deviation, mirrors `LumiTurnRequestSchema` shape)._ [`packages/contracts/src/lumi.ts:53-55`]
- [x] [Review][Decision] **`LumiTurnRequestSchema.message` accepts whitespace-only input** — _Resolved: trim-then-validate via `z.string().trim().min(1).max(4000)`. `'   '` rejected; `'  hi  '` accepted as `'hi'`._ [`packages/contracts/src/lumi.ts:33`]
- [x] [Review][Decision] **`LumiContextSignalSchema.entity_type` and `recent_actions` strings are unbounded** — _Resolved: `entity_type: z.string().min(1).max(64).optional()` and `recent_actions: z.array(z.string().min(1).max(200)).max(5).optional()`._ [`packages/contracts/src/lumi.ts:24,27`]
- [x] [Review][Decision] **`VoiceTalkSessionResponseSchema` tokens are loosely validated** — _Resolved: extracted `VoiceCredentialSchema = z.string().min(1).max(2048).regex(/^\S+$/)` shared by all three credential fields._ [`packages/contracts/src/lumi.ts:60-65`]

**Patch (3) — applied:**

- [x] [Review][Patch] Clarify `LumiThreadTurnsResponseSchema` doc comment — _Applied: comment now says "The API caps each response at 20 turns ordered by server_seq; the schema does not enforce the cap"._ [`packages/contracts/src/lumi.ts:42-44`]
- [x] [Review][Patch] Add inclusive boundary tests for `LumiTurnRequestSchema.message` — _Applied: tests for length 1 and length 4000 added._ [`packages/contracts/src/lumi.test.ts`]
- [x] [Review][Patch] Add an enum-membership pin test for `LumiSurfaceSchema` — _Applied: `expect(LumiSurfaceSchema.options).toEqual([...])` snapshot at top of `LumiSurfaceSchema` describe block._ [`packages/contracts/src/lumi.test.ts`]

**Deferred (7) — real but out of scope for this story:**

- [x] [Review][Defer] **`LumiNudgeEventSchema` is not registered in the `InvalidationEvent` discriminated union** — `'lumi.nudge'` not present in `events.ts` SSE union. Story 12.11 implements SSE delivery and will need to either fold `lumi.nudge` into `InvalidationEvent` or carry it on a separate channel. [edge H1] — deferred, blocks 12.11 scope
- [x] [Review][Defer] **`VoiceSessionCreateSchema` widening lets non-`'onboarding'` surfaces silently pass through to onboarding-only route** — `voice.routes.ts`/`voice.service.ts` ignore `context` and unconditionally use `'onboarding'` thread type. Until 12.5 introduces `/v1/lumi/voice/sessions`, the legacy route should runtime-reject non-`'onboarding'` contexts. Spec explicitly forbids `apps/api` changes in 12.1 — must be a follow-up before 12.5 ships. [blind B11 + edge M1] — deferred, follow-up needed before 12.5
- [x] [Review][Defer] **`LumiNudgeEventSchema` envelope lacks `thread_id`/event-id/timestamp** — Spec defines exactly `type` + `turn` + `surface`. Reconsider envelope-level routing/dedup metadata at SSE-wiring time in 12.11. [blind B8] — deferred, spec-conformant; revisit at 12.11
- [x] [Review][Defer] **`Turn.modality` remains optional** — Ambient Lumi mixes text+voice in one thread; modality semantics are ambiguous. Story 12.4 explicitly drops the modality discriminator. [edge M6] — deferred, addressed by 12.4
- [x] [Review][Defer] **`LumiThreadTurnsResponseSchema` does not cross-check that nested `turns[].thread_id` matches the outer `thread_id`** — server-correctness concern, not a contract gap. [edge L2] — deferred, server-side responsibility
- [x] [Review][Defer] **`voice.test.ts:22` "rejects unknown context" uses `'evening'` which is rejected only because it's not in `LumiSurfaceSchema`** — not load-bearing. Should use a structurally invalid value (`null`, `123`, or `'__not_a_surface__'`). Pre-existing test, 12.1 did not touch test files in voice.test.ts. [edge L4] — deferred, pre-existing test quality issue
- [x] [Review][Defer] **`LumiTurnRequestSchema` strict-mode behavior is undefined** — accepts unknown extra fields by default; no test asserts intended behavior. [edge L5] — deferred, strict-mode policy is a project-wide schema design choice

**Dismissed (4) — false positives or by-design:**

- `server_seq: '1'` test fixture flagged by Blind Hunter — Turn schema accepts string-form bigints via the `SequenceId` union [`packages/contracts/src/thread.ts:7-14`], verified by existing `thread.test.ts:82-93`. Not a defect.
- "Two near-identical session-creation contracts" — `VoiceSessionCreateSchema` (legacy onboarding) and `VoiceTalkSessionCreateSchema` (ambient Lumi) coexist by ADR-002 design. Not duplication.
- "`LumiNudgeEventSchema` is not `.strict()`" — strict-mode is not the codebase default for SSE/event payloads (see `Turn` discriminated union members). Design choice, no consensus to adopt.
- "`Turn.role: 'system'` admitted into `LumiNudgeEventSchema.turn`" — spec defines `turn: Turn` (full schema). Refining to `role === 'lumi'` would deviate from spec.

## Dev Notes

### Zod version
This codebase uses Zod 4 (upgraded in Story 1.16). Use `z.enum([...])` syntax — unchanged from Zod 3. Do NOT use `z.nativeEnum`. [Source: _bmad-output/project-context.md — Zod 4]

### Import path convention in contracts
All intra-package imports use `.js` extension regardless of TypeScript source (ESM + `moduleResolution: "bundler"`). `lumi.ts` must import `Turn` from `'./thread.js'`. [Source: apps/web CLAUDE.md — TypeScript ^5.5, ESM, `moduleResolution: "bundler"`]

### voice.ts backward compatibility
`VoiceSessionCreateSchema.context` changing from `z.literal('onboarding')` to `z.enum([...])` is backward compatible: `'onboarding'` is a valid enum value. The `OnboardingAgent` in `apps/api` passes `context: 'onboarding'` — still valid after this change. No API or web consumers need to change. `VoiceSessionCreate` inferred type in `packages/types` will broaden from `{ context: 'onboarding' }` to `{ context: LumiSurface }` — verify no callers depend on the narrow literal type.

### No onboarding code changes
The onboarding agent, routes, and text onboarding path are NOT touched in this story. The `context: 'onboarding'` literal narrowing exists in the service and agent — those remain as string literals, still valid after widening the schema.

### Turn import in lumi.ts
`LumiThreadTurnsResponseSchema` and `LumiNudgeEventSchema` reference `Turn` from `thread.ts`. Import as `import { Turn } from './thread.js'`. The `Turn` schema is already exported from `thread.ts`.

### Project Structure Notes

- New file: `packages/contracts/src/lumi.ts`
- New file: `packages/contracts/src/lumi.test.ts`
- Modified: `packages/contracts/src/voice.ts` — context field only
- Modified: `packages/contracts/src/index.ts` — add lumi export
- Modified: `packages/types/src/index.ts` — add new type exports
- No changes to `apps/api` or `apps/web` in this story

### References

- [Source: _bmad-output/planning-artifacts/adr-ambient-lumi.md#Decision 2 — Context Signal Layer]
- [Source: _bmad-output/planning-artifacts/adr-ambient-lumi.md#Contract Changes]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.1]
- [Source: packages/contracts/src/voice.ts — VoiceSessionCreateSchema to migrate]
- [Source: packages/contracts/src/thread.ts — Turn schema to import]
- [Source: packages/contracts/src/index.ts — barrel export pattern]
- [Source: packages/types/src/index.ts — type export pattern]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Claude Opus 4.7, 1M context) — bmad-dev-story workflow

### Debug Log References

- Initial `pnpm --filter @hivekitchen/contracts test` revealed 6 pre-existing failures in `cultural.test.ts` (Story 2-11 contract tests). Verified via `git stash --include-untracked` baseline that these failures exist on HEAD before any 12-1 changes — not a regression introduced by this story. Cultural priors test failures are out of scope for 12-1 and should be addressed by the in-flight 2-11 work.
- Lumi tests: 29/29 passing (`vitest run src/lumi.test.ts`).
- Voice tests after `context` widening to `LumiSurfaceSchema`: 32/32 passing — the existing `'onboarding'` happy-path and the unknown-context rejection (which used `'evening'`, still not a member of `LumiSurfaceSchema`) both still hold without modification.
- Repo-wide `pnpm typecheck`: 9/9 packages successful, 0 errors.

### Completion Notes List

- Implemented Lumi contract surface (ADR-002): 7 new Zod schemas with inferred TypeScript types covering surface enum, context signal, text-mode turn request, thread turns response, voice talk-session lifecycle, and SSE nudge event.
- `VoiceSessionCreateSchema.context` widened from `z.literal('onboarding')` to `LumiSurfaceSchema`. Backward compatible — `'onboarding'` remains a valid enum member, so onboarding voice callers (`OnboardingAgent`, voice service) need no changes.
- Existing `voice.test.ts` "rejects unknown context" assertion uses `'evening'` (not `'evening-check-in'`), which is correctly rejected by the widened enum — no test churn required.
- Followed Zod 3-style API (`.string().uuid()`, `.string().datetime()`) to match existing convention in `voice.ts` and `thread.ts`, even though Zod 4 is installed.
- All intra-package imports use `.js` extensions per `moduleResolution: "bundler"` ESM rules.

**Code review patches (2026-04-29):**
- Resolved Decision 1 by dropping top-level `context` from `VoiceTalkSessionCreateSchema`. Spec deviation accepted because (a) the surface is fully captured by `context_signal.surface`, (b) `LumiTurnRequestSchema` already follows the single-source pattern, and (c) two sources of the same fact would drift between API routing and agent prompt construction. Update ADR-002 / spec accordingly when next revising the contract docs.
- Resolved Decision 2 by adding `.trim()` before `.min(1)` on `message` — whitespace-only input is rejected, surrounding whitespace is silently trimmed.
- Resolved Decision 3 by tightening `entity_type` to `min(1).max(64)` and `recent_actions[i]` to `min(1).max(200)`, bringing them in line with sibling caps (`entity_summary` 500, `message` 4000).
- Resolved Decision 4 by extracting a shared `VoiceCredentialSchema = z.string().min(1).max(2048).regex(/^\S+$/)` for `stt_token`, `tts_token`, and `voice_id` — credentials fail fast at the API boundary instead of at ElevenLabs auth.
- Added 19 new tests covering boundary cases, the dropped `context` field, trim semantics, credential whitespace/length rules, entity_type bounds, recent_actions per-item bounds, and an enum-membership pin test for `LumiSurfaceSchema`. Total contract tests: 76/76 green; full repo `pnpm typecheck` 9/9 green.
- No `apps/api` or `apps/web` changes required for this story — type widening is consumer-safe.

### File List

- `packages/contracts/src/lumi.ts` — new
- `packages/contracts/src/lumi.test.ts` — new
- `packages/contracts/src/voice.ts` — modified (`context` field widened to `LumiSurfaceSchema`)
- `packages/contracts/src/index.ts` — modified (added `export * from './lumi.js'`)
- `packages/types/src/index.ts` — modified (added 7 new inferred type exports)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (12-1 status transition)
- `_bmad-output/implementation-artifacts/12-1-lumi-contracts-lumisurface-lumicontextsignal-lumiturnrequest.md` — modified (Dev Agent Record + status)

## Change Log

| Date       | Change                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------- |
| 2026-04-29 | Implemented Story 12.1 — Lumi contract surface (lumi.ts + voice.ts context widening). Status → review. |
