# Story 3.16: School-Policy Update + Propagation

Status: review

## Story

As a Primary Parent,
I want to update declared school-policy constraints (nut-free rule, no-heating rule) and have the changes propagate through all affected future plans,
So that policy changes silently regenerate impacted days without my re-planning (FR22).

## Acceptance Criteria

1. **Given** I am authenticated,
   **When** I update school policy via `PATCH /v1/children/:id/school-policies`,
   **Then** affected future `plan_items` are flagged for regeneration; per-slot policy scoping (FR112) regenerates only items in the targeted slot for affected days.

2. **And** affected plans pass through guardrail; SSE `plan.updated` fires.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 2.12: `per_child_lunch_bag_slot_declaration` — `children` table has `lunch_bag_slots JSONB`, per-child slot declarations; `school_policies` table already exists with `child_id, policy_type, policy_scope` columns (verify exact schema in 2-12 story file)
- Story 3.1: `AllergyGuardrailService.clearOrReject()` — used after regeneration
- Story 3.5: `PlansService.commit()`, `PlansRepository` — plan commit with guardrail integration
- Story 3.7: `planGenerationJobPlugin`, `GENERATE_QUEUE`, `deriveWeekId()` — BullMQ job infrastructure
- Story 3.13: `planRegenerationJobPlugin`, `REGEN_QUEUE`, `PlanRegenerationJobData` — existing regen job infrastructure; **REUSE this for policy-triggered regen**
- Story 3.13: `PlansRepository.findByHouseholdAndWeek()` (from 3.14 actually) or `findItemsByPlanId()` for finding affected plan items
- `AUDIT_EVENT_TYPES` in `apps/api/src/audit/audit.types.ts` — check if `'school_policy.updated'` and `'plan.policy_regeneration_triggered'` exist; add if missing
- `fastify.redis` — ioredis instance registered by `ioredisPlugin`
- `authorize(['primary_parent'])` — Secondary Caregivers cannot change school policies (policy change is a household-level decision)

**Key invariants from previous stories:**
- Plan regeneration uses `planRegenerationJobPlugin` (REGEN_QUEUE) — do NOT create a new job type; pass `scope='day'` or `scope='week'` to the existing infrastructure
- Presentation layer always reads `WHERE guardrail_cleared_at IS NOT NULL`
- All DB access through API only — never from agent layer
- `briefStateComposer.refresh()` MUST NOT throw
- No `framer-motion` — Tailwind animation utilities only
- Logical-property lint rule: `start-*`/`end-*` — no `left-*`/`right-*`
- `import type` for all type-only imports

---

## Tasks / Subtasks

### Task 1 — DB Migration: add `slot_scope` to `school_policies`

Create `supabase/migrations/20260700000000_add_slot_scope_to_school_policies.sql`:

```sql
-- Story 3.16 + FR112: per-slot policy scoping. A policy rule can target
-- bag_wide (all slots), main, snack, or extra. When a policy changes,
-- only items in the matching slot are regenerated — not the whole plan.
-- DEFAULT 'bag_wide' for backward compatibility with existing rows.
DO $$ BEGIN
  CREATE TYPE slot_scope_enum AS ENUM ('bag_wide', 'main', 'snack', 'extra');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE school_policies
  ADD COLUMN IF NOT EXISTS slot_scope slot_scope_enum NOT NULL DEFAULT 'bag_wide';

-- Index: fetch active policies for a child quickly.
CREATE INDEX IF NOT EXISTS idx_school_policies_child_id
  ON school_policies(child_id)
  WHERE NOT is_deleted; -- adjust to match actual deletion pattern in your table
```

**Before writing this migration:** Check the actual `school_policies` table schema (created in Story 2.12's migration). Verify the column names and whether a soft-delete pattern exists. Adjust the index condition accordingly.

### Task 2 — Contracts: add school-policy update schemas

In `packages/contracts/src/` — create a new file `school-policy.ts` (or add to `children.ts` if that exists):

```typescript
import { z } from 'zod';

export const SlotScopeSchema = z.enum(['bag_wide', 'main', 'snack', 'extra']);

export const SchoolPolicySchema = z.object({
  id: z.string().uuid(),
  child_id: z.string().uuid(),
  policy_type: z.string().min(1).max(100), // e.g., 'nut_free', 'no_heating'
  policy_description: z.string().max(500).nullable(),
  slot_scope: SlotScopeSchema,
  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// PATCH /v1/children/:id/school-policies body
// policy_type identifies which rule to upsert; slot_scope and is_active can be updated.
export const UpdateSchoolPolicyInputSchema = z.object({
  policy_type: z.string().min(1).max(100),
  policy_description: z.string().max(500).optional(),
  slot_scope: SlotScopeSchema.default('bag_wide'),
  is_active: z.boolean(),
});

export const UpdateSchoolPolicyResponseSchema = z.object({
  policy: SchoolPolicySchema,
  regeneration_triggered: z.boolean(), // true if active future plans were queued for regen
  affected_plan_ids: z.array(z.string().uuid()),
});

export const ChildIdParamSchema = z.object({
  id: z.string().uuid(), // child_id
});
```

Export from `packages/contracts/src/index.ts`. Add types to `packages/types/src/index.ts`:
```typescript
export type SlotScope = z.infer<typeof SlotScopeSchema>;
export type SchoolPolicy = z.infer<typeof SchoolPolicySchema>;
export type UpdateSchoolPolicyInput = z.infer<typeof UpdateSchoolPolicyInputSchema>;
export type UpdateSchoolPolicyResponse = z.infer<typeof UpdateSchoolPolicyResponseSchema>;
```

### Task 3 — SchoolPoliciesRepository

Create `apps/api/src/modules/children/school-policies.repository.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SchoolPolicy } from '@hivekitchen/types';

const POLICY_COLUMNS = 'id, child_id, policy_type, policy_description, slot_scope, is_active, created_at, updated_at';

export class SchoolPoliciesRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsertPolicy(opts: {
    childId: string;
    policyType: string;
    policyDescription: string | null;
    slotScope: string;
    isActive: boolean;
  }): Promise<SchoolPolicy> {
    const { data, error } = await this.client
      .from('school_policies')
      .upsert(
        {
          child_id: opts.childId,
          policy_type: opts.policyType,
          policy_description: opts.policyDescription,
          slot_scope: opts.slotScope,
          is_active: opts.isActive,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'child_id,policy_type' },
      )
      .select(POLICY_COLUMNS)
      .single();
    if (error) throw error;
    return data as SchoolPolicy;
  }

  // Find all active policies for a child (for validation and prompt context).
  async findActiveByChildId(childId: string): Promise<SchoolPolicy[]> {
    const { data, error } = await this.client
      .from('school_policies')
      .select(POLICY_COLUMNS)
      .eq('child_id', childId)
      .eq('is_active', true);
    if (error) throw error;
    return (data ?? []) as SchoolPolicy[];
  }
}
```

### Task 4 — Find active future plans for a child's household

In `apps/api/src/modules/plans/plans.repository.ts`, add:

```typescript
// Returns plan IDs for plans that have not yet passed (week_of >= today's week).
// Used by policy propagation to find which future plans need regeneration.
async findActiveFuturePlanIds(householdId: string): Promise<string[]> {
  const todayWeekMonday = new Date();
  const day = todayWeekMonday.getUTCDay();
  todayWeekMonday.setUTCDate(todayWeekMonday.getUTCDate() - (day === 0 ? 6 : day - 1));
  const weekOfFloor = todayWeekMonday.toISOString().slice(0, 10);

  const { data, error } = await this.client
    .from('plans')
    .select('id, week_id, week_of')
    .eq('household_id', householdId)
    .gte('week_of', weekOfFloor)
    .not('guardrail_cleared_at', 'is', null);
  if (error) throw error;
  return (data ?? []).map((row) => row.id as string);
}
```

### Task 5 — SchoolPoliciesService

Create `apps/api/src/modules/children/school-policies.service.ts`:

```typescript
import type { Queue } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';
import type { SchoolPoliciesRepository } from './school-policies.repository.js';
import type { PlansRepository } from '../plans/plans.repository.js';
import type { UpdateSchoolPolicyInput, SchoolPolicy } from '@hivekitchen/types';
import type { PlanRegenerationJobData } from '../../jobs/plan-regeneration.job.js';
import { REGEN_QUEUE } from '../../jobs/plan-regeneration.job.js';

export class SchoolPoliciesService {
  constructor(
    private readonly repo: SchoolPoliciesRepository,
    private readonly plansRepo: PlansRepository,
    private readonly regenQueue: Queue,
    private readonly auditService: AuditService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async updatePolicy(opts: {
    childId: string;
    householdId: string;
    input: UpdateSchoolPolicyInput;
    requestId: string;
  }): Promise<{ policy: SchoolPolicy; regenerationTriggered: boolean; affectedPlanIds: string[] }> {
    // 1. Upsert the policy.
    const policy = await this.repo.upsertPolicy({
      childId: opts.childId,
      policyType: opts.input.policy_type,
      policyDescription: opts.input.policy_description ?? null,
      slotScope: opts.input.slot_scope,
      isActive: opts.input.is_active,
    });

    // 2. Audit the policy change.
    try {
      await this.auditService.write({
        event_type: 'school_policy.updated',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          child_id: opts.childId,
          policy_type: opts.input.policy_type,
          slot_scope: opts.input.slot_scope,
          is_active: opts.input.is_active,
        },
      });
    } catch (err) {
      this.logger.error({ err }, 'audit write failed for school_policy.updated — continuing');
    }

    // 3. If policy is active, queue regeneration of affected future plans.
    // If deactivated, no regen needed (removing a constraint is safe — existing plans remain valid).
    if (!opts.input.is_active) {
      return { policy, regenerationTriggered: false, affectedPlanIds: [] };
    }

    const futurePlanIds = await this.plansRepo.findActiveFuturePlanIds(opts.householdId);
    if (futurePlanIds.length === 0) {
      return { policy, regenerationTriggered: false, affectedPlanIds: [] };
    }

    // Enqueue week-scope regen for each affected plan.
    // Per FR112: slot_scope determines which items regenerate — the orchestrator
    // prompt must be updated to respect slot_scope (see Dev Notes).
    // For MVP: enqueue full-week scope regen; the slot_scope is passed in metadata
    // so the planner agent can use it as a constraint.
    for (const planId of futurePlanIds) {
      try {
        await this.regenQueue.add(
          'regenerate-plan-policy',
          {
            plan_id: planId,
            household_id: opts.householdId,
            // week_of and week_id must be fetched from the plan row.
            // IMPORTANT: the PlanRegenerationJobData requires week_of and week_id.
            // Since findActiveFuturePlanIds returns only id, we need to fetch the plan.
            // For now, use a separate lookup. See Dev Notes.
            week_of: '', // populated below in the enhanced version
            week_id: '', // populated below
            scope: 'week',
            request_id: opts.requestId,
          } satisfies Omit<PlanRegenerationJobData, 'week_of' | 'week_id'> & { week_of: string; week_id: string },
          { attempts: 2, backoff: { type: 'exponential', delay: 60_000 } },
        );
      } catch (err) {
        this.logger.error({ err, planId }, 'failed to enqueue policy regen for plan — continuing');
      }
    }

    return { policy, regenerationTriggered: true, affectedPlanIds: futurePlanIds };
  }
}
```

**IMPORTANT — week_of/week_id resolution:** `findActiveFuturePlanIds` only returns plan IDs. The regeneration job requires `week_of` and `week_id`. Update `findActiveFuturePlanIds()` to return `Array<{ id: string; week_of: string; week_id: string }>` instead of just `string[]`. Then the service can pass the correct values to the job.

Update Task 4's `findActiveFuturePlanIds` signature:
```typescript
async findActiveFuturePlanIds(householdId: string): Promise<Array<{ id: string; week_id: string; week_of: string }>>
// Return data.map((row) => ({ id: row.id, week_id: row.week_id, week_of: row.week_of ?? '' }));
```

And update the service loop accordingly:
```typescript
for (const planMeta of futurePlanIds) {
  await this.regenQueue.add('regenerate-plan-policy', {
    plan_id: planMeta.id,
    household_id: opts.householdId,
    week_of: planMeta.week_of,
    week_id: planMeta.week_id,
    scope: 'week',
    request_id: opts.requestId,
  } satisfies PlanRegenerationJobData, { ... });
}
```

### Task 6 — Route: `PATCH /v1/children/:id/school-policies`

Create or add to `apps/api/src/modules/children/children.routes.ts`:

```typescript
import {
  UpdateSchoolPolicyInputSchema,
  UpdateSchoolPolicyResponseSchema,
  ChildIdParamSchema,
} from '@hivekitchen/contracts';

// PATCH /v1/children/:id/school-policies
// Primary Parent only — policy changes are household-level decisions.
fastify.patch(
  '/v1/children/:id/school-policies',
  {
    preHandler: authorize(['primary_parent']),
    schema: {
      params: ChildIdParamSchema,
      body: UpdateSchoolPolicyInputSchema,
      response: { 200: UpdateSchoolPolicyResponseSchema },
    },
  },
  async (request, reply) => {
    const { id: childId } = request.params as { id: string };
    const body = request.body as UpdateSchoolPolicyInput;

    // Verify child belongs to this household (RLS + application-layer check).
    // TODO: Add a ChildrenRepository.verifyOwnership(childId, householdId) call.
    // This prevents a Primary Parent updating another household's child via the URL.

    const { policy, regenerationTriggered, affectedPlanIds } =
      await fastify.schoolPoliciesService.updatePolicy({
        childId,
        householdId: request.user.household_id,
        input: body,
        requestId: request.id,
      });

    return reply.send({
      policy,
      regeneration_triggered: regenerationTriggered,
      affected_plan_ids: affectedPlanIds,
    });
  },
);
```

### Task 7 — Frontend: school policy settings UI

In `apps/web/src/features/children/SchoolPoliciesForm.tsx` (or wherever child settings are rendered):

```typescript
// A minimal form for toggling school policies.
// Each policy has a policy_type (display name), slot_scope selector, and is_active toggle.

import { useState } from 'react';
import { hkFetch } from '../../lib/fetch.js';
import type { UpdateSchoolPolicyInput } from '@hivekitchen/types';

const COMMON_POLICY_TYPES = [
  { type: 'nut_free', label: 'Nut-free' },
  { type: 'no_heating', label: 'No heating / cold-only' },
  { type: 'no_pork', label: 'No pork' },
  { type: 'no_shellfish', label: 'No shellfish' },
  { type: 'vegetarian', label: 'Vegetarian only' },
] as const;

// Renders the school policy form for a child.
// Calls PATCH /v1/children/:childId/school-policies for each policy toggle.
export function SchoolPoliciesForm({ childId }: { childId: string }) {
  const [saving, setSaving] = useState(false);

  async function togglePolicy(policyType: string, isActive: boolean) {
    setSaving(true);
    try {
      await hkFetch(`/v1/children/${childId}/school-policies`, {
        method: 'PATCH',
        body: JSON.stringify({
          policy_type: policyType,
          slot_scope: 'bag_wide',
          is_active: isActive,
        } satisfies UpdateSchoolPolicyInput),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-scope flex flex-col gap-3">
      <h2 className="font-serif text-[18px] text-stone-800">School food policies</h2>
      {COMMON_POLICY_TYPES.map(({ type, label }) => (
        <label key={type} className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            disabled={saving}
            onChange={(e) => void togglePolicy(type, e.target.checked)}
            className="h-4 w-4 rounded border-stone-300 text-stone-800 focus:ring-stone-400"
          />
          <span className="font-sans text-[15px] text-stone-700">{label}</span>
        </label>
      ))}
      {saving && (
        <p className="font-sans text-[13px] text-stone-400">Saving and updating plans…</p>
      )}
    </div>
  );
}
```

**Note:** This is a minimal implementation. The full UI should load existing policies from `GET /v1/children/:id/school-policies` (add that route if it doesn't exist) and show current state. The form above only handles toggling — loading existing state is needed for a complete implementation.

### Task 8 — Add `GET /v1/children/:id/school-policies` route

```typescript
fastify.get(
  '/v1/children/:id/school-policies',
  {
    preHandler: authorize(['primary_parent', 'secondary_caregiver']),
    schema: {
      params: ChildIdParamSchema,
      response: { 200: z.object({ policies: z.array(SchoolPolicySchema) }) },
    },
  },
  async (request, reply) => {
    const { id: childId } = request.params as { id: string };
    const policies = await fastify.schoolPoliciesService.getPoliciesForChild(childId);
    return reply.send({ policies });
  },
);
```

Add `getPoliciesForChild()` to `SchoolPoliciesService`:
```typescript
async getPoliciesForChild(childId: string): Promise<SchoolPolicy[]> {
  return this.repo.findActiveByChildId(childId);
}
```

### Task 9 — Audit event types

In `apps/api/src/audit/audit.types.ts`, add to `AUDIT_EVENT_TYPES` if not already present:
```typescript
'school_policy.updated',
'plan.policy_regeneration_triggered',
```

### Task 10 — Register `SchoolPoliciesService` in app

Create `apps/api/src/modules/children/school-policies.hook.ts`:

```typescript
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { SchoolPoliciesRepository } from './school-policies.repository.js';
import { SchoolPoliciesService } from './school-policies.service.js';
import { REGEN_QUEUE } from '../../jobs/plan-regeneration.job.js';

const schoolPoliciesHook: FastifyPluginAsync = async (fastify) => {
  const repo = new SchoolPoliciesRepository(fastify.supabase);
  const service = new SchoolPoliciesService(
    repo,
    fastify.plansRepository,  // verify this decorator exists; may need to expose repo separately
    fastify.bullmq.getQueue(REGEN_QUEUE),
    fastify.auditService,
    fastify.log,
  );
  fastify.decorate('schoolPoliciesService', service);
};

export const schoolPoliciesHookPlugin = fp(schoolPoliciesHook, { name: 'school-policies-hook' });
```

**Note:** If `fastify.plansRepository` is not directly decorated (it may be an internal dep of `plansService`), expose the repository via a decorator in `plans.hook.ts` or pass it through a different mechanism. Avoid exposing raw repositories to routes — keep them inside services.

Register `schoolPoliciesHookPlugin` in `apps/api/src/app.ts` after `plansHook`.

### Task 11 — Contract + API tests

- `UpdateSchoolPolicyInputSchema` parses valid body; rejects missing `policy_type`
- `SchoolPoliciesService.updatePolicy()` — deactivation does NOT enqueue regen
- `SchoolPoliciesService.updatePolicy()` — activation with future plans enqueues regen jobs
- `SchoolPoliciesService.updatePolicy()` — no future plans → `regeneration_triggered: false`

### Task 12 — Typecheck and tests

- `pnpm --filter @hivekitchen/contracts typecheck && pnpm --filter @hivekitchen/contracts test`
- `pnpm --filter @hivekitchen/api typecheck`
- `pnpm --filter @hivekitchen/web typecheck`

---

## Dev Notes

### Per-slot policy scoping (FR112)

The acceptance criteria says "per-slot policy scoping regenerates only items in the targeted slot." The current `PlanRegenerationJobData` supports `scope: 'week' | 'day'` — there is no `scope: 'slot'`. For MVP, enqueue `scope: 'week'` regeneration and pass `slot_scope` in metadata so the planner prompt can respect it as a constraint. The orchestrator will regenerate the entire week but the LLM prompt should say "the nut_free policy now applies to the snack slot only." Full slot-level partial regeneration (only re-plan snack items) is a more complex infrastructure change — defer to a follow-up story and add to `deferred-work.md`.

### Household ownership verification for child

The `PATCH /v1/children/:id` route must verify that `childId` belongs to `request.user.household_id`. Supabase RLS provides database-level protection, but an application-layer check prevents confused-deputy issues. Add a `ChildrenRepository.verifyChildBelongsToHousehold(childId, householdId)` call in the route handler. If RLS is configured correctly, the upsert will simply affect 0 rows (and the `.single()` will error) — but explicit ownership check makes the intent clear.

### SSE `plan.updated` for policy-triggered regen

The acceptance criteria says "SSE `plan.updated` fires." SSE emission is handled inside the existing `planRegenerationJobPlugin` worker (from Story 3.13) — but Story 3.13 deferred SSE to Story 5.2. Until 5.2 ships, clients will see the update via TanStack Query polling (same as 3.13). Add a note to `deferred-work.md` if not already there.

### `school_policies` table schema uncertainty

This story assumes the `school_policies` table exists from Story 2.12 with columns `child_id`, `policy_type`, `is_active`, etc. Read the 2-12 story file and the actual migration file to verify the exact schema before writing the `SchoolPoliciesRepository`. The upsert conflict key `(child_id, policy_type)` may need a unique constraint migration if it doesn't exist.

---

## Project Structure

**New files:**
```
supabase/migrations/20260700000000_add_slot_scope_to_school_policies.sql
packages/contracts/src/school-policy.ts
apps/api/src/modules/children/school-policies.repository.ts
apps/api/src/modules/children/school-policies.service.ts
apps/api/src/modules/children/school-policies.service.test.ts
apps/api/src/modules/children/school-policies.hook.ts
apps/web/src/features/children/SchoolPoliciesForm.tsx
apps/web/src/features/children/SchoolPoliciesForm.test.tsx
```

**Modified files:**
```
packages/contracts/src/index.ts                         + export school-policy schemas
packages/types/src/index.ts                             + SlotScope, SchoolPolicy, UpdateSchoolPolicyInput, UpdateSchoolPolicyResponse
apps/api/src/audit/audit.types.ts                       + school_policy.updated, plan.policy_regeneration_triggered (if missing)
apps/api/src/modules/plans/plans.repository.ts          + findActiveFuturePlanIds()
apps/api/src/modules/children/children.routes.ts         + PATCH + GET school-policies routes
apps/api/src/app.ts                                     + schoolPoliciesHookPlugin registration
_bmad-output/implementation-artifacts/sprint-status.yaml  3-16 → ready-for-dev
```

**Do NOT touch:**
```
apps/api/src/jobs/plan-regeneration.job.ts  (reuse existing REGEN_QUEUE infrastructure)
apps/api/src/modules/allergy-guardrail/    (guardrail runs automatically inside PlansService.commit)
```

---

---

## Tasks Completion

- [x] Task 1 — DB Migration: create `school_policies` table (the table was deferred from Story 2.10; not just a column add). Includes `slot_scope_enum`, unique `(child_id, policy_type)` index, child_id index, `set_updated_at` trigger, and RLS enabled.
- [x] Task 2 — Contracts: `SlotScopeSchema`, `SchoolPolicySchema`, `UpdateSchoolPolicyInputSchema` (`.strict()`), `UpdateSchoolPolicyResponseSchema`, `GetSchoolPoliciesResponseSchema`, `SchoolPolicyChildIdParamSchema`. Re-exported via `packages/contracts/src/index.ts`. Inferred types added to `packages/types/src/index.ts`.
- [x] Task 3 — `SchoolPoliciesRepository.upsertPolicy()` + `findActiveByChildId()`.
- [x] Task 4 — `PlansRepository.findActiveFuturePlanIds(householdId)` returning `{ id, week_id, week_of, revision }[]`. Filters to cleared rows whose `week_of >= current Monday (UTC)`. Internally uses a small `currentWeekMondayUtc()` helper to avoid importing from PlansService (would create a circular dep).
- [x] Task 5 — `SchoolPoliciesService.updatePolicy()` + `getPoliciesForChild()`. Verifies child belongs to household via `ChildrenRepository.findById` (matches Story 2.12 pattern). Activation enqueues one regen job per cleared future plan with full `PlanRegenerationJobData` shape (`current_revision` is fetched from the plan row). Per-plan enqueue failures are logged but don't block siblings.
- [x] Task 6 — `PATCH /v1/children/:id/school-policies` (`primary_parent` only).
- [x] Task 7 — Web `SchoolPoliciesForm` (loads existing policies via GET, toggles via PATCH, displays "Saved. Updating future plans now." when regeneration triggers).
- [x] Task 8 — `GET /v1/children/:id/school-policies` (`primary_parent` + `secondary_caregiver`).
- [x] Task 9 — Audit event types `school_policy.updated` and `plan.policy_regeneration_triggered` added to TS `AUDIT_EVENT_TYPES` and Postgres `audit_event_type` enum migration.
- [x] Task 10 — Service wiring lives inline in `children.routes.ts` (matches the existing Story 2.12 pattern of constructing per-route services in the plugin) rather than a separate `school-policies.hook.ts`. This keeps the SchoolPoliciesService scoped to the children-routes plugin and avoids exposing yet another fastify decorator. Plumbed `bullmq.getQueue(REGEN_QUEUE)`, `auditService`, and a fresh `PlansRepository(supabase)`.
- [x] Task 11 — Tests: 21 contract tests, 9 service tests, 12 new route tests (in `children.routes.test.ts`).
- [x] Task 12 — `pnpm typecheck` clean for all my files; pre-existing failures elsewhere (memory/voice/plan-regeneration test files) are documented and unchanged.

## Dev Agent Record

### Agent Model Used
claude-opus-4-7 (1M context)

### Debug Log References

- `pnpm --filter @hivekitchen/contracts typecheck` — clean.
- `pnpm --filter @hivekitchen/contracts test -- school-policy` — 21 / 21 pass.
- `pnpm --filter @hivekitchen/api typecheck` — pre-existing test-file errors only (memory.service.test, plan-regeneration.job.test, brief-state.composer.test, plans.service.test, voice.service.test, households.routes.test). None touch Story 3.16 code paths; verified by checking `git stash` on a clean tree reproduces the same set.
- `pnpm --filter @hivekitchen/api test -- school-policies` — 9 / 9 pass.
- `pnpm --filter @hivekitchen/api test -- children.routes` — 32 / 32 pass (20 prior + 12 new for school-policies).
- `pnpm --filter @hivekitchen/api lint` — zero errors in any Story 3.16 file. Pre-existing `_fnName` warning in the children.routes.test mock predates this story (called out in Story 2.12 review).
- `pnpm --filter @hivekitchen/web typecheck` — clean.

### Completion Notes List

- **`school_policies` table did NOT exist before this story.** The story spec assumed it was created in Story 2.12, but the 2.10 children migration explicitly defers it: "school_policies table deferred — captured as free-text school_policy_notes until Story 3.x normalizes school policy management." This story is the "Story 3.x" the comment referred to. The migration creates the table fresh rather than `ALTER TABLE`-ing a column.
- **Existing `school_policy_notes` column on `children` is left intact.** Removing it would be a breaking change for the rest of the brownfield (the planner agent already reads it as free-text context). Both surfaces co-exist: the new normalized rows feed `slot_scope`-aware regeneration; the legacy text column remains for free-form notes.
- **Service wired inline in `children.routes.ts`, not a standalone hook plugin.** The story Task 10 sketched a `school-policies.hook.ts` that decorates `fastify.schoolPoliciesService`. The simpler path — already used by `ChildrenService` itself in `children.routes.ts` — is to construct the service inside the routes plugin, keeping it scoped and avoiding another exported fastify decorator. The wiring requires only `fastify.bullmq`, `fastify.auditService`, and a `PlansRepository(supabase)` instance.
- **`current_revision` was missing from the story-spec's regen-job-data sketch.** `PlanRegenerationJobData` (Story 3.13) requires `current_revision` so the worker can bump `revision = current_revision + 1`. I extended `findActiveFuturePlanIds` to return the revision alongside the id/week_id/week_of trio.
- **`scope='week'` (not `'slot'`) per Dev Notes.** Slot-level partial regen would require a new BullMQ scope variant + `commit_plan()` archival path that filters by slot. Deferred per Dev Notes; logged in `deferred-work.md`.
- **`UpdateSchoolPolicyInputSchema.policy_description` is `.nullable().optional()`** (not `.optional()` only) — the Zod 3 default behavior strips nulls when only `.optional()` is used, which collides with the column's NULL semantics. Tests verify both shapes round-trip.
- **`SlotScopeSchema.default('bag_wide')` happens at the contract layer** so a request body without `slot_scope` resolves to `bag_wide` before the service ever sees it. The schema registration in Fastify uses the parsed body (not the raw), so the service can rely on `slot_scope` being a concrete value.
- **Per-policy `jobId` includes `policy_type`** so toggling two different policies in the same request still produces distinct BullMQ jobs while idempotency on a single (policy, plan) is preserved within a request.
- **Audit fanout event (`plan.policy_regeneration_triggered`) is only written when at least one job successfully enqueues.** An all-fail enqueue leaves only `school_policy.updated` in the audit, matching the response shape (`regeneration_triggered: false`, `affected_plan_ids: []`).
- **`policy_description` not surfaced in the web form yet.** The contract supports it but the SchoolPoliciesForm only toggles canonical presets. UX has not yet decided whether free-text policies feed plan generation through this surface or stay on the legacy `school_policy_notes` column. Logged in `deferred-work.md`.
- **Route `:id` param schema is `SchoolPolicyChildIdParamSchema`** — distinct symbol name from any future child-route param schemas to avoid an export collision in `@hivekitchen/contracts`.
- **No SSE emission on policy-triggered regen.** Same constraint as 3.13 — deferred to Story 5.2; the regen worker logs "sse.deferred" and the brief is updated via the same `briefStateComposer.refresh()` path that drives TanStack Query polling.

### File List

**New files**
- `supabase/migrations/20260700000000_create_school_policies.sql`
- `supabase/migrations/20260700000100_add_school_policy_audit_types.sql`
- `packages/contracts/src/school-policy.ts`
- `packages/contracts/src/school-policy.test.ts`
- `apps/api/src/modules/children/school-policies.repository.ts`
- `apps/api/src/modules/children/school-policies.service.ts`
- `apps/api/src/modules/children/school-policies.service.test.ts`
- `apps/web/src/hooks/useSchoolPolicies.ts`
- `apps/web/src/features/children/SchoolPoliciesForm.tsx`

**Modified files**
- `packages/contracts/src/index.ts` — re-export `school-policy.js`.
- `packages/types/src/index.ts` — inferred type exports for `SlotScope`, `SchoolPolicy`, `UpdateSchoolPolicyInput`, `UpdateSchoolPolicyResponse`, `GetSchoolPoliciesResponse`, `SchoolPolicyChildIdParam`.
- `apps/api/src/audit/audit.types.ts` — `school_policy.updated` and `plan.policy_regeneration_triggered` added to `AUDIT_EVENT_TYPES`.
- `apps/api/src/modules/plans/plans.repository.ts` — added `findActiveFuturePlanIds()` + private `currentWeekMondayUtc()` helper.
- `apps/api/src/modules/children/children.routes.ts` — instantiates `SchoolPoliciesService` in the plugin, registers PATCH/GET `/v1/children/:id/school-policies` routes.
- `apps/api/src/modules/children/children.routes.test.ts` — extended mock supabase (`school_policies` + `plans` tables), added `bullmq` + `auditService` fastify decorators, added 12 new tests across PATCH/GET school-policies routes (also added `plans` and `schoolPolicies` slots to `MockDbState`).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 3-16 → review.
- `_bmad-output/implementation-artifacts/deferred-work.md` — Story 3.16 deferred entries (slot-level partial regen, SSE, policy_description UI, regen rate-limit reuse, UTC week math).
- `_bmad-output/implementation-artifacts/tests/test-summary.md` — Story 3.16 contract / service / route test inventory.

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.16 created — ready-for-dev. |
| 2026-05-05 | Amelia | Implemented Story 3.16 end-to-end. New `school_policies` table (table did not previously exist — deferred from Story 2.10). Contracts, repository, service with regen-fanout, PATCH + GET routes, web form, audit events. 21 contract tests, 9 service tests, 12 new route tests — all green. Status → review. |
