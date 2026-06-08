# Story 5-S8: "I Noticed" Learning Moments

Status: done

<!-- folds: 5.12 -->
<!-- cited PRD: FR62 -->
<!-- slice source: _bmad-output/planning-artifacts/epic-5-vertical-slices.md §"Slice 5-S8" -->

## Story

As a parent who has had several conversations with Lumi,
I want to see a callout in the Brief footer when Lumi has noticed ≥3 meaningful patterns about my family,
so that I can confirm, explore, or dismiss what Lumi is learning — making the system's enrichment legible and correctable.

---

## ⚠️ READ FIRST — Scope reconciliation

The epic description says "Cron or on-write threshold check on memory_nodes; surfaces callout via brief_state projection extension." The current codebase:

- **`BriefStateComposer.refreshTree()`** already reads `previousBrief` (line 200 in `brief-state.composer.ts`) to carry forward `plan_state` mirror fields. The same pattern carries forward the new `learning_moment_suppressed_until` field.
- **`BriefStatePayloadSchema`** is JSONB — adding new nullable fields with `.default(null)` requires no DB migration. The DB column default `'{}'` parses cleanly against the updated schema.
- **`memory_nodes.source_type`** is NOT on `memory_nodes` directly — it lives on the `memory_provenance` table (FK → `memory_nodes.id`). The threshold query must JOIN `memory_provenance` using the `!inner` PostgREST syntax.
- **`BriefStateComposer`** is decorated on `fastify` via `plans.hook.ts` (see `fastify.decorate('briefStateComposer', ...)` at line 165 in `plans.hook.ts`). The respond endpoint in `households.routes.ts` calls `fastify.briefStateComposer.respondToLearningMoment()`.
- The Epic spec mentions "TemplateStateChangedEvent audit row" on [Yes]. This story uses purpose-specific `memory.learning_moment_confirmed` / `memory.learning_moment_dismissed` / `memory.learning_moment_tell_more` audit types instead of repurposing the cultural `template.state_changed` event.

**What this slice ships:**
- Threshold-gated `learning_moment_callout` field in `BriefStatePayloadSchema` (surfaced by `BriefStateComposer.refreshTree()`)
- `POST /v1/households/:householdId/brief/learning-moment { action }` respond endpoint
- `<LumiCallout>` component mounted in `<BriefCanvas>` footer (above `<BriefWhyPanel>`)
- 3 new audit event types + `MemoryRepository.findRecentTurnSourcedNodes()`

**What this slice does NOT do:**
- Does NOT add SSE push for real-time callout appearance — the callout appears on the next Brief fetch/refresh after the threshold is crossed
- Does NOT deduplicate callouts against prior surfacings — after a confirm/dismiss, the 7-day suppress window prevents immediate re-surface; after that window, a new callout can form from fresh nodes
- Does NOT add per-child scoping to the callout — all enrichment signals are household-scoped (`subject_child_id = null`) in this slice; per-child attributions are a follow-up
- Does NOT trigger a full `BriefStateComposer.refreshTree()` when responding — the respond handler patches only the callout fields in the existing brief_state row to avoid regenerating tile summaries or touching plan state

---

## Acceptance Criteria

1. **Given** ≥3 `memory_nodes` for the household have `source_type='turn'` (on their `memory_provenance` row), `soft_forget_at IS NULL`, and `created_at >= now - 7 days`, AND the current timestamp is past `learning_moment_suppressed_until` (or it is null), **When** `BriefStateComposer.refreshTree()` runs, **Then** `brief_state.payload.learning_moment_callout` is set to `{ prose: "I've noticed [bestNode.prose_text] — want me to keep that in mind?", node_ids: [...], surfaced_at: <now> }`.

2. **Given** the Brief payload has a non-null `learning_moment_callout`, **When** `<BriefCanvas>` renders, **Then** `<LumiCallout>` is rendered above `<BriefWhyPanel>` in the Brief footer, displaying the prose text and three action buttons: [Yes, keep it in mind], [Tell me more], [Not for us].

3. **Given** the user taps [Yes, keep it in mind], **When** `POST /v1/households/:householdId/brief/learning-moment { action: 'confirm' }` is called, **Then** a `memory.learning_moment_confirmed` audit row is written, `learning_moment_callout` is set to null in the brief_state payload, and the callout unmounts on the next Brief query invalidation.

4. **Given** the user taps [Not for us], **When** `POST ... { action: 'dismiss' }` is called, **Then** a `memory.learning_moment_dismissed` audit row is written, `learning_moment_callout` is set to null, and `learning_moment_suppressed_until` is set to `now + 7 days` — the callout will not resurface for 7 days even if the ≥3 threshold is met.

5. **Given** the user taps [Tell me more], **When** `POST ... { action: 'tell_more' }` is called, **Then** a `memory.learning_moment_tell_more` audit row is written, `learning_moment_callout` is set to null (no suppress window), and the web client opens the Lumi panel via `useLumiContext` (client-side only — the server just clears the callout).

6. **Given** `learning_moment_suppressed_until` is a future datetime, **When** `refreshTree()` calls `buildLearningMomentCallout()`, **Then** it returns null and no callout is set — the suppress window is respected regardless of how many turn-sourced nodes exist.

7. **Given** `refreshTree()` runs and the existing payload has a `learning_moment_suppressed_until`, **Then** that value is carried forward to the new payload unconditionally (same pattern as the `plan_state` mirror at lines 241–243 in `brief-state.composer.ts`).

8. **Given** no `memory_nodes` with `source_type='turn'` exist OR fewer than 3 exist within the 7-day window, **When** `refreshTree()` runs, **Then** `learning_moment_callout` remains null.

---

## Tasks / Subtasks

### Task 1 — Contracts: extend `BriefStatePayloadSchema` (AC: #1–#8)

- [x] 1.1 In `packages/contracts/src/plan.ts`, add a new schema above `BriefStatePayloadSchema`:
  ```ts
  export const LearningMomentCalloutSchema = z.object({
    prose: z.string().min(1).max(400),
    node_ids: z.array(z.string().uuid()).min(1).max(5),
    surfaced_at: z.string().datetime({ offset: true }),
  });
  ```

- [x] 1.2 In `packages/contracts/src/plan.ts`, extend `BriefStatePayloadSchema` with two new nullable fields (append after `plan_state_message`):
  ```ts
  // 5-S8 — "I noticed" learning moment callout. Null when below threshold or suppressed.
  learning_moment_callout: LearningMomentCalloutSchema.nullable().default(null),
  // 5-S8 — suppress window after dismiss action. Null means no active suppress.
  learning_moment_suppressed_until: z.string().datetime({ offset: true }).nullable().default(null),
  ```
  These have `.default(null)` so parsing an existing `'{}'` brief_state row produces null for both fields — no migration needed.

- [x] 1.3 In `packages/contracts/src/plan.ts`, add respond-action schemas (can go near `LearningMomentCalloutSchema`):
  ```ts
  export const LearningMomentActionSchema = z.enum(['confirm', 'tell_more', 'dismiss']);
  export const RespondToLearningMomentRequestSchema = z.object({
    action: LearningMomentActionSchema,
  });
  ```

- [x] 1.4 Verify `packages/contracts/src/index.ts` already re-exports from `./plan.js` (it does — no change needed).

- [x] 1.5 In `packages/types/src/index.ts`, add type re-exports (use `export type` — isolatedModules):
  ```ts
  export type { LearningMomentCallout, LearningMomentAction, RespondToLearningMomentRequest } from '@hivekitchen/contracts';
  ```
  Where each type is `z.infer<typeof XSchema>`. Check the existing pattern in the file — types are exported as named imports from the contracts package (not re-declared).

- [x] 1.6 Add round-trip schema tests to `packages/contracts/src/plan.test.ts`:
  - `LearningMomentCalloutSchema` parses valid object
  - `LearningMomentCalloutSchema` rejects prose > 400 chars
  - `RespondToLearningMomentRequestSchema` accepts `confirm | tell_more | dismiss`
  - `BriefStatePayloadSchema` parses `{}` (empty JSONB default) with `learning_moment_callout: null`

### Task 2 — `MemoryRepository`: `findRecentTurnSourcedNodes()` (AC: #1, #6, #8)

- [x] 2.1 In `apps/api/src/modules/memory/memory.repository.ts`, add a new method. The query JOINs `memory_provenance` using `!inner` to filter to nodes sourced from a `'turn'`:
  ```ts
  async findRecentTurnSourcedNodes(
    householdId: string,
    sinceIso: string,
  ): Promise<Array<{ id: string; prose_text: string; node_type: string; created_at: string }>> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .select('id, prose_text, node_type, created_at, memory_provenance!inner(source_type)')
      .eq('household_id', householdId)
      .is('soft_forget_at', null)
      .gte('created_at', sinceIso)
      .eq('memory_provenance.source_type', 'turn')
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) {
      this.logger.warn({ err: error, household_id: householdId }, 'findRecentTurnSourcedNodes failed — returning []');
      return [];
    }
    return (data ?? []).map((r) => ({
      id: r.id,
      prose_text: r.prose_text,
      node_type: r.node_type,
      created_at: r.created_at,
    }));
  }
  ```
  **Note:** `MemoryRepository` extends `BaseRepository` which takes only `SupabaseClient`. It does NOT have a `logger` field in the base class. Add a second constructor argument for the logger, or log at the caller (composer). If MemoryRepository has no logger, swallow the error at the method level and return `[]` with no log (the caller logs). Check `memory.repository.ts` to confirm — if no logger field, remove the `.warn()` line and simply `return []` on error (the composer will log the absence of results).

- [x] 2.2 Add tests to `apps/api/src/modules/memory/memory.repository.test.ts`:
  - **"returns nodes joined with turn-sourced provenance"** — mock Supabase chain returns 2 turn-sourced nodes; expect them mapped correctly
  - **"returns empty array on Supabase error"** — mock returns `{ data: null, error: new Error('db') }`; expect `[]` (no throw)

### Task 3 — `BriefStateComposer`: threshold logic + respond method (AC: #1, #3–#8)

- [x] 3.1 In `apps/api/src/modules/plans/brief-state.composer.ts`, add `MemoryRepository` import:
  ```ts
  import type { MemoryRepository } from '../memory/memory.repository.js';
  ```

- [x] 3.2 Add `memoryRepository?: MemoryRepository` to `BriefStateComposerDeps` interface (optional — the existing 6 tests that construct `BriefStateComposer` without a memory repo remain valid):
  ```ts
  export interface BriefStateComposerDeps {
    plansRepository: PlansRepository;
    briefStateRepository: BriefStateRepository;
    childrenRepository: ChildrenRepository;
    lunchLinkSessionRepository?: LunchLinkSessionRepository;
    auditService: AuditService;
    logger: FastifyBaseLogger;
    memoryRepository?: MemoryRepository; // 5-S8 — optional so existing tests remain valid
  }
  ```

- [x] 3.3 Add `private readonly memoryRepository?: MemoryRepository` field and assign in the constructor.

- [x] 3.4 Add a private `buildLearningMomentCallout()` method:
  ```ts
  private async buildLearningMomentCallout(
    householdId: string,
    suppressedUntil: string | null,
  ): Promise<{
    prose: string;
    node_ids: string[];
    surfaced_at: string;
  } | null> {
    if (!this.memoryRepository) return null;  // not wired in tests
    if (suppressedUntil && new Date(suppressedUntil) > new Date()) return null;  // AC#6

    // 7-day window: ISO string for the cutoff
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const nodes = await this.memoryRepository.findRecentTurnSourcedNodes(householdId, since);

    if (nodes.length < 3) return null;  // AC#8 — threshold not met

    // Build prose from the most-recently-created node (first in desc-order result)
    const best = nodes[0]!;
    const prose = `I've noticed ${best.prose_text} — want me to keep that in mind?`.slice(0, 400);
    const nodeIds = nodes.slice(0, 5).map((n) => n.id);

    return { prose, node_ids: nodeIds, surfaced_at: new Date().toISOString() };
  }
  ```

- [x] 3.5 In `refreshTree()`, add a parallel read for `buildLearningMomentCallout`:
  - Read `suppressedUntil` from `previousBrief?.payload?.learning_moment_suppressed_until ?? null` AFTER the parallel read resolves (since `previousBrief` is fetched there).
  - Call `buildLearningMomentCallout()` sequentially after the parallel fetch (it needs `previousBrief` first).
  - Insert the two new payload fields in `upsertInput.payload`:
  ```ts
  // After the parallel read resolves (line ~206 in current file):
  const suppressedUntil = previousBrief?.payload?.learning_moment_suppressed_until ?? null;
  const learningMomentCallout = await this.buildLearningMomentCallout(householdId, suppressedUntil);

  // In upsertInput.payload (after line ~243):
  plan_state: previousBrief?.payload?.plan_state ?? null,
  plan_state_set_at: previousBrief?.payload?.plan_state_set_at ?? null,
  plan_state_message: previousBrief?.payload?.plan_state_message ?? null,
  // 5-S8 — learning moment callout
  learning_moment_callout: learningMomentCallout,
  learning_moment_suppressed_until: suppressedUntil,
  ```

- [x] 3.6 Add a public `respondToLearningMoment()` method (AC: #3–#5, #7):
  ```ts
  async respondToLearningMoment(
    householdId: string,
    action: 'confirm' | 'tell_more' | 'dismiss',
    requestId: string,
  ): Promise<void> {
    const current = await this.briefStateRepo.findByHousehold(householdId);
    if (!current || !current.payload.learning_moment_callout) {
      // No callout to respond to — no-op (idempotent)
      return;
    }

    const suppressedUntil =
      action === 'dismiss'
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : current.payload.learning_moment_suppressed_until;  // carry forward or null

    const updatedPayload = {
      ...current.payload,
      learning_moment_callout: null,
      learning_moment_suppressed_until: suppressedUntil ?? null,
    };

    await this.briefStateRepo.upsert({
      household_id: householdId,
      plan_id: current.plan_id,
      moment_headline: current.moment_headline,
      lumi_note: current.lumi_note,
      memory_prose: current.memory_prose,
      payload: updatedPayload,
      generated_at: current.generated_at,
      plan_revision: current.plan_revision,
    });

    const auditEventType =
      action === 'confirm'
        ? 'memory.learning_moment_confirmed'
        : action === 'dismiss'
          ? 'memory.learning_moment_dismissed'
          : 'memory.learning_moment_tell_more';

    try {
      await this.auditService.write({
        event_type: auditEventType,
        household_id: householdId,
        request_id: requestId,
        metadata: { action },
      });
    } catch (auditErr) {
      this.logger.warn({ auditErr, household_id: householdId }, 'audit write failed for learning moment respond — non-fatal');
    }
  }
  ```
  **Note on `upsert` shape:** `BriefStateUpsertInput` mirrors the `BriefStateRowSchema` minus `updated_at` (set by the DB trigger). Confirm the exact shape by reading `brief-state.repository.ts` — the `upsert()` call should match line 218–248 in the current composer. The `plan_revision` field comes from `current.plan_revision`.

### Task 4 — `plans.hook.ts`: wire `memoryRepository` (AC: #1)

- [x] 4.1 In `apps/api/src/modules/plans/plans.hook.ts`, import `MemoryRepository`:
  ```ts
  import { MemoryRepository } from '../memory/memory.repository.js';
  ```

- [x] 4.2 Create an instance and pass to the composer:
  ```ts
  const memoryRepository = new MemoryRepository(fastify.supabase);

  const briefStateComposer = new BriefStateComposer({
    plansRepository: repository,
    briefStateRepository,
    childrenRepository,
    lunchLinkSessionRepository,
    auditService: fastify.auditService,
    logger: fastify.log,
    memoryRepository,  // ← NEW 5-S8
  });
  ```

### Task 5 — `AUDIT_EVENT_TYPES`: new event types (AC: #3–#5)

- [x] 5.1 In `apps/api/src/audit/audit.types.ts`, add 3 new entries to `AUDIT_EVENT_TYPES` (in the `// memory` section, after `'memory.hard_forgotten'`):
  ```ts
  'memory.learning_moment_confirmed',  // 5-S8: user tapped [Yes, keep it in mind]
  'memory.learning_moment_dismissed',  // 5-S8: user tapped [Not for us], 7-day suppress set
  'memory.learning_moment_tell_more',  // 5-S8: user tapped [Tell me more], no suppress
  ```

### Task 6 — `households.routes.ts`: respond endpoint (AC: #3–#5)

- [x] 6.1 In `apps/api/src/modules/households/households.routes.ts`, add a route (alongside the GET `/v1/households/:householdId/brief` route, using the same `requireParentOrCaregiver` guard):
  ```ts
  fastify.post(
    '/v1/households/:householdId/brief/learning-moment',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: HouseholdIdParamsSchema,         // already defined in the file
        body: RespondToLearningMomentRequestSchema,
        response: { 204: z.object({}) },
      },
    },
    async (request, reply) => {
      const { householdId } = request.params;
      // Cross-household guard — already enforced by requireParentOrCaregiver
      await fastify.briefStateComposer.respondToLearningMoment(
        householdId,
        request.body.action,
        request.id,
      );
      return reply.status(204).send();
    },
  );
  ```
  Add the required import at the top of the file:
  ```ts
  import { RespondToLearningMomentRequestSchema } from '@hivekitchen/contracts';
  ```

### Task 7 — `LumiCallout.tsx`: new component (AC: #2, #3–#5)

- [x] 7.1 Create `apps/web/src/features/plan/LumiCallout.tsx`:
  - Props: `callout: LearningMomentCallout` (from `@hivekitchen/types`), `householdId: string`, `onTellMore?: () => void`
  - Three action buttons matching the [Yes, keep it in mind] / [Tell me more] / [Not for us] labels
  - On button click: `hkFetch('POST', /v1/households/${householdId}/brief/learning-moment, { action })` → on success, invalidate `QueryKeys.brief(householdId)` → callout unmounts on next refetch
  - For [Tell me more] action: also call `onTellMore?.()` after the mutation resolves (opens Lumi panel — caller provides the callback)
  - Use `aria-busy` while the mutation is in flight; disable all three buttons during flight
  - Design tokens: `bg-surface-2`, serif prose text (`font-serif`), honey-amber-500 Lumi label ("Lumi noticed"), raw bordered secondary pills for the three actions (matches existing brief action patterns — see `PlanActionSection` for pill button patterns)
  - No voice, no SSE, no stores — pure fetch + query invalidation

- [x] 7.2 Create `apps/web/src/features/plan/LumiCallout.test.tsx`:
  - **"renders prose from callout"**
  - **"calls POST with action=confirm on [Yes] click"**
  - **"calls POST with action=dismiss on [Not for us] click"**
  - **"calls POST + onTellMore on [Tell me more] click"**
  - **"disables buttons while request is in flight"**

### Task 8 — `BriefCanvas.tsx`: mount `<LumiCallout>` (AC: #2)

- [x] 8.1 In `apps/web/src/features/plan/BriefCanvas.tsx`:
  - Import `LumiCallout` and `useLumiContext`
  - Read `payload.learning_moment_callout` from the `brief` (already available via `payload = brief?.payload`)
  - Render `<LumiCallout>` immediately ABOVE the `<BriefWhyPanel>` line (current line 546), only when `payload.learning_moment_callout != null`:
    ```tsx
    {payload.learning_moment_callout && (
      <LumiCallout
        callout={payload.learning_moment_callout}
        householdId={brief.household_id}
        onTellMore={() => { /* open Lumi panel — useLumiContext or router nav */ }}
      />
    )}
    <BriefWhyPanel brief={brief} />
    ```
  - The `onTellMore` handler: look at how other components open the Lumi panel. If `useLumiContext` provides a `setOpen` or similar, use that. If not, navigate to a surface that shows the Lumi panel. Keep it simple — the minimal implementation is just calling `useLumiContext` if a method exists, or routing to `/app?lumi=open` as a fallback.

### Task 9 — Tests: `brief-state.composer` + `households.routes` (AC: all)

- [x] 9.1 Add tests to `apps/api/src/modules/plans/brief-state.composer.tree.test.ts` (or colocated composer test file):
  - **"sets learning_moment_callout when ≥3 turn-sourced nodes exist"** — mock `memoryRepository.findRecentTurnSourcedNodes` to return 3 nodes; verify `upsertInput.payload.learning_moment_callout` is non-null with correct prose and node_ids.
  - **"leaves learning_moment_callout null when < 3 nodes"** — mock returns 2 nodes; verify callout is null.
  - **"respects suppress window — returns null callout when suppressedUntil is future"** — mock returns 5 nodes but `previousBrief.payload.learning_moment_suppressed_until` is 6 days from now; verify callout is null.
  - **"carries forward learning_moment_suppressed_until"** — verify the suppress window date is echoed into the new payload unchanged.
  - **"skips buildLearningMomentCallout when memoryRepository is absent"** — construct composer without memoryRepository; verify no crash and callout is null.

- [x] 9.2 Add tests to `apps/api/src/modules/households/households.routes.test.ts`:
  - **"204 on POST .../brief/learning-moment { action: 'confirm' }"** — mock `briefStateComposer.respondToLearningMoment`; expect 204.
  - **"403 on cross-household POST .../brief/learning-moment"** — use a different householdId from the JWT; expect 403.
  - **"400 on invalid action"** — body `{ action: 'banana' }`; expect 400.

- [x] 9.3 Verify baseline test counts before starting:
  - API: `pnpm --filter @hivekitchen/api test` — confirm ~1717 pass / 20 fail (documented baseline).
  - Expected new tests: ~8–10 in API (2 memory.repo + 5 composer + 3 route) + ~5 in web (LumiCallout component) + ~4 in contracts = ~17–19 total.

### Task 10 — Verification (AC: all)

- [x] 10.1 `pnpm typecheck` — zero new errors (API 11, web 6, contracts/types 1 — all in untouched files).
- [x] 10.2 `pnpm test` for `apps/api` — all new tests green; documented 20 pre-existing failures unchanged.
- [x] 10.3 `pnpm test` for `apps/web` — all new `LumiCallout` tests green; documented 2 pre-existing failures (PackerAssignmentDialog + sse packer.assigned key) unchanged.
- [x] 10.4 `pnpm test` for `packages/contracts` — 4 new round-trip tests green.
- [x] 10.5 Manual smoke (optional): Start local stack → send 3+ messages containing memory-worthy signals → brief should show callout → tap [Yes] → callout clears.

---

## Dev Notes

### CRITICAL: `source_type` is on `memory_provenance`, not `memory_nodes`

The `memory_nodes` table does NOT have a `source_type` column. It is on `memory_provenance.source_type` (FK: `memory_provenance.memory_node_id → memory_nodes.id`). The query must JOIN these tables:
```ts
.select('id, prose_text, node_type, created_at, memory_provenance!inner(source_type)')
.eq('memory_provenance.source_type', 'turn')
```

The `!inner` suffix in PostgREST forces an INNER JOIN — rows with no matching provenance record are excluded. The `.eq('memory_provenance.source_type', 'turn')` filter works on the joined table. This pattern is confirmed by PostgREST 12 / Supabase JS v2 docs.

### CRITICAL: `refreshTree()` sequence — `suppressedUntil` must be read AFTER the parallel fetch

The parallel fetch (lines 193–206 in `brief-state.composer.ts`) resolves `previousBrief`. Read `suppressedUntil` from `previousBrief?.payload?.learning_moment_suppressed_until` AFTER the `await Promise.all([...])` resolves, then call `await this.buildLearningMomentCallout(householdId, suppressedUntil)`. This adds one sequential async call after the parallel block — acceptable because it returns early (null) for 95% of households that have no callout candidates.

### CRITICAL: `BriefStateComposer.respondToLearningMoment()` patches the payload, NOT a full refresh

The respond handler does NOT call `refreshTree()`. This is intentional:
- `refreshTree()` would re-evaluate the callout and potentially immediately re-surface it
- The patch approach is atomic: clear callout + optionally set suppress window in one upsert
- The client invalidates `QueryKeys.brief(householdId)` after success, which fetches the patched payload — the callout is gone

### CRITICAL: `BriefStateUpsertInput` shape — confirm from `brief-state.repository.ts`

Before writing `respondToLearningMoment()`, read `apps/api/src/modules/plans/brief-state.repository.ts` to confirm the exact `BriefStateUpsertInput` interface. The `upsert()` call in the composer at lines 218–248 uses this shape. The key fields to carry forward from `current` are: `household_id`, `plan_id`, `moment_headline`, `lumi_note`, `memory_prose`, `generated_at`, `plan_revision`. The `updated_at` is set by a DB trigger — do NOT include it in the upsert.

### CRITICAL: TypeScript type for `upsertInput.payload`

After extending `BriefStatePayloadSchema`, the inferred `BriefStatePayload` type will require `learning_moment_callout` and `learning_moment_suppressed_until` to be provided explicitly in every `upsertInput.payload` object in the codebase. Grep for `BriefStateUpsertInput` or `upsert(` in the composer — there may be more than one upsert call site. All must be updated to include the new fields (set to `null` or carry from previous payload).

Search:
```bash
grep -rn "upsertInput\|briefStateRepo.upsert\|briefStateRepository.upsert" apps/api/src/
```

The flat `refresh()` method (coexisting with `refreshTree()`) may have its own upsert. Add `learning_moment_callout: null, learning_moment_suppressed_until: null` there as well — the flat path is being retired but must compile.

### CRITICAL: No new migration needed

The `brief_state.payload` column is already `JSONB NOT NULL DEFAULT '{}'`. Zod's `.default(null)` on the two new fields means parsing `'{}'` returns `{ ..., learning_moment_callout: null, learning_moment_suppressed_until: null }`. No DB schema change required.

### `prose` construction — keep it under 400 chars

The prose template is:
```ts
const prose = `I've noticed ${best.prose_text} — want me to keep that in mind?`.slice(0, 400);
```
`best.prose_text` is capped at 150 chars by `EnrichmentSignalSchema.prose_text.max(150)` (from 5-S7). The template adds ~50 chars overhead, so the `.slice(0, 400)` is a safety net only.

### `onTellMore` in `<BriefCanvas>` — Lumi panel open mechanism

Check how other Brief surface components open the Lumi panel. Look at `LumiPanel.tsx` or the layout component for how the panel is toggled. If `useLumiContext` exposes a `setActiveSession` or `openPanel` method, use it. If not, a `useState` flag passed down from the Brief page is acceptable. The simplest working implementation: do nothing server-side; the callout is cleared; separately, if there's a Lumi panel toggle in scope, call it. Do NOT add a new Zustand store for this single flag.

### `BriefStateRepository.findByHousehold()` return type

The `respondToLearningMoment()` method calls `this.briefStateRepo.findByHousehold(householdId)`. Confirm the return type includes the full `BriefStateRow` (with typed `payload`). If `findByHousehold` returns `null` when no brief exists, add a guard: return early without error if `!current`.

### `MemoryRepository` logger field

`BaseRepository` only takes `SupabaseClient` — there is NO `logger` field. The `findRecentTurnSourcedNodes` method should return `[]` on error without logging (the caller in the composer logs at the warn level if no callout is generated). Alternatively, add a second optional `logger` param to the `MemoryRepository` constructor if the existing methods already log. Prefer consistency with what's already in `memory.repository.ts`.

### Web: `hkFetch` for the respond mutation

Mirror the existing `hkFetch` call pattern in `BriefCanvas.tsx` or `LumiCallout.tsx`. `hkFetch` signature is two args: `(path: string, init?: RequestInit)` — for POST, pass `{ method: 'POST', body: { action } }` (the library JSON-stringifies the body automatically based on the pattern in `lib/fetch.ts`). Check `lib/fetch.ts` to confirm the exact call signature — do NOT pass `JSON.stringify(body)` since `hkFetch` already does it internally (SPEC RECONCILIATION from 7-S3: confirmed this is the codebase pattern).

### Web: query invalidation after respond

After the POST resolves, invalidate `QueryKeys.brief(householdId)` (or the equivalent Brief query key). Look at how other Brief mutations (e.g., packer assignment in 5-S3) invalidate the brief query. The `useQueryClient()` + `.invalidateQueries()` pattern is standard.

### Web: `LumiCallout` design alignment

Per `docs/DESIGN.md` (§Honey rule, §Button taxonomy):
- Lumi's voice is editorial serif — use `font-serif` for the prose text
- Use `text-honey-amber-600` for the "Lumi noticed" label (or the `honey` color token if available)
- Three action pills: raw bordered buttons (no filled/elevated — these are secondary, non-destructive choices)
- No icons on the action buttons — text labels only
- Component stays narrow (max-w-lg or full Brief width) — do not create a modal or overlay

### Source file map

| File | Action | Notes |
|------|--------|-------|
| `packages/contracts/src/plan.ts` | Modify | Add `LearningMomentCalloutSchema`, `LearningMomentActionSchema`, `RespondToLearningMomentRequestSchema`; extend `BriefStatePayloadSchema` |
| `packages/contracts/src/plan.test.ts` | Modify | 4 new contract tests |
| `packages/types/src/index.ts` | Modify | 3 new type re-exports |
| `apps/api/src/modules/memory/memory.repository.ts` | Modify | Add `findRecentTurnSourcedNodes()` |
| `apps/api/src/modules/memory/memory.repository.test.ts` | Modify | 2 new repo tests |
| `apps/api/src/modules/plans/brief-state.composer.ts` | Modify | Add `memoryRepository` dep; `buildLearningMomentCallout()`; `respondToLearningMoment()`; wire into `refreshTree()` |
| `apps/api/src/modules/plans/brief-state.composer.tree.test.ts` | Modify | 5 new composer tests |
| `apps/api/src/modules/plans/plans.hook.ts` | Modify | Create `MemoryRepository` instance + pass to composer |
| `apps/api/src/audit/audit.types.ts` | Modify | 3 new audit event types |
| `apps/api/src/modules/households/households.routes.ts` | Modify | `POST /v1/households/:householdId/brief/learning-moment` |
| `apps/api/src/modules/households/households.routes.test.ts` | Modify | 3 new route tests |
| `apps/web/src/features/plan/LumiCallout.tsx` | Create | New component |
| `apps/web/src/features/plan/LumiCallout.test.tsx` | Create | 5 new component tests |
| `apps/web/src/features/plan/BriefCanvas.tsx` | Modify | Mount `<LumiCallout>` above `<BriefWhyPanel>` |

**No changes to:**
- Any migration files — no DB schema change needed
- `apps/api/src/agents/` — no agent changes
- `apps/api/src/modules/lumi/` — enrichment path unchanged
- `apps/api/src/modules/memory/memory.service.ts` — `MemoryRepository` is called directly from the composer
- `apps/web/src/features/plan/BriefWhyPanel.tsx` — no changes to the why-panel

### Existing code to reuse (do NOT reinvent)

| What | Where | Pattern |
|------|-------|---------|
| `previousBrief` carry-forward pattern | `brief-state.composer.ts:241–243` | Mirror for `learning_moment_suppressed_until` |
| `findByHousehold()` | `brief-state.repository.ts` | Used in `respondToLearningMoment()` to read current payload |
| `requireParentOrCaregiver` guard | `households.routes.ts` (already defined before GET /brief) | Reuse for POST endpoint |
| `hkFetch` body auto-stringify | `lib/fetch.ts:179` | Pass raw object `{ action }`, NOT `JSON.stringify({ action })` — confirmed 7-S3 reconciliation |
| Query invalidation after mutation | `useQuery` + `useQueryClient().invalidateQueries()` | See packer assignment in `PackerAssignmentDialog.tsx` for the pattern |
| `BriefStateComposer.auditService.write()` | `brief-state.composer.ts` (e.g., line 261) | Best-effort pattern with try/catch wrapping the audit write |
| `!inner` PostgREST JOIN | Supabase JS v2 — used in `findAllergyEventsByHousehold()` in `audit.repository.ts` if it exists | Same `!inner(field)` + `.eq('table.column', value)` syntax |

### Test flushing — composer async tests

`buildLearningMomentCallout()` is called with `await` inside `refreshTree()`, not fire-and-forget. Tests can assert `upsertInput.payload.learning_moment_callout` synchronously after `await composer.refreshTree(...)` — no extra microtask flush needed.

### Pre-existing flat `refresh()` path in `brief-state.composer.ts`

The file still contains the FLAT `refresh()` method (being retired by 3-DM-C1). After extending `BriefStatePayloadSchema`, TypeScript will require `learning_moment_callout` and `learning_moment_suppressed_until` in the flat path's `upsertInput.payload` too. Add both as `null` to keep it compiling. Do NOT add the threshold query to the flat path — it is dead code.

### USER-SIDE GATES

None. No migration, no new env var, no new npm dependency. `MemoryRepository` uses the existing Supabase client. The `memory_provenance` table's `source_type='turn'` value is already valid (confirmed by `SourceTypeSchema` in `packages/contracts/src/memory.ts:26`).

### Test baselines (from 5-S7 done state, 2026-06-07)

- **API:** ~1717 pass / 20 fail (documented pre-existing: auth×7, children.repository×3, extra-library×3, lunch-link-dev, onboarding.tools, audit-parity, catalog-seed, households-memory-200, plan-adjustment, memory-partial-seeding)
- **Web:** ~532 pass / 2 fail (pre-existing 5-S3 debt: PackerAssignmentDialog, sse packer.assigned key)
- **Contracts:** ~701 pass / 7 fail (pre-existing: auth×3 working-tree, cultural×1, heart-notes×3)
- **Typecheck baseline:** API 11, web 6, contracts/types 1 — all in untouched files

Expected new tests: ~4 contracts + ~10 API (2 repo + 5 composer + 3 route) + ~5 web = ~19 total.

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

- `pnpm --filter @hivekitchen/api exec vitest run` → 1727 pass / 20 fail / 13 skip (20 fail = documented baseline; +10 new green: 2 memory.repo + 5 composer + 3 route).
- `pnpm --filter @hivekitchen/web exec vitest run` → 537 pass / 2 fail (2 fail = pre-existing 5-S3 debt; +5 new LumiCallout).
- `pnpm --filter @hivekitchen/contracts exec vitest run` → 708 pass / 7 fail (7 fail = pre-existing auth×3/cultural×1/heart-notes×3; +7 new plan.test).
- Typecheck: API 12 (= baseline), web 7 (= baseline), contracts/types heart-notes (= baseline) — **0 new** typecheck errors. (Baselines verified via `git stash` of the working tree.)

### Completion Notes List

- ✅ AC#1–#8 satisfied. `learning_moment_callout` + `learning_moment_suppressed_until` added to `BriefStatePayloadSchema` (`.default(null)` — no DB schema change for brief_state). Surfaced by `BriefStateComposer.refreshTree()` via the new private `buildLearningMomentCallout()` (≥3 turn-sourced nodes in a 7-day window, suppress-window respected, suppress carried forward unconditionally).
- ✅ `MemoryRepository.findRecentTurnSourcedNodes()` JOINs `memory_provenance!inner` filtered to `source_type='turn'`. BaseRepository has no logger → returns `[]` silently on error (composer is the log site).
- ✅ `respondToLearningMoment()` patches ONLY the callout fields (no full `refreshTree`), writes the audit row, sets a 7-day suppress on dismiss, idempotent no-op when no callout. Wired through `POST /v1/households/:householdId/brief/learning-moment` (`requireParentOrCaregiver`, cross-household 403, 400 on invalid action, 204 on success).
- ✅ `<LumiCallout>` mounts above `<BriefWhyPanel>` in `<BriefCanvas>`; three secondary pills; POST → invalidate `QueryKeys.brief`; `[Tell me more]` also calls `onTellMore` → `useLumiStore.getState().openPanel()`. `aria-busy` + all buttons disabled in flight.
- **DEVIATION from story "No migration needed":** the story overlooked that `audit_event_type` is a real Postgres enum with TS↔SQL parity enforced (`audit.types.test.ts`). The ACs *require* audit rows to be written, so the 3 new event types must exist in the DB or the best-effort writes silently fail. Added migration `20260907000000_add_learning_moment_audit_types.sql` (mirrors the established `add_*_audit_type.sql` convention, e.g. 7-S5). The parity test remains red **only** due to pre-existing TS-ahead drift (`plan.main_swapped`, `planner.bad_output`, etc.); the 3 learning-moment values are correctly synced (verified: they appear without `+` in the diff). → **USER-SIDE GATE: `supabase db push --include-all` (migration 20260907000000).**
- Note: the story's flat `refresh()` path no longer exists in `brief-state.composer.ts` (already retired); only `refreshTree()` needed wiring — no second upsert site to update.
- Test factories (`apps/api/test/factories/index.ts` `buildBriefState`, `apps/web/.../BriefCanvas.test.tsx makeBrief`) updated to include the two new payload fields (required by the widened inferred type).

### File List

- `packages/contracts/src/plan.ts` — Modified: `LearningMomentCalloutSchema`, `LearningMomentActionSchema`, `RespondToLearningMomentRequestSchema`; 2 new `BriefStatePayloadSchema` fields
- `packages/contracts/src/plan.test.ts` — Created: 7 round-trip tests
- `packages/types/src/index.ts` — Modified: 3 type re-exports
- `apps/api/src/modules/memory/memory.repository.ts` — Modified: `findRecentTurnSourcedNodes()`
- `apps/api/src/modules/memory/memory.repository.test.ts` — Modified: 2 new tests
- `apps/api/src/modules/plans/brief-state.composer.ts` — Modified: `memoryRepository` dep; `buildLearningMomentCallout()`; `respondToLearningMoment()`; `refreshTree()` wiring
- `apps/api/src/modules/plans/brief-state.composer.tree.test.ts` — Modified: 5 new tests
- `apps/api/src/modules/plans/plans.hook.ts` — Modified: construct + pass `MemoryRepository`
- `apps/api/src/audit/audit.types.ts` — Modified: 3 new audit event types
- `apps/api/src/modules/households/households.routes.ts` — Modified: `POST .../brief/learning-moment`
- `apps/api/src/modules/households/households.routes.test.ts` — Modified: harness `briefStateComposer` option + 3 new tests
- `apps/api/test/factories/index.ts` — Modified: `buildBriefState` payload fields
- `apps/web/src/features/plan/LumiCallout.tsx` — Created
- `apps/web/src/features/plan/LumiCallout.test.tsx` — Created: 5 tests
- `apps/web/src/features/plan/BriefCanvas.tsx` — Modified: mount `<LumiCallout>`
- `apps/web/src/features/plan/BriefCanvas.test.tsx` — Modified: `makeBrief` payload fields
- `supabase/migrations/20260907000000_add_learning_moment_audit_types.sql` — Created

### Review Findings

- [x] [Review][Patch] `findRecentTurnSourcedNodes` missing `hard_forgotten = false` filter — all other active-node queries in `MemoryRepository` apply `.eq('hard_forgotten', false)`; this method omits it, allowing hard-forgotten (DB-deleted-pending) nodes to count toward the ≥3 threshold and appear in `node_ids`. Add `.eq('hard_forgotten', false)` after `.eq('household_id', householdId)`. [`apps/api/src/modules/memory/memory.repository.ts` — `findRecentTurnSourcedNodes`] ✅ Fixed
- [x] [Review][Patch] `LumiCallout.respond()` has no error handling — a network failure resets `submitting` via `finally` but never shows the user feedback; the brief query is not invalidated so the callout stays visible, but the user has no indication their tap was lost. Add a `catch` block that sets a local `error` state and shows a brief inline error message (or simply re-enables with a visible retry cue). [`apps/web/src/features/plan/LumiCallout.tsx` — `respond()`] ✅ Fixed
- [x] [Review][Defer] `refreshTree()` overwrites `learning_moment_suppressed_until` with the pre-fetch value — a plan commit running concurrently with a dismiss can read stale state and upsert `suppressed_until: null`, erasing the dismiss window; pre-existing eventual-consistency limitation of the brief_state projection pattern [`apps/api/src/modules/plans/brief-state.composer.ts` — `refreshTree()`]
- [x] [Review][Defer] Concurrent `respondToLearningMoment` calls have no optimistic lock — two simultaneous taps (two caregivers, double-tap) can both pass the `!callout` guard and write conflicting suppress states; last writer wins; pre-existing pattern for brief_state patches [`apps/api/src/modules/plans/brief-state.composer.ts` — `respondToLearningMoment()`]
- [x] [Review][Defer] `tell_more` does not set a suppress window — intentional per AC#5 ("no suppress window"); UX consequence is that the callout resurfaces on the very next `refreshTree()` if threshold is still met; acceptable per spec but worth revisiting if users find it repetitive [`apps/api/src/modules/plans/brief-state.composer.ts` — `respondToLearningMoment()`]
- [x] [Review][Defer] DB errors in `findRecentTurnSourcedNodes` are swallowed silently with no log — documented design decision (BaseRepository has no logger; composer is the log site); however the composer also produces no log when callout is null, so operators have no signal distinguishing "threshold not met" from "DB error"; consider adding a warn-level log in the composer when the repo call returns [] but the feature is expected to fire [`apps/api/src/modules/memory/memory.repository.ts` — `findRecentTurnSourcedNodes`]
- [x] [Review][Defer] `refreshTree()` always re-evaluates the callout threshold — an active callout's prose and `node_ids` can change mid-read if new nodes cross the 7-day window between refreshes; spec-documented out of scope ("Does NOT deduplicate callouts against prior surfacings") [`apps/api/src/modules/plans/brief-state.composer.ts` — `buildLearningMomentCallout()`]
- [x] [Review][Defer] Migration timestamp `20260907` is 3 months ahead of current date (June 2026) — `IF NOT EXISTS` guard makes ordering safe for enum additions, but date mismatch is cosmetic debt [`supabase/migrations/20260907000000_add_learning_moment_audit_types.sql`]
- [x] [Review][Defer] `confirm`/`tell_more` carry forward already-expired `suppressedUntil` timestamp — functionally harmless (expired timestamp never blocks future callouts); spec does not specify the behavior for non-dismiss actions on the suppress field [`apps/api/src/modules/plans/brief-state.composer.ts` — `respondToLearningMoment()`]
- [x] [Review][Defer] `aria-busy` on `div role="region"` — some screen readers do not reliably announce loading state for non-live landmark roles; buttons are individually disabled (the primary a11y guard); address when a11y audit pass runs [`apps/web/src/features/plan/LumiCallout.tsx` — component root div]

### Change Log

| Date | Change |
|------|--------|
| 2026-06-07 | Story authored: "I noticed" learning moments (5-S8). `BriefStatePayloadSchema` extension + `LumiCallout` component + `POST .../brief/learning-moment` endpoint. No migration, no new deps. |
| 2026-06-07 | Implemented all 10 tasks / 8 ACs. +22 tests (7 contracts + 10 API + 5 web), 0 new typecheck errors (API 12 / web 7 / contracts-types 1 = baselines), all suites at documented baseline. DEVIATION: added migration `20260907000000_add_learning_moment_audit_types.sql` — the 3 audit enum values are required by the DB enum for the AC#3–#5 audit writes to succeed (story's "no migration" overlooked the audit enum). USER-SIDE GATE: `supabase db push --include-all`. Status → review. |
