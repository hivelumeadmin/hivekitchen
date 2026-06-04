# Story 7-S2: Provenance Chips

Status: done

## Story

As a Primary Parent or Secondary Caregiver,
I want to tap `⋯` on a memory sentence and see where Lumi learned it,
so that I understand why a memory exists and can trust the system's knowledge about my family.

## Acceptance Criteria

1. **Given** I tap the `⋯` button on any `<VisibleMemorySentence>` row, **When** the click fires, **Then** a provenance popover opens inline below the button showing the most recent non-superseded provenance record's source label and confidence percentage.

2. **Given** the popover is open, **When** I press Escape, **Then** the popover closes and focus returns to the `⋯` button (non-modal — no focus trap, no backdrop, no scroll lock).

3. **Given** the popover is open, **When** I click outside it or press Escape, **Then** the popover closes. Clicking the `⋯` button again re-opens it (toggle).

4. **Given** `GET /v1/memory/:nodeId/provenance` is called with a valid JWT, **When** the nodeId belongs to the caller's household, **Then** 200 is returned with `{ provenance: MemoryProvenance[] }` ordered `captured_at DESC`.

5. **Given** `GET /v1/memory/:nodeId/provenance` is called, **When** the nodeId is not found OR belongs to a different household, **Then** 404 is returned (no info leakage about cross-household node existence).

6. **Given** `GET /v1/memory/:nodeId/provenance` is called without a valid JWT, **When** the request is unauthorized, **Then** 401 is returned.

7. **Given** the provenance popover fetches data, **When** the fetch is in-flight, **Then** a subtle loading indicator is shown inside the popover. The fetch is triggered on first open only — subsequent opens use the cached result.

8. **Given** the provenance popover is open, **When** the fetch resolves, **Then** three disabled action pills are rendered: **Edit**, **Forget**, **Adjust** — each with a `disabled` attribute and `aria-label="<action> (available in a future update)"`. These are stubs for S3/S4.

9. **Given** the `⋯` button is wired, **When** it is rendered, **Then** it has `aria-expanded={open}` and `aria-controls={regionId}` attributes (matches the `SwapHistoryPopover` accessibility pattern).

## Tasks / Subtasks

- [x] Task 1 — Add `GetProvenanceResponseSchema` to contracts (AC: #4)
  - [ ] In `packages/contracts/src/memory.ts`, add after `GetMemoryResponseSchema`:
    ```ts
    export const GetProvenanceResponseSchema = z.object({
      provenance: z.array(MemoryProvenanceSchema),
    });
    export type GetProvenanceResponse = z.infer<typeof GetProvenanceResponseSchema>;
    ```
  - [ ] `MemoryProvenanceSchema` already exists — no change to it
  - [ ] Confirm `packages/contracts/src/index.ts` already has `export * from './memory.js'` — if yes, no edit needed
  - [ ] Add 3 tests to `packages/contracts/src/memory.test.ts`: parse valid `{ provenance: [] }`, parse with one full provenance record, reject missing `provenance` field

- [x] Task 2 — Add read methods to `MemoryRepository` (AC: #4, #5)
  - [ ] In `apps/api/src/modules/memory/memory.repository.ts`, add:
    ```ts
    async findNodeByIdForHousehold(nodeId: string, householdId: string): Promise<MemoryNodeRow | null> {
      const { data, error } = await this.client
        .from('memory_nodes')
        .select(NODE_COLUMNS)
        .eq('id', nodeId)
        .eq('household_id', householdId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as MemoryNodeRow | null;
    }

    async findProvenanceByNodeId(nodeId: string): Promise<MemoryProvenanceRow[]> {
      const { data, error } = await this.client
        .from('memory_provenance')
        .select(PROVENANCE_COLUMNS)
        .eq('memory_node_id', nodeId)
        .order('captured_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as MemoryProvenanceRow[];
    }
    ```
  - [ ] `PROVENANCE_COLUMNS` and `MemoryProvenanceRow` are already defined — no new constants needed

- [x] Task 3 — Add `getProvenance` to `MemoryService` (AC: #4, #5)
  - [x] In `apps/api/src/modules/memory/memory.service.ts`, add:
    ```ts
    async getProvenance(nodeId: string, householdId: string): Promise<MemoryProvenanceRow[] | null> {
      const node = await this.repository.findNodeByIdForHousehold(nodeId, householdId);
      if (!node) return null; // 404 — caller handles
      return this.repository.findProvenanceByNodeId(nodeId);
    }
    ```

- [x] Task 4 — Wire `GET /v1/memory/:nodeId/provenance` in a new `memory.routes.ts` (AC: #4, #5, #6)
  - [ ] Create `apps/api/src/modules/memory/memory.routes.ts`:
    ```ts
    import fp from 'fastify-plugin';
    import type { FastifyPluginAsync } from 'fastify';
    import { z } from 'zod';
    import { GetProvenanceResponseSchema } from '@hivekitchen/contracts';
    import { authorize } from '../../middleware/authorize.hook.js';
    import { NotFoundError } from '../../common/errors.js';

    const memoryRoutesPlugin: FastifyPluginAsync = async (fastify) => {
      const requireParentOrCaregiver = authorize(['primary_parent', 'secondary_caregiver']);

      fastify.get(
        '/v1/memory/:nodeId/provenance',
        {
          preHandler: requireParentOrCaregiver,
          schema: {
            params: z.object({ nodeId: z.string().uuid() }),
            response: { 200: GetProvenanceResponseSchema },
          },
        },
        async (request) => {
          const { nodeId } = request.params as { nodeId: string };
          const householdId = request.user.household_id;
          const provenance = await fastify.memoryService.getProvenance(nodeId, householdId);
          if (provenance === null) throw new NotFoundError('Memory node not found');
          return { provenance };
        },
      );
    };

    export const memoryRoutes = fp(memoryRoutesPlugin, { name: 'memory-routes' });
    ```
  - [ ] Register `memoryRoutes` in `apps/api/src/app.ts` after `householdsRoutes`
  - [ ] Add `memoryRoutes` import to `app.ts`

- [x] Task 5 — Build `<ProvenancePopover>` component (AC: #1, #2, #3, #7, #8, #9)
  - [ ] Create `apps/web/src/components/ProvenancePopover.tsx`
  - [ ] Component signature: `export function ProvenancePopover({ nodeId }: { nodeId: string })`
  - [ ] Internal state: `open`, `status: 'idle' | 'loading' | 'ready' | 'error'`, `provenance: MemoryProvenance[]`
  - [ ] Fetch on first open only: use a `hasFetched` ref — once fetched (success or error), do not re-fetch
  - [ ] Fetch via `hkFetch<unknown>(`/v1/memory/${nodeId}/provenance`)`, parse with `GetProvenanceResponseSchema`
  - [ ] Loading: show a short "Loading…" text inside the popover region
  - [ ] Error: show a one-line error message inside the region
  - [ ] When ready: show the provenance display (see Dev Notes for label rules)
  - [ ] Three disabled pills: Edit / Forget / Adjust — use `<button type="button" disabled aria-label="Edit (available in a future update)">` etc.
  - [ ] Keyboard handling: Escape closes + returns focus to trigger (`triggerRef.current?.focus()`)
  - [ ] Accessibility: trigger button has `aria-expanded={open}`, `aria-controls={regionId}`; region has `role="region"` (non-modal, matches SwapHistoryPopover)
  - [ ] The render wraps in a `<span className="relative inline-block">` positioned absolutely (same as SwapHistoryPopover)
  - [ ] The `⋯` trigger button preserves: `type="button"`, `aria-label="More options"`, all existing Tailwind classes — adds `aria-expanded` + `aria-controls` + `onClick`

- [x] Task 6 — Update `<VisibleMemorySentence>` to render `<ProvenancePopover>` (AC: #1, #9)
  - [ ] In `apps/web/src/components/VisibleMemorySentence.tsx`, replace the raw `<button>` stub with `<ProvenancePopover nodeId={node.id} />`
  - [ ] Import `ProvenancePopover` from `./ProvenancePopover.js`
  - [ ] The containing `<div>` layout (flex, border-b, gap, py-3) does not change

- [x] Task 7 — Tests (AC: all)
  - [ ] `packages/contracts/src/memory.test.ts` — 3 tests for `GetProvenanceResponseSchema` (per Task 1)
  - [ ] `apps/api/src/modules/memory/memory.repository.test.ts` — tests for `findNodeByIdForHousehold` (found + null when household mismatch) and `findProvenanceByNodeId` (returns rows ordered captured_at DESC, empty array when none)
  - [ ] `apps/api/src/modules/memory/memory.service.test.ts` — tests for `getProvenance`: returns rows when node found; returns null when node not found; passes householdId to repo
  - [ ] `apps/api/src/modules/memory/memory.routes.test.ts` (create) — tests for `GET /v1/memory/:nodeId/provenance`: 200 with provenance array; 404 when node not found; 401 without token; 400 when nodeId is not a UUID
  - [ ] `apps/web/src/components/ProvenancePopover.test.tsx` (create) — tests: button renders with `aria-label="More options"` and `aria-expanded=false` initially; clicking opens the popover; Escape closes popover and restores focus; three disabled action pills render; `aria-expanded` updates on toggle
  - [ ] `apps/web/src/components/VisibleMemorySentence.test.tsx` — update existing tests to reflect that the `⋯` button is now rendered by `ProvenancePopover` (mock `ProvenancePopover` or check `aria-label="More options"` still present)

## Dev Notes

### Popover accessibility pattern — follow SwapHistoryPopover exactly

`apps/web/src/features/plan/SwapHistoryPopover.tsx` is the canonical pattern:
- `useId()` for `regionId` and `labelId`
- `useRef<HTMLButtonElement>` for `triggerRef`
- `role="region"` on the panel (NOT `role="dialog"` — non-modal, no focus trap)
- `aria-expanded`, `aria-controls` on the button
- `onKeyDown` on BOTH the trigger and the region panel — Escape closes from either
- `triggerRef.current?.focus()` on Escape

### Provenance source label mapping

Render the most recent record where `superseded_by IS NULL`. Format:

| `source_type` | Label |
|---|---|
| `onboarding` | `"from your setup conversation"` |
| `turn` | `"from a conversation on [date]"` |
| `tool` | `"Lumi inferred this on [date]"` |
| `user_edit` | `"you edited this on [date]"` |
| `plan_outcome` | `"from a plan outcome on [date]"` |
| `import` | `"imported on [date]"` |

Date format: `new Date(captured_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })` — concise, matches SwapHistoryPopover.

Confidence: `Math.round(confidence * 100)` → `"87% confident"`.

When `provenance` array is empty (node seeded without provenance): render `"Source unknown"` in place of the source label. Do not crash.

### `hasFetched` ref for lazy fetch

Fetch on first open, cache forever in component lifetime:

```tsx
const hasFetched = useRef(false);

function handleOpen() {
  setOpen(true);
  if (!hasFetched.current) {
    hasFetched.current = true;
    void fetchProvenance();
  }
}
```

Re-opens after an error still show the error copy (do not re-fetch). This matches the kitchen-profile pattern.

### Token classes (v2.0 design system)

- `text-fg` — body text
- `text-fg-muted` — secondary/muted text
- `border-border` — hairline dividers
- `bg-surface` — panel background (popover body)
- `focus:ring-foliage` — focus indicator
- NEVER `bg-white`, `text-stone-*`, `ring-amber-*`

### Action pill styling (disabled state)

```tsx
<button
  type="button"
  disabled
  aria-label="Edit (available in a future update)"
  className="px-3 py-1 rounded-full font-sans text-xs text-fg-muted border border-border cursor-not-allowed opacity-50"
>
  Edit
</button>
```

Three pills: Edit, Forget, Adjust. All `disabled`. Layout: `flex gap-2 mt-3`.

### Route registration

Add to `apps/api/src/app.ts` after `householdsRoutes`:
```ts
import { memoryRoutes } from './modules/memory/memory.routes.js';
// ...
await app.register(memoryRoutes);
```

### Cross-household 404 (not 403)

The route returns 404 for both "node doesn't exist" and "node exists but belongs to a different household". This prevents callers from probing whether a node ID exists in another household. The service's `findNodeByIdForHousehold` naturally handles both cases by querying `WHERE id = $nodeId AND household_id = $householdId`.

### memory.routes.test.ts — test app wiring

Follow `households.routes.test.ts` pattern: `buildTestApp` that decorates `memoryService` as a mock. The service mock for `getProvenance` returns either a `MemoryProvenanceRow[]` or `null`.

### VisibleMemorySentence update is small

The only change is replacing:
```tsx
<button type="button" aria-label="More options" className="...">···</button>
```
with:
```tsx
<ProvenancePopover nodeId={node.id} />
```

The outer `<div>` (flex, border-b, gap, py-3) stays exactly the same.

### References

- [Source: `apps/web/src/features/plan/SwapHistoryPopover.tsx`] — canonical popover pattern
- [Source: `apps/api/src/modules/memory/memory.repository.ts`] — `PROVENANCE_COLUMNS`, `MemoryProvenanceRow`
- [Source: `packages/contracts/src/memory.ts`] — `MemoryProvenanceSchema`, `GetMemoryResponseSchema`
- [Source: `apps/api/src/modules/households/households.routes.ts:181–202`] — `/memory` route as the neighbor; `requireParentOrCaregiver`, `ForbiddenError` patterns
- [Source: `apps/api/src/app.ts:224`] — `householdsRoutes` registration location for insertion point
- [Source: `apps/api/src/modules/memory/memory.hook.ts`] — `memoryService` decoration on fastify (already done in S1)
- [Source: `apps/web/src/components/VisibleMemorySentence.tsx`] — component to update in Task 6
- [Source: `apps/web/src/lib/fetch.ts`] — `hkFetch`, `HkApiError`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

(to be filled during implementation)

### Completion Notes List

- **All 9 ACs satisfied.** Tasks 1–7 complete.
- **Contracts (Task 1):** `GetProvenanceResponseSchema` + `GetProvenanceResponse` added to `memory.ts` after `MemoryProvenanceSchema` (ordering fix: initial placement before the schema definition caused a TS forward-reference error). 3 new tests pass (31→34 in memory.test.ts; 4 pre-existing heart-notes/cultural failures unchanged).
- **Repository (Task 2):** `findNodeByIdForHousehold` uses `.eq(id).eq(household_id).maybeSingle()` so cross-household probes and missing nodes both return `null` without separate queries. `findProvenanceByNodeId` returns rows ordered `captured_at DESC`. 6 new repo tests pass.
- **Service (Task 3):** `getProvenance(nodeId, householdId)` — calls `findNodeByIdForHousehold` first; returns `null` (not 403) when absent, letting the route translate to 404. `MemoryProvenanceRow` import added. 2 new service tests pass.
- **Route (Task 4):** New `memory.routes.ts` registered in `app.ts` after `householdsRoutes`. Returns 404 for missing/cross-household nodes (no info leakage). Response Zod-validated against `GetProvenanceResponseSchema`. 5 new route tests pass.
- **ProvenancePopover (Task 5):** Self-contained component following `SwapHistoryPopover` pattern. `hasFetched` ref guards lazy fetch (fires once on first open, cached for lifetime). `aria-expanded`, `aria-controls`, `role="region"`, Escape handler all wired. Three disabled action pills. Source label + confidence % displayed from most recent non-superseded record. Empty provenance → "Source unknown".
- **VisibleMemorySentence (Task 6):** Minimal change — raw `<button>` stub replaced with `<ProvenancePopover nodeId={node.id} />`. Layout unchanged.
- **Typecheck:** Zero new errors. Pre-existing baselines (contracts 1, api 11+baseline, web 3) unchanged.
- **Tests:** web 413/413 (+10); api 19 fail / 1451 pass (+13 = repo ×6 + service ×2 + routes ×5) / 13 skip; contracts 4 fail / 640 pass (+3). All pre-existing failures unchanged.

### File List

**New:**
- `apps/api/src/modules/memory/memory.routes.ts`
- `apps/api/src/modules/memory/memory.routes.test.ts`
- `apps/web/src/components/ProvenancePopover.tsx`
- `apps/web/src/components/ProvenancePopover.test.tsx`

**Modified:**
- `packages/contracts/src/memory.ts` — add `GetProvenanceResponseSchema` + `GetProvenanceResponse`
- `packages/contracts/src/memory.test.ts` — `GetProvenanceResponseSchema` tests
- `apps/api/src/modules/memory/memory.repository.ts` — add `findNodeByIdForHousehold` + `findProvenanceByNodeId`
- `apps/api/src/modules/memory/memory.repository.test.ts` — new method tests
- `apps/api/src/modules/memory/memory.service.ts` — add `getProvenance`
- `apps/api/src/modules/memory/memory.service.test.ts` — `getProvenance` tests
- `apps/api/src/app.ts` — register `memoryRoutes`
- `apps/web/src/components/VisibleMemorySentence.tsx` — render `<ProvenancePopover>` instead of raw button
- `apps/web/src/components/VisibleMemorySentence.test.tsx` — update for ProvenancePopover

## Review Findings

_Code review 2026-06-04 (3-layer adversarial: Blind Hunter, Edge Case Hunter, Acceptance Auditor). Scope: 7-S2 surface only (7-S1 code already reviewed). 1 decision-needed, 3 patch, 0 defer, 10 dismissed as noise._

**Patch** _(all applied 2026-06-04, batch-apply)_

- [x] [Review][Patch] AC3 "click outside closes" now implemented [apps/web/src/components/ProvenancePopover.tsx] — added a `containerRef` on the wrapping `<span>` and a `useEffect` (gated on `open`) that registers a document `pointerdown` listener and closes when the target is outside the trigger+region; cleaned up on unmount. Listener attaches after the opening render so the opening click never self-closes. New test `closes the popover on a pointerdown outside the trigger+region (AC3)`.
- [x] [Review][Patch] `hasFetched` error dead-end fixed [apps/web/src/components/ProvenancePopover.tsx] — moved `hasFetched.current = true` to the fetch success path; `handleOpen` now guards on `!hasFetched.current && status !== 'loading'`. Error state is now retryable on re-open and "Try again" is truthful.
- [x] [Review][Patch] AC1 non-superseded selection now tested [apps/web/src/components/ProvenancePopover.test.tsx] — new test feeds a superseded newest record + older live record and asserts the older live (50%, onboarding) is shown, not the superseded 99%.
- [x] [Review][Patch] AC9 `aria-controls` now asserted [apps/web/src/components/ProvenancePopover.test.tsx] — new test asserts the trigger's `aria-controls` is present and equals the region `id`.

_Verification: `ProvenancePopover.test.tsx` 12/12 pass (9→12); web typecheck unchanged (3 pre-existing baseline errors in untouched files); added lines lint-clean. Note: 2 pre-existing lint errors remain in this file (region `onKeyDown` jsx-a11y + `Couldn't` unescaped-entity) — copied from the canonical SwapHistoryPopover pattern and within the project's known web lint baseline; left untouched (surgical scope)._

## Change Log

| Date       | Change                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| 2026-06-04 | Story file authored for 7-S2 Provenance Chips. Status → in-progress.  |
| 2026-06-04 | Implemented 7-S2 (all 9 ACs, Tasks 1–7): GetProvenanceResponseSchema contract, findNodeByIdForHousehold + findProvenanceByNodeId repo methods, getProvenance service method, GET /v1/memory/:nodeId/provenance route in new memory.routes.ts, ProvenancePopover component, VisibleMemorySentence updated. Status → review. |
| 2026-06-04 | Code review complete (3-layer adversarial: Blind Hunter, Edge Case Hunter, Acceptance Auditor). 1 decision resolved (AC3 click-outside → implemented), 4 patches applied (AC3 click-outside listener + test, `hasFetched` success-only retry fix, AC1 non-superseded selection test, AC9 `aria-controls` assertion), 10 dismissed. Unit `ProvenancePopover.test.tsx` 12/12 + new E2E `7-s2-provenance-chips.spec.ts` 10/10 green; web typecheck unchanged (3 pre-existing baseline errors in untouched files); new lines lint-clean. Status → done. |
