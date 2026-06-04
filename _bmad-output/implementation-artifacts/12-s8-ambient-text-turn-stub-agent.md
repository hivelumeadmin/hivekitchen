# Story 12-S8: Ambient Text Turn — Stub Agent

Status: done

## Story

As a Primary Parent using HiveKitchen,
I want to type a message to Lumi in the panel and receive a reply,
so that the ambient Lumi companion is conversational and my messages persist across page reloads.

## Acceptance Criteria

1. **Given** the LumiPanel is open on any non-onboarding surface, **When** I type a message and submit, **Then** `POST /v1/lumi/turns` is called with `{ message, context_signal: { surface } }` and JWT auth.

2. **Given** no prior ambient thread exists for this `(household_id, surface)` pair, **When** the first turn is submitted, **Then** the API lazy-creates a `threads` row (type = surface name, modality = 'text') using the existing `createAmbientThread` repository method, then persists both the user turn and the Lumi stub turn to `thread_turns`.

3. **Given** an ambient thread already exists for this surface, **When** a subsequent turn is submitted, **Then** both turns are appended to the existing thread — no new thread is created.

4. **Given** the user submits a turn, **When** the API responds with `{ thread_id, user_turn, lumi_turn }`, **Then** the LumiPanel appends the user turn and the Lumi turn to the visible turns list without a full re-hydration.

5. **Given** the API response is received, **When** the `threadIds[surface]` was previously undefined, **Then** the store updates `threadIds[surface]` with the returned `thread_id` so subsequent panel opens pre-hydrate from the correct thread.

6. **Given** the LumiAgent stub is called, **Then** it returns the fixed string `"Got it."` regardless of the message content (real implementation in S9).

7. **Given** the panel is reloaded (route unmount + remount), **When** `useLumiContext` fires, **Then** `GET /v1/lumi/threads/:threadId/turns` returns both persisted turns and the panel renders them.

8. **Given** the textarea was previously disabled (TODO comment in LumiPanel.tsx), **When** this story is complete, **Then** the textarea is enabled and the TODO comment is removed.

9. **Given** `context_signal.surface === 'onboarding'`, **When** `POST /v1/lumi/turns` is called, **Then** the API returns 400 with `{ code: 'VALIDATION_FAILED' }` — same guard as the voice session endpoint.

10. **Given** the user submits a turn, **When** a network error or 4xx/5xx occurs, **Then** the textarea input is restored (not cleared) and an inline error message appears in the panel without breaking the turn list state.

## Tasks / Subtasks

- [x] Task 1 — Add `LumiTurnResponseSchema` to contracts (AC: #4, #5)
  - [x] In `packages/contracts/src/lumi.ts`, add:
    ```ts
    export const LumiTurnResponseSchema = z.object({
      thread_id: z.string().uuid(),
      user_turn: Turn,
      lumi_turn: Turn,
    });
    export type LumiTurnResponse = z.infer<typeof LumiTurnResponseSchema>;
    ```
  - [x] Export `LumiTurnResponseSchema` and `LumiTurnResponse` from `packages/contracts/src/index.ts`
  - [x] Add a unit test to `packages/contracts/src/lumi.ts`'s test file (or inline if no test file exists) verifying `LumiTurnResponseSchema.parse()` accepts a valid payload and rejects missing fields

- [x] Task 2 — Create stub `LumiAgent` (AC: #6)
  - [x] Create `apps/api/src/agents/lumi.agent.ts`:
    ```ts
    export interface LumiAgentRespondInput {
      message: string;
    }

    // Stub for Story 12-S8. Real LLM dispatch with surface prompts + household
    // snapshot lands in Story 12-S9. Constructor takes no args so S9 can
    // add dependency injection without changing the service call site structure.
    export class LumiAgent {
      respond(_input: LumiAgentRespondInput): Promise<string> {
        return Promise.resolve('Got it.');
      }
    }
    ```
  - [x] Create `apps/api/src/agents/lumi.agent.test.ts` with a single test: `respond()` resolves `"Got it."` for any message

- [x] Task 3 — Add `insertTurn` to `LumiRepository` (AC: #2, #3)
  - [x] In `apps/api/src/modules/lumi/lumi.repository.ts`, add:
    ```ts
    async insertTurn(input: {
      threadId: string;
      role: 'user' | 'lumi' | 'system';
      body: TurnBody;
      modality: 'text' | 'voice';
    }): Promise<Turn> {
      const { data, error } = await this.client
        .from('thread_turns')
        .insert({
          thread_id: input.threadId,
          role: input.role,
          body: input.body,
          modality: input.modality,
        })
        .select(TURN_COLUMNS)
        .single();
      if (error) throw error;
      return mapRowToTurn(data as TurnRow);
    }
    ```
  - [x] Import `TurnBody` from `@hivekitchen/types` at the top of `lumi.repository.ts`
  - [x] The `mapRowToTurn` function is already module-level in that file — no change needed to it

- [x] Task 4 — Add `submitTextTurn` to `LumiService` (AC: #2, #3, #6, #9)
  - [x] In `apps/api/src/modules/lumi/lumi.service.ts`, add the method:
    ```ts
    async submitTextTurn(input: {
      householdId: string;
      message: string;
      contextSignal: LumiContextSignal;
    }): Promise<{ thread_id: string; user_turn: Turn; lumi_turn: Turn }> {
      const surface = input.contextSignal.surface;
      assertAmbientSurface(surface); // reuse existing guard — throws 400 for 'onboarding'

      const existing = await this.repository.findActiveAmbientThread(
        input.householdId,
        surface,
      );
      const thread =
        existing ??
        (await this.repository.createAmbientThread(input.householdId, surface, 'text'));

      const userTurn = await this.repository.insertTurn({
        threadId: thread.id,
        role: 'user',
        body: { type: 'message', content: input.message },
        modality: 'text',
      });

      const agent = new LumiAgent();
      const lumiText = await agent.respond({ message: input.message });

      const lumiTurn = await this.repository.insertTurn({
        threadId: thread.id,
        role: 'lumi',
        body: { type: 'message', content: lumiText },
        modality: 'text',
      });

      return { thread_id: thread.id, user_turn: userTurn, lumi_turn: lumiTurn };
    }
    ```
  - [x] Import `LumiAgent` at the top: `import { LumiAgent } from '../../agents/lumi.agent.js';`
  - [x] Import `Turn` from `@hivekitchen/types`

- [x] Task 5 — Wire `POST /v1/lumi/turns` route (AC: #1, #2, #9)
  - [x] In `apps/api/src/modules/lumi/lumi.routes.ts`, add:
    ```ts
    fastify.post(
      '/turns',
      {
        schema: {
          body: LumiTurnRequestSchema,
          response: { 201: LumiTurnResponseSchema },
        },
      },
      async (request, reply) => {
        const body = request.body as LumiTurnRequest;
        const result = await service.submitTextTurn({
          householdId: request.user.household_id,
          message: body.message,
          contextSignal: body.context_signal,
        });
        return reply.code(201).send(result);
      },
    );
    ```
  - [x] Add `LumiTurnRequestSchema`, `LumiTurnResponseSchema` and their inferred types to the import from `@hivekitchen/contracts`

- [x] Task 6 — Wire LumiPanel composer (AC: #4, #5, #8, #10)
  - [x] In `apps/web/src/components/LumiPanel.tsx`, replace the disabled textarea with a functional composer:
    - Add `import { LumiTurnResponseSchema } from '@hivekitchen/contracts';`
    - Add local state: `const [draft, setDraft] = useState(''); const [isSending, setIsSending] = useState(false); const [sendError, setSendError] = useState<string | null>(null);`
    - `handleSubmit` function (see Dev Notes section for implementation blueprint)
    - Remove `disabled` prop and the TODO comment from the textarea
    - Render `sendError` inline below the textarea when non-null
  - [x] The `appendTurn` store action is already implemented — use it for both user and Lumi turns
  - [x] The `threadIds` update must use `useLumiStore.setState` directly (no dedicated action exists)

- [x] Task 7 — Tests (AC: all)
  - [x] `apps/api/src/modules/lumi/lumi.routes.test.ts` — add tests for `POST /v1/lumi/turns`:
    - Returns 201 with `{ thread_id, user_turn, lumi_turn }` for valid body + auth
    - Returns 400 (`VALIDATION_FAILED`) when `surface === 'onboarding'`
    - Returns 400 when `message` is empty or whitespace-only
    - Returns 401 when JWT is absent
    - Lumi turn body content is `"Got it."`
  - [x] `apps/web/src/components/LumiPanel.test.tsx` — add tests for composer:
    - Textarea is enabled (not disabled) after this story
    - Submitting a message calls `POST /v1/lumi/turns` with correct body
    - Both turns appear in the panel after successful submit
    - `threadIds[surface]` is updated in the store after first submit
    - On network error, textarea draft is restored and error text renders
    - Submit button / Enter key is disabled while `isSending === true` (prevents double-send)
  - [x] `apps/api/src/agents/lumi.agent.test.ts` — already covered in Task 2

## Dev Notes

### LumiPanel composer — implementation blueprint

```tsx
// apps/web/src/components/LumiPanel.tsx (partial — composer area)

import { useState } from 'react';
import { LumiTurnResponseSchema } from '@hivekitchen/contracts';
import { hkFetch } from '@/lib/fetch.js';
import { useLumiStore } from '@/stores/lumi.store.js';

// Inside LumiPanel():
const surface = useLumiStore((s) => s.surface);
const contextSignal = useLumiStore((s) => s.contextSignal);
const [draft, setDraft] = useState('');
const [isSending, setIsSending] = useState(false);
const [sendError, setSendError] = useState<string | null>(null);

async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  const message = draft.trim();
  if (!message || isSending) return;

  setIsSending(true);
  setSendError(null);

  try {
    const raw = await hkFetch<unknown>('/v1/lumi/turns', {
      method: 'POST',
      body: { message, context_signal: contextSignal ?? { surface } },
    });
    const data = LumiTurnResponseSchema.parse(raw);

    // Update threadIds[surface] if this was the first turn (thread lazily created)
    useLumiStore.setState((s) => ({
      threadIds: { ...s.threadIds, [surface]: data.thread_id },
    }));

    useLumiStore.getState().appendTurn(data.user_turn);
    useLumiStore.getState().appendTurn(data.lumi_turn);
    setDraft('');
  } catch {
    setSendError("Lumi couldn't send that. Try again.");
    // draft is NOT cleared — user can retry or edit
  } finally {
    setIsSending(false);
  }
}
```

**JSX for the composer area** (replaces the disabled textarea block):
```tsx
<form onSubmit={handleSubmit} className="border-t border-stone-200 px-4 py-3">
  <textarea
    aria-label="Ask Lumi"
    placeholder="Ask Lumi…"
    rows={2}
    value={draft}
    onChange={(e) => setDraft(e.target.value)}
    disabled={isSending}
    onKeyDown={(e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit(e as unknown as React.FormEvent);
      }
    }}
    className="w-full resize-none rounded-md border border-stone-200 bg-white px-2 py-1 font-sans text-sm text-stone-700 placeholder:text-stone-400 disabled:bg-stone-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-700"
  />
  {sendError !== null && (
    <p role="alert" className="mt-1 font-sans text-xs text-red-700">
      {sendError}
    </p>
  )}
</form>
```

### Key invariants from 12.1–12.7 (do not break)

1. **`setContext()` clears `turns: []`** — this means if you call `appendTurn` immediately after navigating, the surface mismatch guard in `hydrateThread` (store line ~92) discards stale hydration results. `appendTurn` does NOT have this guard. Ensure `appendTurn` is only called when `surface` hasn't changed (it won't in a synchronous handler).

2. **`hydrateThread(surface, threadId, turns)` is TOCTOU-safe** — it checks `state.surface === surface` before writing. Do NOT use `hydrateThread` for the post-submit turn append because it replaces ALL turns. Use `appendTurn` instead.

3. **`threadIds[surface]` must be set before panel close** so the next panel open pre-hydrates. The `useLumiContext` hook (12.7) reads `threadIds[surface]` on route mount. Updating it via `setState` in the submit handler is correct.

4. **The `body.content` vs `body.text` trap** — turns use `body.content` (not `body.text`). The `TurnRow` filter in `LumiPanel.tsx` already checks `t.body.type === 'message'`. Do not change the shape.

5. **No barrel imports from `apps/api/src`** — each module imports its own files. `lumi.agent.ts` lives in `agents/` and is imported via relative path with `.js` extension: `../../agents/lumi.agent.js`.

6. **`hkFetch` serializes `body` as JSON and attaches the Bearer token automatically** — look at `apps/web/src/lib/fetch.ts`. Do not add `Content-Type` manually; `hkFetch` sets it when `body` is provided.

### Thread modality note

The `createAmbientThread` call in `submitTextTurn` passes `'text'` as the modality. The `threads` table still has `modality NOT NULL` (a future migration may relax this). The value stored is informational — the `threads_one_active_per_household_type` partial unique index (Story 12.4) is modality-agnostic, so voice and text turns can share the same thread row (ADR-002 Decision 3).

### LumiService dependency injection

`submitTextTurn` instantiates `LumiAgent` directly (`new LumiAgent()`). In Story 12-S9, the real `LumiAgent` will require an OpenAI client and household snapshot fetcher. At that point, the agent will be injected into `LumiServiceDeps` and stored on `this.agent`. For S8, the direct instantiation is deliberate — it keeps S8 simple and minimal, and S9 owns the refactor.

### Route test pattern (existing file)

`apps/api/src/modules/lumi/lumi.routes.test.ts` already exists and tests the GET + voice session endpoints. Follow the exact same app-build pattern when adding tests for `POST /turns`:
- Build the Fastify app with the lumi plugin registered at `/v1/lumi`
- Inject a mock `LumiRepository` and `LumiService`
- Use `fastify.inject()` for request simulation

### API error handling

`assertAmbientSurface()` is already defined in `lumi.service.ts` and throws `ValidationError` for `surface === 'onboarding'`. Fastify's error handler maps `ValidationError` → 400 with `{ code: 'VALIDATION_FAILED' }`. This matches the guard pattern already in place for voice sessions — no new error types needed.

### Project Structure Notes

**New files:**
- `apps/api/src/agents/lumi.agent.ts`
- `apps/api/src/agents/lumi.agent.test.ts`

**Modified files:**
- `packages/contracts/src/lumi.ts` — add `LumiTurnResponseSchema` + `LumiTurnResponse`
- `packages/contracts/src/index.ts` — export the new schema/type
- `apps/api/src/modules/lumi/lumi.repository.ts` — add `insertTurn()`
- `apps/api/src/modules/lumi/lumi.service.ts` — add `submitTextTurn()`; import `LumiAgent`
- `apps/api/src/modules/lumi/lumi.routes.ts` — add `POST /turns` handler
- `apps/api/src/modules/lumi/lumi.routes.test.ts` — add tests for new endpoint
- `apps/web/src/components/LumiPanel.tsx` — wire composer, enable textarea, remove TODO comment
- `apps/web/src/components/LumiPanel.test.tsx` — add composer submit tests

**No changes to:**
- `apps/web/src/stores/lumi.store.ts` — `appendTurn` and `setState` are already available
- `apps/web/src/hooks/useLumiContext.ts` — thread hydration on route mount is unchanged
- `apps/web/src/components/LumiOrb.tsx` — not touched in this slice
- Any onboarding agent or prompt files — LumiAgent is a new file, no extraction yet (S9 owns that)
- `apps/api/src/modules/lumi/lumi.service.ts` `LumiServiceDeps` interface — no new deps needed for the stub

### References

- [Source: `_bmad-output/planning-artifacts/epic-12-vertical-slices.md` §Slice 12-S8] — demo path, layer breakdown, deferred items
- [Source: `_bmad-output/planning-artifacts/adr-ambient-lumi.md` §Decision 3] — thread model, per-surface thread keying, lazy creation
- [Source: `_bmad-output/planning-artifacts/adr-ambient-lumi.md` §Decision 6] — LumiAgent prompt assembly (context for S9 interface design)
- [Source: `apps/api/src/modules/lumi/lumi.repository.ts`] — `findActiveAmbientThread`, `createAmbientThread`, `mapRowToTurn`, `TURN_COLUMNS`, `TurnRow`
- [Source: `apps/api/src/modules/lumi/lumi.service.ts`] — `assertAmbientSurface`, `LumiServiceDeps`, service constructor, existing method patterns
- [Source: `apps/api/src/modules/lumi/lumi.routes.ts`] — existing route registration, plugin pattern, audit hook usage
- [Source: `apps/web/src/components/LumiPanel.tsx`] — current disabled textarea with TODO comment, `appendTurn` usage, `hydrateThread` pattern
- [Source: `apps/web/src/stores/lumi.store.ts`] — `appendTurn`, `setState` direct pattern, `threadIds` shape
- [Source: `apps/web/src/hooks/useLumiContext.ts`] — how `threadIds[surface]` is read on mount for pre-hydration
- [Source: `apps/web/src/lib/fetch.ts`] — `hkFetch` signature (method, body?, signal?), `HkApiError`
- [Source: `_bmad-output/implementation-artifacts/12-7-route-context-registration.md` §Dev Notes] — Turn shape (`body.content` not `body.text`), `hydrateThread` TOCTOU guard, `isHydrating` setState pattern
- [Source: `packages/contracts/src/lumi.ts`] — `LumiTurnRequestSchema`, `Turn` import from `./thread.js`, existing schema patterns
- [Source: `_bmad-output/project-context.md`] — Zustand 5 curried create, `import type`, `.js` extensions on relative imports in API

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context) — bmad-dev-story workflow.

### Debug Log References

- contracts `lumi.test.ts`: 48/48 pass (4 new `LumiTurnResponseSchema` cases).
- api `lumi.routes.test.ts` + `lumi.agent.test.ts`: 29/29 pass (7 new `POST /turns` + 1 agent).
- web `LumiPanel.test.tsx`: 18/18 pass (5 new composer + 2 updated disabled→enabled).
- Full suites (regression): web 395/395; api 1428 pass / 19 fail (documented baseline,
  none in lumi/agent) / 13 skip; contracts lumi green, the 4 cultural/heart-notes
  failures confirmed pre-existing via `git stash` on a clean tree.
- Typecheck: zero new errors across contracts/api/web (all reported errors are the
  pre-existing baseline in untouched files — `heart-notes.ts`, `evals/runner.ts`,
  `voice/*`, `child-bag-composition.tsx`, etc.).
- Lint: changed api + web files clean (exit 0).

### Completion Notes List

Implemented the ambient text-turn path end-to-end with the stub LumiAgent. All 10 ACs satisfied.

**Spec reconciliations (story code vs. live codebase):**

1. **`insertTurn` must assign `server_seq` (Task 3).** The story's literal `insertTurn`
   omits `server_seq`, but `thread_turns.server_seq` is `bigint NOT NULL` with no DB
   default or trigger (migration `20260504010000`; the column comment states it is
   "assigned by the API"). The literal code would pass the mock test but fail a
   NOT-NULL violation against real Postgres. Reconciled by assigning `server_seq` via
   a private `getNextSeq` (max+1) plus a 3-attempt retry on the `(thread_id, server_seq)`
   unique-violation — mirroring the reviewed `ThreadRepository.appendTurnNext` for the
   same table. `isUniqueViolation` was already imported in `lumi.repository.ts`.

2. **AC9 error shape.** AC9 says `{ code: 'VALIDATION_FAILED' }`, but the API envelope is
   RFC 7807 with a `type` slug (`/errors/validation`) and no `code` field (`common/errors.ts`).
   `assertAmbientSurface` throws the existing `ValidationError` → 400. Tests assert
   `statusCode === 400` + `type === '/errors/validation'`, matching the existing
   voice-session onboarding-guard test in the same file.

3. **Task 1 index export is a no-op.** `packages/contracts/src/index.ts` already does
   `export * from './lumi.js'`, so `LumiTurnResponseSchema`/`LumiTurnResponse` are
   re-exported automatically — no `index.ts` edit needed.

4. **AC8 flipped two existing web tests.** The pre-existing LumiPanel tests asserted the
   textarea was *disabled* ("stub for Story 12.10" + the voice-mode hint test). AC8
   enables the composer, so both were updated to assert `disabled === false` (the
   composer is only disabled while a send is in flight). Voice mode leaves the composer
   usable (the blueprint only sets `disabled={isSending}`).

5. **Stub `LumiAgent` lint.** The story's `respond(_input)` trips
   `@typescript-eslint/no-unused-vars` (the repo config has no `^_` ignore pattern and
   `_input` is the trailing arg). Kept the param in the signature (S9 call-site contract)
   and added a scoped `// eslint-disable-next-line @typescript-eslint/no-unused-vars`
   with rationale — matching the deliberate-stub precedent in `agents/providers/anthropic.adapter.ts`.

**AC7 (reload round-trip)** is covered by composition: `insertTurn` persists valid turns
(with `server_seq`) and the existing `GET /v1/lumi/threads/:threadId/turns` +
`useLumiContext`/`LumiPanel` hydration path read them back. The full unmount→remount
render is a manual/Playwright demo gate (USER-SIDE GATE — live stack + Supabase); unit
coverage exists on both halves (persistence + the unchanged GET path).

### File List

**New:**
- `apps/api/src/agents/lumi.agent.ts`
- `apps/api/src/agents/lumi.agent.test.ts`

**Modified:**
- `packages/contracts/src/lumi.ts` — `LumiTurnResponseSchema` + `LumiTurnResponse`
- `packages/contracts/src/lumi.test.ts` — 4 `LumiTurnResponseSchema` cases
- `apps/api/src/modules/lumi/lumi.repository.ts` — `insertTurn()` + private `getNextSeq()`; import `TurnBody`
- `apps/api/src/modules/lumi/lumi.service.ts` — `submitTextTurn()`; import `LumiAgent`, `Turn`
- `apps/api/src/modules/lumi/lumi.routes.ts` — `POST /turns` handler; contract imports
- `apps/api/src/modules/lumi/lumi.routes.test.ts` — `POST /v1/lumi/turns` suite + `thread_turns` insert/getNextSeq mock
- `apps/web/src/components/LumiPanel.tsx` — functional composer (form, draft/isSending/sendError state, handleSubmit); textarea enabled; TODO removed
- `apps/web/src/components/LumiPanel.test.tsx` — 5 composer tests; 2 disabled→enabled updates
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking

### Review Findings

- [x] [Review][Defer] getNextSeq race condition + retry cap under concurrent writers [lumi.repository.ts — insertTurn/getNextSeq] — deferred, mirrors approved ThreadRepository.appendTurnNext pattern; two independent retry loops on the same table compound collision probability but are a known accepted limitation; no fix needed in stub story
- [x] [Review][Defer] User turn orphaned in DB if agent.respond() throws mid-flight [lumi.service.ts — submitTextTurn] — deferred, stub agent cannot throw; S9 owns real LLM dispatch and must add compensation/rollback at that point
- [x] [Review][Defer] LumiAgent instantiated directly inside submitTextTurn (not injected) [lumi.service.ts — submitTextTurn] — deferred, deliberate for stub per Dev Notes; S9 owns DI refactor into LumiServiceDeps
- [x] [Review][Defer] server_seq bigint type coercion in getNextSeq — runtime cast `data as { server_seq: number }` unsafe if Supabase returns bigint as string [lumi.repository.ts — getNextSeq] — deferred, mirrors pre-existing mapRowToTurn pattern; if real, bug exists in ThreadRepository too
- [x] [Review][Defer] buildMockSupabase select() fallback ignores eq(thread_id) filter — returns turnsDescending for any thread [lumi.routes.test.ts] — deferred, test-only; future tests with multi-thread fixtures would get wrong turns
- [x] [Review][Defer] appendTurn called twice in sequence (separate Zustand setState calls) — momentary mid-render with user turn only [LumiPanel.tsx — handleSubmit] — deferred, cosmetic; React 18 automatic batching mitigates; no correctness impact
- [x] [Review][Defer] AC7 no unmount+remount unit test — no test simulates panel remount rendering the post-submit turn pair [LumiPanel.test.tsx] — deferred, USER-SIDE GATE per Dev Agent Record (live stack + Supabase)

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-03 | Implemented Story 12-S8 (ambient text turn + stub LumiAgent). All 10 ACs satisfied; +17 tests (4 contracts, 8 api, 5 web), 2 web tests updated for AC8. Zero new typecheck/lint; no regressions. Status → review. |
| 2026-06-03 | Code review complete. 0 patches, 0 decisions, 7 deferred, 8 dismissed. Status → done. |
