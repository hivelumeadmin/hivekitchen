# Story 7-S3: Edit a Sentence

Status: done

## Story

As a Primary Parent or Secondary Caregiver,
I want to tap `⋯` → **Edit** on a memory sentence, change its text, and save,
so that I can correct what Lumi learned about my family and have the next plan reflect my correction.

## Acceptance Criteria

1. **Given** the `⋯` provenance popover is open on a memory row, **When** I tap **Edit**, **Then** the popover closes and the row flips to an inline edit field pre-filled with the current `prose_text` and focused. (The **Forget** and **Adjust** pills remain disabled — those are S4/later.)

2. **Given** the inline edit field is open, **When** I change the text and tap **Save**, **Then** `PATCH /v1/memory/:nodeId` is called with body `{ prose_text, reason: 'parent_edit' }`; on success the row exits edit mode and renders the updated text inline.

3. **Given** the inline edit field is open, **When** I tap **Cancel** or press **Escape**, **Then** edit mode closes with no API call and the original text is preserved.

4. **Given** the inline edit field is open, **When** the text is empty/whitespace-only OR unchanged from the original, **Then** **Save** is disabled. While a save is in flight the control is `aria-busy`; if the request fails the row stays in edit mode and shows an inline error line.

5. **Given** `PATCH /v1/memory/:nodeId` with a valid JWT and body `{ prose_text, reason: 'parent_edit' }`, **When** the node belongs to the caller's household, **Then** `200` is returned with `{ node: MemoryNode }` whose `prose_text` is the new value and whose `updated_at` is bumped.

6. **Given** `PATCH /v1/memory/:nodeId`, **When** the node is not found OR belongs to a different household, **Then** `404` is returned (no info leakage about cross-household node existence).

7. **Given** `PATCH /v1/memory/:nodeId`, **When** the request has no valid JWT → `401`; when `nodeId` is not a UUID → `400`; when `prose_text` is missing/empty/over 2000 chars, or `reason` is not `'parent_edit'` → `400`.

8. **Given** a successful edit, **When** the prose is persisted, **Then** a new `memory_provenance` record is inserted with `source_type='user_edit'`, `captured_by=<caller user id>`, `confidence=1.0`, `source_ref={ reason: 'parent_edit' }` — so the S2 provenance popover subsequently shows **"you edited this on [date]"**. (Provenance write is best-effort: a failure logs a warning and does not fail the edit, matching the memory module's seed pattern.)

9. **Given** a node's prose is edited, **When** the planner next recalls memory, **Then** the updated text is used — because `MemoryService.recall` reads `memory_nodes.prose_text` **live** (`findNodes`). No embedding re-generation and no `brief_state` update are required (no embedding pipeline exists, and `brief_state.memory_prose` is populated by a separate trigger, Story 5.11).

## Tasks / Subtasks

- [x] **Task 1 — Add edit contract to `packages/contracts/src/memory.ts`** (AC: #2, #5, #7)
  - [x] Add after `GetProvenanceResponseSchema`:
    ```ts
    // Story 7-S3 — edit a memory sentence. `reason` is a literal today; widen
    // the union when additional edit reasons appear.
    export const EditMemoryRequestSchema = z.object({
      prose_text: z.string().min(1).max(2000),
      reason: z.literal('parent_edit'),
    });
    export type EditMemoryRequest = z.infer<typeof EditMemoryRequestSchema>;

    export const EditMemoryResponseSchema = z.object({
      node: MemoryNodeSchema,
    });
    export type EditMemoryResponse = z.infer<typeof EditMemoryResponseSchema>;
    ```
  - [x] `MemoryNodeSchema` already exists — reuse it. `packages/contracts/src/index.ts:7` already has `export * from './memory.js'` — no index edit.
  - [x] Add tests to `packages/contracts/src/memory.test.ts`: `EditMemoryRequestSchema` accepts `{ prose_text: 'x', reason: 'parent_edit' }`; rejects empty `prose_text`; rejects `prose_text` > 2000; rejects `reason: 'other'`; `EditMemoryResponseSchema` parses `{ node: <valid MemoryNode> }`.

- [x] **Task 2 — Add `updateNodeProse` to `MemoryRepository`** (AC: #5, #6)
  - [x] In `apps/api/src/modules/memory/memory.repository.ts`, add:
    ```ts
    // Story 7-S3 — household-scoped prose edit. The household_id filter is
    // defense-in-depth on top of the service's pre-check; the updated_at column
    // is bumped by the memory_nodes_updated_at trigger.
    async updateNodeProse(
      nodeId: string,
      householdId: string,
      proseText: string,
    ): Promise<MemoryNodeRow> {
      const { data, error } = await this.client
        .from('memory_nodes')
        .update({ prose_text: proseText })
        .eq('id', nodeId)
        .eq('household_id', householdId)
        .select(NODE_COLUMNS)
        .single();
      if (error) throw error;
      if (!data) throw new Error('updateNodeProse returned no data');
      return data as MemoryNodeRow;
    }
    ```
  - [x] Reuse the existing `findNodeByIdForHousehold` (from 7-S2) for the ownership pre-check — do NOT add a second lookup method.
  - [x] Tests in `apps/api/src/modules/memory/memory.repository.test.ts`: `updateNodeProse` issues `.update({prose_text}).eq('id').eq('household_id')` and returns the row; throws on supabase error.

- [x] **Task 3 — Add `editProse` to `MemoryService`** (AC: #5, #6, #8)
  - [x] In `apps/api/src/modules/memory/memory.service.ts`, add:
    ```ts
    // Story 7-S3 — edit a memory sentence scoped to the caller's household.
    // Returns null when the node is absent or cross-household (route → 404).
    // Provenance + audit are best-effort: the prose update is the committed
    // effect, metadata writes must not fail the edit (matches seedFromOnboarding).
    async editProse(
      nodeId: string,
      householdId: string,
      userId: string,
      proseText: string,
      reason: 'parent_edit',
    ): Promise<MemoryNodeRow | null> {
      const existing = await this.repository.findNodeByIdForHousehold(nodeId, householdId);
      if (!existing) return null;

      const updated = await this.repository.updateNodeProse(nodeId, householdId, proseText);

      try {
        await this.repository.insertProvenance({
          memory_node_id: nodeId,
          source_type: 'user_edit',
          source_ref: { reason },
          captured_by: userId,
          confidence: 1.0,
        });
      } catch (err) {
        this.logger.warn(
          { err, module: 'memory', action: 'memory.edit_provenance_insert_failed', memory_node_id: nodeId },
          'user_edit provenance insert failed — prose updated, provenance skipped',
        );
      }

      if (this.audit) {
        try {
          await this.audit.write({
            event_type: 'memory.updated',
            household_id: householdId,
            user_id: userId,
            request_id: randomUUID(),
            metadata: { node_id: nodeId, node_type: updated.node_type, reason },
          });
        } catch (err) {
          this.logger.warn(
            { err, module: 'memory', action: 'memory.audit_write_failed', memory_node_id: nodeId },
            'memory.updated audit write failed — best-effort, continuing',
          );
        }
      }

      return updated;
    }
    ```
  - [x] `randomUUID` is already imported at the top of the file; `this.audit` is already wired via `memory.hook.ts:11`. The `memory.updated` audit event type already exists (`apps/api/src/audit/audit.types.ts`).
  - [x] Tests in `apps/api/src/modules/memory/memory.service.test.ts`: returns the updated node when found; returns `null` when `findNodeByIdForHousehold` returns null (no update/provenance call); inserts a `user_edit` provenance row with `confidence: 1.0` and `captured_by: userId`; a provenance-insert throw does NOT reject `editProse` (still returns updated node); writes `memory.updated` audit.

- [x] **Task 4 — Add `PATCH /v1/memory/:nodeId` to `memory.routes.ts`** (AC: #5, #6, #7)
  - [x] In `apps/api/src/modules/memory/memory.routes.ts`, inside `memoryRoutesPlugin` (after the existing GET route), add:
    ```ts
    import { EditMemoryRequestSchema, EditMemoryResponseSchema } from '@hivekitchen/contracts';
    import type { EditMemoryRequest } from '@hivekitchen/types';
    // ...
    fastify.patch(
      '/v1/memory/:nodeId',
      {
        preHandler: requireParentOrCaregiver,
        schema: {
          params: z.object({ nodeId: z.string().uuid() }),
          body: EditMemoryRequestSchema,
          response: { 200: EditMemoryResponseSchema },
        },
      },
      async (request) => {
        const { nodeId } = request.params as { nodeId: string };
        const { prose_text, reason } = request.body as EditMemoryRequest;
        const node = await fastify.memoryService.editProse(
          nodeId,
          request.user.household_id,
          request.user.id,
          prose_text,
          reason,
        );
        if (node === null) throw new NotFoundError('Memory node not found');
        return { node };
      },
    );
    ```
  - [x] Reuse the existing `requireParentOrCaregiver = authorize(['primary_parent', 'secondary_caregiver'])` and `NotFoundError` already imported in this file from 7-S2 — do NOT re-declare them.
  - [x] No `app.ts` change — `memoryRoutes` is already registered (7-S2).
  - [x] Tests in `apps/api/src/modules/memory/memory.routes.test.ts` (extend the 7-S2 `buildTestApp`): the decorated mock `memoryService` must now expose `editProse` too. Add a `buildTestApp` overload/param or decorate both methods. Cases: `200` with `{ node }` and `editProse` called with `(nodeId, householdId, userId, prose_text, 'parent_edit')`; `404` when `editProse` returns `null`; `401` without token; `400` when `nodeId` is not a UUID; `400` when body `prose_text` empty or `reason` wrong.

- [x] **Task 5 — Enable the Edit pill in `ProvenancePopover`** (AC: #1)
  - [x] In `apps/web/src/components/ProvenancePopover.tsx`, add an optional prop `onEdit?: () => void` to the component signature: `export function ProvenancePopover({ nodeId, onEdit }: { nodeId: string; onEdit?: () => void })`.
  - [x] Replace the **Edit** pill so it is interactive **only when `onEdit` is provided** (backward-compatible — the S2 unit test renders without `onEdit`, so Edit stays disabled there):
    ```tsx
    {onEdit ? (
      <button
        type="button"
        aria-label="Edit this memory"
        onClick={() => {
          setOpen(false);
          onEdit();
        }}
        className="px-3 py-1 rounded-full font-sans text-xs text-fg border border-border hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-foliage"
      >
        Edit
      </button>
    ) : (
      <button
        type="button"
        disabled
        aria-label="Edit (available in a future update)"
        className="px-3 py-1 rounded-full font-sans text-xs text-fg-muted border border-border cursor-not-allowed opacity-50"
      >
        Edit
      </button>
    )}
    ```
    (Verify `surface-hover` exists in the token set; if not, use `hover:bg-surface`. Keep **Forget** and **Adjust** exactly as the disabled stubs they are today.)
  - [x] Tests in `apps/web/src/components/ProvenancePopover.test.tsx`: ADD a test — when `onEdit` is provided, the Edit pill is enabled (not `disabled`) and clicking it calls `onEdit` once and closes the popover (`region` gone). Do NOT change the existing "renders three disabled action pills" test (it renders without `onEdit`, so it still passes).

- [x] **Task 6 — Inline edit mode in `VisibleMemorySentence` + propagate the update from `memory.tsx`** (AC: #1, #2, #3, #4)
  - [x] In `apps/web/src/components/VisibleMemorySentence.tsx`: add `onNodeUpdated: (node: MemoryNode) => void` to `Props`. Add local state `isEditing`, `draft`, `isSaving`, `saveError`. Pass `onEdit={() => { setDraft(node.prose_text); setIsEditing(true); }}` to `<ProvenancePopover>`.
  - [x] When `isEditing`, render an inline editor in place of the `<p>`: a `<textarea>` bound to `draft` (autofocused), a **Save** button, and a **Cancel** button. Escape on the textarea cancels. Use v2.0 tokens only (`text-fg`, `border-border`, `bg-surface`, `focus:ring-foliage`); NO `bg-white`/`text-stone-*`/`ring-amber-*`.
  - [x] **Save** is disabled when `draft.trim().length === 0`, when `draft.trim() === node.prose_text`, or while `isSaving`. On Save: `setIsSaving(true)`, call
    ```ts
    const raw = await hkFetch<unknown>(`/v1/memory/${node.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ prose_text: draft.trim(), reason: 'parent_edit' }),
    });
    const { node: updated } = EditMemoryResponseSchema.parse(raw);
    onNodeUpdated(updated);
    setIsEditing(false);
    ```
    On error: `setSaveError(...)`, stay in edit mode, `setIsSaving(false)`. Mark the editor region `aria-busy={isSaving}`. (Confirm `hkFetch` sets `Content-Type: application/json` for a body; follow the existing mutation call sites in `apps/web/src/lib/fetch.ts` / a sibling feature that PATCHes.)
  - [x] In `apps/web/src/routes/(app)/memory.tsx`: pass `onNodeUpdated` to each row — `<VisibleMemorySentence key={node.id} node={node} onNodeUpdated={(u) => setNodes((prev) => prev.map((n) => (n.id === u.id ? u : n)))} />`. `nodes` is already `useState<MemoryNode[]>` — this keeps the API as the single source of truth (no Zustand).
  - [x] Tests: `VisibleMemorySentence.test.tsx` — entering edit mode shows a textarea pre-filled with prose; Cancel/Escape exits without calling `hkFetch`; Save disabled when unchanged/empty; a successful Save calls `hkFetch` with `PATCH` + correct body, calls `onNodeUpdated` with the parsed node, and exits edit mode; a failed Save shows an error and stays in edit mode. `memory.tsx` (route test) — after an edit the row shows the updated text (mock the PATCH response).

- [x] **Task 7 — E2E** (AC: #1, #2, #3)
  - [x] Create `apps/web/test/e2e/7-s3-edit-a-sentence.spec.ts` following `7-s2-provenance-chips.spec.ts` (mock `**/v1/households/:id/memory`, `**/v1/memory/*/provenance`, and `**/v1/memory/*` PATCH via `route.fulfill`; use `_helpers.ts` `loginAndNavigate` + `SAMPLE_HOUSEHOLD_ID`). Cover: open `⋯` → tap Edit → row shows textarea → change text → Save → row shows new text; and Cancel preserves original. Match the PATCH glob carefully so it does not collide with the provenance GET (`/v1/memory/<id>/provenance` vs `/v1/memory/<id>`).

## Dev Notes

### Scope guardrails — do NOT build these (they're vaporware or out-of-slice)

- **No embeddings / "re-embed on edit".** `memory_nodes` has **no embedding column** and there is **no embedding pipeline anywhere** in `apps/api`. The slice's "invalidates derived embeddings; re-embed on next read" describes future work. Build none of it.
- **No `brief_state` update.** `BriefStateComposer.refreshTree()` writes `memory_prose: ''` today; the memory→brief trigger lands in Story 5.11. The planner reads prose **live** via `MemoryService.recall` → `MemoryRepository.findNodes` (reads `prose_text` directly), so AC9 is satisfied by simply updating `memory_nodes.prose_text`. Do not wire a reconciliation hook.
- **No Forget/Adjust behavior.** Forget is 7-S4; Adjust is later. Leave both pills disabled.
- **No `superseded_by` bookkeeping.** Inserting the new `user_edit` provenance (newest `captured_at`) is sufficient — the S2 popover selects the most-recent non-superseded record (`provenance.find((p) => p.superseded_by === null)` over a `captured_at DESC` list), so the freshly inserted edit naturally wins. Do not retro-set `superseded_by` on prior rows.

### Why a `user_edit` provenance write (AC8)

S2 already maps `source_type: 'user_edit' → "you edited this on [date]"` in `ProvenancePopover` and the FALCPA/source label table. Without writing this record, an edited sentence would still show its old origin ("from a conversation on…"), breaking the trust contract (FR73 explicitly lists "explicit edit" as a source type). The write is best-effort so a metadata hiccup can't fail the user's edit.

### DB facts (migration `supabase/migrations/20260601000000_create_memory_nodes_and_provenance.sql`)

- `memory_nodes`: `prose_text text NOT NULL`; `updated_at timestamptz NOT NULL DEFAULT now()` with a `BEFORE UPDATE` trigger `memory_nodes_updated_at → set_updated_at()` — so a bare `.update({ prose_text })` bumps `updated_at` automatically (AC5). RLS select policy uses `current_household_id()`.
- `memory_provenance`: `confidence numeric(3,2) NOT NULL CHECK (0..1)` — `1.0` is valid. `source_ref jsonb NOT NULL` — pass `{ reason }`, never null. `captured_by uuid` references `users(id)` — pass the caller's user id.
- **No new migration is needed for this slice.**

### API patterns to follow

- 404-for-both-missing-and-cross-household is the established memory pattern (`findNodeByIdForHousehold` filters `id` AND `household_id`, returns null for either). Mirror `heart-note.service.ts:46` (`patchNote` pre-fetch → `NotFoundError`).
- Route handler stays thin: validate via contract schema, call the service, translate `null → NotFoundError`. The route file `memory.routes.ts` already imports `authorize`, `NotFoundError`, `z`, and `fp` (7-S2).
- Audit via the **service** (`this.audit.write`), consistent with `MemoryService.seedFromOnboarding` — NOT via `request.auditContext` (that's the heart-notes route-hook style; the memory module owns its audit inside the service).

### Web patterns to follow

- `hkFetch` + Zod-parse the response (`EditMemoryResponseSchema.parse(raw)`), exactly like `ProvenancePopover.fetchProvenance`. Never `fetch().json()` raw into the component.
- Edit-in-place lives on the row (`VisibleMemorySentence`); the popover only triggers it via the `onEdit` callback. The API (`memory.tsx`'s `nodes` state) stays the single source of truth — propagate the saved node up via `onNodeUpdated`, don't fork it into a second local copy.
- v2.0 tokens only. Match `ProvenancePopover`'s pill/region styling idiom. If `PrimaryButton`/`SecondaryButton` components are a better fit for Save/Cancel, prefer them — but `SecondaryButton` requires an `icon` prop (per 4-S17 notes), so a token-styled `<button>` is acceptable here.
- React 19 rules: no `useEffect` to compute derived state; the only effect needed is autofocusing the textarea on entering edit mode (sync with the DOM) — or use `autoFocus` on the textarea and skip the effect.

### Contract change discipline

This is a coordinated change — `EditMemoryRequestSchema`/`EditMemoryResponseSchema` land in `packages/contracts`, and BOTH `apps/api` (route) and `apps/web` (row save) consume them in this same story. Never ship one side only.

### Testing standards

- API routes via `fastify.inject()` and the 7-S2 `buildTestApp` harness (mock-decorate `memoryService`). API services unit-tested with a faked repository. Contracts get round-trip parse tests. Web components via `@testing-library/react` (behavior, not markup). No `sleep`/`setTimeout`; use `waitFor`/Playwright auto-wait. Do NOT mock `@hivekitchen/contracts`.
- Per-package baselines to respect (do not introduce NEW failures): web typecheck currently has 3 pre-existing errors in untouched files (`child-bag-composition.tsx` ×2, `packages/contracts/src/heart-notes.ts` ×1) — these block `tsc`-gated `pnpm --filter @hivekitchen/web build`, so run E2E via `pnpm --filter @hivekitchen/web exec vite build` then `playwright test`. API has a documented pre-existing failing-test baseline; assert your additions, don't chase the baseline.

### Project Structure Notes

- All new code lands in existing files/locations — no new modules. New files: only the E2E spec (`apps/web/test/e2e/7-s3-edit-a-sentence.spec.ts`).
- Naming: `PascalCaseSchema` contracts; `camelCase` service/repo methods; component files `PascalCase.tsx`; route files unchanged (`memory.routes.ts`).
- `apps/api` relative imports need `.js` extensions. `import type` for type-only edges (`EditMemoryRequest` from `@hivekitchen/types`).

### References

- [Source: `_bmad-output/planning-artifacts/epic-7-vertical-slices.md#Slice 7-S3 — Edit a sentence`] — slice demo + layers (PATCH `{ prose, reason: 'parent_edit' }`, reconciliation, embeddings note)
- [Source: `_bmad-output/planning-artifacts/prd.md:999,1005`] — FR67 (delete/edit learned data point), FR73 ("explicit edit" as a memory source type)
- [Source: `supabase/migrations/20260601000000_create_memory_nodes_and_provenance.sql`] — `memory_nodes`/`memory_provenance` columns, `updated_at` trigger, RLS
- [Source: `apps/api/src/modules/memory/memory.repository.ts:44,116,62`] — `NODE_COLUMNS`, `findNodeByIdForHousehold`, `insertProvenance` (reuse all three)
- [Source: `apps/api/src/modules/memory/memory.service.ts:130,193`] — best-effort audit pattern (`seedFromOnboarding`) and `insertProvenance` usage (`noteFromAgent`); `randomUUID` already imported
- [Source: `apps/api/src/modules/memory/memory.routes.ts`] — existing GET route, `requireParentOrCaregiver`, `NotFoundError`, schema-validated pattern to extend with PATCH
- [Source: `apps/api/src/modules/memory/memory.hook.ts:11`] — `audit: fastify.auditService` already wired into `MemoryService`
- [Source: `apps/api/src/audit/audit.types.ts`] — `memory.updated` event type already defined
- [Source: `apps/api/src/modules/heart-notes/heart-note.routes.ts:160` & `heart-note.service.ts:46`] — canonical PATCH-one-resource route + 404-not-403 pre-fetch pattern
- [Source: `packages/contracts/src/memory.ts:35,55,26`] — `MemoryNodeSchema`, `MemoryProvenanceSchema`, `SourceTypeSchema` (`user_edit` member); index re-export at `packages/contracts/src/index.ts:7`
- [Source: `apps/web/src/components/ProvenancePopover.tsx`] — Edit pill to enable via `onEdit`; existing pill/region token styling
- [Source: `apps/web/src/components/VisibleMemorySentence.tsx`] — row to add inline edit mode
- [Source: `apps/web/src/routes/(app)/memory.tsx`] — `nodes` state owner; add `onNodeUpdated` wiring
- [Source: `apps/web/src/lib/fetch.ts`] — `hkFetch`, `HkApiError`
- [Source: `apps/api/src/modules/memory/memory.routes.test.ts`] — `buildTestApp` mock-decorate harness to extend for PATCH
- [Source: `apps/web/test/e2e/7-s2-provenance-chips.spec.ts` & `apps/web/test/e2e/_helpers.ts`] — E2E mock + `loginAndNavigate`/`SAMPLE_HOUSEHOLD_ID` pattern

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow)

### Debug Log References

- API memory module: `pnpm --filter @hivekitchen/api exec vitest run src/modules/memory` → repo + routes green; the lone `memory.service.test.ts > seedFromOnboarding > partial seeding` failure is **pre-existing baseline** (confirmed via `git stash` on a clean tree: still 1 failed / 11 passed with my changes removed).
- Full API suite: 19 failed / 1465 passed / 13 skipped — fail count unchanged from the documented baseline; the 9 failing files are all unauthored-by-this-slice (`onboarding.tools`, `audit.types`, `auth.routes`, `catalog-seed`, `children.repository`, `extra-library.repository`, `lunch-link.routes`, `plan-adjustment`, and the 1 memory partial-seeding test). `memory.repository.test.ts` + `memory.routes.test.ts` pass 100%.
- Full web suite: 424/424 green.
- Contracts: `memory.test.ts` 40/40; the 4 repo-wide failures are the pre-existing `heart-notes.test.ts` (3) + `cultural.test.ts` (1) baseline.
- Typecheck: contracts/types add zero errors (only the pre-existing `heart-notes.ts:78` baseline). API 11 errors (≤14 baseline, none in memory files). Web 3 errors (baseline: `child-bag-composition.tsx` ×2, `heart-notes.ts` ×1; none in my files).
- Lint: API memory files clean. Web changed files clean after the autofocus fix; the 2 remaining `ProvenancePopover.tsx` errors (108, 120) are the pre-existing SwapHistoryPopover-copied baseline noted in 7-S2, both above my edit and untouched.
- E2E: `vite build` (skips the tsc gate per Dev Notes) → `playwright test` → 7-s3 spec 2/2 + 7-s2 spec 10/10 green.

### Completion Notes List

- All 9 ACs satisfied across 6 layers. Contracts → API repo/service/route → web popover/row/route → E2E.
- **AC9 needs no code:** `MemoryService.recall → MemoryRepository.findNodes` already reads `memory_nodes.prose_text` live, so a bare `prose_text` update is reflected on the next plan-gen. No embeddings, no `brief_state` reconciliation, no `superseded_by` bookkeeping were built (explicitly scoped out as vaporware/out-of-slice).
- **SPEC RECONCILIATION #1 (hkFetch body):** the story's web Save snippet used `body: JSON.stringify({...})`, but `hkFetch` already calls `JSON.stringify(init.body)` internally (verified in `lib/fetch.ts:179` and the canonical PATCH call site `useSchoolPolicies.ts:74`). Passing a pre-stringified string would double-encode, so I pass the **raw object** `{ prose_text, reason }` — matching the documented "follow the existing call sites" guidance over the snippet.
- **SPEC RECONCILIATION #2 (`surface-hover` token):** the story's Edit-pill snippet used `hover:bg-surface-hover`, but that token does not exist in the design system (only referenced in the story text). Used the story's sanctioned fallback `hover:bg-surface`.
- **SPEC RECONCILIATION #3 (autofocus):** the story offered "`autoFocus` on the textarea OR a focus effect." `autoFocus` trips the repo's `jsx-a11y/no-autofocus` error rule (would be a NEW lint error), so I used the other sanctioned option — a `useRef` + `useEffect(... textareaRef.current?.focus())` on entering edit mode (a valid React-19 DOM-sync effect). Satisfies AC1's "focused" with zero new lint debt.
- **`EditMemoryRequest` type path:** added `export type EditMemoryRequest` to `@hivekitchen/types` (importing `EditMemoryRequestSchema`) so the route's `import type { EditMemoryRequest } from '@hivekitchen/types'` resolves — matching the project's "types via z.infer from contracts, consumed via @hivekitchen/types" convention. The inline contract type export (per Task 1) is retained.
- **CROSS-SLICE FIX (not in the story File List):** 7-S3 enabling the live Edit pill superseded the 7-S2 E2E assertion that Edit is disabled on `/app/memory`. Updated the one `7-s2-provenance-chips.spec.ts` test (`renders three disabled action pills`) to assert **Edit enabled / Forget+Adjust disabled** — the 7-S2 *unit* test (which renders `<ProvenancePopover>` without `onEdit`) is unchanged and still asserts a disabled Edit, exactly as Task 5 required.
- No migration (uses the existing `memory_nodes`/`memory_provenance` tables + `updated_at` trigger). No new dependencies. No `app.ts` change (route plugin already registered in 7-S2).
- **USER-SIDE GATE: none.** Read/write goes through the existing migrated tables; no new migration to apply. AC5's `updated_at` bump is handled by the live `memory_nodes_updated_at` trigger (covered by inspection, not a unit assertion since it's a DB-side effect).

### File List

**New:**
- `apps/web/test/e2e/7-s3-edit-a-sentence.spec.ts`

**Modified:**
- `packages/contracts/src/memory.ts` — `EditMemoryRequestSchema` + `EditMemoryResponseSchema` (+ inline types)
- `packages/contracts/src/memory.test.ts` — edit schema round-trip/rejection tests
- `packages/types/src/index.ts` — `export type EditMemoryRequest`
- `apps/api/src/modules/memory/memory.repository.ts` — `updateNodeProse`
- `apps/api/src/modules/memory/memory.repository.test.ts` — `updateNodeProse` tests
- `apps/api/src/modules/memory/memory.service.ts` — `editProse`
- `apps/api/src/modules/memory/memory.service.test.ts` — `editProse` tests
- `apps/api/src/modules/memory/memory.routes.ts` — `PATCH /v1/memory/:nodeId`
- `apps/api/src/modules/memory/memory.routes.test.ts` — PATCH route tests + harness `editProse` decoration
- `apps/web/src/components/ProvenancePopover.tsx` — optional `onEdit` enables the Edit pill
- `apps/web/src/components/ProvenancePopover.test.tsx` — enabled-Edit test
- `apps/web/src/components/VisibleMemorySentence.tsx` — inline edit mode (ref+focus, Save/Cancel/Escape, PATCH, error)
- `apps/web/src/components/VisibleMemorySentence.test.tsx` — edit-mode tests (rewritten: new required `onNodeUpdated` prop)
- `apps/web/src/routes/(app)/memory.tsx` — `onNodeUpdated` lifts the saved node into `nodes` state
- `apps/web/src/routes/(app)/memory.test.tsx` — edit-reflects-inline route test
- `apps/web/test/e2e/7-s2-provenance-chips.spec.ts` — cross-slice fix: Edit now enabled on the live page

**Expected new:**
- `apps/web/test/e2e/7-s3-edit-a-sentence.spec.ts`

**Expected modified:**
- `packages/contracts/src/memory.ts` — `EditMemoryRequestSchema` + `EditMemoryResponseSchema`
- `packages/contracts/src/memory.test.ts` — edit schema tests
- `apps/api/src/modules/memory/memory.repository.ts` — `updateNodeProse`
- `apps/api/src/modules/memory/memory.repository.test.ts` — `updateNodeProse` tests
- `apps/api/src/modules/memory/memory.service.ts` — `editProse`
- `apps/api/src/modules/memory/memory.service.test.ts` — `editProse` tests
- `apps/api/src/modules/memory/memory.routes.ts` — `PATCH /v1/memory/:nodeId`
- `apps/api/src/modules/memory/memory.routes.test.ts` — PATCH route tests
- `apps/web/src/components/ProvenancePopover.tsx` — `onEdit` prop enables Edit pill
- `apps/web/src/components/ProvenancePopover.test.tsx` — enabled-Edit test
- `apps/web/src/components/VisibleMemorySentence.tsx` — inline edit mode
- `apps/web/src/components/VisibleMemorySentence.test.tsx` — edit-mode tests
- `apps/web/src/routes/(app)/memory.tsx` — `onNodeUpdated` wiring
- `apps/web/src/routes/(app)/memory.test.tsx` — edit-reflects-inline test

### Review Findings

- [x] [Review][Patch] **P1: `isSaving` never reset on success — Save permanently disabled on re-edit** [`apps/web/src/components/VisibleMemorySentence.tsx` — `handleSave`] — added `setIsSaving(false)` before `setIsEditing(false)` on the happy path; regression test added.
- [x] [Review][Patch] **P2: TOCTOU in `updateNodeProse` — race between pre-check and UPDATE surfaces as unhandled 500** [`apps/api/src/modules/memory/memory.repository.ts` — `updateNodeProse`; `apps/api/src/modules/memory/memory.service.ts` — `editProse`] — switched to `.maybeSingle()`, removed `throw new Error(...)` guard, returns `null` on no-data; service adds `if (!updated) return null` guard; TOCTOU tests added to both repo and service.
- [x] [Review][Patch] **P3: No `maxLength={2000}` on textarea** [`apps/web/src/components/VisibleMemorySentence.tsx` — `<textarea>`] — added `maxLength={2000}`.
- [x] [Review][Patch] **P4: `reason` param typed as `string` in route test mock** [`apps/api/src/modules/memory/memory.routes.test.ts` — `buildTestApp`] — narrowed to `reason: 'parent_edit'`.
- [x] [Review][Patch] **P5: No route test for `prose_text` over 2000 chars → 400** [`apps/api/src/modules/memory/memory.routes.test.ts`] — test added; confirmed green.

- [x] [Review][Defer] **D1: `draft` state could be stale if `isEditing` is entered outside the `onEdit` callback** [`apps/web/src/components/VisibleMemorySentence.tsx`] — deferred, latent; all current paths to edit mode go through `onEdit()` which resets `draft` to `node.prose_text`. No execution path today reaches stale draft.
- [x] [Review][Defer] **D2: ZodError from `EditMemoryResponseSchema.parse` is swallowed as a generic save error — no logging** [`apps/web/src/components/VisibleMemorySentence.tsx` — `handleSave`] — deferred, behavior correct (edit fails safely); diagnostic improvement only — add per-category logging in a future hardening pass.
- [x] [Review][Defer] **D3: No rate limiting on `PATCH /v1/memory/:nodeId`** [`apps/api/src/modules/memory/memory.routes.ts`] — deferred, pre-existing gap across all mutation endpoints; not introduced by this slice.
- [x] [Review][Defer] **D4: In-flight PATCH still resolves after Cancel — silent state update** [`apps/web/src/components/VisibleMemorySentence.tsx`] — deferred; if user clicks Cancel while save is in-flight, `onNodeUpdated` fires when the fetch resolves and the parent node is updated even though the user "cancelled." Fix requires AbortController or a `cancelled` ref. Spec doesn't address; out of current slice scope.
- [x] [Review][Defer] **D5: `findNodeByIdForHousehold` fetches hard_forgotten=true nodes without filtering** [`apps/api/src/modules/memory/memory.repository.ts`] — deferred, pre-existing 7-S2 behavior; hard-forgotten nodes are invisible in the UI so users can't reach them via normal flow. Fix belongs in 7-S5 (soft→hard promotion job).
- [x] [Review][Defer] **D6: Edit button unreachable when provenance fetch fails or hangs** [`apps/web/src/components/ProvenancePopover.tsx`] — deferred, provenance fetch error/hang UX established in 7-S2; no fetch timeout today. Address in a future UX hardening slice.
- [x] [Review][Defer] **D7: `saveDisabled` comparison doesn't trim `node.prose_text`** [`apps/web/src/components/VisibleMemorySentence.tsx`] — deferred, data-quality edge case; server-written prose_text is always trimmed (we always PATCH `trimmed`), so surrounding whitespace in stored prose is not a real scenario today. Revisit if another write path skips trimming.
- [x] [Review][Defer] **D8: `aria-busy` on roleless `<div>` has reduced AT support** [`apps/web/src/components/VisibleMemorySentence.tsx`] — deferred, minor a11y; `aria-busy` without an explicit ARIA role may not be announced by all assistive technology. Add `role="status"` or restructure in a future a11y pass.

## Change Log

| Date       | Change                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| 2026-06-04 | Story file authored for 7-S3 Edit a Sentence. Status → ready-for-dev.  |
| 2026-06-04 | Implemented all 9 ACs across 6 layers + E2E. Edit contract, `updateNodeProse` repo, `editProse` service (best-effort user_edit provenance + memory.updated audit), `PATCH /v1/memory/:nodeId`, enabled Edit pill, inline edit-in-place with `onNodeUpdated` lift. 3 spec reconciliations (raw hkFetch body, `surface-hover`→`surface`, autofocus→focus-effect). Cross-slice fix to the 7-S2 Edit-disabled E2E assertion. No migration. Status → review. |
| 2026-06-04 | Code review complete (3-layer adversarial). 0 decision-needed, 5 patch, 8 defer, 4 dismissed. |
