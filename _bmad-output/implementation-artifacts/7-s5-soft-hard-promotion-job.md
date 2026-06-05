# Story 7-S5: Soft→Hard Promotion Job (Feature MVP Wall)

Status: done

## Story

As a HiveKitchen system process,
I want a nightly BullMQ job to hard-delete `memory_nodes` rows that were soft-forgotten more than 30 days ago,
so that the trust contract is honored: data a parent asked Lumi to forget is genuinely and permanently erased after the recovery window closes.

## Acceptance Criteria

1. **Given** the nightly `memory-forget.job.ts` runs, **When** a `memory_nodes` row has `soft_forget_at` set AND `soft_forget_at < NOW() - 30 days`, **Then** it is hard-deleted from `memory_nodes`; `memory_provenance` rows cascade automatically (ON DELETE CASCADE).

2. **Given** the job deletes one or more nodes, **When** each node is deleted, **Then** one `memory.hard_forgotten` audit row is written containing `{ node_id, household_id, node_type }` (best-effort — audit failure does NOT prevent the deletion or halt the job).

3. **Given** the job runs with zero qualifying nodes, **When** `hardDeleteSoftForgotten` returns `[]`, **Then** the job completes normally with an `INFO` log `count: 0`.

4. **Given** `GET /v1/households/:id/memory` is called after a node is hard-deleted, **When** `findActiveNodes` queries, **Then** the deleted node is absent (the row no longer exists in `memory_nodes`).

5. **Given** `MemoryRepository.hardDeleteSoftForgotten(cutoffAt)` is called and Supabase returns an error, **When** the error propagates, **Then** the method throws, the job worker logs `error` and re-throws to trigger BullMQ retry.

6. **Given** the API boots, **When** `memoryForgetJobPlugin` is registered, **Then** BullMQ `upsertJobScheduler` is called with cron `0 3 * * *` UTC.

7. **Given** `MemoryService.editProse` is called on a node with `soft_forget_at` set (D3 close from 7-S4 review), **When** the pre-check runs, **Then** `null` is returned (route → 404); editing a tombstoned node's prose is blocked at the service layer.

## Tasks / Subtasks

### Task 1 — Migration: add `memory.hard_forgotten` audit event type (AC: #2)

- [x] Create `supabase/migrations/20260606000000_add_memory_hard_forgotten_audit_type.sql`:
  ```sql
  -- Story 7-S5: tombstone audit event for the nightly hard-deletion job.
  -- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
  ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'memory.hard_forgotten';
  ```
  Pattern: mirrors `20260601000100_add_memory_seeded_audit_type.sql` exactly.

- [x] In `apps/api/src/audit/audit.types.ts`, append to the `// memory` cluster:
  ```ts
  'memory.forgotten',
  'memory.updated',
  'memory.seeded',
  'memory.hard_forgotten',   // Story 7-S5 — nightly promotion job tombstone
  ```
  No TypeScript type exports needed — audit writes are internal API only.

- **USER-SIDE GATE:** `supabase db push --include-all` before the job writes `memory.hard_forgotten` rows on a real DB.

---

### Task 2 — `MemoryRepository.hardDeleteSoftForgotten` (AC: #1, #4, #5)

- [x] In `apps/api/src/modules/memory/memory.repository.ts`, add after `softForgetNode`:
  ```ts
  // Story 7-S5 — nightly hard-delete of expired soft-forgotten nodes.
  // Deletes all nodes where soft_forget_at IS NOT NULL AND < cutoffAt.
  // memory_provenance cascades automatically (ON DELETE CASCADE).
  // Returns deleted rows for tombstone audit writing.
  async hardDeleteSoftForgotten(
    cutoffAt: string,
  ): Promise<Array<{ id: string; household_id: string; node_type: NodeType }>> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .delete()
      .not('soft_forget_at', 'is', null)
      .lt('soft_forget_at', cutoffAt)
      .select('id, household_id, node_type');
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; household_id: string; node_type: NodeType }>;
  }
  ```
  `NodeType` is already imported from `@hivekitchen/types` at the top of the file.

- **⚠️ `memory_embeddings` does NOT exist.** The architecture docs mention cascading to it; the table has not been created. ON DELETE CASCADE on `memory_provenance` is the only cascade needed today. When the embeddings table is created its migration will add its own cascade from `memory_nodes`.

- [x] Tests in `apps/api/src/modules/memory/memory.repository.test.ts`:

  Build a delete-chain mock (analogous to the existing `buildUpdateMockClient` pattern — capture `.not()` and `.lt()` filter calls):
  ```ts
  function buildDeleteMockClient(result: {
    data: Array<{ id: string; household_id: string; node_type: string }> | null;
    error: unknown;
  }) {
    const filters: { method: string; col: string; val: unknown }[] = [];
    return {
      from: vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          not: vi.fn().mockImplementation((col: string) => {
            filters.push({ method: 'not', col, val: null });
            return {
              lt: vi.fn().mockImplementation((col2: string, val2: unknown) => {
                filters.push({ method: 'lt', col: col2, val: val2 });
                return { select: vi.fn().mockResolvedValue(result) };
              }),
            };
          }),
        }),
      }),
      _filters: filters,
    } as unknown as SupabaseClient;
  }
  ```

  Add `describe('MemoryRepository.hardDeleteSoftForgotten')`:
  - Passes `cutoffAt` to `.lt('soft_forget_at', cutoffAt)` and `.not('soft_forget_at', 'is', null)`.
  - Returns the `data` array (id, household_id, node_type) on success.
  - Returns `[]` when Supabase returns `null` data.
  - Throws when Supabase returns an error object.

---

### Task 3 — Close D3: guard `editProse` on soft-forgotten nodes (AC: #7)

- [x] In `apps/api/src/modules/memory/memory.service.ts`, update `editProse`:
  ```ts
  const existing = await this.repository.findNodeByIdForHousehold(nodeId, householdId);
  if (!existing) return null;
  if (existing.soft_forget_at !== null) return null;   // D3 close — tombstoned node → 404
  ```
  Insert the second guard immediately after the first `if (!existing)` check. No other changes.

- [x] Test in `apps/api/src/modules/memory/memory.service.test.ts`:
  - `editProse` returns `null` when `findNodeByIdForHousehold` resolves a node with `soft_forget_at: '2026-05-01T00:00:00.000Z'` (non-null).
  - Verify `updateNodeProse` is NOT called in that path.

---

### Task 4 — `memory-forget.job.ts` (AC: #1, #2, #3, #5, #6)

- [x] Create `apps/api/src/jobs/memory-forget.job.ts`:

```ts
import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import { MemoryRepository } from '../modules/memory/memory.repository.js';

const MEMORY_FORGET_QUEUE = 'memory-forget';
const MEMORY_FORGET_SCHEDULER_ID = 'nightly-memory-forget';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const memoryForgetPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error('memoryForgetPlugin requires supabase — register supabasePlugin first');
  }
  if (!fastify.bullmq) {
    throw new Error('memoryForgetPlugin requires bullmq — register bullmqPlugin first');
  }

  const repo = new MemoryRepository(fastify.supabase);
  const queue = fastify.bullmq.getQueue(MEMORY_FORGET_QUEUE);

  void queue
    .upsertJobScheduler(
      MEMORY_FORGET_SCHEDULER_ID,
      { pattern: '0 3 * * *', tz: 'UTC' },
      {
        name: 'promote-soft-forgotten',
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 60_000 },
          removeOnComplete: { count: 30 },
          removeOnFail: { count: 14 },
        },
      },
    )
    .catch((err: unknown) => {
      fastify.log.error(
        { err, module: 'memory-forget', action: 'scheduler.registration.failed' },
        'failed to register memory-forget scheduler',
      );
    });

  fastify.bullmq.getWorker(MEMORY_FORGET_QUEUE, async (_job: Job) => {
    const cutoffAt = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

    let deleted: Array<{ id: string; household_id: string; node_type: string }>;
    try {
      deleted = await repo.hardDeleteSoftForgotten(cutoffAt);
    } catch (err) {
      fastify.log.error(
        { err, module: 'memory-forget', action: 'hard_delete.failed', cutoffAt },
        'memory-forget: hard-delete query failed',
      );
      throw err;   // BullMQ retries (attempts: 3)
    }

    fastify.log.info(
      { module: 'memory-forget', action: 'promotion.complete', count: deleted.length, cutoffAt },
      'memory-forget: hard-deleted soft-forgotten nodes',
    );

    for (const node of deleted) {
      try {
        await fastify.auditService.write({
          event_type: 'memory.hard_forgotten',
          household_id: node.household_id,
          request_id: randomUUID(),
          metadata: { node_id: node.id, node_type: node.node_type },
        });
      } catch (err) {
        fastify.log.warn(
          { err, module: 'memory-forget', action: 'tombstone_audit.failed', node_id: node.id },
          'tombstone audit write failed — deletion committed, continuing',
        );
      }
    }
  });
};

export const memoryForgetJobPlugin = fp(memoryForgetPlugin, {
  name: 'memory-forget-job',
});
```

  Key design decisions:
  - **Creates `MemoryRepository` directly** (same as `heart-note-delivery.job.ts` creating `HeartNoteRepository`). Does NOT use `fastify.memoryService` decorator — that service carries audit + logger deps that are already handled inline by the job.
  - **`fastify.auditService`** — decorated onto Fastify before this plugin runs (registered in `app.ts` before job plugins). Access it directly.
  - **`THIRTY_DAYS_MS`** — constant at module level, not inline arithmetic.
  - **Re-throw on delete failure** — triggers BullMQ retry (attempts: 3, exponential backoff). Best-effort for audit writes only.

---

### Task 5 — Register in `app.ts` (AC: #6)

- [x] In `apps/api/src/app.ts`:
  - Add import at the existing job-imports block (around lines 35-41):
    ```ts
    import { memoryForgetJobPlugin } from './jobs/memory-forget.job.js';
    ```
  - Add registration after `heartNoteDeliveryJobPlugin` (around line 138):
    ```ts
    await app.register(memoryForgetJobPlugin);
    ```

---

### Task 6 — Job unit tests (AC: #1, #2, #3, #5)

- [x] Create `apps/api/src/jobs/memory-forget.job.test.ts`.

  The BullMQ plugin infrastructure is hard to test end-to-end; test the **worker callback logic** by extracting it into a standalone function OR by calling the worker callback directly with mocked dependencies. Pattern: look at `apps/api/src/jobs/plan-generation.job.test.ts` for the existing approach this codebase uses for job tests.

  Minimum test cases:
  - Worker computes `cutoffAt` = approximately 30 days before "now" and calls `repo.hardDeleteSoftForgotten(cutoffAt)`.
  - Worker writes one audit entry per deleted node via `auditService.write`.
  - Worker logs INFO with `count: deleted.length`.
  - Worker re-throws when `hardDeleteSoftForgotten` rejects (BullMQ retry path).
  - Worker continues the audit loop when one individual `auditService.write` throws (best-effort; remaining nodes still get audit rows).

---

## Dev Notes

### Scope guardrails — do NOT build these

- **No web changes.** After a node is hard-deleted, `GET /v1/households/:id/memory` simply won't return it on the next load. No tombstone-removal or sync UI needed.
- **No contracts/types changes.** This is a pure API background job.
- **No `memory_embeddings` cascade.** The table does not exist in the current DB schema. Skip it completely.
- **No `hard_forgotten = true` flag.** The job DELETES rows; it does not flip the `hard_forgotten` column. That column remains for future use (e.g., a 7-year retention scan that goes deeper than this 30-day deletion sweep).
- **No SSE fan-out.** Background deletion; UI picks up the change on next page load.
- **No undo endpoint.** The 30-day soft-forget window IS the undo window. Post-promotion, data is gone.
- **No pagination.** Process all eligible rows per run. Acceptable at beta scale.

### DB facts

- `memory_nodes.soft_forget_at timestamptz` — exists. Job filters `IS NOT NULL AND < cutoffAt`.
- `memory_nodes.hard_forgotten boolean NOT NULL DEFAULT false` — exists but NOT SET by this job. DELETE removes the row; the column stays false on all surviving rows.
- `memory_provenance` → `memory_nodes(id) ON DELETE CASCADE` — confirmed in `20260601000000_create_memory_nodes_and_provenance.sql:52`. Provenance rows cascade automatically; no explicit delete needed.
- `memory_embeddings` — **does NOT exist** in current DB schema. Only mentioned in architecture/planning docs. Skip.
- `audit_event_type` is a PostgreSQL ENUM (confirmed: `20260601000100_add_memory_seeded_audit_type.sql` uses `ALTER TYPE audit_event_type ADD VALUE`). Task 1 migration follows the exact same pattern.

### Deferred-work closures

- **D6 (from 7-S4 review):** "soft_forget_at timestamp from Node.js clock." The nightly job uses `Date.now() - THIRTY_DAYS_MS` to compute `cutoffAt`. Single-millisecond skew across API instances is acceptable for a 30-day window. No DB-function approach required.
- **D3 (from 7-S4 review):** "`editProse` not guarded on soft-forgotten nodes." Closed in Task 3.

### Job patterns to follow

- **Exact pattern:** `apps/api/src/jobs/heart-note-delivery.job.ts` — nightly sweep, `upsertJobScheduler`, `getWorker`, direct repo instantiation, no service decorator. Copy the structure.
- **Secondary reference:** `apps/api/src/jobs/audit-partition-rotation.job.ts` — shows `upsertJobScheduler` with monthly cron + inline error handling.
- **Import extensions:** All job imports use `.js` suffix for ESM (e.g., `../modules/memory/memory.repository.js`). Do not omit the extension.
- **`fp()` wrapper:** The export must be `fp(plugin, { name: 'memory-forget-job' })`.

### `MemoryRepository.hardDeleteSoftForgotten` Supabase chain

The Supabase PostgREST delete chain with `.select()` returns deleted rows:

```ts
await this.client
  .from('memory_nodes')
  .delete()
  .not('soft_forget_at', 'is', null)   // exclude rows where soft_forget_at IS NULL
  .lt('soft_forget_at', cutoffAt)       // include rows older than 30 days
  .select('id, household_id, node_type');
```

This is equivalent to:
```sql
DELETE FROM memory_nodes
WHERE soft_forget_at IS NOT NULL
  AND soft_forget_at < :cutoffAt
RETURNING id, household_id, node_type;
```

The `.not('soft_forget_at', 'is', null)` filter uses PostgREST's negation of `.is()`. The existing Supabase client version in this project supports the `.delete().select()` pattern (confirmed: `supabase-js` v2.x).

### Per-package test baselines (do not introduce NEW failures)

- **Web tests:** 436/436 — no web changes in this slice; baseline must hold.
- **Contracts memory tests:** 46/46 — no contract changes; baseline must hold.
- **API memory tests:** 100% pass (1 pre-existing `MemoryService.seedFromOnboarding` partial-seeding fail confirmed pre-existing via stash on 7-S4). New `hardDeleteSoftForgotten` repo tests + D3 service test increase the pass count.
- **API typecheck:** 11 errors ≤14 baseline; none in memory files. Zero new errors allowed.
- **Web typecheck:** 3 errors in pre-existing untouched files. Zero new errors allowed.

### File List

**New:**
- `supabase/migrations/20260606000000_add_memory_hard_forgotten_audit_type.sql`
- `apps/api/src/jobs/memory-forget.job.ts`
- `apps/api/src/jobs/memory-forget.job.test.ts`

**Modified:**
- `apps/api/src/audit/audit.types.ts` — add `'memory.hard_forgotten'` to `AUDIT_EVENT_TYPES`
- `apps/api/src/modules/memory/memory.repository.ts` — add `hardDeleteSoftForgotten`
- `apps/api/src/modules/memory/memory.repository.test.ts` — tests for `hardDeleteSoftForgotten`
- `apps/api/src/modules/memory/memory.service.ts` — D3 close: `editProse` guard on soft-forgotten
- `apps/api/src/modules/memory/memory.service.test.ts` — D3 close test
- `apps/api/src/app.ts` — import + register `memoryForgetJobPlugin`

### References

- [Source: `apps/api/src/jobs/heart-note-delivery.job.ts`] — canonical nightly cron pattern to follow verbatim
- [Source: `apps/api/src/jobs/audit-partition-rotation.job.ts`] — `upsertJobScheduler` cron pattern
- [Source: `supabase/migrations/20260601000100_add_memory_seeded_audit_type.sql`] — `ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS` pattern
- [Source: `apps/api/src/modules/memory/memory.repository.ts:160-179`] — `softForgetNode` — model for `hardDeleteSoftForgotten` structure + `NodeType` import
- [Source: `apps/api/src/modules/memory/memory.service.ts:183-184`] — `editProse` lines to insert D3 guard after
- [Source: `apps/api/src/modules/memory/memory.service.test.ts:18-32`] — `makeNodeRow` factory: set `soft_forget_at: '2026-05-01T00:00:00.000Z'` for D3 test
- [Source: `apps/api/src/audit/audit.types.ts:32-34`] — existing `memory.*` event types block to append to
- [Source: `apps/api/src/app.ts:35-41,124-138`] — job import block + registration block locations
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:1-11`] — D3 and D6 from 7-S4 review (both closed here)
- [Source: `_bmad-output/planning-artifacts/epic-7-vertical-slices.md#Slice 7-S5`] — demo path, layers, PRD codes FR67 + UX-DR8 Phase 1 (full)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- `pnpm --filter @hivekitchen/api exec vitest run` (job + repo + service memory suites): new tests green; lone `memory.service` partial-seeding fail confirmed pre-existing via `git stash` on clean e86d066 tree.
- `pnpm exec tsc --noEmit -p tsconfig.json` → "Found 11 errors in 6 files" = documented baseline (≤14), zero in memory/job/audit files.
- `pnpm exec eslint` on all changed files → exit 0 (clean).
- Full API suite: 20 fail / 1493 pass / 13 skip — all 20 in documented pre-existing baseline files (auth, children, extra-library, lunch-link, onboarding.tools, audit-parity drift, catalog-seed, households, plan-adjustment, memory partial-seeding). `memory.routes.test.ts` 18/18 confirms `buildApp` registers the new job plugin cleanly.

### Completion Notes List

- **Task 1 — audit type + migration:** Added `'memory.hard_forgotten'` to `AUDIT_EVENT_TYPES` and migration `20260606000000_add_memory_hard_forgotten_audit_type.sql` (mirrors the `memory.seeded` pattern). The enum-parity test (`audit.types.test.ts`) was already failing on a long-standing TS↔migration drift; the diff confirms `memory.hard_forgotten` is balanced on both sides (appears as a context line, not a `+`/`-`), so this slice does not add to the drift.
- **Task 2 — `hardDeleteSoftForgotten`:** Added the PostgREST `.delete().not().lt().select()` chain returning deleted rows for tombstone audit. `memory_provenance` cascades via the existing `ON DELETE CASCADE`. 4 repo tests (filter assertions, success rows, null→`[]`, error→throw).
- **Task 3 — D3 close:** Inserted `if (existing.soft_forget_at !== null) return null;` guard in `editProse` so a tombstoned node's prose edit is blocked at the service layer (route → 404). 1 service test added.
- **Task 4 — `memory-forget.job.ts`:** Nightly BullMQ scheduler (cron `0 3 * * *` UTC) + worker. **SPEC RECONCILIATION #1:** extracted the worker body into an exported `runMemoryForgetSweep(deps)` pure function (the story's Task-6-sanctioned "extract into a standalone function" option) so the sweep is unit-testable without standing up BullMQ. Re-throws on delete failure (BullMQ retry, attempts:3); per-node audit writes are best-effort (a failure logs `warn` and continues). **SPEC RECONCILIATION #2:** dropped the story snippet's `if (!fastify.bullmq)` guard (`bullmq` is a non-optional decorator — dead branch) to match the canonical `heart-note-delivery.job.ts`. **SPEC RECONCILIATION #3:** the story snippet's `async (_job: Job) =>` reproduces the canonical job's pre-existing `no-unused-vars` lint error; since the param is unused, replaced with a zero-arg `async () =>` callback (BullMQ `Processor` accepts fewer params) to keep changed files lint-clean with zero new debt — also let the unused `Job` import be dropped.
- **Task 5 — registration:** Imported + registered `memoryForgetJobPlugin` in `app.ts` after `heartNoteDeliveryJobPlugin` (depends on supabase + bullmq + `auditService` from `auditHook`, all registered earlier).
- **Task 6 — job tests:** 5 cases against `runMemoryForgetSweep` (cutoff ≈30d before now, one audit row per deleted node, INFO `count:0` + no audit on empty, re-throw on delete failure, audit loop continues when one write throws).
- **Scope held:** no web, no contracts/types, no `memory_embeddings` cascade, no `hard_forgotten` flag flip, no SSE, no undo endpoint, no pagination — per Dev Notes guardrails.
- **USER-SIDE GATE:** `supabase db push --include-all` (migration `20260606000000`) before the job writes `memory.hard_forgotten` rows against a real DB.

### File List

**New:**
- `supabase/migrations/20260606000000_add_memory_hard_forgotten_audit_type.sql`
- `apps/api/src/jobs/memory-forget.job.ts`
- `apps/api/src/jobs/memory-forget.job.test.ts`
- `apps/api/src/jobs/memory-forget.job.integration.test.ts` — code-review E2E gate: registers the real plugin + drives the worker (AC#1/#2/#3/#5/#6 + boot guard)

**Modified:**
- `apps/api/src/audit/audit.types.ts` — `'memory.hard_forgotten'` added to `AUDIT_EVENT_TYPES`
- `apps/api/src/modules/memory/memory.repository.ts` — `hardDeleteSoftForgotten`; review P1: `soft_forget_at IS NULL` filter added to `updateNodeProse`
- `apps/api/src/modules/memory/memory.repository.test.ts` — 4 `hardDeleteSoftForgotten` tests; review P1 test (`updateNodeProse` filter) + P2 (capture/assert table + select columns)
- `apps/api/src/modules/memory/memory.service.ts` — D3: `editProse` guard on soft-forgotten nodes
- `apps/api/src/modules/memory/memory.service.test.ts` — D3 close test
- `apps/api/src/app.ts` — import + register `memoryForgetJobPlugin`

### Review Findings

_Code review 2026-06-04 — 3-layer adversarial (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Acceptance Auditor verdict: PASS (all 7 ACs satisfied, no scope-guardrail violations). 2 patch (both applied), 2 defer, 8 dismissed._

- [x] [Review][Patch] `editProse` TOCTOU — `updateNodeProse` lacked the `soft_forget_at IS NULL` filter its sibling `softForgetNode` carries, so a concurrent soft-forget between the D3 pre-check and the update could write prose onto a now-tombstoned node. **Fixed:** added `.is('soft_forget_at', null)` to `updateNodeProse` (mirrors `softForgetNode`) so the race resolves to null → route 404; new repo test asserts the filter [apps/api/src/modules/memory/memory.repository.ts:149]
- [x] [Review][Patch] `hardDeleteSoftForgotten` repo test never asserted the table name or select-column string. **Fixed:** `buildDeleteMockClient` now captures `from()` table + `select()` columns; the filter test asserts `table === 'memory_nodes'` and `selectCols === 'id, household_id, node_type'` (these feed the audit metadata) [apps/api/src/modules/memory/memory.repository.test.ts:406]
- [x] [Review][Defer] Scheduler-registration failure is logged-and-swallowed (`void queue.upsertJobScheduler(...).catch(log)`) → the nightly deletion job can silently never run while the app boots healthy [apps/api/src/jobs/memory-forget.job.ts:111] — deferred, pre-existing codebase-wide job pattern (heart-note-delivery, catalog, audit-partition all do this); cross-cutting ops concern, not unique to this slice
- [x] [Review][Defer] On a >~1000-node backlog, PostgREST `db-max-rows` may truncate the *returned* (and thus audited) row set, leaving deleted-but-un-audited nodes (AC#2 completeness gap at scale) [apps/api/src/modules/memory/memory.repository.ts:185] — deferred, spec explicitly scoped out pagination ("Acceptable at beta scale"); dormant at current volume; revisit with a limit+loop before scale (also bounds the audit loop)

**E2E gate (2026-06-04):** API-only background job — no web surface. Generated `apps/api/src/jobs/memory-forget.job.integration.test.ts` (5 tests) registering the real `memoryForgetJobPlugin` + driving the worker; covers AC#1/#2/#3/#5 and **AC#6 (scheduler cron — previously uncovered)** + boot guard. Summary at `_bmad-output/implementation-artifacts/tests/test-summary-7-s5.md`. Full job surface 10/10; full API suite 1499-pass/20-fail (documented baseline, 0 regressions); typecheck 11 = baseline. Live DB-backed verification remains the USER-SIDE GATE (`supabase db push --include-all` + job vs live Redis/Supabase). Status → done.

## Change Log

| Date       | Change                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------- |
| 2026-06-04 | Story file authored for 7-S5 Soft→Hard Promotion Job. Status → ready-for-dev.              |
| 2026-06-04 | Implemented all 6 tasks. Migration 20260606000000 + `memory.hard_forgotten` audit type; `hardDeleteSoftForgotten` repo method; D3 `editProse` tombstone guard; `memory-forget.job.ts` nightly BullMQ sweep (extracted testable `runMemoryForgetSweep`); registered in app.ts. 10 new tests green; typecheck 11≤14 baseline (0 new); changed files lint-clean. Status → review. |
