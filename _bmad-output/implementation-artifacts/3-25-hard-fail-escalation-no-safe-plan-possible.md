# Story 3.25: Hard-fail Escalation (No Safe Plan Possible)

Status: ready-for-dev

## Story

As a Primary Parent,
I want a hard-fail case (no safe plan possible given my constraints) to escalate to ops and to me with a transparent description,
So that I know the system tried and what went wrong (FR82).

## Acceptance Criteria

1. **Given** Stories 3.5+3.24 are complete,
   **When** the planner exhausts all retry attempts and no safe plan exists for a household,
   **Then** `audit.service.write({event_type: 'plan.hard_fail', stages: [...attempts]})` fires; ops anomaly dashboard alerts; parent receives in-app `<AccountableError>` *"Lumi couldn't compose a safe plan this week. Our ops team is reviewing — we'll be back to you within an hour."*

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.5: `PlansService.commit()` runs guardrail then retries with rejection context (max 3 retries); on exhaustion, the failure currently propagates as a thrown error without escalation — this story adds structured escalation at that point
- Story 3.24: `'uncertain'` verdict + safe substitution; commit handles both blocked and uncertain; hard-fail occurs when BOTH blocked retries AND uncertain-without-substitution exhaust
- Story 3.2: `DomainOrchestrator.planWeek()` with `rejectionContext` and `uncertainContext` parameters
- Story 3.8: `BriefCanvas.tsx` already renders `<AccountableError>` when `uncertainty_flags` present (Story 3.24); extend to render on hard-fail too
- Story 3.11: `<FreshnessState>` component — Story 3.26 builds on this for the `failed` variant; Story 3.25 focuses on the audit/escalation path
- Story 1.8: `AuditService.write()` — single-row audit log
- `AUDIT_EVENT_TYPES` in `apps/api/src/audit/audit.types.ts`

**Key invariants:**
- Hard-fail is defined as: max guardrail retries exhausted AND no uncertain-to-certain substitution path succeeded
- Hard-fail is per-household-per-week — not per-child, not per-day
- `plan.hard_fail` audit row carries the full attempt history in `stages` for ops reconstruction
- The parent-facing message is never diagnostic — it is opaque about the failure reason (safety/ops principle)
- `<AccountableError>` for hard-fail is read-only (no affordance buttons); the ops team contacts the parent
- `brief_state.plan_state` column (to be added) signals the failed state to the frontend
- All DB access through API layer only
- `import type` for all type-only imports

---

## Tasks / Subtasks

### Task 1 — Add `plan.hard_fail` to AUDIT_EVENT_TYPES

In `apps/api/src/audit/audit.types.ts`:

```typescript
// Add to the AUDIT_EVENT_TYPES const/union:
'plan.hard_fail',
```

The audit row metadata shape:
```typescript
{
  plan_id: string;
  household_id: string;
  week_of: string;
  stages: Array<{
    attempt: number;
    verdict: 'blocked' | 'uncertain';
    conflicts?: string[];       // conflict descriptions from blocked verdict
    uncertain_ingredients?: string[]; // ingredient names from uncertain verdict
    substitution_attempted: boolean;
    substitution_succeeded: boolean;
  }>;
  total_attempts: number;
}
```

### Task 2 — `brief_state` schema: add `plan_state` column

Read `apps/api/src/modules/plans/brief-state.composer.ts` and the `brief_state` migration from Story 3.6 before proceeding.

Create migration `supabase/migrations/20260820000000_add_plan_state_to_brief_state.sql`:

```sql
-- Story 3.25: plan_state signals hard-fail and degraded states to the frontend.
-- NULL means the plan is in a normal state (cleared or pending generation).
-- 'hard_failed': planner exhausted all retries — ops engaged, parent notified.
-- 'degraded': cultural intersection empty — Story 3.29 uses this value.
DO $$ BEGIN
  CREATE TYPE plan_state_enum AS ENUM ('hard_failed', 'degraded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE brief_state
  ADD COLUMN IF NOT EXISTS plan_state plan_state_enum,
  ADD COLUMN IF NOT EXISTS plan_state_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_state_message TEXT;
```

### Task 3 — `HardFailEscalationService`

Create `apps/api/src/modules/plans/hard-fail-escalation.service.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';

export interface HardFailStage {
  attempt: number;
  verdict: 'blocked' | 'uncertain';
  conflicts?: string[];
  uncertain_ingredients?: string[];
  substitution_attempted: boolean;
  substitution_succeeded: boolean;
}

export class HardFailEscalationService {
  constructor(
    private readonly client: SupabaseClient,
    private readonly auditService: AuditService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async escalate(opts: {
    householdId: string;
    planId: string;
    weekOf: string;
    stages: HardFailStage[];
    requestId: string;
  }): Promise<void> {
    // 1. Write audit row — ops monitoring watches for 'plan.hard_fail'.
    try {
      await this.auditService.write({
        event_type: 'plan.hard_fail',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          household_id: opts.householdId,
          week_of: opts.weekOf,
          stages: opts.stages,
          total_attempts: opts.stages.length,
        },
      });
    } catch (err) {
      // Audit failure must not prevent brief_state from being updated.
      this.logger.error({ err }, 'audit write failed for plan.hard_fail — continuing to update brief_state');
    }

    // 2. Update brief_state to surface the hard-fail to the parent.
    const { error } = await this.client
      .from('brief_state')
      .update({
        plan_state: 'hard_failed',
        plan_state_set_at: new Date().toISOString(),
        plan_state_message:
          "Lumi couldn't compose a safe plan this week. Our ops team is reviewing — we'll be back to you within an hour.",
      })
      .eq('household_id', opts.householdId);

    if (error) {
      this.logger.error({ error }, 'failed to update brief_state for hard-fail');
    }

    this.logger.warn(
      { householdId: opts.householdId, planId: opts.planId, totalAttempts: opts.stages.length },
      'plan.hard_fail escalation complete',
    );
  }

  // Called when a new plan is successfully committed — clears hard-fail state.
  async clearIfSet(householdId: string): Promise<void> {
    await this.client
      .from('brief_state')
      .update({ plan_state: null, plan_state_set_at: null, plan_state_message: null })
      .eq('household_id', householdId)
      .eq('plan_state', 'hard_failed');
  }
}
```

### Task 4 — Hook `HardFailEscalationService` into `PlansService.commit()`

In `apps/api/src/modules/plans/plans.service.ts`, the existing `commit()` method retries up to 3 times when the guardrail blocks. After exhausting retries (or after uncertain substitution fails), call `hardFailEscalation.escalate()`.

The retry loop tracks each attempt as a `HardFailStage`. When the loop exits without a successful plan, call escalation instead of throwing:

```typescript
// After the retry loop exits without a committed plan:
const stages: HardFailStage[] = attempts.map((a, i) => ({
  attempt: i + 1,
  verdict: a.verdict,
  conflicts: a.conflicts?.map((c) => c.ingredient),
  uncertain_ingredients: a.uncertain_ingredients?.map((u) => u.ingredient),
  substitution_attempted: a.substitution_attempted ?? false,
  substitution_succeeded: a.substitution_succeeded ?? false,
}));

await this.hardFailEscalation.escalate({
  householdId: plan.household_id,
  planId: plan.plan_id,
  weekOf: plan.week_of,
  stages,
  requestId,
});

// Return a structured result instead of throwing — callers render the hard-fail state via brief_state.
return { status: 'hard_failed' };
```

Add `HardFailEscalationService` to `PlansService` constructor deps.

Also call `hardFailEscalation.clearIfSet(householdId)` at the top of a successful `commitPlan()` call, to reset brief_state when a later plan succeeds.

### Task 5 — Wire `HardFailEscalationService` in `plans.hook.ts`

In `apps/api/src/modules/plans/plans.hook.ts`, instantiate `HardFailEscalationService` and inject it into `PlansService`.

### Task 6 — Frontend: render `<AccountableError>` on hard-fail in `BriefCanvas`

In `apps/api/src/features/plan/BriefCanvas.tsx`, check `brief.plan_state === 'hard_failed'` and render `<AccountableError>`:

```typescript
{brief.plan_state === 'hard_failed' && brief.plan_state_message && (
  <AccountableError
    headline="Plan not available this week"
    body={brief.plan_state_message}
    // No actions — ops team is handling it. Parent contacted separately.
  />
)}
```

The `<AccountableError>` component (from Story 3.24) handles this correctly with no `actions` prop.

Update the `BriefStateResponse` contract in `packages/contracts/src/brief.ts`:

```typescript
export const BriefStateResponseSchema = z.object({
  // ... existing fields ...
  plan_state: z.enum(['hard_failed', 'degraded']).nullable(),
  plan_state_set_at: z.string().datetime().nullable(),
  plan_state_message: z.string().nullable(),
});
```

Update `packages/types/src/index.ts` accordingly.

### Task 7 — Ops alerting via audit log

The `plan.hard_fail` audit event is the signal. Grafana Cloud (wired in Story 1.7) reads the OpenTelemetry structured log stream. Create a Grafana alert rule (document the JSON in `apps/api/src/monitoring/alerts/plan-hard-fail.alert.json`):

```json
{
  "name": "plan.hard_fail escalation",
  "condition": "count of audit_log WHERE event_type = 'plan.hard_fail' in last 5m > 0",
  "severity": "high",
  "message": "Hard-fail escalation: household cannot generate a safe plan. Check audit_log for details.",
  "notification_channel": "ops-slack"
}
```

This is a documentation artifact — the actual Grafana rule is created in the monitoring stack separately. The file serves as the source of truth for the alert spec.

### Task 8 — Tests

**`hard-fail-escalation.service.test.ts` (new):**
- `escalate()` writes `plan.hard_fail` audit row with correct `stages` metadata
- `escalate()` updates `brief_state.plan_state = 'hard_failed'` with message
- `escalate()` continues even if audit write fails (graceful degradation)
- `clearIfSet()` resets `plan_state` to null when a new plan commits

**`plans.service.test.ts` (extend):**
- `commit()` with 3 blocked verdicts → calls `hardFailEscalation.escalate()` with 3 stages
- `commit()` with uncertain + failed substitution → calls escalation
- Successful `commit()` after prior hard-fail → calls `clearIfSet()`

**`BriefCanvas.test.tsx` (extend):**
- `plan_state = 'hard_failed'` → renders `<AccountableError>` with correct headline
- `plan_state = null` → no `<AccountableError>` rendered

---

## Dev Notes

### Hard-fail is the terminal state after all retry paths are exhausted

The retry cascade in `commit()` (Story 3.5) is:
1. Guardrail blocks → retry with rejection context (max 3 attempts)
2. Guardrail uncertain → attempt safe substitution; re-run guardrail
3. Substitution fails → surface via audit + brief_state uncertainty flag (Story 3.24), but still commit the plan
4. **Hard-fail**: only triggers if ALL of the above fail — i.e., the plan cannot be committed at all

In practice, Step 3 (Story 3.24) allows a plan to commit even with uncertain ingredients (marked with uncertainty flags). Hard-fail only occurs when the guardrail returns `'blocked'` on EVERY attempt after exhausting retries. A plan with `uncertain` verdict is never a hard-fail.

### `plan_state` vs `uncertainty_flags` in `brief_state`

These are distinct signals:
- `uncertainty_flags`: plan was committed but has uncertain ingredients (yellow state, per Story 3.24)
- `plan_state = 'hard_failed'`: plan was NOT committed at all (red-equivalent state, per this story)

Both render as `<AccountableError>`, but with different copy and different action affordances.

### `clearIfSet()` must run on every successful commit

When ops resolves the constraint conflict (or the parent changes their constraints), the next plan generation will succeed. The `clearIfSet()` call at the top of `commitPlan()` ensures the hard-fail `<AccountableError>` disappears automatically when the next plan lands.

---

## Project Structure

**New files:**
```
apps/api/src/modules/plans/hard-fail-escalation.service.ts
apps/api/src/modules/plans/hard-fail-escalation.service.test.ts
apps/api/src/monitoring/alerts/plan-hard-fail.alert.json
supabase/migrations/20260820000000_add_plan_state_to_brief_state.sql
```

**Modified files:**
```
apps/api/src/audit/audit.types.ts                          + plan.hard_fail
apps/api/src/modules/plans/plans.service.ts                + escalation call on retry exhaustion; clearIfSet() on success
apps/api/src/modules/plans/plans.hook.ts                   + HardFailEscalationService wired
packages/contracts/src/brief.ts                            + plan_state, plan_state_set_at, plan_state_message in BriefStateResponseSchema
packages/types/src/index.ts                                + updated BriefStateResponse type
apps/web/src/features/plan/BriefCanvas.tsx                 + render <AccountableError> on plan_state=hard_failed
_bmad-output/implementation-artifacts/sprint-status.yaml   3-25 → ready-for-dev
```

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.25 created — ready-for-dev. |
