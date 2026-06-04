# Story 7-S1: Visible Memory Read

Status: done

## Story

As a Primary Parent,
I want to navigate to `/app/memory` and see a list of things Lumi has learned about my family,
so that I can review what Lumi knows and understand that the system is paying attention to us specifically.

## Acceptance Criteria

1. **Given** I am authenticated as Primary Parent or Secondary Caregiver, **When** I navigate to `/app/memory`, **Then** a `GET /v1/households/:householdId/memory` request is made and the page renders each active memory node as a `<VisibleMemorySentence>` row showing `prose_text`.

2. **Given** the household has active memory nodes, **When** the page renders, **Then** each row displays an always-visible `⋯` affordance (non-functional in this story — wired in S2). The `⋯` must be rendered via an `aria-label="More options"` button so S2 can attach a handler without layout changes.

3. **Given** the household has zero active memory nodes, **When** the page renders, **Then** the empty state reads exactly: *"Lumi is still learning about your family. Memory will show up here as patterns appear."* (UX-DR39).

4. **Given** the API call is in-flight, **When** rendering, **Then** a loading skeleton or status indicator is shown; the page never flashes empty state before the fetch completes.

5. **Given** the API returns a 4xx/5xx, **When** rendering, **Then** an honest error line renders ("Lumi couldn't load your memory right now. Try refreshing.") without breaking the page layout.

6. **Given** `GET /v1/households/:householdId/memory` is called with a valid JWT, **When** the household_id in the JWT does not match the param, **Then** the API returns 403.

7. **Given** `GET /v1/households/:householdId/memory` is called, **When** successful, **Then** the response is `{ nodes: MemoryNode[] }` containing only active nodes (`hard_forgotten = false AND soft_forget_at IS NULL`), ordered by `created_at ASC`.

8. **Given** the route mounts, **When** the component calls `useLumiContext`, **Then** the signal `{ surface: 'general' }` is registered in the Lumi store so the ambient orb/panel is context-aware.

## Tasks / Subtasks

- [x] Task 1 — Add `GetMemoryResponseSchema` to contracts (AC: #1, #7)
  - [x] In `packages/contracts/src/memory.ts`, add after `MemoryNodeSchema`:
    ```ts
    export const GetMemoryResponseSchema = z.object({
      nodes: z.array(MemoryNodeSchema),
    });
    export type GetMemoryResponse = z.infer<typeof GetMemoryResponseSchema>;
    ```
  - [x] `MemoryNodeSchema` already exists and is exported — no change to it
  - [x] Export `GetMemoryResponseSchema` + `GetMemoryResponse` from `packages/contracts/src/index.ts` (check if `export * from './memory.js'` already covers it — if yes, no edit needed)
  - [x] Add a unit test to `packages/contracts/src/memory.test.ts` (or create if absent): parse a valid `GetMemoryResponse` payload and reject a missing `nodes` field

- [x] Task 2 — Add `findActiveNodes` to `MemoryRepository` (AC: #7)
  - [x] In `apps/api/src/modules/memory/memory.repository.ts`, add:
    ```ts
    async findActiveNodes(householdId: string): Promise<MemoryNodeRow[]> {
      const { data, error } = await this.client
        .from('memory_nodes')
        .select(NODE_COLUMNS)
        .eq('household_id', householdId)
        .eq('hard_forgotten', false)
        .is('soft_forget_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as MemoryNodeRow[];
    }
    ```
  - [x] Note: `findNodes()` already exists and is used by the **planner recall tool** — do NOT modify it. `findActiveNodes()` is the read path for the UI (different filter: adds `soft_forget_at IS NULL`)

- [x] Task 3 — Add `findActive` to `MemoryService` (AC: #7)
  - [x] In `apps/api/src/modules/memory/memory.service.ts`, add:
    ```ts
    async findActive(householdId: string): Promise<MemoryNodeRow[]> {
      return this.repository.findActiveNodes(householdId);
    }
    ```
  - [x] Import `MemoryNodeRow` from `./memory.repository.js` at the top (check if already imported)

- [x] Task 4 — Wire `GET /v1/households/:householdId/memory` endpoint (AC: #1, #6, #7)
  - [x] In `apps/api/src/modules/households/households.routes.ts`, add after the existing `/brief` route (around line 178):
    ```ts
    fastify.get(
      '/v1/households/:householdId/memory',
      {
        preHandler: requireParentOrCaregiver,
        schema: {
          params: z.object({ householdId: z.string().uuid() }),
          response: { 200: GetMemoryResponseSchema },
        },
      },
      async (request) => {
        const { householdId } = request.params as { householdId: string };
        if (householdId !== request.user.household_id) {
          throw new ForbiddenError('Cannot access another household memory');
        }
        const nodes = await fastify.memoryService.findActive(householdId);
        return { nodes };
      },
    );
    ```
  - [x] Add `GetMemoryResponseSchema` to the import from `@hivekitchen/contracts` at the top of the file
  - [x] `fastify.memoryService` is already decorated via `memoryHook` — no new plugin wiring needed
  - [x] `requireParentOrCaregiver` is already defined earlier in this file (before the `/brief` route)

- [x] Task 5 — Build `<VisibleMemorySentence>` component (AC: #2)
  - [x] Create `apps/web/src/components/VisibleMemorySentence.tsx`:
    ```tsx
    import type { MemoryNode } from '@hivekitchen/types';

    interface Props {
      node: MemoryNode;
    }

    export function VisibleMemorySentence({ node }: Props) {
      return (
        <div className="flex items-start justify-between gap-3 py-3 border-b border-border last:border-0">
          <p className="font-sans text-base text-fg leading-relaxed">
            {node.prose_text}
          </p>
          <button
            type="button"
            aria-label="More options"
            className="shrink-0 mt-0.5 font-sans text-sm text-fg-muted hover:text-fg transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-foliage rounded"
          >
            ···
          </button>
        </div>
      );
    }
    ```
  - [x] The `⋯` button is a stub in S1. S2 will add an `onClick` that opens a provenance popover — the layout contract (button always right-aligned, always present) must not change between stories

- [x] Task 6 — Create `/app/memory` route (AC: #1, #3, #4, #5, #8)
  - [x] Create `apps/web/src/routes/(app)/memory.tsx`:
    - Use `useLumiContext({ surface: 'general' })` on mount (matches pattern in `kitchen-profile.tsx`)
    - Use `useAuthStore` to get `householdId`
    - On mount: `GET /v1/households/:householdId/memory` via `hkFetch`
    - Parse response with `GetMemoryResponseSchema` (validates at boundary per project-context.md rule)
    - Render states: loading → skeleton rows; error → honest error line (AC #5); empty → UX-DR39 prose; ready → list of `<VisibleMemorySentence>`
    - Page heading: `<h1>` with `font-serif text-fg` — "Memory" is sufficient
    - Apply `.app-scope` CSS class (already applied by `(app)/layout.tsx` — no per-route action needed)
  - [x] Add `MemoryNode` type import from `@hivekitchen/types` (it is `z.infer<typeof MemoryNodeSchema>`)

- [x] Task 7 — Tests (AC: all)
  - [x] `apps/api/src/modules/households/households.routes.test.ts` — add tests for `GET /v1/households/:id/memory`:
    - Returns 200 with `{ nodes: [] }` when no active nodes
    - Returns 200 with correct nodes when active nodes exist
    - Excludes `hard_forgotten = true` nodes
    - Excludes `soft_forget_at` IS NOT NULL nodes
    - Returns 403 when householdId param doesn't match JWT claim
    - Returns 401 when JWT absent
  - [x] `apps/api/src/modules/memory/memory.repository.test.ts` (create if absent) — add tests for `findActiveNodes`:
    - Returns only nodes with `hard_forgotten = false AND soft_forget_at IS NULL`
    - Orders by `created_at ASC`
  - [x] `apps/web/src/routes/(app)/memory.test.tsx` (create):
    - Renders `<VisibleMemorySentence>` rows from API response
    - Shows empty state when `nodes: []` returned
    - Shows loading state before fetch resolves
    - Shows error line on network failure
    - Each row has a `⋯` button with `aria-label="More options"`
  - [x] `apps/web/src/components/VisibleMemorySentence.test.tsx` (create):
    - Renders `prose_text` content
    - Renders `⋯` button with correct `aria-label`

## Dev Notes

### Key invariant — two read paths for memory_nodes

`findNodes()` (existing) is the **planner recall** path — used by `memory.recall` agent tool, filters only `hard_forgotten = false`, keeps soft-forgotten nodes visible to the planner so it can reason about explicit parental signals. **Do not modify it.**

`findActiveNodes()` (new) is the **UI display** path — adds `soft_forget_at IS NULL` so soft-forgotten nodes don't render on the Visible Memory page (they appear with the "Lumi won't use this anymore" visual in S4).

### brief_state.memory_prose is NOT the data source for this page

`brief_state.composer.ts` line 223 stubs `memory_prose: ''`. That field feeds `BriefWhyPanel` on the Brief surface. It is NOT what the `/app/memory` page reads — this story reads from `memory_nodes` directly so each row has an individual node ID. That ID is required by S2 (`GET /v1/memory/:nodeId/provenance`), S3 (`PATCH /v1/memory/:nodeId`), and S4 (`PATCH /v1/memory/:nodeId/forget`).

### memoryService is already on the Fastify instance

`fastify.memoryService` is decorated by `memoryHook` (registered before `households.routes.ts`). Check `apps/api/src/agents/orchestrator.hook.ts` line 23 for the registration guard pattern. No new plugin wiring is needed.

### Route pattern — follow kitchen-profile.tsx

`(app)/kitchen-profile.tsx` is the closest prior art: fetch-on-mount with `hkFetch`, `useAuthStore` for householdId, `useLumiContext` for ambient Lumi, manual load-state enum (`'loading' | 'ready' | 'error'`). Mirror that pattern — do not introduce a new data-fetching abstraction for this story.

### Token classes

All tokens are available via the design system's Tailwind preset:
- `text-fg` — primary body text (replaces old `text-stone-800`)
- `text-fg-muted` — muted/secondary text (replaces old `text-stone-500`)
- `border-border` — hairline dividers
- `bg-surface` — card/panel background
- `focus:ring-foliage` — focus indicator (NEVER `focus:ring-amber-*`)

### Empty state grammar (UX-DR39)

Exact copy required: *"Lumi is still learning about your family. Memory will show up here as patterns appear."*
Do not add a CTA, illustration, or call to action. Observational, not imperative.

### ⋯ button layout contract (forward-compat)

S2 will add `onClick` to the `⋯` button that opens a `<ProvenanceChip>` popover. Do not add any placeholder `onClick` or `disabled` prop in S1. The button must be `type="button"` (not a `<span>`) so S2 can add a handler without changing the element type.

### useLumiContext call signature

From `apps/web/src/hooks/useLumiContext.ts`, the hook takes a `LumiContextSignal` object:
```ts
useLumiContext({ surface: 'general' })
```
`'memory'` is not yet in `LumiSurfaceSchema` — use `'general'` for this story. A future story (alongside the 12-S9 surface-prompt work) can add `'memory'` to the enum.

### contracts/index.ts re-export check

`packages/contracts/src/index.ts` likely already has `export * from './memory.js'`. If so, `GetMemoryResponseSchema` and `GetMemoryResponse` are automatically re-exported — no edit needed. Verify before adding a redundant export.

### MemoryNode type

`MemoryNode` is `z.infer<typeof MemoryNodeSchema>` from `@hivekitchen/types`. It is already exported — check `packages/types/src/index.ts` before adding any new type exports.

### Project Structure Notes

**New files:**
- `apps/web/src/routes/(app)/memory.tsx`
- `apps/web/src/routes/(app)/memory.test.tsx`
- `apps/web/src/components/VisibleMemorySentence.tsx`
- `apps/web/src/components/VisibleMemorySentence.test.tsx`

**Modified files:**
- `packages/contracts/src/memory.ts` — add `GetMemoryResponseSchema` + `GetMemoryResponse`
- `apps/api/src/modules/memory/memory.repository.ts` — add `findActiveNodes()`
- `apps/api/src/modules/memory/memory.service.ts` — add `findActive()`
- `apps/api/src/modules/households/households.routes.ts` — add `GET /v1/households/:id/memory`
- `apps/api/src/modules/households/households.routes.test.ts` — add memory endpoint tests

**No changes to:**
- `memory.repository.ts#findNodes` — planner recall path, do not touch
- `brief-state.composer.ts` — memory_prose wiring is a later story
- `packages/contracts/src/index.ts` — only if `export * from './memory.js'` is absent
- `LumiSurfaceSchema` — 'memory' surface is deferred to 12-S9 surface prompt work
- `(app)/layout.tsx` — already applies `.app-scope` and mounts LumiOrb + LumiPanel

### References

- [Source: `_bmad-output/planning-artifacts/epic-7-vertical-slices.md` §Slice 7-S1] — demo path, layers, deferred items
- [Source: `apps/api/src/modules/memory/memory.repository.ts`] — `MemoryNodeRow`, `NODE_COLUMNS`, `findNodes` pattern
- [Source: `apps/api/src/modules/memory/memory.service.ts`] — `MemoryServiceDeps`, constructor, existing method patterns
- [Source: `apps/api/src/modules/households/households.routes.ts:155–178`] — `/brief` route as the model; `requireParentOrCaregiver` already defined
- [Source: `apps/api/src/types/fastify.d.ts:41`] — `fastify.memoryService: MemoryService` confirmed
- [Source: `packages/contracts/src/memory.ts`] — `MemoryNodeSchema` already exported; `GetMemoryResponseSchema` is the only addition needed
- [Source: `apps/web/src/routes/(app)/kitchen-profile.tsx`] — fetch-on-mount pattern, `useLumiContext`, `useAuthStore`, load-state enum
- [Source: `apps/web/src/hooks/useLumiContext.ts`] — `useLumiContext(signal: LumiContextSignal): void` signature
- [Source: `apps/api/src/modules/plans/brief-state.composer.ts:223`] — `memory_prose: ''` stub; confirm this story does NOT touch the composer
- [Source: `_bmad-output/project-context.md`] — semantic token aliases, `.js` extensions on relative imports in API, `import type`, no barrel files in `apps/*/src`
- [Source: `docs/DESIGN.md §6`] — `text-fg`, `text-fg-muted`, `border-border`, `bg-surface`, `focus:ring-foliage` token rules

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Contracts test (`memory.test.ts`): 31/31 pass (4 new `GetMemoryResponseSchema` cases).
- API `memory.repository.test.ts`: 8/8 (4 new `findActiveNodes` cases).
- API `memory.service.test.ts`: my `findActive` delegation test passes; 1 pre-existing failure in
  `seedFromOnboarding > partial seeding` confirmed pre-existing via `git stash` on the clean tree
  (it fails identically without my changes — `nodeCount` is incremented only after provenance
  succeeds, which predates this story).
- API `households.routes.test.ts`: 28/28 (5 new memory-endpoint cases).
- Web `VisibleMemorySentence.test.tsx`: 2/2; Web `memory.test.tsx`: 6/6.
- Full suites: contracts 637 pass / 4 pre-existing fail (cultural + heart-notes baseline);
  API 1438 pass / 19 pre-existing fail / 13 skip (baseline was 1428 pass / 19 fail — +10 are my new
  tests, fail count unchanged); web 403/403 pass (+8 mine).

### Completion Notes List

- **All 8 ACs satisfied.** Stub→real progression not applicable (single read path, no new tables).
- **Contracts (Task 1):** added `GetMemoryResponseSchema` + `GetMemoryResponse` to `memory.ts`.
  Confirmed `packages/contracts/src/index.ts` already re-exports via `export * from './memory.js'`
  — no index edit needed. `MemoryNode` type already exported from `@hivekitchen/types` — no types
  edit needed.
- **Repository (Task 2):** new `findActiveNodes()` is a distinct read path from `findNodes()`
  (planner recall, untouched). It adds `.is('soft_forget_at', null)` and orders `created_at ASC`.
  Tests assert both the emitted filter set (household_id, hard_forgotten=false, soft_forget_at IS
  NULL, order asc) and the filtered/ordered result over a seeded set.
- **Service (Task 3):** `findActive()` is a thin delegation; imported `MemoryNodeRow` alongside the
  existing `MemoryRepository` type import.
- **Route (Task 4):** `GET /v1/households/:householdId/memory` mounted after `/brief`, reuses the
  existing `requireParentOrCaregiver` preHandler and the `fastify.memoryService` decoration
  (`memoryHook`, already registered) — no new plugin wiring. 403 on cross-household param; response
  Zod-validated against `GetMemoryResponseSchema`.
- **Component (Task 5):** `VisibleMemorySentence` renders `prose_text` + an always-present
  `type="button"` `aria-label="More options"` affordance. No `onClick`/`disabled` in S1 — the
  layout contract is fixed for S2 to attach the provenance popover handler.
- **Route page (Task 6):** mirrors `kitchen-profile.tsx` (fetch-on-mount via `hkFetch`,
  `useAuthStore` for `current_household_id`, `useLumiContext({ surface: 'general' })`, load-state
  enum). Did NOT call `useScope('app-scope')` — `(app)/layout.tsx` already applies it (per story
  guidance). Registered `/app/memory` under `AppLayout` in `app.tsx`. Exact UX-DR39 empty copy and
  the honest error line are hoisted to `EMPTY_COPY`/`ERROR_COPY` constants (guarantees verbatim
  copy and sidesteps the JSX unescaped-entities lint rule). Loading shows a `role="status"`
  skeleton so the empty state never flashes pre-fetch (AC4).
- **Typecheck:** zero new errors. Per-package baselines verified via `git stash` on the clean tree —
  contracts 1 (heart-notes.ts), api 11, web 3 — identical with and without my changes; every error
  is in a file I did not author.
- **Lint:** all new/changed files lint-clean. Two self-introduced errors fixed during the pass:
  dropped an unused `_cols` param in `memory.repository.test.ts`, and replaced an inline
  `typeof import('react-router-dom')` annotation in `memory.test.tsx` with `<object>`
  (`consistent-type-imports`). The ~33 pre-existing `no-unused-vars` errors in the untouched mock
  code of `households.routes.test.ts` are part of the known API lint baseline and sit outside my
  added memory block.

### File List

**New:**
- `apps/web/src/routes/(app)/memory.tsx`
- `apps/web/src/routes/(app)/memory.test.tsx`
- `apps/web/src/components/VisibleMemorySentence.tsx`
- `apps/web/src/components/VisibleMemorySentence.test.tsx`

**Modified:**
- `packages/contracts/src/memory.ts` — add `GetMemoryResponseSchema` + `GetMemoryResponse`
- `packages/contracts/src/memory.test.ts` — `GetMemoryResponseSchema` round-trip tests
- `apps/api/src/modules/memory/memory.repository.ts` — add `findActiveNodes()`
- `apps/api/src/modules/memory/memory.repository.test.ts` — `findActiveNodes` tests
- `apps/api/src/modules/memory/memory.service.ts` — add `findActive()` + `MemoryNodeRow` import
- `apps/api/src/modules/memory/memory.service.test.ts` — `findActive` delegation test
- `apps/api/src/modules/households/households.routes.ts` — add `GET /v1/households/:id/memory` + import
- `apps/api/src/modules/households/households.routes.test.ts` — memory-endpoint tests + `memoryService` test-app wiring
- `apps/web/src/app.tsx` — register `/app/memory` route

## Review Findings

- [x] [Review][Defer] `householdId === null` with valid `accessToken` causes permanent loading skeleton [apps/web/src/routes/(app)/memory.tsx:33] — deferred, pre-existing (matches kitchen-profile.tsx pattern; null-household with valid token is a broader auth-store concern)
- [x] [Review][Defer] `didLoad.current = false` on non-401 error could replay fetch on dependency change [apps/web/src/routes/(app)/memory.tsx:51] — deferred, pre-existing (retry on token refresh is intentional; dependency-change-triggered replay is narrow)
- [x] [Review][Defer] `didLoad.current` not reset when household changes without component unmount [apps/web/src/routes/(app)/memory.tsx:33] — deferred, pre-existing (household switch always causes navigation/unmount in current flows)
- [x] [Review][Defer] No pagination cap on `findActiveNodes` — full table scan for large households [apps/api/src/modules/memory/memory.repository.ts] — deferred, architecture gap (memory nodes are low-volume in practice; pagination belongs in a later slice)
- [x] [Review][Defer] `403` response falls through to generic error copy, no redirect or differentiation [apps/web/src/routes/(app)/memory.tsx:47] — deferred, AC5-compliant (4xx → honest error line per spec; 403 is server-side guarded)
- [x] [Review][Defer] Route handler `as { householdId: string }` cast instead of inferred Fastify type [apps/api/src/modules/households/households.routes.ts:190] — deferred, pre-existing (pattern used across all routes in this file)
- [x] [Review][Defer] `useLumiContext({ surface: 'general' })` registered one tick before auth redirect [apps/web/src/routes/(app)/memory.tsx:18] — deferred, pre-existing (matches kitchen-profile.tsx; signal is cosmetic and clears on navigate)
- [x] [Review][Defer] Secondary_caregiver route test only asserts 200 with empty nodes, not with actual nodes [apps/api/src/modules/households/households.routes.test.ts] — deferred, minor coverage gap
- [x] [Review][Defer] AC5 route test throws generic `Error`, not `HkApiError` with 4xx/5xx status [apps/web/src/routes/(app)/memory.test.tsx:142] — deferred, minor test-fidelity gap

## Change Log

| Date       | Change                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| 2026-06-04 | Implemented 7-S1 Visible Memory Read (all 8 ACs, Tasks 1–7). Read endpoint + repo/service read path, contract, `VisibleMemorySentence`, and `/app/memory` route. Status → review. |
