# Story 3.29: Degraded-Propose State with Try Alternating Sovereignty Toggle

Status: ready-for-dev

## Story

As a Primary Parent of an interfaith household,
I want a clear surface when "honor all rules" intersection collapses to near-empty (e.g., Kosher + Halal + Hindu-veg with no shared protein), with a one-tap toggle to switch to alternating sovereignty,
So that the household isn't stuck with rice-and-steamed-vegetables plans (UX-DR48, UX-DR49).

## Acceptance Criteria

1. **Given** Story 3.18 (cultural priors) is complete,
   **When** the planner detects `CULTURAL_INTERSECTION_EMPTY`,
   **Then** `PlanUpdatedEvent.guardrail_verdict.status = 'degraded'` with `reason: 'CULTURAL_INTERSECTION_EMPTY'` and `suggestion: 'try_alternating_sovereignty'`; Brief renders inline note *"This week's plan couldn't honor every rule strictly. Try alternating whose rules lead each day?"* with one-tap mode-switch toggle.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.18: `CulturalCalendarService` + `MemoryContextService`; planner prompt receives cultural priors and observances; silence-mode guard
- Story 3.2: `DomainOrchestrator.planWeek()` — orchestrator handles `rejectionContext` and `uncertainContext`; this story adds a `degradedReason` output path
- Story 3.6: `brief_state` projection; `GET /v1/households/:id/brief`
- Story 3.25 / 3.26: `hard_fail` on `GET /v1/plans` + `FreshnessState variant="reworking"` — the hard-fail (no-safe-plan) surface. Neither story added `brief_state.plan_state`. **This story adds those columns** (Task 1b migration).
- Story 3.11: `<FreshnessState>` — exists with `fresh | stale | loading | failed | offline | reworking`. The `reworking` variant (Story 3.26) is for hard-fail. This story uses a different surface: an inline `<LumiNote>` for `plan_state = 'degraded'` in `BriefCanvas`, not `FreshnessState`.
- `AUDIT_EVENT_TYPES`

**Key invariants:**
- `CULTURAL_INTERSECTION_EMPTY` is detected by the planner agent (not the guardrail) — it is a cultural-constraint signal, not an allergen-safety signal
- The plan IS committed in the degraded state — it is a best-effort plan, not a hard-fail (unlike Story 3.25)
- The toggle switches `households.sovereignty_mode`; the next plan generation uses the new mode
- Alternating sovereignty means: each day's plan follows only one household's cultural rules, rotating through children/traditions per day
- Silence-mode households (no ratified cultural priors) never see `CULTURAL_INTERSECTION_EMPTY` — they have no intersection to collapse
- The inline note is not an `<AccountableError>` (that's for safety issues); it is a `<LumiNote>` variant — see UX-DR48
- All DB access through API layer only
- `import type` for all type-only imports

---

## Tasks / Subtasks

### Task 1a — DB Migration: `brief_state` plan-state columns

Create `supabase/migrations/20260920000000_add_plan_state_to_brief_state.sql`:

```sql
-- Story 3.29: brief_state tracks a soft cultural-degradation signal.
-- plan_state_enum covers both the hard-fail path (Story 3.25 audit machinery)
-- and this story's cultural-degradation path. The enum lives here so both
-- paths share the same type.
DO $$ BEGIN
  CREATE TYPE plan_state_enum AS ENUM ('hard_failed', 'degraded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE brief_state
  ADD COLUMN IF NOT EXISTS plan_state       plan_state_enum,   -- null = no active degradation
  ADD COLUMN IF NOT EXISTS plan_state_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_state_message TEXT;
```

`plan_state = NULL` is the normal/no-degradation state (most rows). The column is nullable to avoid backfill.

> **Note:** `hard_failed` is in this enum for completeness, but the current hard-fail surface (Story 3.25/3.26) reads from `audit_log` via `GET /v1/plans`, not from `brief_state`. A future story may unify both paths through `brief_state`; for now only `'degraded'` is written here.

---

### Task 1b — DB Migration: `households.sovereignty_mode` column

Create `supabase/migrations/20260920000100_add_sovereignty_mode_to_households.sql`:

```sql
-- Story 3.29: households can choose how to handle intersecting cultural rule sets.
-- 'unified': honor ALL household cultural rules simultaneously (default — may produce near-empty intersections).
-- 'alternating': rotate which tradition leads each day, giving each full expression.
DO $$ BEGIN
  CREATE TYPE sovereignty_mode_enum AS ENUM ('unified', 'alternating');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS sovereignty_mode sovereignty_mode_enum NOT NULL DEFAULT 'unified',
  ADD COLUMN IF NOT EXISTS sovereignty_mode_updated_at TIMESTAMPTZ;
```

### Task 2 — Planner: detect and signal `CULTURAL_INTERSECTION_EMPTY`

In `apps/api/src/agents/orchestrator.ts`, after `planWeek()` completes but before committing:

The planner agent's `plan.compose` tool output may include a `degraded_reason` field when the cultural constraint intersection was near-empty. Extend `PlanComposeOutput` in `packages/contracts/src/plan.ts`:

```typescript
// Add to PlanComposeOutputSchema:
degraded_reason: z.enum(['CULTURAL_INTERSECTION_EMPTY']).nullable().optional(),
```

In `plan-generation.job.ts` contextLines, include a sovereignty instruction:

```typescript
const sovereigntyMode = household.sovereignty_mode ?? 'unified';

if (sovereigntyMode === 'alternating') {
  contextLines.push(
    'ALTERNATING SOVEREIGNTY MODE: This household rotates cultural lead by day. ' +
    'Each day, follow ONE tradition\'s rules completely. Rotate through represented traditions across the week. ' +
    'Do not attempt to honor all traditions simultaneously on any single day.',
  );
} else {
  // unified (default) — no special instruction needed; planner honors all rules simultaneously
  // Tell the planner to signal if intersection collapses:
  contextLines.push(
    'If the intersection of all household cultural and dietary rules leaves fewer than 3 distinct protein options, ' +
    'include "degraded_reason": "CULTURAL_INTERSECTION_EMPTY" in the plan.compose output.',
  );
}
```

### Task 3 — `PlansService.commit()`: handle `degraded_reason`

In `apps/api/src/modules/plans/plans.service.ts`, after the guardrail clears the plan:

```typescript
const composeOutput = await this.orchestrator.planWeek(...);

// Check for cultural intersection collapse.
if (composeOutput.degraded_reason === 'CULTURAL_INTERSECTION_EMPTY') {
  await this.handleDegradedPlan(composeOutput, household, requestId);
  // Still commit the plan — degraded != hard-fail.
}

return this.commitPlan(composeOutput, requestId);
```

```typescript
private async handleDegradedPlan(
  composeOutput: PlanComposeOutput,
  household: HouseholdRow,
  requestId: string,
): Promise<void> {
  // 1. Update brief_state with degraded plan_state.
  await this.client
    .from('brief_state')
    .update({
      plan_state: 'degraded',
      plan_state_set_at: new Date().toISOString(),
      plan_state_message:
        "This week's plan couldn't honor every rule strictly. Try alternating whose rules lead each day?",
    })
    .eq('household_id', household.id);

  // 2. Audit.
  try {
    await this.auditService.write({
      event_type: 'plan.cultural_degraded',
      household_id: household.id,
      request_id: requestId,
      metadata: { reason: 'CULTURAL_INTERSECTION_EMPTY' },
    });
  } catch (err) {
    this.logger.error({ err }, 'audit write failed for plan.cultural_degraded');
  }
}
```

### Task 4 — Route: `PATCH /v1/households/:id/sovereignty-mode`

In `apps/api/src/modules/households/households.routes.ts`:

```typescript
// Contract:
export const UpdateSovereigntyModeInputSchema = z.object({
  sovereignty_mode: z.enum(['unified', 'alternating']),
});

fastify.patch(
  '/v1/households/:id/sovereignty-mode',
  {
    preHandler: authorize(['primary_parent']),
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: UpdateSovereigntyModeInputSchema,
      response: { 200: z.object({ sovereignty_mode: z.enum(['unified', 'alternating']) }) },
    },
  },
  async (request, reply) => {
    const { id: householdId } = request.params as { id: string };
    if (householdId !== request.user.household_id) throw new ForbiddenError('Not your household');

    const body = request.body as UpdateSovereigntyModeInput;

    const { error } = await fastify.supabase
      .from('households')
      .update({
        sovereignty_mode: body.sovereignty_mode,
        sovereignty_mode_updated_at: new Date().toISOString(),
      })
      .eq('id', householdId);
    if (error) throw error;

    await fastify.auditService.write({
      event_type: 'household.sovereignty_mode_changed',
      household_id: householdId,
      request_id: request.id,
      metadata: { sovereignty_mode: body.sovereignty_mode },
    });

    // Clear the degraded plan_state now that the parent has acknowledged and chosen a mode.
    await fastify.supabase
      .from('brief_state')
      .update({ plan_state: null, plan_state_set_at: null, plan_state_message: null })
      .eq('household_id', householdId)
      .eq('plan_state', 'degraded');

    return reply.send({ sovereignty_mode: body.sovereignty_mode });
  },
);
```

Also trigger a plan regeneration after mode switch (so the parent sees the alternating plan immediately):

```typescript
await fastify.planAdjustmentService.triggerAdjustment({
  type: 'cultural_sovereignty_mode_changed',
  householdId,
  slotScope: 'bag_wide',
  dayScope: null,
  requestId: request.id,
  metadata: { sovereignty_mode: body.sovereignty_mode },
});
```

Update `PlanAdjustmentTriggerType` in `plan-adjustment.types.ts` to include `'cultural_sovereignty_mode_changed'`.

### Task 5 — Frontend: degraded inline note in `BriefCanvas`

The degraded state uses a `<LumiNote>` inline note (per UX-DR48), not an `<AccountableError>`:

In `apps/web/src/features/plan/BriefCanvas.tsx`:

```typescript
{brief.plan_state === 'degraded' && brief.plan_state_message && (
  <div className="rounded-lg border border-foliage-200 bg-foliage-50 px-4 py-3 flex flex-col gap-2">
    <p className="font-sans text-[14px] text-foliage-800 leading-relaxed">
      {brief.plan_state_message}
    </p>
    <button
      type="button"
      onClick={handleToggleAlternatingSovereignty}
      className="self-start rounded-full border border-foliage-400 px-3 py-1 font-sans text-[13px] text-foliage-800 hover:bg-foliage-100 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foliage-400"
      aria-label="Switch to alternating sovereignty mode"
    >
      Try alternating
    </button>
  </div>
)}
```

The toggle calls `PATCH /v1/households/:id/sovereignty-mode` with `{ sovereignty_mode: 'alternating' }`.

Use `foliage-*` from Tailwind tokens (cultural/diversity palette — verify with `Design System.md`; if not defined, use `emerald-*` as placeholder and note the token mapping in `deferred-work.md`).

### Task 6 — Add `plan_state` fields to `BriefStateRowSchema` contract

**File:** `packages/contracts/src/plan.ts` (where `BriefStateRowSchema` lives — there is no `brief.ts`).

Add three fields to `BriefStateRowSchema`. Read the schema before editing — it currently ends at `updated_at`.

```typescript
// Add to BriefStateRowSchema (after updated_at):
plan_state: z.enum(['hard_failed', 'degraded']).nullable().default(null),
plan_state_set_at: z.string().datetime({ offset: true }).nullable().default(null),
plan_state_message: z.string().max(500).nullable().default(null),
```

`default(null)` ensures existing `brief_state` rows without these columns (pre-migration) parse cleanly without breaking the `BriefResponseSchema`.

Also update `packages/types/src/index.ts` — if `BriefStateRow` is re-exported via `z.infer<typeof BriefStateRowSchema>`, the type picks up the new fields automatically. Confirm with `pnpm --filter @hivekitchen/contracts exec tsc --noEmit`.

### Task 7 — Planner prompt: alternating sovereignty instructions

In `apps/api/src/agents/prompts/planner.prompt.ts`, bump version to reflect the new alternating sovereignty instruction. The sovereignty mode context is injected dynamically in `plan-generation.job.ts` (Task 2), so the prompt version bump is minor. Document the change:

```typescript
// Bump to v1.3.0 — alternating sovereignty context injection added.
export const PLANNER_PROMPT = {
  version: 'v1.3.0',
  // ...
};
```

### Task 8 — Audit event types

```typescript
'plan.cultural_degraded',
'household.sovereignty_mode_changed',
```

### Task 9 — Tests

**`plans.service.test.ts` (extend):**
- `commit()` with `composeOutput.degraded_reason = 'CULTURAL_INTERSECTION_EMPTY'` → updates `brief_state.plan_state = 'degraded'`; still commits the plan; writes `plan.cultural_degraded` audit
- `commit()` with no `degraded_reason` → no `brief_state` update

**`households.routes.test.ts` (extend):**
- PATCH sovereignty-mode `alternating` → 200, sovereignty_mode updated, brief_state plan_state cleared, regen triggered
- PATCH from different household → 403

**`BriefCanvas.test.tsx` (extend):**
- `plan_state = 'degraded'` → renders foliage-toned inline note with "Try alternating" button
- `plan_state = 'hard_failed'` → renders `<AccountableError>` (not the inline note — regression from 3.25)
- `plan_state = null` → no degraded note, no error

---

## Dev Notes

### Degraded vs. hard-fail — different surfaces, different severity

| | `hard_failed` | `degraded` |
|---|---|---|
| Plan committed? | No | Yes (best effort) |
| Surface | `<FreshnessState variant="reworking">` (Story 3.26) | `<LumiNote>` inline note in `BriefCanvas` |
| Data source | `audit_log` via `GET /v1/plans hard_fail` | `brief_state.plan_state` (this story) |
| Palette | warm-neutral `text-fg-muted` | foliage (cultural/soft) |
| `role` | `status` (polite) | `status` (polite) |
| Actions | None (ops handles it) | [Try alternating] toggle |
| `plan_state` value | n/a (not in `brief_state`) | `'degraded'` |

### `CULTURAL_INTERSECTION_EMPTY` is the planner's signal, not the guardrail's

The allergy guardrail is deterministic and only knows blocked/uncertain/cleared. The `CULTURAL_INTERSECTION_EMPTY` signal comes from the LLM planner detecting that it cannot compose a nutritionally diverse, culturally appropriate plan under the simultaneous constraints. It is a soft signal, not an error.

The planner must be instructed to signal this condition explicitly (Task 2) — it will not do so by default.

### Alternating sovereignty does not require new schema beyond `sovereignty_mode`

In alternating mode, the planner receives an instruction to lead each day with one tradition. The rotation logic is prompt-driven (LLM decides the order). A future story could make the rotation explicit (e.g., Monday = Kosher, Tuesday = Halal, Wednesday = Hindu-veg), but for MVP the prompt approach is sufficient.

### Silence-mode guard

Households in silence-mode (no ratified cultural priors) never produce `CULTURAL_INTERSECTION_EMPTY`. The planner context for silence-mode households (Story 3.18) includes no cultural rules, so there is no intersection to collapse. The `contextLines` check from Story 3.18 already guards this.

---

## Project Structure

**New files:**
```
supabase/migrations/20260920000000_add_plan_state_to_brief_state.sql
supabase/migrations/20260920000100_add_sovereignty_mode_to_households.sql
```

**Modified files:**
```
packages/contracts/src/plan.ts                              + degraded_reason in PlanComposeOutputSchema; plan_state/plan_state_set_at/plan_state_message in BriefStateRowSchema
packages/contracts/src/households.ts                        + UpdateSovereigntyModeInputSchema
packages/types/src/index.ts                                  + UpdateSovereigntyModeInput type
apps/api/src/audit/audit.types.ts                            + plan.cultural_degraded, household.sovereignty_mode_changed
apps/api/src/agents/orchestrator.ts                          + handleDegradedPlan() call on degraded_reason
apps/api/src/agents/prompts/planner.prompt.ts                + version bump to v1.3.0
apps/api/src/jobs/plan-generation.job.ts                     + sovereignty_mode context injection; CULTURAL_INTERSECTION_EMPTY instruction
apps/api/src/modules/plans/plans.service.ts                  + handleDegradedPlan() private method
apps/api/src/modules/plans/plan-adjustment.types.ts          + cultural_sovereignty_mode_changed trigger type
apps/api/src/modules/households/households.routes.ts         + PATCH /v1/households/:id/sovereignty-mode
apps/web/src/features/plan/BriefCanvas.tsx                   + degraded inline note + toggle
_bmad-output/implementation-artifacts/sprint-status.yaml     3-29 → ready-for-dev
_bmad-output/implementation-artifacts/deferred-work.md       + foliage-* token mapping; explicit day-rotation schema for alternating sovereignty
```

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.29 created — ready-for-dev. |
| 2026-05-25 | Menon | Corrected stale dependency assumption: 3.25/3.26 did NOT add brief_state.plan_state. Added Task 1a migration for those columns. Rewrote Task 6 to add the schema fields (was "verify"). Updated dev notes table: AccountableError deleted in 3.26, replaced by FreshnessState variant=reworking. Fixed migration timestamp (was 20260850000000, now 20260920000100). |
