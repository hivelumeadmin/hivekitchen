# Story 3.17: System Adjusts on Policy/Leftover/Calendar Changes

Status: done

## Story

As a Primary Parent,
I want the system to automatically adjust affected future-day plans when school policy changes, leftover state shifts, or cultural-calendar events arrive,
So that I don't have to re-plan when the world shifts under me (FR19).

## Acceptance Criteria

1. **Given** Stories 3.16 (policy) and Epic 6 (pantry/leftovers) and 3.18 (cultural calendar) exist,
   **When** any triggering event fires,
   **Then** the orchestrator re-evaluates impacted future plans, regenerates as needed, passes through guardrail, fires SSE `plan.updated` with `<QuietDiff>` summary for scaffolding changes (loud `<AccountableError>` for safety changes).

**Dependency scope for this story:** Story 3.16 is done. Epic 6 (pantry/leftovers) and Story 3.18 (cultural calendar) are not yet built. This story implements the **event-driven plan adjustment pipeline** that wires up to those triggers. Concrete trigger implementations for leftovers and cultural calendar are deferred — this story installs the pipeline infrastructure so future stories can plug in with minimal changes.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.16: `SchoolPoliciesService.updatePolicy()` — already enqueues regen via `REGEN_QUEUE` when a policy is activated. The policy trigger is already wired.
- Story 3.13: `planRegenerationJobPlugin`, `REGEN_QUEUE`, `PlanRegenerationJobData` — regen job infrastructure; **this story reuses it**
- Story 3.11: `<QuietDiff>` — renders inline banner above Brief with one-line mutation summary
- Story 3.11: `<AccountableError>` — loud component for safety mutations (check if this component exists in 3.11 story; may be a future story)
- Story 3.6: `BriefStateComposer.refresh()` — called after each regeneration; brief_state.mutation_summary populated here
- `AUDIT_EVENT_TYPES` in `apps/api/src/audit/audit.types.ts`
- `fastify.redis` for event deduplication

**Key invariants from previous stories:**
- Guardrail runs automatically inside `PlansService.commit()` — every regen passes through it
- Scaffolding changes (safe): `<QuietDiff>` (silent banner); Safety changes (allergy-relevant): `<AccountableError>` (loud)
- SSE `plan.updated` is still deferred to Story 5.2 — clients poll via TanStack Query
- `briefStateComposer.refresh()` MUST NOT throw
- No `framer-motion`, logical-property lint rule applies throughout

---

## Tasks / Subtasks

- [x] Task 1 — Define `PlanAdjustmentTrigger` event type
- [x] Task 2 — `PlanAdjustmentService`: centralized adjustment dispatcher
- [x] Task 3 — Update `SchoolPoliciesService` to use `PlanAdjustmentService`
- [x] Task 4 — Audit event types (`plan.adjustment_triggered` added; Postgres enum migration added)
- [x] Task 5 — Register `PlanAdjustmentService` as a Fastify decorator (in `plansHook`)
- [x] Task 6 — `<QuietDiff>` integration verified — `BriefStateComposer.refresh()` already populates `scaffolding_diff` (the project's actual contract field, story 3.11)
- [x] Task 7 — Deferred trigger stubs documented in `plan-adjustment.types.ts`
- [x] Task 8 — Service tests (5 tests covering the spec scenarios)
- [x] Task 9 — Typecheck (no new errors introduced) + targeted vitest (46 tests pass across the 3 affected files)

---

### Task 1 — Define `PlanAdjustmentTrigger` event type

Create `apps/api/src/modules/plans/plan-adjustment.types.ts`:

```typescript
// Trigger event for automatic plan adjustment.
// Each trigger type has different metadata and different regeneration scopes.
export type PlanAdjustmentTriggerType =
  | 'school_policy_changed'   // Story 3.16 — already wired
  | 'pantry_leftover_changed' // Epic 6 — deferred; pipeline ready
  | 'cultural_calendar_event' // Story 3.18 — deferred; pipeline ready

export interface PlanAdjustmentTrigger {
  type: PlanAdjustmentTriggerType;
  householdId: string;
  // For slot-scoped triggers (policy), which slot is affected.
  // null = all slots (bag-wide or unknown).
  slotScope: 'bag_wide' | 'main' | 'snack' | 'extra' | null;
  // For day-scoped triggers (specific day events). null = all future days.
  dayScope: string | null; // ISO day name or null
  requestId: string;
  metadata: Record<string, unknown>;
}
```

### Task 2 — `PlanAdjustmentService`: centralized adjustment dispatcher

Create `apps/api/src/modules/plans/plan-adjustment.service.ts`:

```typescript
import type { Queue } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlansRepository } from './plans.repository.js';
import type { PlanRegenerationJobData } from '../../jobs/plan-regeneration.job.js';
import { REGEN_QUEUE } from '../../jobs/plan-regeneration.job.js';
import type { PlanAdjustmentTrigger } from './plan-adjustment.types.js';

export class PlanAdjustmentService {
  constructor(
    private readonly plansRepo: PlansRepository,
    private readonly regenQueue: Queue,
    private readonly auditService: AuditService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  // Dispatches regeneration jobs for all active future plans affected by the trigger.
  // Returns the number of plans queued.
  async triggerAdjustment(trigger: PlanAdjustmentTrigger): Promise<{
    plansQueued: number;
    planIds: string[];
  }> {
    // 1. Find all active future plans for this household.
    const futurePlans = await this.plansRepo.findActiveFuturePlanIds(trigger.householdId);

    if (futurePlans.length === 0) {
      this.logger.info(
        { trigger: trigger.type, householdId: trigger.householdId },
        'plan-adjustment: no active future plans found — no regen triggered',
      );
      return { plansQueued: 0, planIds: [] };
    }

    // 2. Enqueue regen for each affected plan.
    const queued: string[] = [];
    for (const planMeta of futurePlans) {
      try {
        const scope = trigger.dayScope !== null ? 'day' : 'week';
        await this.regenQueue.add(
          `regen-${trigger.type}`,
          {
            plan_id: planMeta.id,
            household_id: trigger.householdId,
            week_of: planMeta.week_of,
            week_id: planMeta.week_id,
            scope,
            day: trigger.dayScope ?? undefined,
            request_id: trigger.requestId,
          } satisfies PlanRegenerationJobData,
          { attempts: 2, backoff: { type: 'exponential', delay: 60_000 } },
        );
        queued.push(planMeta.id);
      } catch (err) {
        this.logger.error(
          { err, planId: planMeta.id, trigger: trigger.type },
          'plan-adjustment: failed to enqueue regen job — continuing with other plans',
        );
      }
    }

    // 3. Audit.
    try {
      await this.auditService.write({
        event_type: 'plan.adjustment_triggered',
        household_id: trigger.householdId,
        request_id: trigger.requestId,
        metadata: {
          trigger_type: trigger.type,
          slot_scope: trigger.slotScope,
          day_scope: trigger.dayScope,
          plans_queued: queued.length,
          plan_ids: queued,
          ...trigger.metadata,
        },
      });
    } catch (err) {
      this.logger.error({ err }, 'audit write failed for plan.adjustment_triggered — continuing');
    }

    return { plansQueued: queued.length, planIds: queued };
  }
}
```

### Task 3 — Update `SchoolPoliciesService` to use `PlanAdjustmentService`

Story 3.16 added direct `regenQueue.add()` calls inside `SchoolPoliciesService`. Replace those with a call to `PlanAdjustmentService.triggerAdjustment()`:

In `apps/api/src/modules/children/school-policies.service.ts`, replace the direct `regenQueue.add()` loop with:

```typescript
// Replace direct regenQueue usage with PlanAdjustmentService.
import type { PlanAdjustmentService } from '../plans/plan-adjustment.service.js';

// In constructor:
private readonly planAdjustment: PlanAdjustmentService,

// In updatePolicy(), replace the loop with:
if (opts.input.is_active && futurePlanIds.length > 0) {
  const { plansQueued, planIds } = await this.planAdjustment.triggerAdjustment({
    type: 'school_policy_changed',
    householdId: opts.householdId,
    slotScope: opts.input.slot_scope as 'bag_wide' | 'main' | 'snack' | 'extra',
    dayScope: null,
    requestId: opts.requestId,
    metadata: {
      child_id: opts.childId,
      policy_type: opts.input.policy_type,
    },
  });
  return { policy, regenerationTriggered: plansQueued > 0, affectedPlanIds: planIds };
}
```

This refactor means `SchoolPoliciesService` no longer needs direct `regenQueue` injection — it goes through `PlanAdjustmentService`. Update `school-policies.hook.ts` accordingly.

### Task 4 — Audit event types

In `apps/api/src/audit/audit.types.ts`, add:
```typescript
'plan.adjustment_triggered',
```

### Task 5 — Register `PlanAdjustmentService` as a Fastify decorator

In `apps/api/src/modules/plans/plans.hook.ts` (or a new `plan-adjustment.hook.ts`), add:

```typescript
import { PlanAdjustmentService } from './plan-adjustment.service.js';

// Inside plansHook (or a separate hook):
const planAdjustmentService = new PlanAdjustmentService(
  repository,  // PlansRepository
  fastify.bullmq.getQueue(REGEN_QUEUE),
  fastify.auditService,
  fastify.log,
);
fastify.decorate('planAdjustmentService', planAdjustmentService);
```

### Task 6 — `<QuietDiff>` integration note

The `<QuietDiff>` component (Story 3.11) already renders a one-line banner when scaffolding mutations are detected. It reads from `brief_state.mutation_summary` (populated by `BriefStateComposer.refresh()`). For policy-triggered regenerations, the `BriefStateComposer` must populate a `mutation_summary` when the plan changes differ from the previous version.

**Action:** In `apps/api/src/modules/plans/brief-state.composer.ts`, verify that `BriefStateComposer.refresh()` populates a `mutation_summary` field in `brief_state` when the plan revision changes. If not, add:

```typescript
// In refresh(), after comparing new planItems to previous:
const hasChanges = /* detect if plan items differ from previous revision */;
if (hasChanges) {
  briefRow.mutation_summary = 'Lumi updated some meals to match your school\'s food policy.';
}
```

The actual diff detection and summary generation logic depends on the `brief_state` schema. Check the 3.6 migration and `brief-state.composer.ts` to understand what fields are available.

### Task 7 — Deferred trigger stubs

In `apps/api/src/modules/plans/plan-adjustment.service.ts`, add stub comments for future triggers:

```typescript
// HOW TO WIRE A NEW TRIGGER:
// 1. Import PlanAdjustmentService in the triggering service.
// 2. Call planAdjustmentService.triggerAdjustment({ type: '<new_type>', ... }).
// 3. Add the new event type to AUDIT_EVENT_TYPES.
// 4. Add the type to PlanAdjustmentTriggerType union.
//
// Deferred triggers:
// - 'pantry_leftover_changed': Epic 6 pantry service calls triggerAdjustment after leftover
//   state write. Pass dayScope=null (all future days), slotScope=null.
// - 'cultural_calendar_event': Story 3.18 cultural calendar service calls triggerAdjustment
//   for relevant dates. Pass dayScope=<affected ISO day names>, slotScope=null.
```

### Task 8 — Service tests

In `apps/api/src/modules/plans/plan-adjustment.service.test.ts`:
- `triggerAdjustment()` with no future plans → returns `{ plansQueued: 0, planIds: [] }`, no queue.add calls
- `triggerAdjustment()` with 2 future plans → calls `regenQueue.add` twice, returns `plansQueued: 2`
- `triggerAdjustment()` with one queue.add failure → continues to next plan, partial success
- Audit write called on success
- Audit write failure does NOT rethrow

### Task 9 — Typecheck

- `pnpm --filter @hivekitchen/api typecheck`
- `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans/plan-adjustment.service`

---

## Dev Notes

### SSE `plan.updated` is still deferred

The acceptance criteria mentions "fires SSE `plan.updated`." SSE emission is still deferred to Story 5.2 (as documented in Story 3.13). The brief_state projection is updated synchronously by `BriefStateComposer.refresh()` inside `PlansService.commit()`. Clients poll TanStack Query. `<QuietDiff>` will appear on the next poll when `brief_state.mutation_summary` is populated. Add to `deferred-work.md` if not already there.

### `<AccountableError>` for safety changes

The acceptance criteria says safety changes should trigger `<AccountableError>` (loud). The guardrail already blocks allergen-introducing regenerations. If a policy change causes a guardrail rejection (unlikely but possible if a new ingredient is now blocked), the `PlansService.commit()` error path should surface this. The `PlanAdjustmentService` does not need special-case logic — the existing guardrail + audit chain handles it.

### Epic 6 and 3.18 trigger wiring

When Epic 6 and Story 3.18 are implemented, they wire triggers by:
1. Injecting `planAdjustmentService` into their respective services via the Fastify decorator.
2. Calling `planAdjustmentService.triggerAdjustment(...)` after their state change commits.
3. No changes to `PlanAdjustmentService` itself — it's open for extension.

### Regen deduplication

Multiple triggers firing in quick succession (e.g., 3 policy updates in 5 seconds) could enqueue multiple regen jobs for the same plan. BullMQ's `jobId` deduplication (from Story 3.13) helps if the same requestId is used. Consider adding a Redis-based debounce (10s window) per `(householdId, planId)` to avoid redundant regenerations. Defer to `deferred-work.md` for now.

---

## Project Structure

**New files:**
```
apps/api/src/modules/plans/plan-adjustment.types.ts
apps/api/src/modules/plans/plan-adjustment.service.ts
apps/api/src/modules/plans/plan-adjustment.service.test.ts
```

**Modified files:**
```
apps/api/src/audit/audit.types.ts                           + plan.adjustment_triggered
apps/api/src/modules/plans/plans.hook.ts                    + PlanAdjustmentService decorator
apps/api/src/modules/children/school-policies.service.ts    + use PlanAdjustmentService instead of direct regenQueue
apps/api/src/modules/children/school-policies.hook.ts       + inject planAdjustmentService
apps/api/src/modules/plans/brief-state.composer.ts          + mutation_summary population (verify needed)
_bmad-output/implementation-artifacts/sprint-status.yaml    3-17 → ready-for-dev
_bmad-output/implementation-artifacts/deferred-work.md      + regen deduplication note
```

**Do NOT touch:**
```
apps/api/src/jobs/plan-regeneration.job.ts  (no changes — reuse as-is)
apps/api/src/modules/plans/plans.service.ts (no changes — guardrail runs in commit())
```

---

## Dev Agent Record

### Implementation Plan

- **Pipeline shape:** new `PlanAdjustmentService` owns the regen fanout end-to-end (find future plans → enqueue per-plan jobs with dedupe → audit). Trigger sources stay stateless about regen plumbing — they pass a typed `PlanAdjustmentTrigger` and read back `{ plansQueued, enqueuedPlanIds, failedPlanIds }`.
- **Refactor of 3.16:** `SchoolPoliciesService` no longer holds `plansRepository` or `regenQueue`; it depends on `PlanAdjustmentService` only. The fanout-level audit (`plan.policy_regeneration_triggered`) was replaced by the new `plan.adjustment_triggered` event with `metadata.trigger_type='school_policy_changed'` so future causes (leftovers, calendar) reuse the same event family.
- **Wiring:** `plansHook` constructs and decorates `planAdjustmentService` (uses the `PlansRepository` already created there, plus the shared `REGEN_QUEUE`). `childrenRoutes` now requires the decorator and consumes it directly instead of re-instantiating plans plumbing.
- **Job dedupe:** BullMQ `jobId` is `adjust-<type>-<household>-<weekId>-<dayScope|'week'>` so a duplicate webhook or retried PATCH collapses to one job per affected plan; `request_id` is intentionally excluded from the key (otherwise retries would defeat dedup).
- **Day-scope path:** `dayScope!=null` → `scope='day'`, `day=<weekday>` in the job; otherwise `scope='week'`. Slot-scope partial regen is still deferred (carried over from 3.16's deferred-work).

### Completion Notes

- ✅ All ACs satisfied: trigger fires regen for impacted future plans, jobs reuse the existing `REGEN_QUEUE` worker (which routes the commit through the guardrail in `PlansService.commit()`), and `<QuietDiff>` already picks up the resulting scaffolding mutation via `brief_state.scaffolding_diff` populated inside `BriefStateComposer.refresh()`.
- ✅ Two of the three deferred triggers (`pantry_leftover_changed`, `cultural_calendar_event`) are pre-wired in the type union — Epic 6 / Story 3.18 just inject `planAdjustmentService` and call `triggerAdjustment()`.
- ⚠️ The story spec mentions a `mutation_summary` field; the actual contract field is `scaffolding_diff` (added in Story 3.11). No code change was needed for "Task 6" — verified the existing path.
- ⚠️ Sprint-wide pre-existing typecheck errors in unrelated test files (`plan-regeneration.job.test.ts`, `households.routes.test.ts`, `brief-state.composer.test.ts`, `plans.service.test.ts`, `voice.service.test.ts`) and one pre-existing failing test (`memory.service.test.ts`) are present on `main` before this story — confirmed via `git stash` baseline. None are introduced by this story.
- SSE `plan.updated` emission for adjustment-triggered regen remains deferred to Story 5.2 (same constraint as 3.13/3.16); clients see updates via TanStack Query polling.

### File List

**New files:**
- `apps/api/src/modules/plans/plan-adjustment.types.ts`
- `apps/api/src/modules/plans/plan-adjustment.service.ts`
- `apps/api/src/modules/plans/plan-adjustment.service.test.ts`
- `supabase/migrations/20260700000200_add_plan_adjustment_audit_type.sql`

**Modified files:**
- `apps/api/src/audit/audit.types.ts` — added `'plan.adjustment_triggered'`
- `apps/api/src/types/fastify.d.ts` — added `planAdjustmentService` decorator type
- `apps/api/src/modules/plans/plans.hook.ts` — constructs + decorates `planAdjustmentService`
- `apps/api/src/modules/children/school-policies.service.ts` — refactored to depend on `PlanAdjustmentService`
- `apps/api/src/modules/children/school-policies.service.test.ts` — updated mocks/assertions for new dependency
- `apps/api/src/modules/children/children.routes.ts` — consumes `fastify.planAdjustmentService` decorator
- `apps/api/src/modules/children/children.routes.test.ts` — registers a real `PlanAdjustmentService` against the mocked supabase + bullmq + audit; updated audit assertion to `plan.adjustment_triggered`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 3-17 → `review`
- `_bmad-output/implementation-artifacts/deferred-work.md` — appended 3-17 deferred items

---

## Review Findings (2026-05-05)

- [x] [Review][Patch] `trigger.metadata` spread after named audit fields — a caller passing `trigger_type`, `slot_scope`, `day_scope`, `enqueued_plan_ids`, or `failed_plan_ids` in metadata silently overwrites the first-class audit keys [`plan-adjustment.service.ts:103-111`]
- [x] [Review][Patch] `findActiveFuturePlanIds` rejection propagates uncaught out of `triggerAdjustment` — a DB error after the policy upsert returns 500 to the HTTP caller with the policy committed but no regen queued [`plan-adjustment.service.ts:41`]
- [x] [Review][Patch] Missing `hasDecorator('planAdjustmentService')` guard in `plansHook` before decorating — double-registration produces a cryptic Fastify error instead of the clear guard message used for `briefStateComposer` [`plans.hook.ts:60`]
- [x] [Review][Patch] Missing test: all enqueues fail → audit still fires with correct `failedPlanIds` — the "0 plans queued, all failed" branch is untested; distinct from the "no future plans" early-return branch that skips audit [`plan-adjustment.service.test.ts`]
- [x] [Review][Defer] `slotScope` not forwarded to job data — intentional, slot-level partial regen is deferred; already in deferred-work.md from 3.16 [`plan-adjustment.service.ts:58`, `plan-adjustment.types.ts`]
- [x] [Review][Defer] Sunday UTC boundary includes current week in `findActiveFuturePlanIds` — pre-existing UTC math issue, already in deferred-work.md [`plans.repository.ts:findActiveFuturePlanIds`]
- [x] [Review][Defer] `dayScope` is untyped `string` with no validation — arbitrary strings forwarded to the regen worker fail silently; deferred until Story 3.18 wires day-scoped triggers [`plan-adjustment.types.ts:dayScope`]
- [x] [Review][Defer] TOCTOU: `current_revision` captured at enqueue time may be superseded — pre-existing revision race, already in deferred-work.md [`plan-adjustment.service.ts:69`]
- [x] [Review][Defer] `plan.policy_regeneration_triggered` is a dead audit event type with no surviving callsite — cleanup deferred per deferred-work.md note [`audit.types.ts:6`]
- [x] [Review][Defer] Partial enqueue failures not surfaced to the HTTP caller — `regeneration_triggered: true` returned even when some plans failed to queue; full failure breakdown is audited [`plan-adjustment.service.ts`, `children.routes.ts`]
- [x] [Review][Defer] `scaffolding_diff` post-adjustment-regen population not integration-tested — AC6 verified by prose only; no test asserts `brief_state.scaffolding_diff` is non-null after a policy-triggered regen [`plan-adjustment.service.ts`]
- [x] [Review][Defer] Partial-failure test's `failedPlanIds` assertion assumes stable `findActiveFuturePlanIds` iteration order — pre-existing no-ORDER-BY issue already in deferred-work.md [`plan-adjustment.service.test.ts:146-168`]

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.17 created — ready-for-dev. |
| 2026-05-05 | Amelia (dev) | Implemented PlanAdjustmentService pipeline; refactored 3.16 to use it; status → review. |
| 2026-05-05 | Claude (review) | Code review (4 patches applied — metadata spread ordering, repo-query error handling, hasDecorator guard, missing all-fail test + repo-throw test). Status → done. |
