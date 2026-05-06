# Story 3.23: Per-Slot Policy Scoping + Bag-Wide Allergy Rule

Status: ready-for-dev

## Story

As a Primary Parent,
I want school-policy rules to support per-slot scoping (bag-wide / Main-only / Snack-only / Extra-only) while allergy-safety rules apply bag-wide without exception,
So that a "no peanuts in Snack" school rule doesn't trigger needless Main regeneration, but allergens are caught wherever they appear (FR112, FR113).

## Acceptance Criteria

1. **Given** Story 3.16 is complete,
   **When** I tag a school policy with a slot scope,
   **Then** `school_policies.slot_scope` enum (`bag_wide|main|snack|extra`) persists; only items in the matching slot regenerate on policy change.

2. **And** allergy-safety rules in the guardrail engine ignore slot scope — allergen in any slot triggers full-plan rejection.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.16: `school_policies.slot_scope` column already added via `supabase/migrations/20260700000000_add_slot_scope_to_school_policies.sql`; `SlotScopeSchema` in contracts; `UpdateSchoolPolicyInputSchema.slot_scope` field; `SchoolPoliciesService.updatePolicy()` already passes `slot_scope` to the policy upsert
- Story 3.16: `SchoolPoliciesService` uses `PlanAdjustmentService.triggerAdjustment()` which enqueues `scope='week'` regen for all future plans — **this story changes it to scope='day' for slot-scoped policies**
- Story 3.1: `AllergyGuardrailService.clearOrReject()` — already evaluates all slots regardless of school policies; no changes needed here (AC #2 is already satisfied by the guardrail architecture)
- Story 3.20: `plan_items.slot` distinguishes 'main', 'snack', 'extra'; `plan_items.item_sku_id` for Snack items
- Story 3.17: `PlanAdjustmentService.triggerAdjustment()` — the central dispatcher; extend it to support slot-scoped regen

**Key invariants:**
- Allergy guardrail already evaluates ALL slots unconditionally — AC #2 requires zero code changes to the guardrail (it is designed this way per Story 3.1)
- Policy-triggered regen scope must be narrowed to the targeted slot — only regen items in that slot, not the full day
- All DB access through API only
- `import type` for all type-only imports

---

## Tasks / Subtasks

### Task 1 — Verify `school_policies.slot_scope` migration is applied

Before writing any code: verify that Story 3.16's migration (`20260700000000_add_slot_scope_to_school_policies.sql`) has been applied and the `slot_scope` column exists on the `school_policies` table. If Story 3.16 is not yet implemented, implement it first.

If the migration already exists, this task is complete — no new migration needed.

### Task 2 — Extend `PlanAdjustmentTrigger` with `slotScope`

In `apps/api/src/modules/plans/plan-adjustment.types.ts`, the `PlanAdjustmentTrigger` type already includes `slotScope` (added in Story 3.17). Verify it is:

```typescript
export interface PlanAdjustmentTrigger {
  type: PlanAdjustmentTriggerType;
  householdId: string;
  slotScope: 'bag_wide' | 'main' | 'snack' | 'extra' | null;
  dayScope: string | null;
  requestId: string;
  metadata: Record<string, unknown>;
}
```

If `slotScope` is already there, no changes needed. If not, add it.

### Task 3 — Update `PlanAdjustmentService` to support slot-scoped regen

In `apps/api/src/modules/plans/plan-adjustment.service.ts`, update `triggerAdjustment()` to pass `slotScope` to the regeneration job:

The existing `PlanRegenerationJobData` (from Story 3.13) supports `scope: 'week' | 'day'`. It does not have a `slotScope` field. For slot-scoped policy changes:

**MVP approach:** Pass a `slot_context` field in the job metadata that the planner prompt uses to constrain regeneration:

Update `PlanRegenerationJobData` in `apps/api/src/jobs/plan-regeneration.job.ts`:

```typescript
export interface PlanRegenerationJobData {
  plan_id: string;
  household_id: string;
  week_of: string;
  week_id: string;
  scope: 'week' | 'day';
  day?: string;
  request_id: string;
  slot_scope?: 'bag_wide' | 'main' | 'snack' | 'extra'; // Story 3.23 — slot-level regen context
  policy_context?: string; // Human-readable policy change description for the planner prompt
}
```

In `PlanAdjustmentService.triggerAdjustment()`, when `trigger.slotScope !== null && trigger.slotScope !== 'bag_wide'`:

```typescript
await this.regenQueue.add(
  `regen-${trigger.type}`,
  {
    plan_id: planMeta.id,
    household_id: trigger.householdId,
    week_of: planMeta.week_of,
    week_id: planMeta.week_id,
    scope: 'week', // still regenerate the full week, but with slot constraint in prompt
    request_id: trigger.requestId,
    slot_scope: trigger.slotScope ?? undefined,
    policy_context: trigger.metadata.policy_context as string | undefined,
  } satisfies PlanRegenerationJobData,
  { attempts: 2, backoff: { type: 'exponential', delay: 60_000 } },
);
```

### Task 4 — Update `plan-regeneration.job.ts` worker to inject slot context into prompt

In `apps/api/src/jobs/plan-regeneration.job.ts`, inside the worker, before calling `orchestrator.planWeek()`:

```typescript
// When slot_scope is set, inject an instruction into the orchestrator to only
// regenerate items in the specified slot. Items in other slots must be preserved exactly.
let slotScopeContext: string | undefined;
if (job.data.slot_scope && job.data.slot_scope !== 'bag_wide') {
  const slotLabel = job.data.slot_scope.charAt(0).toUpperCase() + job.data.slot_scope.slice(1);
  slotScopeContext =
    `SLOT-SCOPED REGENERATION: Regenerate ONLY the ${slotLabel} slot items. ` +
    `Keep ALL other slot items (Main/Snack/Extra as applicable) identical to the previous plan. ` +
    (job.data.policy_context ? `Policy change: ${job.data.policy_context}` : '');
}

const composeOutput = await fastify.orchestrator.planWeek(
  household_id,
  week_of,
  request_id,
  undefined, // rejectionContext
  undefined, // dayScope
  undefined, // culturalContext (loaded separately in plan-generation.job, not here)
  slotScopeContext,
);
```

Update `orchestrator.planWeek()` signature to accept `slotScopeContext`:

```typescript
async planWeek(
  householdId: string,
  weekOf: string,
  requestId: string,
  rejectionContext?: string,
  dayScope?: string,
  culturalContext?: CulturalContext,
  slotScopeContext?: string, // Story 3.23 — slot-scoped regen instruction
): Promise<PlanComposeOutput>
```

And inject `slotScopeContext` as a context line (placed early, before other lines, so the LLM sees it as a primary constraint):

```typescript
if (slotScopeContext !== undefined) {
  contextLines.unshift(slotScopeContext); // prepend — high-priority constraint
}
```

### Task 5 — Update `SchoolPoliciesService` to pass slot context to `PlanAdjustmentService`

In `apps/api/src/modules/children/school-policies.service.ts`, update the `triggerAdjustment()` call to include `policy_context`:

```typescript
await this.planAdjustment.triggerAdjustment({
  type: 'school_policy_changed',
  householdId: opts.householdId,
  slotScope: opts.input.slot_scope as 'bag_wide' | 'main' | 'snack' | 'extra',
  dayScope: null,
  requestId: opts.requestId,
  metadata: {
    child_id: opts.childId,
    policy_type: opts.input.policy_type,
    policy_context: `School policy '${opts.input.policy_type}' has changed. Slot scope: ${opts.input.slot_scope}. ${opts.input.policy_description ?? ''}`.trim(),
  },
});
```

### Task 6 — Verify guardrail bag-wide invariant (no code changes needed)

In `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`, verify:

1. The engine evaluates ALL `plan_items` regardless of `slot` value.
2. There is no condition that skips evaluation based on `slot` or `slot_scope`.
3. A blocked verdict on any item causes a full-plan rejection.

Read the file and confirm. No code changes should be needed — this is the guardrail's existing design. Document the confirmation in a comment if useful:

```typescript
// Evaluates all slots unconditionally — FR113 mandates bag-wide allergy checking.
// School-policy slot_scope does NOT apply here. An allergen in the Snack slot
// is just as blocking as one in Main. This is by architectural design (Story 3.1).
```

### Task 7 — Frontend: expose slot scope in school policy form

In `apps/web/src/features/children/SchoolPoliciesForm.tsx` (from Story 3.16), add a `slot_scope` selector to the policy toggle form:

```typescript
// After the policy_type checkbox, show a slot scope dropdown.
// Default is 'bag_wide'. Options: bag_wide, main, snack, extra.
const SLOT_SCOPE_OPTIONS = [
  { value: 'bag_wide', label: 'All slots' },
  { value: 'main', label: 'Main only' },
  { value: 'snack', label: 'Snack only' },
  { value: 'extra', label: 'Extra only' },
] as const;
```

A `<select>` element per active policy, wired to update the `slot_scope` field in the PATCH request body.

### Task 8 — Contract update: ensure `slot_scope` is in `UpdateSchoolPolicyInputSchema`

Verify (from Story 3.16) that `UpdateSchoolPolicyInputSchema` includes:
```typescript
slot_scope: SlotScopeSchema.default('bag_wide'),
```

If it does, no changes needed. If not, add it.

### Task 9 — Tests

**`plan-adjustment.service.test.ts` (extend):**
- Slot-scoped trigger (`slotScope: 'snack'`) → job enqueued with `slot_scope: 'snack'` and `policy_context` in job data
- Bag-wide trigger (`slotScope: 'bag_wide'`) → job enqueued with no `slot_scope` restriction

**`plan-regeneration.job.ts` unit test (extend):**
- Worker with `slot_scope: 'snack'` → `slotScopeContext` string contains "Snack slot" and is prepended to context
- Worker with `slot_scope: undefined` → no slot scope context injected

**`allergy-rules.engine.ts` test (verify/extend):**
- Confirm existing test: allergen in 'snack' slot → full plan blocked (no slot exemption)
- Confirm existing test: allergen in 'extra' slot → full plan blocked

### Task 10 — Typecheck

- `pnpm --filter @hivekitchen/api typecheck`
- `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans/plan-adjustment.service`
- `pnpm --filter @hivekitchen/api exec vitest run src/jobs`

---

## Dev Notes

### AC #2 is architecturally pre-satisfied

The allergy guardrail (Story 3.1) was designed from day one to evaluate ALL slots unconditionally. FR113 is baked into the engine's `clearOrReject()` call signature — it takes a plan (all items) and a household (all allergens) and evaluates every combination. There is no slot-filtering in the guardrail path. This story simply documents and tests that invariant rather than implementing new guardrail logic.

### Slot-scoped regen via prompt vs. structural filtering

True slot-scoped regeneration (only re-plan Snack items, preserve Main/Extra exactly) requires either:
- A structural approach: commit a partial set of items (only the affected slot) and merge with existing
- A prompt approach: instruct the LLM to only change the target slot and preserve others

This story uses the prompt approach for MVP (Task 4). The structural approach (analogous to day-scope regen in Story 3.13's merge logic) is more reliable but more complex. Defer to `deferred-work.md`.

The risk: the LLM may not strictly obey "only change the Snack slot." The existing day-scope regen has the same risk (guarded by output filtering in `plan-regeneration.job.ts`). Add a similar filter for slot-scope: after the planner returns, filter `composeOutput.days` to only include items where `slot === slotScope` and merge with the existing items for other slots. This is the same merge pattern as Story 3.13 Task 8.

### `PlanRegenerationJobData` is in `plan-regeneration.job.ts`

Adding `slot_scope` and `policy_context` to this interface is a backward-compatible change (both are optional). Existing callers (Story 3.13 rate-limit endpoint) don't need to pass these fields.

---

## Project Structure

**No new files** — this story extends existing infrastructure.

**Modified files:**
```
apps/api/src/jobs/plan-regeneration.job.ts       + slot_scope, policy_context in PlanRegenerationJobData; slotScopeContext injection in worker
apps/api/src/agents/orchestrator.ts              + slotScopeContext? param in planWeek(); contextLines.unshift()
apps/api/src/modules/plans/plan-adjustment.types.ts  + verify slotScope field (from 3.17)
apps/api/src/modules/plans/plan-adjustment.service.ts  + pass slot_scope + policy_context to job data
apps/api/src/modules/children/school-policies.service.ts  + pass policy_context string to triggerAdjustment
apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts  + confirm comment (no logic change)
apps/web/src/features/children/SchoolPoliciesForm.tsx  + slot_scope selector per policy
_bmad-output/implementation-artifacts/sprint-status.yaml  3-23 → ready-for-dev
_bmad-output/implementation-artifacts/deferred-work.md  + structural slot-scope regen note
```

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.23 created — ready-for-dev. |
