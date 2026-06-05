# Story 7-S4: Soft-Forget a Memory Sentence

Status: done

## Story

As a Primary Parent or Secondary Caregiver,
I want to tap `⋯` → **Forget** on a memory sentence, optionally give a reason, and confirm,
so that Lumi stops using that memory in future plans and I can see it is no longer active.

## Acceptance Criteria

1. **Given** the `⋯` provenance popover is open on a memory row (Edit and Forget pills visible), **When** I tap **Forget**, **Then** the popover closes and the row flips to an inline confirmation UI: an optional reason input (placeholder "Why are you forgetting this? (optional)"), a **Confirm forget** button, and a **Cancel** button. The **Confirm forget** button is enabled even with an empty reason field.

2. **Given** the inline confirmation UI is open, **When** I tap **Cancel** or press **Escape**, **Then** the confirmation UI closes with no API call and the original prose is preserved.

3. **Given** the inline confirmation UI is open, **When** I tap **Confirm forget**, **Then** `PATCH /v1/memory/:nodeId/forget` is called with body `{ reason?: string }` (reason omitted or empty string treated as no reason); on success the row renders the tombstone view within 300ms (optimistic update from the API response).

4. **Given** a successful forget, **When** the node renders, **Then** it shows "Lumi won't use this anymore" (or "Lumi won't use this anymore — [reason]" when reason is non-empty) in `font-sans text-base text-fg-muted italic`, with no `⋯` affordance. The row has no interactive controls.

5. **Given** `PATCH /v1/memory/:nodeId/forget` with a valid JWT and body `{}` or `{ reason: "..." }`, **When** the node belongs to the caller's household AND has not already been soft-forgotten, **Then** `200` is returned with `{ node: MemoryNode }` whose `soft_forget_at` is a valid datetime string and `forget_reason` is the provided reason or `null`.

6. **Given** `PATCH /v1/memory/:nodeId/forget`, **When** the node is not found, belongs to a different household, OR is already soft-forgotten, **Then** `404` is returned (no info leakage).

7. **Given** `PATCH /v1/memory/:nodeId/forget`, **When** the request has no valid JWT → `401`; when `nodeId` is not a UUID → `400`; when `reason` is present and exceeds 500 chars → `400`.

8. **Given** a successful soft-forget, **When** the audit service is available, **Then** a `memory.forgotten` audit event is written with `household_id`, `user_id`, `node_id`, `node_type`, and `reason` (best-effort: a failure does NOT fail the forget).

9. **Given** the planner recalls memory via `MemoryService.recall` → `MemoryRepository.findNodes`, **When** a node has `soft_forget_at` set, **Then** it is excluded from the planner's result set (WHERE `soft_forget_at IS NULL` added to `findNodes`).

10. **Given** the user navigates to `/app/memory` after a node has been soft-forgotten, **When** the page loads, **Then** the soft-forgotten node is included in the list (the `GET /v1/households/:id/memory` endpoint now returns all non-hard-forgotten nodes — both active and soft-forgotten) and renders the tombstone view.

## Tasks / Subtasks

- [x] **Task 1 — Migration: add `forget_reason` column to `memory_nodes`** (AC: #5, #10)
  - [x] Create `supabase/migrations/20260605000000_memory_nodes_forget_reason.sql`:
    ```sql
    ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS forget_reason text;
    ```
  - [x] No data backfill needed (all existing rows get `NULL`, which is correct for active nodes).

- [x] **Task 2 — Update contracts and types** (AC: #5, #7)
  - [x] In `packages/contracts/src/memory.ts`:
    - Add `forget_reason: z.string().nullable()` to `MemoryNodeSchema` (after `soft_forget_at`):
      ```ts
      soft_forget_at: z.string().datetime({ offset: true }).nullable(),
      forget_reason: z.string().nullable(),
      hard_forgotten: z.boolean(),
      ```
    - Add after `EditMemoryResponseSchema`:
      ```ts
      // Story 7-S4 — soft-forget a memory sentence. Body carries an optional
      // reason; nodeId comes from the URL parameter. Mode is always 'soft' here —
      // hard promotion is handled by the nightly job (7-S5).
      export const ForgetMemoryRequestSchema = z.object({
        reason: z.string().max(500).optional(),
      });
      export type ForgetMemoryRequest = z.infer<typeof ForgetMemoryRequestSchema>;

      export const ForgetMemoryResponseSchema = z.object({
        node: MemoryNodeSchema,
      });
      export type ForgetMemoryResponse = z.infer<typeof ForgetMemoryResponseSchema>;
      ```
    - **⚠️ DO NOT use the existing `ForgetRequest` schema (lines 3-7) as the HTTP request body** — that schema has `node_id` and `mode` fields designed for a different purpose (event/SSE message shape). Use `ForgetMemoryRequestSchema` for the route body.
    - The existing `ForgetCompletedEvent` schema (lines 9-14) is already correct for future SSE use — do not modify it.
  - [x] In `packages/types/src/index.ts`, add after `// Memory (Story 7-S3 — edit a sentence)`:
    ```ts
    // Memory (Story 7-S4 — soft-forget a sentence)
    export type ForgetMemoryRequest = z.infer<typeof ForgetMemoryRequestSchema>;
    ```
    Also add `ForgetMemoryRequestSchema` to the import list from `@hivekitchen/contracts`.
  - [x] Add tests to `packages/contracts/src/memory.test.ts`:
    - `ForgetMemoryRequestSchema` accepts `{}` (no reason), `{ reason: 'test' }`, rejects `reason` > 500 chars.
    - `ForgetMemoryResponseSchema` parses `{ node: <valid MemoryNode> }`.
    - `MemoryNodeSchema` accepts a node with `forget_reason: 'some reason'` and `forget_reason: null`.

- [x] **Task 3 — Update `MemoryRepository`** (AC: #5, #9, #10)
  - [x] In `apps/api/src/modules/memory/memory.repository.ts`:
    - Add `forget_reason: string | null` to `MemoryNodeRow` interface.
    - Update `NODE_COLUMNS` constant to include `, forget_reason`.
    - **Remove** `.is('soft_forget_at', null)` from `findActiveNodes` so soft-forgotten nodes are included in the UI read path. Update the method comment:
      ```ts
      // Story 7-S1 — read path for the Visible Memory page. Returns all
      // non-hard-forgotten nodes (active AND soft-forgotten). Soft-forgotten nodes
      // render with a tombstone view on the client (7-S4). Unlike findNodes()
      // (planner recall), this does NOT filter soft_forget_at — the UI needs
      // both states to show the correct affordance.
      ```
    - **Add** `.is('soft_forget_at', null)` to `findNodes` (the planner recall path) so soft-forgotten nodes are excluded from planning. Update the comment from the misleading "soft-forgotten ones still surface" to:
      ```ts
      // Exclude hard-forgotten AND soft-forgotten nodes from planner recall.
      // A parent explicitly asking to forget a node means the planner must not
      // use it. Hard-forgotten nodes are also excluded (they may not even exist
      // in the DB post-7-S5 promotion job).
      ```
      Specifically, change:
      ```ts
      .eq('hard_forgotten', false)
      .order('created_at', { ascending: false })
      ```
      to:
      ```ts
      .eq('hard_forgotten', false)
      .is('soft_forget_at', null)
      .order('created_at', { ascending: false })
      ```
    - Add `softForgetNode` method:
      ```ts
      // Story 7-S4 — household-scoped soft-forget. The IS NULL guard makes this
      // idempotent: if already soft-forgotten the update matches zero rows and
      // returns null (service → route → 404).
      async softForgetNode(
        nodeId: string,
        householdId: string,
        softForgetAt: string,
        reason: string | null,
      ): Promise<MemoryNodeRow | null> {
        const { data, error } = await this.client
          .from('memory_nodes')
          .update({ soft_forget_at: softForgetAt, forget_reason: reason })
          .eq('id', nodeId)
          .eq('household_id', householdId)
          .is('soft_forget_at', null)
          .select(NODE_COLUMNS)
          .maybeSingle();
        if (error) throw error;
        return (data ?? null) as MemoryNodeRow | null;
      }
      ```
  - [x] Update `apps/api/src/modules/memory/memory.repository.test.ts`:
    - Update `makeNode` factory to include `forget_reason: null` (new column).
    - Update `describe('MemoryRepository.findActiveNodes')`:
      - **Remove** the assertion `expect(capture.is).toContainEqual({ col: 'soft_forget_at', val: null })`.
      - Update the test title to: `'queries memory_nodes filtering hard_forgotten=false only (no soft_forget_at filter), ordered created_at ASC'`.
      - Update the data test to show soft-forgotten nodes ARE now included: remove the `softForgotten` node from the "excluded" expectation — it should appear in results. Expected: `['active 1', 'active 2', 'soft']` (order: ASC by created_at).
    - **Add** a `describe('MemoryRepository.findNodes')` block (or verify it exists) that asserts `soft_forget_at IS NULL` IS applied.
    - Add `describe('MemoryRepository.softForgetNode')`:
      - Test: updates `soft_forget_at` + `forget_reason`, filtered by `id` AND `household_id` AND `soft_forget_at IS NULL`, returns the row.
      - Test: returns `null` when the update returns no row (node not found, cross-household, or already soft-forgotten).
      - Test: throws when supabase returns an error.
    - **Note:** The `buildUpdateMockClient` only captures `.eq()` chains. `softForgetNode` also calls `.is()`. You can extend `buildUpdateMockClient` to also capture `.is()` calls, or write a dedicated builder for this method. The existing `buildSelectMockClient` capture pattern (for `findActiveNodes`) is a good model.

- [x] **Task 4 — Add `softForget` to `MemoryService`** (AC: #5, #6, #8, #9)
  - [x] In `apps/api/src/modules/memory/memory.service.ts`, add after `editProse`:
    ```ts
    // Story 7-S4 — soft-forget a memory sentence scoped to the caller's household.
    // Returns null when the node is absent, cross-household, OR already
    // soft-forgotten (all → route 404). Audit is best-effort: a failure does
    // NOT fail the forget (matches seedFromOnboarding + editProse patterns).
    async softForget(
      nodeId: string,
      householdId: string,
      userId: string,
      reason: string | null,
    ): Promise<MemoryNodeRow | null> {
      const existing = await this.repository.findNodeByIdForHousehold(nodeId, householdId);
      if (!existing) return null;
      if (existing.soft_forget_at !== null) return null; // already forgotten → 404

      const softForgetAt = new Date().toISOString();
      const updated = await this.repository.softForgetNode(nodeId, householdId, softForgetAt, reason);
      if (!updated) return null;

      if (this.audit) {
        try {
          await this.audit.write({
            event_type: 'memory.forgotten',
            household_id: householdId,
            user_id: userId,
            request_id: randomUUID(),
            metadata: {
              node_id: nodeId,
              node_type: updated.node_type,
              reason: reason ?? null,
            },
          });
        } catch (err) {
          this.logger.warn(
            { err, module: 'memory', action: 'memory.audit_write_failed', memory_node_id: nodeId },
            'memory.forgotten audit write failed — best-effort, continuing',
          );
        }
      }

      return updated;
    }
    ```
  - [x] `randomUUID` is already imported at the top of the file. `this.audit` + `this.logger` + `this.repository` are already in the constructor — no change needed.
  - [x] `memory.forgotten` audit event type is already defined in `apps/api/src/audit/audit.types.ts` — do NOT add it again.
  - [x] Note: NO provenance write for soft-forget. Provenance records the origin of data; the forget action is captured in the audit log. The `⋯` popover does not show for tombstone rows anyway.
  - [x] Tests in `apps/api/src/modules/memory/memory.service.test.ts`:
    - Returns the updated node when found and not yet forgotten.
    - Returns `null` when `findNodeByIdForHousehold` returns null (no update call).
    - Returns `null` when the node is already soft-forgotten (`existing.soft_forget_at !== null`).
    - `softForgetNode` is called with `(nodeId, householdId, <an ISO string>, reason)`.
    - Writes `memory.forgotten` audit with `node_id`, `node_type`, `reason`.
    - An audit-write throw does NOT reject `softForget` (returns updated node).

- [x] **Task 5 — Add `PATCH /v1/memory/:nodeId/forget` to `memory.routes.ts`** (AC: #5, #6, #7)
  - [x] In `apps/api/src/modules/memory/memory.routes.ts`, add imports:
    ```ts
    import {
      GetProvenanceResponseSchema,
      EditMemoryRequestSchema,
      EditMemoryResponseSchema,
      ForgetMemoryRequestSchema,
      ForgetMemoryResponseSchema,
    } from '@hivekitchen/contracts';
    import type { EditMemoryRequest, ForgetMemoryRequest } from '@hivekitchen/types';
    ```
  - [x] Inside `memoryRoutesPlugin`, add after the PATCH `/v1/memory/:nodeId` route:
    ```ts
    // Story 7-S4 — PATCH /v1/memory/:nodeId/forget
    // Soft-forgets a memory node owned by the caller's household.
    // Returns 404 for missing, cross-household, AND already-soft-forgotten nodes.
    fastify.patch(
      '/v1/memory/:nodeId/forget',
      {
        preHandler: requireParentOrCaregiver,
        schema: {
          params: z.object({ nodeId: z.string().uuid() }),
          body: ForgetMemoryRequestSchema,
          response: { 200: ForgetMemoryResponseSchema },
        },
      },
      async (request) => {
        const { nodeId } = request.params as { nodeId: string };
        const { reason } = request.body as ForgetMemoryRequest;
        const node = await fastify.memoryService.softForget(
          nodeId,
          request.user.household_id,
          request.user.id,
          reason ?? null,
        );
        if (node === null) throw new NotFoundError('Memory node not found');
        return { node };
      },
    );
    ```
  - [x] `requireParentOrCaregiver`, `NotFoundError`, `z`, `fp` are all already imported — do NOT re-declare.
  - [x] No `app.ts` change — `memoryRoutes` is already registered (7-S2).
  - [x] SSE `forget.completed` event: **scope out the server-side SSE emit for this slice.** The server-side SSE dispatcher (`InvalidationEvent`) is not yet wired for memory events (same no-op pattern as 4-S15). The web achieves the ≤300ms visual flip via optimistic node update from the API response. Document as a no-op:
    ```ts
    // SSE forget.completed — server-side emit is deferred; web uses the
    // API response for optimistic update. ForgetCompletedEvent contract
    // is already defined in @hivekitchen/contracts for future fan-out.
    ```
  - [x] Tests in `apps/api/src/modules/memory/memory.routes.test.ts`:
    - Extend `buildTestApp` to accept `softForget?`:
      ```ts
      async function buildTestApp(
        getProvenance: ...,
        editProse?: ...,
        softForget?: (
          nodeId: string,
          householdId: string,
          userId: string,
          reason: string | null,
        ) => Promise<unknown | null>,
      ): Promise<FastifyInstance>
      ```
      And in the decorator:
      ```ts
      app.decorate('memoryService', {
        getProvenance: ...,
        editProse: ...,
        softForget: (softForget ?? (async () => null)) as FastifyInstance['memoryService']['softForget'],
      } as unknown as FastifyInstance['memoryService']);
      ```
    - Add `describe('PATCH /v1/memory/:nodeId/forget')` with these cases:
      - `200` with `{ node }` when `softForget` returns a node; assert args passed: `(nodeId, householdId, userId, null)` for empty body.
      - `200` with reason passed through as `'some reason'` when body `{ reason: 'some reason' }`.
      - `404` when `softForget` returns `null`.
      - `401` without token.
      - `400` when `nodeId` is not a UUID.
      - `400` when `reason` exceeds 500 chars.
    - Add the `forget_reason: null` field to `sampleNode()` factory (matches the new column).

- [x] **Task 6 — Enable Forget pill in `ProvenancePopover`** (AC: #1)
  - [x] In `apps/web/src/components/ProvenancePopover.tsx`, update the component signature to add `onForget?: () => void`:
    ```ts
    export function ProvenancePopover({
      nodeId,
      onEdit,
      onForget,
    }: {
      nodeId: string;
      onEdit?: () => void;
      onForget?: () => void;
    })
    ```
  - [x] Replace the **Forget** pill (currently always-disabled) so it is interactive only when `onForget` is provided (same backward-compatible pattern as `onEdit`):
    ```tsx
    {onForget ? (
      <button
        type="button"
        aria-label="Forget this memory"
        onClick={() => {
          setOpen(false);
          onForget();
        }}
        className="px-3 py-1 rounded-full font-sans text-xs text-fg border border-border hover:bg-surface focus:outline-none focus:ring-2 focus:ring-foliage"
      >
        Forget
      </button>
    ) : (
      <button
        type="button"
        disabled
        aria-label="Forget (available in a future update)"
        className="px-3 py-1 rounded-full font-sans text-xs text-fg-muted border border-border cursor-not-allowed opacity-50"
      >
        Forget
      </button>
    )}
    ```
  - [x] Keep **Adjust** pill exactly as the disabled stub it is today.
  - [x] Tests in `apps/web/src/components/ProvenancePopover.test.tsx`:
    - Add test: when `onForget` is provided, the Forget pill is enabled and clicking it calls `onForget` once and closes the popover.
    - Do NOT change the existing test for the "three action pills" state — **but update it** to reflect that `onForget` is NOT provided, so Forget stays disabled. The test renders `<ProvenancePopover nodeId="..." />` without `onForget`, so Forget stays disabled and the existing assertion holds.
    - **Cross-slice fix needed:** the 7-S2 E2E test `7-s2-provenance-chips.spec.ts` has a test "renders the action pills when ready — Edit enabled, Forget/Adjust disabled" that now needs `Forget` to be `disabled` (correct — `landOnMemory` doesn't pass `onForget`). **Verify this test still passes without changes** since the E2E only exercises the live `/app/memory` route, which now DOES pass `onForget` to `ProvenancePopover`. The E2E test mocks the forget route too — **check the 7-S3 cross-slice pattern**: the 7-S3 impl fixed the E2E pill test to show Edit enabled. Similarly, 7-S4 will make Forget enabled on the live page. Update the E2E 7-S2 test from "Forget disabled" to "Forget enabled" (similar to the Edit-enabled update from 7-S3).

- [x] **Task 7 — Forget confirmation + tombstone render in `VisibleMemorySentence`** (AC: #1, #2, #3, #4, #10)
  - [x] In `apps/web/src/components/VisibleMemorySentence.tsx`:
    - Import `ForgetMemoryResponseSchema` from `@hivekitchen/contracts`.
    - Add new local state: `isConfirmingForget`, `forgetReason`, `isForgetting`, `forgetError`.
    - Pass `onForget={() => { setIsConfirmingForget(true); setForgetReason(''); setForgetError(null); }}` to `<ProvenancePopover>`.
    - **Tombstone render** (when `node.soft_forget_at !== null`): render before the `isEditing` check. No `⋯` button, no interactive controls:
      ```tsx
      if (node.soft_forget_at !== null) {
        return (
          <div className="flex items-start py-3 border-b border-border last:border-0">
            <p className="font-sans text-base text-fg-muted italic">
              {node.forget_reason
                ? `Lumi won't use this anymore — ${node.forget_reason}`
                : "Lumi won't use this anymore"}
            </p>
          </div>
        );
      }
      ```
    - **Confirmation render** (when `isConfirmingForget`): insert between the `soft_forget_at` check and the `isEditing` check:
      ```tsx
      if (isConfirmingForget) {
        return (
          <div
            aria-busy={isForgetting}
            className="flex flex-col gap-2 py-3 border-b border-border last:border-0"
          >
            <p className="font-sans text-sm text-fg-muted">
              Lumi will stop using this. You can undo this for 30 days.
            </p>
            <input
              type="text"
              value={forgetReason}
              onChange={(e) => setForgetReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancelForget(); } }}
              placeholder="Why are you forgetting this? (optional)"
              maxLength={500}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-sans text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-foliage"
            />
            {forgetError && (
              <p role="alert" className="font-sans text-sm text-fg-muted">
                {forgetError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleForget}
                disabled={isForgetting}
                className="px-3 py-1 rounded-full font-sans text-xs text-fg border border-border hover:bg-surface focus:outline-none focus:ring-2 focus:ring-foliage disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirm forget
              </button>
              <button
                type="button"
                onClick={cancelForget}
                className="px-3 py-1 rounded-full font-sans text-xs text-fg-muted border border-border hover:bg-surface focus:outline-none focus:ring-2 focus:ring-foliage"
              >
                Cancel
              </button>
            </div>
          </div>
        );
      }
      ```
    - **`cancelForget`:** `setIsConfirmingForget(false); setForgetError(null);`
    - **`handleForget`:**
      ```ts
      async function handleForget() {
        setIsForgetting(true);
        setForgetError(null);
        try {
          const body: { reason?: string } = {};
          const trimmedReason = forgetReason.trim();
          if (trimmedReason.length > 0) body.reason = trimmedReason;
          const raw = await hkFetch<unknown>(`/v1/memory/${node.id}/forget`, {
            method: 'PATCH',
            body,
          });
          const { node: updated } = ForgetMemoryResponseSchema.parse(raw);
          onNodeUpdated(updated);
          setIsConfirmingForget(false);
        } catch {
          setForgetError("Couldn't forget this memory. Try again.");
          setIsForgetting(false);
        }
      }
      ```
      Note: `isForgetting` does NOT need to be reset on success (component will re-render from `onNodeUpdated` and the tombstone branch exits before `isForgetting` is visible).
    - **Pass `hkFetch` body as a raw object** (`body: {}` or `body: { reason: '...' }`) — DO NOT `JSON.stringify` it. `hkFetch` internally calls `JSON.stringify(init.body)`. This is the same pattern established in 7-S3 (SPEC RECONCILIATION #1 from 7-S3 Dev Notes). Verify at `apps/web/src/lib/fetch.ts` line ~179.
    - v2.0 tokens only: `text-fg`, `text-fg-muted`, `bg-surface`, `border-border`, `focus:ring-foliage`. **No** `bg-white`, `text-stone-*`, `ring-amber-*`, or tokens that don't exist in the design system.
    - `onNodeUpdated` prop is already on `VisibleMemorySentence` (added in 7-S3) — reuse it for the forget optimistic update. No new prop needed.
  - [x] Tests in `apps/web/src/components/VisibleMemorySentence.test.tsx`:
    - Test: when `node.soft_forget_at` is set, renders the tombstone text and no `⋯` button.
    - Test: when `node.soft_forget_at` is set AND `node.forget_reason` is non-empty, includes reason in tombstone text.
    - Test: tapping the (now-enabled) Forget pill triggers `isConfirmingForget` — the confirmation UI with reason input + "Confirm forget" + "Cancel" appears.
    - Test: Cancel/Escape exits confirmation without calling `hkFetch`.
    - Test: Confirm forget calls `hkFetch PATCH /v1/memory/<id>/forget` with `{}` (no reason) when reason input is empty/whitespace.
    - Test: Confirm forget calls `hkFetch` with `{ reason: '...' }` when reason input has text.
    - Test: successful forget calls `onNodeUpdated` with the parsed node and exits confirmation mode.
    - Test: failed forget shows error and stays in confirmation mode (`isForgetting` reset to false).

- [x] **Task 8 — Wire `onNodeUpdated` and `onForget`/`onEdit` from `memory.tsx`** (AC: #10)
  - [x] `memory.tsx` already passes `onNodeUpdated` to each row. No additional prop wiring needed — `VisibleMemorySentence` handles the `onForget` callback internally via `ProvenancePopover`. However, **verify the `GET /v1/households/:id/memory` endpoint now returns soft-forgotten nodes** (since `findActiveNodes` no longer filters them). The `MemoryNodeSchema` already carries `soft_forget_at` and `forget_reason` — no `GetMemoryResponseSchema` change needed.
  - [x] Update `apps/web/src/routes/(app)/memory.test.tsx` (or `memory.tsx` route test): add a test that when a node in the response has `soft_forget_at` set, it renders the tombstone copy rather than prose text.

- [x] **Task 9 — E2E** (AC: #1, #2, #3, #4, #10)
  - [x] Create `apps/web/test/e2e/7-s4-soft-forget.spec.ts` following the pattern of `7-s3-edit-a-sentence.spec.ts`.
    - Set up `FORGET_URL = '**/v1/memory/*'` (PATCH requests) — be careful: the glob `**/v1/memory/*` matches both PATCH `/v1/memory/<id>` (edit) and PATCH `/v1/memory/<id>/forget`. Use `route.request().url()` to distinguish within the handler, OR use `'**/v1/memory/*/forget'` as the URL glob. Prefer the more specific glob `'**/v1/memory/*/forget'` to avoid collisions with the edit route.
    - Mock `MEMORY_URL` to return one active node and one soft-forgotten node (with `soft_forget_at` set and `forget_reason: 'too spicy'`).
    - Test: active node shows prose text + `⋯` button; soft-forgotten node shows tombstone text with reason "— too spicy" and no `⋯` button.
    - Test: open `⋯` → tap Forget → confirmation UI appears → Cancel → row shows original prose.
    - Test: open `⋯` → tap Forget → type a reason → Confirm forget → mock PATCH returns node with `soft_forget_at` set → row shows tombstone text with reason.
    - Test: open `⋯` → tap Forget → Confirm forget (no reason) → mock PATCH returns node with `soft_forget_at` set, `forget_reason: null` → row shows "Lumi won't use this anymore" (no dash).
  - [x] Also run the existing E2E specs to check for regressions:
    - `7-s2-provenance-chips.spec.ts` — update the "renders the action pills" test: Forget pill is now **enabled** on the live memory page (same cross-slice pattern as the Edit-enabled fix in 7-S3). Change the assertion from `toBeDisabled()` to `toBeEnabled()` for the Forget pill. Adjust the `aria-label` to `"Forget this memory"` (matching the new enabled state). Adjust + test: After this change, only Adjust remains disabled.
    - `7-s3-edit-a-sentence.spec.ts` — verify unaffected (no changes to edit flow).

## Dev Notes

### Scope guardrails — do NOT build these

- **No hard-forget in this slice.** Hard deletion, the 30-day promotion job, and tombstone cleanup are 7-S5. This slice only sets `soft_forget_at`.
- **No SSE fan-out.** `ForgetCompletedEvent` is already defined in contracts for future use. Server-side SSE emit is a documented no-op in this slice (same as 4-S15 "NO server SSE dispatcher"). Web does optimistic update from the API response.
- **No "Adjust" pill.** That's a later slice — leave it as the disabled stub.
- **No undo flow.** "You can undo this for 30 days" is informational copy only in the confirmation UI. No undo endpoint exists in this slice.
- **No re-forget from UI.** Tombstone rows have no `⋯` button so double-forget is not reachable from the UI. The API returns 404 for already-forgotten nodes (defense-in-depth).
- **No planner prompt changes.** The planner's memory read path (`MemoryService.recall → MemoryRepository.findNodes`) will now filter out soft-forgotten nodes via the new `soft_forget_at IS NULL` SQL filter. No agent prompt text needs changing.

### Migration note

Migration file: `supabase/migrations/20260605000000_memory_nodes_forget_reason.sql`

```sql
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS forget_reason text;
```

Run via `supabase db push --include-all` (or `supabase migration up`) before testing the forget flow on a real DB. **USER-SIDE GATE** for this slice.

### Critical `findActiveNodes` behavior change

7-S1 deliberately excluded soft-forgotten nodes from the read path with the comment "they reappear with a 'won't use this' affordance in a later slice." **This is that slice.** You must:
1. Remove `.is('soft_forget_at', null)` from `findActiveNodes`.
2. Update the method's comment (see Task 3).
3. Update the existing `findActiveNodes` repository tests that assert the `soft_forget_at IS NULL` filter — those assertions should be removed. The test verifying that soft-forgotten nodes are excluded from results must be updated to show that they ARE now included.

The companion change: add `.is('soft_forget_at', null)` to `findNodes` (planner recall path).

### Critical `ForgetRequest` vs `ForgetMemoryRequestSchema` distinction

The `packages/contracts/src/memory.ts` file already has:
```ts
export const ForgetRequest = z.object({
  node_id: z.string().uuid(),
  mode: z.literal('soft'),
  reason: z.string().optional(),
});
```
This was defined early as a message/event schema (for the `ForgetCompletedEvent` pattern). It is **not** the HTTP request body — it includes `node_id` and `mode` which are redundant for a URL-param route. Use the new `ForgetMemoryRequestSchema = z.object({ reason: z.string().max(500).optional() })` for the route body. Do not modify or remove the existing `ForgetRequest` schema.

### DB facts

- `memory_nodes.soft_forget_at timestamptz` — already exists. The API sets this to `new Date().toISOString()`.
- `memory_nodes.forget_reason text` — **new column** (Task 1 migration). Nullable; stores the parent's optional reason text.
- `memory_nodes.hard_forgotten boolean NOT NULL DEFAULT false` — already exists. Not touched in this slice (7-S5 handles promotion).
- `memory_nodes` RLS: select policy uses `current_household_id()` — the household_id filter in `softForgetNode` is defense-in-depth on top of RLS.
- **No new migration to `memory_provenance`** — forget does not write a provenance record. The audit log is the paper trail.

### API patterns to follow

- 404-for-missing-cross-household-and-already-forgotten mirrors the `editProse` pattern: `findNodeByIdForHousehold` returns null for absent or cross-household, then service additionally returns null for `existing.soft_forget_at !== null`.
- Route handler stays thin: validate via contract schema, call service, translate `null → NotFoundError`. Pattern established in `memory.routes.ts:39-63`.
- Audit via **service** (`this.audit.write`), best-effort try/catch. Matches `editProse` and `seedFromOnboarding`.
- `randomUUID` from `node:crypto` already imported at `memory.service.ts:1`.

### Web patterns to follow

- `hkFetch` + `ForgetMemoryResponseSchema.parse(raw)` — exactly as `ProvenancePopover.fetchProvenance` and `VisibleMemorySentence.handleSave`. **Never** `fetch().json()` raw.
- Pass `hkFetch` body as a **raw object** (`{ reason: '...' }` or `{}`), NOT `JSON.stringify(...)`. `hkFetch` internally stringifies at `lib/fetch.ts:~179`. Pre-stringifying would double-encode. (SPEC RECONCILIATION #1 from 7-S3 is the canonical reference.)
- Optimistic update via `onNodeUpdated(updated)` — already the prop on `VisibleMemorySentence`. No Zustand, no separate store. API response is source of truth.
- Render order in `VisibleMemorySentence`: (1) tombstone branch if `node.soft_forget_at !== null`, (2) confirmation branch if `isConfirmingForget`, (3) edit branch if `isEditing`, (4) normal row. The tombstone check goes FIRST so a forgotten node never shows the `⋯` button or edit mode.
- v2.0 tokens only. `surface-hover` does NOT exist (reconciliation from 7-S3) — use `hover:bg-surface`.

### Testing standards

- API routes via `fastify.inject()` with the existing `buildTestApp` harness extended for `softForget`.
- API service tested with a faked repository. Use `vi.fn()` for `findNodeByIdForHousehold` and `softForgetNode`.
- Contracts: round-trip parse tests with valid/invalid shapes.
- Web: `@testing-library/react` behavior tests. No DOM snapshot tests.
- No `sleep`/`setTimeout` in tests; use `waitFor`/Playwright auto-wait.
- Do NOT mock `@hivekitchen/contracts`.

### Per-package test baselines (do not introduce NEW failures)

- Web typecheck: 3 pre-existing errors in untouched files (`child-bag-composition.tsx` ×2, `packages/contracts/src/heart-notes.ts` ×1). Zero new typecheck errors allowed.
- API typecheck: 11 errors (≤14 baseline), none in memory files. Zero new errors allowed.
- E2E: run via `pnpm --filter @hivekitchen/web exec vite build` → `playwright test` (skips the tsc gate for web, same as 7-S3).

### Spec reconciliations

1. **`ForgetRequest` schema**: The existing `ForgetRequest` in `memory.ts` (lines 3-7) has `node_id + mode + reason?` — NOT the HTTP body shape. Use new `ForgetMemoryRequestSchema` for the route body. Do not remove or modify `ForgetRequest`.
2. **`findActiveNodes` test update required**: The 7-S1 repository test at line 238 asserts `.is('soft_forget_at', null)`. Remove this assertion. The data-filtering test (line 242-261) also needs updating: `softForgotten` node should now appear in results.
3. **`findNodes` filter addition**: The 7-S1 comment at `memory.repository.ts:85` says "soft-forgotten ones still surface" — this is incorrect per 7-S4 spec. Update the comment and add the `.is('soft_forget_at', null)` filter before `.order()`.
4. **Cross-slice E2E fix (7-S2 spec)**: The `7-s2-provenance-chips.spec.ts` test "renders the action pills when ready — Edit enabled, Forget/Adjust disabled (AC8, 7-S3)" needs Forget updated to **enabled** since `VisibleMemorySentence` now provides `onForget`. Update the Forget assertion from `toBeDisabled()` to `toBeEnabled()` with `aria-label="Forget this memory"`.
5. **`makeNode` test factory**: All `makeNode` call-sites in `memory.repository.test.ts` need `forget_reason: null` added to the returned shape after the migration column is added. Update the factory at line 154 to include it.

### File List

**New:**
- `supabase/migrations/20260605000000_memory_nodes_forget_reason.sql`
- `apps/web/test/e2e/7-s4-soft-forget.spec.ts`

**Modified:**
- `packages/contracts/src/memory.ts` — `MemoryNodeSchema` adds `forget_reason`; add `ForgetMemoryRequestSchema` + `ForgetMemoryResponseSchema`
- `packages/contracts/src/memory.test.ts` — new schema round-trip tests; `MemoryNodeSchema` forget_reason test
- `packages/types/src/index.ts` — import + export `ForgetMemoryRequest` type
- `apps/api/src/modules/memory/memory.repository.ts` — `MemoryNodeRow` adds `forget_reason`; `NODE_COLUMNS` updated; `findActiveNodes` removes `soft_forget_at IS NULL` filter; `findNodes` adds `soft_forget_at IS NULL` filter; new `softForgetNode` method
- `apps/api/src/modules/memory/memory.repository.test.ts` — `makeNode` factory updated; `findActiveNodes` tests updated; new `softForgetNode` tests; (optional) `findNodes` test asserting `soft_forget_at IS NULL`
- `apps/api/src/modules/memory/memory.service.ts` — new `softForget` method
- `apps/api/src/modules/memory/memory.service.test.ts` — `softForget` tests
- `apps/api/src/modules/memory/memory.routes.ts` — `PATCH /v1/memory/:nodeId/forget`; updated imports
- `apps/api/src/modules/memory/memory.routes.test.ts` — extended `buildTestApp`; `sampleNode` updated with `forget_reason: null`; forget route tests
- `apps/web/src/components/ProvenancePopover.tsx` — `onForget` prop enables Forget pill
- `apps/web/src/components/ProvenancePopover.test.tsx` — enabled-Forget test
- `apps/web/src/components/VisibleMemorySentence.tsx` — tombstone render; confirmation flow; `handleForget`; `onForget` → `ProvenancePopover`
- `apps/web/src/components/VisibleMemorySentence.test.tsx` — tombstone + forget flow tests
- `apps/web/src/routes/(app)/memory.test.tsx` — test that soft-forgotten node renders tombstone copy
- `apps/web/test/e2e/7-s2-provenance-chips.spec.ts` — cross-slice fix: Forget pill now enabled

### References

- [Source: `_bmad-output/planning-artifacts/epic-7-vertical-slices.md#Slice 7-S4 — Soft-forget`] — demo path, layers, PRD codes FR67 + UX-DR8 Phase 1
- [Source: `packages/contracts/src/memory.ts:3-14`] — existing `ForgetRequest` / `ForgetCompletedEvent` (NOT to use as HTTP body — see SPEC RECONCILIATION #1)
- [Source: `apps/api/src/modules/memory/memory.repository.ts:44,73,98,102,116`] — `NODE_COLUMNS`, `findNodes`, `findActiveNodes`, `findNodeByIdForHousehold` (all need updating)
- [Source: `apps/api/src/modules/memory/memory.service.ts:160,172,176`] — `findActive`, `getProvenance`, `editProse` — patterns to follow for `softForget`
- [Source: `apps/api/src/modules/memory/memory.routes.ts`] — existing GET + PATCH routes; `requireParentOrCaregiver`; `NotFoundError`; schema-validated pattern
- [Source: `apps/api/src/audit/audit.types.ts:32`] — `memory.forgotten` already defined
- [Source: `apps/api/src/modules/memory/memory.routes.test.ts:16-71`] — `buildTestApp` harness to extend with `softForget`
- [Source: `apps/api/src/modules/memory/memory.repository.test.ts:154-299`] — `makeNode`, `findActiveNodes` tests to update; `buildSelectMockClient` builder pattern for the `softForgetNode` `.is()` capture
- [Source: `apps/web/src/components/ProvenancePopover.tsx:31,137`] — `onEdit` prop pattern to mirror for `onForget`; Forget pill location
- [Source: `apps/web/src/components/VisibleMemorySentence.tsx:19-119`] — existing edit confirmation pattern; `onNodeUpdated`; `handleSave` → template for `handleForget`
- [Source: `apps/web/src/lib/fetch.ts:~179`] — `hkFetch` JSON-stringifies `init.body` internally — pass raw object not pre-stringified string
- [Source: `apps/web/test/e2e/7-s2-provenance-chips.spec.ts:103-120`] — the pill test to update (Forget: disabled → enabled)
- [Source: `apps/web/test/e2e/7-s3-edit-a-sentence.spec.ts`] — E2E mock/route pattern to follow
- [Source: `apps/web/test/e2e/_helpers.ts`] — `loginAndNavigate`, `SAMPLE_HOUSEHOLD_ID`
- [Source: `_bmad-output/implementation-artifacts/7-s3-edit-a-sentence.md#SPEC RECONCILIATION #1`] — hkFetch raw body rule (canonical reference)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- API memory module: 63 pass / 1 fail (`MemoryService.seedFromOnboarding` partial-seeding — pre-existing baseline, confirmed via `git stash` on a clean tree; unrelated to this slice).
- Web full unit suite: 436/436 pass (+12 from this slice).
- Contracts memory suite: 46/46 pass.
- E2E (vite build → playwright): 7-s4 4/4, 7-s2 10/10, 7-s3 2/2 — 16/16 green.
- Typecheck: contracts/types baseline = 1 (heart-notes.ts:78); API baseline = 11 (≤14; the lone households.routes.test.ts:443 is pre-existing, none in memory); web baseline = 3 (child-bag-composition ×2, heart-notes ×1). Zero new errors.

### Completion Notes List

All 10 ACs satisfied across 6 layers + E2E.

- **Migration** `20260605000000_memory_nodes_forget_reason.sql` — adds nullable `forget_reason text`. **USER-SIDE GATE:** `supabase db push --include-all` before exercising the forget flow on a real DB. `memory.forgotten` audit type already present in the DB enum (`20260501110000`) and `audit.types.ts` — no audit migration needed.
- **Contracts** — `MemoryNodeSchema` gains `forget_reason: z.string().nullable()`; added `ForgetMemoryRequestSchema` (`{ reason?: string.max(500) }`) + `ForgetMemoryResponseSchema`. The pre-existing `ForgetRequest` (node_id+mode) is NOT the HTTP body — left untouched (SPEC RECONCILIATION #1). `ForgetMemoryRequest` type re-exported via `@hivekitchen/types`.
- **Repository** — `MemoryNodeRow` + `NODE_COLUMNS` gain `forget_reason`. `findActiveNodes` (UI read) NO LONGER filters `soft_forget_at` (soft-forgotten nodes now render as tombstones); `findNodes` (planner recall) NOW adds `.is('soft_forget_at', null)` so the planner never recalls a forgotten node (AC9). New `softForgetNode` is idempotent via the `soft_forget_at IS NULL` update guard.
- **Service** — `softForget` mirrors `editProse`: `findNodeByIdForHousehold` → null-or-cross-household → 404; additional `existing.soft_forget_at !== null` → 404 (already forgotten); `softForgetNode`; best-effort `memory.forgotten` audit (a throw does NOT fail the forget). No provenance write (the audit log is the paper trail).
- **Route** — `PATCH /v1/memory/:nodeId/forget` (schema-validated body + UUID param; 404 via `NotFoundError`). SSE `forget.completed` server emit is a documented no-op (web optimistic-updates from the API response — same pattern as 4-S15).
- **Web** — `ProvenancePopover` Forget pill enabled via optional `onForget` (backward-compatible: the disabled stub stays when omitted, matching the `onEdit` pattern). `VisibleMemorySentence` renders, in order: (1) tombstone if `soft_forget_at !== null` (no `⋯`, no controls), (2) forget confirmation (reason input + Confirm forget [enabled even when empty] + Cancel + Escape), (3) edit, (4) normal row. `handleForget` passes the **raw** `hkFetch` body (empty `{}` when reason blank, `{ reason }` when present) — NOT `JSON.stringify` (SPEC RECONCILIATION: hkFetch stringifies internally). Optimistic update via existing `onNodeUpdated`. v2.0 tokens only.
- **Cross-slice fix** — `7-s2-provenance-chips.spec.ts` pill test updated: Forget now **enabled** on the live page (only Adjust remains disabled). `forget_reason: null` added to the 7-s2 + 7-s3 E2E `sampleNode` factories (the SPA parses the GET response against the updated `MemoryNodeSchema`).
- **Scope held:** no hard-forget / promotion job (7-S5), no SSE fan-out, no Adjust pill, no undo endpoint (the "undo for 30 days" copy is informational only).

### File List

**New:**
- `supabase/migrations/20260605000000_memory_nodes_forget_reason.sql`
- `apps/web/test/e2e/7-s4-soft-forget.spec.ts`

**Modified:**
- `packages/contracts/src/memory.ts`
- `packages/contracts/src/memory.test.ts`
- `packages/types/src/index.ts`
- `apps/api/src/modules/memory/memory.repository.ts`
- `apps/api/src/modules/memory/memory.repository.test.ts`
- `apps/api/src/modules/memory/memory.service.ts`
- `apps/api/src/modules/memory/memory.service.test.ts`
- `apps/api/src/modules/memory/memory.routes.ts`
- `apps/api/src/modules/memory/memory.routes.test.ts`
- `apps/web/src/components/ProvenancePopover.tsx`
- `apps/web/src/components/ProvenancePopover.test.tsx`
- `apps/web/src/components/VisibleMemorySentence.tsx`
- `apps/web/src/components/VisibleMemorySentence.test.tsx`
- `apps/web/src/routes/(app)/memory.test.tsx`
- `apps/web/test/e2e/7-s2-provenance-chips.spec.ts`
- `apps/web/test/e2e/7-s3-edit-a-sentence.spec.ts`

### Review Findings

**Patch findings (apply before marking done):**

- [x] [Review][Patch] P1: `isForgetting` not reset on success — added `setIsForgetting(false)` before `setIsConfirmingForget(false)` in the success path of `handleForget` [`apps/web/src/components/VisibleMemorySentence.tsx` — `handleForget` success path] ✓ applied
- [x] [Review][Patch] P2: Empty string `reason: ""` passthrough — changed `reason ?? null` to `reason?.trim() || null` in the PATCH forget route handler [`apps/api/src/modules/memory/memory.routes.ts` — forget route body destructure] ✓ applied
- [x] [Review][Patch] P3: `GetMemoryResponseSchema` JSDoc comment stale — updated comment to reflect soft-forgotten nodes are included [`packages/contracts/src/memory.ts` — GetMemoryResponseSchema comment] ✓ applied
- [x] [Review][Patch] P4: Escape key scope limited to reason input — added `onKeyDown` Escape handler to the outer `<div>` of the confirmation UI [`apps/web/src/components/VisibleMemorySentence.tsx` — confirmation UI `<div>`] ✓ applied

**Deferred findings (pre-existing or out of scope):**

- [x] [Review][Defer] D1: Concurrent forget returns 404 — spec AC6 explicitly mandates 404 for already-soft-forgotten; the TOCTOU race produces that state; semantically odd but spec-compliant [`apps/api/src/modules/memory/memory.service.ts` — softForget] — deferred, matches spec intent
- [x] [Review][Defer] D2: Unbounded `findActiveNodes` — no `.limit()` call; grows as soft-forgotten nodes accumulate over time; pre-existing gap amplified by this change [`apps/api/src/modules/memory/memory.repository.ts` — findActiveNodes] — deferred, pre-existing; needs pagination work
- [x] [Review][Defer] D3: `editProse` not blocked on soft-forgotten nodes — `PATCH /v1/memory/:nodeId` has no `soft_forget_at !== null` guard; API-level defense-in-depth gap introduced by 7-S3 and exposed by 7-S4 [`apps/api/src/modules/memory/memory.service.ts` — editProse] — deferred, 7-S3 gap; add guard in 7-S5 or follow-up
- [x] [Review][Defer] D4: Stale `draft` state when node prop updates externally while editing — `useState(node.prose_text)` initialized at mount only; SSE fan-out would trigger this; no SSE for memory currently [`apps/web/src/components/VisibleMemorySentence.tsx` — draft state init] — deferred, no SSE today; revisit when memory SSE is wired
- [x] [Review][Defer] D5: Error message `text-fg-muted` visually indistinguishable from help text — `forgetError` uses same token as informational copy; consistent with `saveError` in editProse (7-S3 pattern) [`apps/web/src/components/VisibleMemorySentence.tsx` — forgetError render] — deferred, pre-existing pattern from 7-S3
- [x] [Review][Defer] D6: `soft_forget_at` timestamp from Node.js clock — `new Date().toISOString()` not DB-authoritative; matters when 30-day undo window (7-S5) is computed [`apps/api/src/modules/memory/memory.service.ts` — softForget] — deferred, revisit in 7-S5 when retention window is implemented
- [x] [Review][Defer] D7: `findNodes` data-filtering test only verifies `.is()` call, not row exclusion — no seed-data test asserting soft-forgotten rows are absent from result [`apps/api/src/modules/memory/memory.repository.test.ts` — findNodes describe block] — deferred, test quality gap; behavior correct at DB level
- [x] [Review][Defer] D8: No DB-level length constraint on `forget_reason` — 500-char limit lives only in Zod schema; consistent with `prose_text` and rest of schema [`supabase/migrations/20260605000000_memory_nodes_forget_reason.sql`] — deferred, consistent with existing pattern

## Change Log

| Date       | Change                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------- |
| 2026-06-04 | Story file authored for 7-S4 Soft-Forget. Status → ready-for-dev.                          |
| 2026-06-04 | Implemented 7-S4 across 6 layers + E2E. All 10 ACs satisfied. Status → review.              |
