# Story 3.19: Day-Level Context Overrides

Status: ready-for-dev

## Story

As a Primary Parent,
I want a defined set of day-level context overrides (Bag-suspended / Half-day / Field-trip / Sick-day / Post-dentist / Early-release / Sport-practice / Test-day) that temporarily modify composition for a single (child, day),
So that one-off events don't require permanent profile changes (FR118).

## Acceptance Criteria

1. **Given** Story 2.12 is complete,
   **When** I tap an override option on a specific day,
   **Then** `POST /v1/plans/:id/items/:itemId/override` writes `day_overrides` row; override auto-reverts after the day; Lumi proposes Sport-practice/Field-trip overrides from calendar signal per FR119.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 2.12: `per_child_lunch_bag_slot_declaration` — `children` table with lunch bag slot declarations; slot model is established
- Story 3.5: `plans`, `plan_items` tables; `PlansRepository`; `PlansService.commit()`
- Story 3.12: `plan_items.paused_at` — sick-day pause already implemented here; `PlansService.pauseDay()` — **check if Sick-day and Bag-suspended overlap with this story's scope**. Story 3.12 implemented "skip/sick" as `plan_items.paused_at`. This story's "Sick-day" override should reuse that mechanism rather than duplicating it.
- Story 3.13: `planRegenerationJobPlugin` — day-scope regen via REGEN_QUEUE; used when composition changes
- Story 3.7: `planGenerationJobPlugin` — plan generation with per-TZ scheduling
- `authorize(['primary_parent', 'secondary_caregiver'])` preHandler
- `AUDIT_EVENT_TYPES` in `apps/api/src/audit/audit.types.ts`

**Key invariants:**
- All DB access through API only
- Override auto-reverts — a nightly job or a check at plan-read time must clear overrides whose `day` has passed
- No `framer-motion`, logical-property lint rule applies
- `import type` for all type-only imports
- Presentation layer always reads `WHERE guardrail_cleared_at IS NOT NULL`

---

## Tasks / Subtasks

### Task 1 — DB Migration: `day_overrides` table

Create `supabase/migrations/20260720000000_create_day_overrides.sql`:

```sql
-- Story 3.19: per (child, plan_item) one-off context overrides.
-- Overrides auto-revert after the day — enforced by a nightly job or at-read check.
-- One active override per (plan_item_id, child_id) pair at a time (upsert on conflict).
DO $$ BEGIN
  CREATE TYPE day_override_type AS ENUM (
    'bag_suspended',   -- No lunch delivered this day (child absent, parent skip)
    'half_day',        -- Shorter school day — lighter composition
    'field_trip',      -- Out-of-classroom — portable, no-mess composition
    'sick_day',        -- Child is sick — gentle, easy-to-eat composition
    'post_dentist',    -- Soft foods only
    'early_release',   -- Early dismissal — normal composition, earlier delivery
    'sport_practice',  -- High-energy day — extra protein/carbs proposed
    'test_day'         -- Stress-free, familiar foods
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS day_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_item_id    UUID NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  child_id        UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  household_id    UUID NOT NULL,
  override_date   DATE NOT NULL,           -- the specific date (e.g., '2026-05-06')
  override_type   day_override_type NOT NULL,
  is_lumi_proposed BOOLEAN NOT NULL DEFAULT false, -- true when Lumi auto-proposed from calendar signal
  confirmed_at    TIMESTAMPTZ,             -- NULL = proposed but not yet confirmed; NOT NULL = confirmed by parent
  reverted_at     TIMESTAMPTZ,             -- populated by nightly revert job after the day
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_item_id, child_id, override_date)   -- one active override per slot per day
);

CREATE INDEX idx_day_overrides_household_date
  ON day_overrides(household_id, override_date)
  WHERE reverted_at IS NULL;  -- only active overrides in the index
```

### Task 2 — Contracts: add day-override schemas

In `packages/contracts/src/plan.ts` (or a new `day-override.ts`):

```typescript
export const DayOverrideTypeSchema = z.enum([
  'bag_suspended',
  'half_day',
  'field_trip',
  'sick_day',
  'post_dentist',
  'early_release',
  'sport_practice',
  'test_day',
]);

export const DayOverrideSchema = z.object({
  id: z.string().uuid(),
  plan_item_id: z.string().uuid(),
  child_id: z.string().uuid(),
  household_id: z.string().uuid(),
  override_date: z.string().date(), // 'YYYY-MM-DD'
  override_type: DayOverrideTypeSchema,
  is_lumi_proposed: z.boolean(),
  confirmed_at: z.string().datetime().nullable(),
  reverted_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// POST /v1/plans/:id/items/:itemId/override body
export const SetDayOverrideInputSchema = z.object({
  override_type: DayOverrideTypeSchema,
  override_date: z.string().date(), // must be today or future
  child_id: z.string().uuid(),
  // Confirmation required for Lumi-proposed overrides per Principle 1.
  // For parent-initiated overrides, confirmed_at is set immediately.
  is_lumi_proposed: z.boolean().default(false),
});

// DELETE /v1/plans/:id/items/:itemId/override/:overrideId — reverts an active override.
export const SetDayOverrideResponseSchema = z.object({
  override: DayOverrideSchema,
  regen_triggered: z.boolean(), // true if plan will be regenerated to reflect override
});
```

Export from `packages/contracts/src/index.ts`. Add types to `packages/types/src/index.ts`:
```typescript
export type DayOverrideType = z.infer<typeof DayOverrideTypeSchema>;
export type DayOverride = z.infer<typeof DayOverrideSchema>;
export type SetDayOverrideInput = z.infer<typeof SetDayOverrideInputSchema>;
export type SetDayOverrideResponse = z.infer<typeof SetDayOverrideResponseSchema>;
```

### Task 3 — `DayOverridesRepository`

Create `apps/api/src/modules/plans/day-overrides.repository.ts`:

```typescript
const OVERRIDE_COLUMNS =
  'id, plan_item_id, child_id, household_id, override_date, override_type, is_lumi_proposed, confirmed_at, reverted_at, created_at, updated_at';

export class DayOverridesRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(input: {
    planItemId: string;
    childId: string;
    householdId: string;
    overrideDate: string;
    overrideType: string;
    isLumiProposed: boolean;
  }): Promise<DayOverride> {
    const { data, error } = await this.client
      .from('day_overrides')
      .upsert(
        {
          plan_item_id: input.planItemId,
          child_id: input.childId,
          household_id: input.householdId,
          override_date: input.overrideDate,
          override_type: input.overrideType,
          is_lumi_proposed: input.isLumiProposed,
          // Parent-initiated overrides are confirmed immediately.
          // Lumi-proposed overrides start unconfirmed (confirmed_at = null).
          confirmed_at: input.isLumiProposed ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'plan_item_id,child_id,override_date' },
      )
      .select(OVERRIDE_COLUMNS)
      .single();
    if (error) throw error;
    return data as DayOverride;
  }

  // Revert an active override (set reverted_at = now()).
  async revert(overrideId: string, householdId: string): Promise<DayOverride> {
    const { data, error } = await this.client
      .from('day_overrides')
      .update({ reverted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', overrideId)
      .eq('household_id', householdId) // household ownership guard
      .is('reverted_at', null)
      .select(OVERRIDE_COLUMNS)
      .single();
    if (error) throw error;
    return data as DayOverride;
  }

  // Confirm a Lumi-proposed override (sets confirmed_at = now()).
  async confirm(overrideId: string, householdId: string): Promise<DayOverride> {
    const { data, error } = await this.client
      .from('day_overrides')
      .update({ confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', overrideId)
      .eq('household_id', householdId)
      .is('confirmed_at', null)
      .select(OVERRIDE_COLUMNS)
      .single();
    if (error) throw error;
    return data as DayOverride;
  }

  // Returns active (non-reverted) overrides for a household on future dates.
  // Used by nightly revert job and plan-generation context.
  async findActiveByHousehold(householdId: string): Promise<DayOverride[]> {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('day_overrides')
      .select(OVERRIDE_COLUMNS)
      .eq('household_id', householdId)
      .gte('override_date', today)
      .is('reverted_at', null);
    if (error) throw error;
    return (data ?? []) as DayOverride[];
  }

  // Revert all overrides whose date has passed (called nightly).
  async revertExpired(): Promise<number> {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const { data, error } = await this.client
      .from('day_overrides')
      .update({ reverted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .lt('override_date', yesterdayStr)
      .is('reverted_at', null)
      .select('id');
    if (error) throw error;
    return (data ?? []).length;
  }
}
```

### Task 4 — `DayOverridesService`

Create `apps/api/src/modules/plans/day-overrides.service.ts`:

```typescript
export class DayOverridesService {
  constructor(
    private readonly repo: DayOverridesRepository,
    private readonly plansRepo: PlansRepository,
    private readonly regenQueue: Queue,
    private readonly auditService: AuditService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async setOverride(opts: {
    planId: string;
    planItemId: string;
    householdId: string;
    input: SetDayOverrideInput;
    requestId: string;
  }): Promise<{ override: DayOverride; regenTriggered: boolean }> {
    // Validate plan item belongs to this household's plan.
    const item = await this.plansRepo.findItemById(opts.planItemId);
    if (!item || item.plan_id !== opts.planId) {
      throw new NotFoundError(`plan item ${opts.planItemId}`);
    }

    // For 'bag_suspended' and 'sick_day' overrides: also set paused_at on plan_items
    // (Story 3.12 mechanism) so Lunch Link delivery is suppressed.
    if (opts.input.override_type === 'bag_suspended' || opts.input.override_type === 'sick_day') {
      await this.plansRepo.pauseDay(opts.planId, item.child_id, item.day, opts.householdId);
    }

    const override = await this.repo.upsert({
      planItemId: opts.planItemId,
      childId: opts.input.child_id,
      householdId: opts.householdId,
      overrideDate: opts.input.override_date,
      overrideType: opts.input.override_type,
      isLumiProposed: opts.input.is_lumi_proposed,
    });

    // Audit.
    try {
      await this.auditService.write({
        event_type: 'plan.day_override_set',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_item_id: opts.planItemId,
          override_type: opts.input.override_type,
          override_date: opts.input.override_date,
          is_lumi_proposed: opts.input.is_lumi_proposed,
        },
      });
    } catch (err) {
      this.logger.error({ err }, 'audit write failed for plan.day_override_set — continuing');
    }

    // Composition-changing overrides trigger a day-scope regen so the planner
    // can adjust the meal content (e.g., 'field_trip' → portable foods).
    // Non-composition overrides (bag_suspended, early_release) don't need regen.
    const COMPOSITION_CHANGING_OVERRIDES = [
      'field_trip',
      'half_day',
      'post_dentist',
      'sport_practice',
      'test_day',
    ];

    let regenTriggered = false;
    if (COMPOSITION_CHANGING_OVERRIDES.includes(opts.input.override_type)) {
      // Find the plan to get week_of and week_id for the regen job.
      const plan = await this.plansRepo.findByIdForPresentation({
        planId: opts.planId,
        householdId: opts.householdId,
      });
      if (plan?.week_of) {
        try {
          await this.regenQueue.add(
            'regen-day-override',
            {
              plan_id: opts.planId,
              household_id: opts.householdId,
              week_of: plan.week_of,
              week_id: plan.week_id,
              scope: 'day',
              day: item.day,
              request_id: opts.requestId,
            } satisfies PlanRegenerationJobData,
            { attempts: 2, backoff: { type: 'exponential', delay: 30_000 } },
          );
          regenTriggered = true;
        } catch (err) {
          this.logger.error({ err }, 'failed to enqueue day regen for override — continuing');
        }
      }
    }

    return { override, regenTriggered };
  }
}
```

### Task 5 — Routes: set + revert override

In `apps/api/src/modules/plans/plans.routes.ts`, add:

```typescript
import {
  SetDayOverrideInputSchema,
  SetDayOverrideResponseSchema,
} from '@hivekitchen/contracts';

// POST /v1/plans/:planId/items/:itemId/override
fastify.post(
  '/v1/plans/:planId/items/:itemId/override',
  {
    preHandler: authorize(['primary_parent', 'secondary_caregiver']),
    schema: {
      params: z.object({ planId: z.string().uuid(), itemId: z.string().uuid() }),
      body: SetDayOverrideInputSchema,
      response: { 201: SetDayOverrideResponseSchema },
    },
  },
  async (request, reply) => {
    const { planId, itemId } = request.params as { planId: string; itemId: string };
    const body = request.body as SetDayOverrideInput;
    const { override, regenTriggered } = await fastify.dayOverridesService.setOverride({
      planId,
      planItemId: itemId,
      householdId: request.user.household_id,
      input: body,
      requestId: request.id,
    });
    return reply.status(201).send({ override, regen_triggered: regenTriggered });
  },
);

// DELETE /v1/plans/:planId/items/:itemId/override/:overrideId — revert override
fastify.delete(
  '/v1/plans/:planId/items/:itemId/override/:overrideId',
  {
    preHandler: authorize(['primary_parent', 'secondary_caregiver']),
    schema: {
      params: z.object({
        planId: z.string().uuid(),
        itemId: z.string().uuid(),
        overrideId: z.string().uuid(),
      }),
    },
  },
  async (request, reply) => {
    const { overrideId } = request.params as { planId: string; itemId: string; overrideId: string };
    await fastify.dayOverridesService.revertOverride(overrideId, request.user.household_id);
    return reply.status(204).send();
  },
);
```

Add `revertOverride()` to `DayOverridesService`:
```typescript
async revertOverride(overrideId: string, householdId: string): Promise<void> {
  await this.repo.revert(overrideId, householdId);
}
```

### Task 6 — Nightly revert job

In `apps/api/src/jobs/` create `day-override-revert.job.ts`:

```typescript
// Runs nightly to revert day_overrides whose date has passed.
// Uses a simple BullMQ repeatable job scheduled at midnight UTC.
const dayOverrideRevertPlugin: FastifyPluginAsync = async (fastify) => {
  const repo = new DayOverridesRepository(fastify.supabase);

  // Schedule nightly at 00:05 UTC (after midnight to catch late-night writes).
  fastify.bullmq.getQueue('day-override-revert').add(
    'revert-expired',
    {},
    { repeat: { pattern: '5 0 * * *' }, removeOnComplete: { count: 7 } },
  );

  fastify.bullmq.getWorker('day-override-revert', async () => {
    const reverted = await repo.revertExpired();
    fastify.log.info({ reverted }, 'day-override-revert: reverted expired overrides');
  });
};
```

Register `dayOverrideRevertPlugin` in `apps/api/src/app.ts`.

### Task 7 — Frontend: override picker in PlanTile

In `apps/web/src/features/plan/PlanTile.tsx`, add an "Override" option to the disambiguation picker (L1 level, after swap and sick-day options):

The override picker is a simple bottom sheet or Popover with the 8 override types listed. When selected, it calls `POST /v1/plans/:planId/items/:itemId/override`.

Create `apps/web/src/features/plan/OverridePicker.tsx`:

```typescript
// A Popover listing available day-level context overrides for a plan item.
// Lumi-proposed overrides (is_lumi_proposed=true) appear pre-populated when
// Lumi detects a calendar signal (FR119 — sport practice, field trip).

import type { DayOverrideType } from '@hivekitchen/types';

const OVERRIDE_OPTIONS: Array<{ type: DayOverrideType; label: string; description: string }> = [
  { type: 'bag_suspended', label: 'No lunch needed', description: 'Child is absent or skipping' },
  { type: 'half_day', label: 'Half-day', description: 'Shorter school day, lighter bag' },
  { type: 'field_trip', label: 'Field trip', description: 'Portable, no-mess foods' },
  { type: 'sick_day', label: 'Sick day', description: 'Gentle, easy-to-eat foods' },
  { type: 'post_dentist', label: 'Post-dentist', description: 'Soft foods only' },
  { type: 'early_release', label: 'Early release', description: 'Deliver early' },
  { type: 'sport_practice', label: 'Sport practice', description: 'Extra energy — protein + carbs' },
  { type: 'test_day', label: 'Test day', description: 'Familiar, stress-free foods' },
];

interface OverridePickerProps {
  planId: string;
  planItemId: string;
  childId: string;
  overrideDate: string; // 'YYYY-MM-DD'
  onConfirm: () => void;
}

export function OverridePicker({ planId, planItemId, childId, overrideDate, onConfirm }: OverridePickerProps) {
  const [saving, setSaving] = useState(false);

  async function selectOverride(type: DayOverrideType) {
    setSaving(true);
    try {
      await hkFetch(`/v1/plans/${planId}/items/${planItemId}/override`, {
        method: 'POST',
        body: JSON.stringify({
          override_type: type,
          override_date: overrideDate,
          child_id: childId,
          is_lumi_proposed: false,
        }),
      });
      onConfirm();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-scope flex flex-col gap-1.5">
      <p className="font-sans text-[13px] text-stone-500 mb-1">What's happening?</p>
      {OVERRIDE_OPTIONS.map(({ type, label, description }) => (
        <button
          key={type}
          type="button"
          disabled={saving}
          onClick={() => void selectOverride(type)}
          className="flex flex-col items-start rounded-lg border border-stone-200 px-3 py-2 text-start hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
        >
          <span className="font-sans text-[14px] font-medium text-stone-800">{label}</span>
          <span className="font-sans text-[12px] text-stone-400">{description}</span>
        </button>
      ))}
    </div>
  );
}
```

### Task 8 — Audit event types

In `apps/api/src/audit/audit.types.ts`, add:
```typescript
'plan.day_override_set',
'plan.day_override_reverted',
```

### Task 9 — Tests

- `DayOverridesRepository` — upsert creates override; revert sets reverted_at; revertExpired resets past-date overrides
- `DayOverridesService.setOverride()` — bag_suspended triggers pauseDay; sport_practice triggers regen; sick_day triggers pauseDay + no regen
- Contract schema tests for `DayOverrideTypeSchema`, `SetDayOverrideInputSchema`

---

## Dev Notes

### Sick-day overlap with Story 3.12

Story 3.12 implemented sick-day pause via `plan_items.paused_at` (the "Skip" option in the disambiguation picker). This story's `sick_day` override type should ALSO set `paused_at` (per Task 4: `sick_day → pauseDay()`). If a user already used the Story 3.12 "Skip" path, the sick-day override is a more explicit record of why. Verify `DisambiguationPicker` (Story 3.13) still works — its "Sick day" option can call the new override endpoint instead of the direct pause endpoint for a unified path.

### FR119: Lumi-proposed overrides

FR119 says Lumi proposes an Extra item (or override) for high-activity days. For MVP, Lumi-proposed overrides are created via the same endpoint with `is_lumi_proposed: true`. The confirmation flow is a future story (Lumi sends a notification proposing the override; parent confirms via the app). For now, the `confirmed_at` field tracks whether the parent has explicitly accepted.

### Composition-changing vs. non-changing overrides

- **Composition-changing** (triggers day regen): `field_trip`, `half_day`, `post_dentist`, `sport_practice`, `test_day`
- **Non-composition** (no regen): `bag_suspended` (no lunch), `sick_day` (pause delivery), `early_release` (same content, different timing)
- This classification is opinionated. If the product wants `sick_day` to also adjust composition (e.g., bland foods), add it to `COMPOSITION_CHANGING_OVERRIDES` and remove the `pauseDay` call (or do both).

### Auto-revert mechanism

Overrides auto-revert via the nightly job in Task 6. This is a soft revert — `reverted_at` is set, the row remains. The `is_reverted_at IS NULL` partial index in the DB migration ensures active-override queries are fast. If the nightly job is missed (e.g., server down), overrides linger until the next run — acceptable at MVP scale.

---

## Project Structure

**New files:**
```
supabase/migrations/20260720000000_create_day_overrides.sql
apps/api/src/modules/plans/day-overrides.repository.ts
apps/api/src/modules/plans/day-overrides.repository.test.ts
apps/api/src/modules/plans/day-overrides.service.ts
apps/api/src/modules/plans/day-overrides.service.test.ts
apps/api/src/jobs/day-override-revert.job.ts
apps/web/src/features/plan/OverridePicker.tsx
apps/web/src/features/plan/OverridePicker.test.tsx
```

**Modified files (new contract schemas):**
```
packages/contracts/src/plan.ts (or day-override.ts)   + DayOverrideTypeSchema, DayOverrideSchema, SetDayOverrideInputSchema, SetDayOverrideResponseSchema
packages/types/src/index.ts                            + DayOverrideType, DayOverride, SetDayOverrideInput, SetDayOverrideResponse
apps/api/src/audit/audit.types.ts                      + plan.day_override_set, plan.day_override_reverted
apps/api/src/modules/plans/plans.routes.ts             + POST + DELETE override routes
apps/api/src/app.ts                                    + dayOverrideRevertPlugin registration; dayOverridesHook
apps/web/src/features/plan/PlanTile.tsx                + Override option wired to OverridePicker
_bmad-output/implementation-artifacts/sprint-status.yaml   3-19 → ready-for-dev
```

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.19 created — ready-for-dev. |
