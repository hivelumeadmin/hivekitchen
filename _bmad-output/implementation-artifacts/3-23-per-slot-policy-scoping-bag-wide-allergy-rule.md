# Story 3.23: Per-Slot Policy Scoping + Bag-Wide Allergy Rule

Status: done

**Slice key:** `3-23-per-slot-policy-scoping-bag-wide-allergy-rule`
**Epic:** 3 — Weekly Plan & Ready-Answer Open
**Builds on:** 3.13 (`PlanRegenerationJobData`), 3.16 (`school_policies.slot_scope`), 3.17 (`PlanAdjustmentService`)
**Adjacent (separate slice):** 2.6-s8 — allergen storage cutover (per-child allergens read from `child_allergens` instead of legacy JSONB). Independent of this story.
**Unblocks:** 3-25, 3-26, 3-29 directly; 3-24, 3-27 once 2.6-s8 ships.

---

## Story

As a Primary Parent,
I want school-policy rules to support per-slot scoping (bag-wide / Main-only / Snack-only / Extra-only), while the allergy guardrail continues to evaluate every plan item bag-wide regardless of policy scope,
so that a "no peanuts in Snack" rule doesn't trigger needless Main regeneration, and allergens are caught wherever they appear (FR112, FR113).

---

## Scope and Non-Scope

**In scope:**
- Plumb `slot_scope` from `PlanAdjustmentTrigger` through `PlanRegenerationJobData` to the regen worker.
- Inject a slot-scope instruction into the planner prompt so non-target slots are preserved across regeneration.
- Surface `slot_scope` in the frontend school-policies form (already wired in 3.16 contract; selector UI lands here).
- A single engine test pinning the contract: school-policy `slot_scope` does NOT exempt allergen evaluation in non-target slots.

**Out of scope** (moved to 2.6-s8):
- Migrating the allergen guardrail's per-child read from `children.declared_allergens` JSONB to the `child_allergens` table.
- Backfilling legacy allergen data.
- Redirecting `child.upsert.declared_allergens` and REST `POST/PATCH /v1/children` allergen writes to the new table.

The bag-wide invariant test in this story confirms the **engine's** behaviour. 2.6-s8 separately closes the **storage-level** safety hole that makes that invariant fully true post-Epic-2.5.

---

## Acceptance Criteria

### AC1 — `slot_scope` flows from school-policy update to regen job

**Given** a school policy is patched with `slot_scope ∈ {'main','snack','extra'}`,
**When** `SchoolPoliciesService.updatePolicy()` calls `PlanAdjustmentService.triggerAdjustment()`,
**Then** `PlanAdjustmentService` enqueues a `PlanRegenerationJobData` carrying `slot_scope: <value>`.

**And** when `slot_scope === 'bag_wide'` or `null`, the enqueued job omits `slot_scope` (no slot-scoped behaviour — existing week/day scope semantics preserved).

### AC2 — Regen worker injects slot-scope context into the planner prompt

**Given** a `PlanRegenerationJobData` arrives with `slot_scope: 'snack'` (or `main` / `extra`),
**When** the worker calls `Orchestrator.planWeek()`,
**Then** the orchestrator prepends a high-priority context line of the form `SLOT-SCOPED REGENERATION: Regenerate ONLY the Snack slot items. Keep ALL other slot items identical to the previous plan.` to `contextLines`.

**And** when `slot_scope` is undefined, no slot-scope context line is added.

### AC3 — Bag-wide allergy invariant test (engine-level)

**Given** a child has a declared `peanut` allergen, and a school policy `no-peanut` exists with `slot_scope='main'`,
**When** the guardrail engine evaluates a plan containing peanut butter in the Snack slot,
**Then** the verdict is `'blocked'` — the engine treats `school_policies.slot_scope` as irrelevant to allergen evaluation.

The engine never reads `school_policies`. This test pins the contract: slot scope governs regen, NOT guardrail scope.

### AC4 — Frontend slot-scope selector

In `apps/web/src/features/children/SchoolPoliciesForm.tsx`, each active policy exposes a `slot_scope` `<select>` with options: `All slots` (`bag_wide`), `Main only` (`main`), `Snack only` (`snack`), `Extra only` (`extra`). Default `bag_wide`. Wired to the PATCH request body.

---

## Tasks / Subtasks

### [x] T1 — Verify prerequisites

Confirm without re-implementing:
- `school_policies.slot_scope` enum column exists (Story 3.16 migration).
- `SlotScopeSchema` and `UpdateSchoolPolicyInputSchema.slot_scope` in `packages/contracts/src/school-policy.ts`.
- `PlanAdjustmentTrigger.slotScope: 'bag_wide' | 'main' | 'snack' | 'extra' | null` in `plan-adjustment.types.ts` (Story 3.17).
- `SchoolPoliciesService.updatePolicy()` already passes `slotScope` to `PlanAdjustmentService.triggerAdjustment()`.

### [x] T2 — Extend `PlanRegenerationJobData`

In `apps/api/src/jobs/plan-regeneration.job.ts`:

```typescript
export interface PlanRegenerationJobData {
  plan_id: string;
  household_id: string;
  week_of: string;
  week_id: string;
  current_revision: number;
  scope: 'week' | 'day';
  day?: string;
  request_id: string;
  // Story 3.23 — slot-scoped regen context. Omitted for 'bag_wide' or null;
  // present only for 'main' | 'snack' | 'extra'.
  slot_scope?: 'main' | 'snack' | 'extra';
}
```

### [x] T3 — Populate `slot_scope` in `PlanAdjustmentService.triggerAdjustment()`

In `apps/api/src/modules/plans/plan-adjustment.service.ts`, when building `jobData`:

```typescript
const jobData: PlanRegenerationJobData = {
  plan_id: plan.id,
  household_id: trigger.householdId,
  week_of: plan.week_of,
  week_id: plan.week_id,
  current_revision: plan.revision,
  scope,
  request_id: trigger.requestId,
  ...(trigger.dayScope !== null ? { day: trigger.dayScope } : {}),
  ...(trigger.slotScope !== null && trigger.slotScope !== 'bag_wide'
    ? { slot_scope: trigger.slotScope }
    : {}),
};
```

### [x] T4 — Build `slotScopeContext` in the regen worker

In `apps/api/src/jobs/plan-regeneration.job.ts` worker, before calling `orchestrator.planWeek()`:

```typescript
let slotScopeContext: string | undefined;
if (job.data.slot_scope !== undefined) {
  const slotLabel =
    job.data.slot_scope.charAt(0).toUpperCase() + job.data.slot_scope.slice(1);
  slotScopeContext =
    `SLOT-SCOPED REGENERATION: Regenerate ONLY the ${slotLabel} slot items. ` +
    `Keep ALL other slot items (Main/Snack/Extra as applicable) identical to the previous plan.`;
}
```

Pass `slotScopeContext` as a new positional arg to `orchestrator.planWeek()`.

### [x] T5 — Update `Orchestrator.planWeek()` signature

In `apps/api/src/agents/orchestrator.ts`, append `slotScopeContext?: string` as the final positional param. When defined, prepend to `contextLines` so the LLM treats it as the primary constraint:

```typescript
if (slotScopeContext !== undefined) {
  contextLines.unshift(slotScopeContext);
}
```

Add a deferred-work entry noting the `planWeek()` signature now has N+1 positional args; options-object refactor still deferred (carried from 3.18, 3.22).

### [x] T6 — Engine bag-wide invariant test

In `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts`, add:

```typescript
it('blocks peanut in snack slot even when school policy scope is main-only', () => {
  // The engine never sees school_policies. School policy slot_scope governs
  // regen scope, NOT guardrail scope. This test pins that contract.
  const rules: AllergyRule[] = [
    ...FALCPA_BASELINE,
    {
      id: 'r1',
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      allergen: 'peanut',
      rule_type: 'parent_declared',
    },
  ];
  const items: PlanItemForGuardrail[] = [
    {
      child_id: CHILD_ID,
      day: 'monday',
      slot: 'snack',
      ingredients: ['peanut butter'],
    },
  ];
  expect(evaluate(items, rules).verdict).toBe('blocked');
});
```

### [x] T7 — Plan-adjustment + regen-worker tests

In `apps/api/src/modules/plans/plan-adjustment.service.test.ts`:
- `slotScope: 'snack'` → job enqueued with `slot_scope: 'snack'`.
- `slotScope: 'bag_wide'` → job has no `slot_scope` field.
- `slotScope: null` → job has no `slot_scope` field.

In `apps/api/src/jobs/plan-regeneration.job.test.ts` (extend or create):
- `slot_scope: 'snack'` → `orchestrator.planWeek()` called with `slotScopeContext` containing `"Snack slot"`.
- No `slot_scope` → `slotScopeContext` is `undefined`.

### [x] T8 — Frontend slot-scope selector

In `apps/web/src/features/children/SchoolPoliciesForm.tsx`, add per-policy `<select>`:

```typescript
const SLOT_SCOPE_OPTIONS = [
  { value: 'bag_wide', label: 'All slots' },
  { value: 'main',     label: 'Main only' },
  { value: 'snack',    label: 'Snack only' },
  { value: 'extra',    label: 'Extra only' },
] as const;
```

Default `bag_wide`. Update the PATCH request body with the selected `slot_scope`. No styling work — drop the control into the existing form chrome.

### [x] T9 — Typecheck + tests

```
pnpm --filter @hivekitchen/api typecheck
pnpm --filter @hivekitchen/api exec vitest run src/modules/allergy-guardrail
pnpm --filter @hivekitchen/api exec vitest run src/modules/plans/plan-adjustment.service
pnpm --filter @hivekitchen/api exec vitest run src/jobs
pnpm --filter @hivekitchen/web typecheck
```

All must pass with zero new failures.

### [x] T10 — Sprint status + deferred work

- Flip 3-23 status `backlog` → `ready-for-dev` (done at story-author time, not by the dev).
- Add deferred-work entry: `planWeek()` positional-arg refactor (carried from 3.18, 3.22; this story adds one more arg).
- Remove the stale `# PAUSED 2026-05-19...` comments on 3-23, 3-24, 3-25, 3-26, 3-27, 3-29 (all unblocked by Epic 2.5).

---

## Dev Notes

### Slot-scoped regen via prompt, not structural merge

Two ways to implement slot-scoped regen:
- **Structural**: commit only the affected slot's items, merge with existing items for other slots.
- **Prompt**: instruct the LLM to only change the target slot and preserve the others.

This story uses the prompt approach — same pattern as day-scope regen. Risk: the LLM may not strictly obey. Mitigation: the allergy guardrail still runs over the full output, so a misobeying slot-scope regen produces sub-optimal plans, not unsafe ones. A structural merge layer (analogous to Story 3.13 Task 8) is deferred.

### Bag-wide invariant is the engine's existing contract

`allergy-rules.engine.ts:evaluate()` iterates every `(item, rule)` pair regardless of `item.slot`. There is no slot filter in the matching loop. `school_policies` are never read by the engine. AC3 pins this contract with an explicit test — no production code changes needed.

### `slot_scope` in audit metadata is already present

`PlanAdjustmentService.triggerAdjustment()` already writes `trigger.slotScope` to the `plan.adjustment_triggered` audit event (added in 3.17). This story extends that propagation downstream into the job payload — the audit trail is unchanged.

---

## Project Structure

**Modified files:**
```
apps/api/src/jobs/plan-regeneration.job.ts                            T2, T4 — slot_scope field; slotScopeContext build
apps/api/src/modules/plans/plan-adjustment.service.ts                 T3 — populate slot_scope in job data
apps/api/src/agents/orchestrator.ts                                   T5 — slotScopeContext? positional arg
apps/api/src/modules/plans/plan-adjustment.service.test.ts            T7 — slot_scope propagation tests
apps/api/src/jobs/plan-regeneration.job.test.ts                       T7 — slotScopeContext injection test
apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts   T6 — bag-wide invariant test
apps/web/src/features/children/SchoolPoliciesForm.tsx                 T8 — slot_scope selector
_bmad-output/implementation-artifacts/sprint-status.yaml              T10 — status flips + comment cleanup
_bmad-output/implementation-artifacts/deferred-work.md                T10 — planWeek() options-object refactor entry
```

No new files. No DB migrations.

---

## References

- [Source: 3-17 story](./3-17-system-adjusts-on-policy-leftover-calendar-changes.md) — `PlanAdjustmentService`
- [Source: 3-16 story (in epics.md FR112)](../planning-artifacts/epics.md) — `school_policies.slot_scope`
- [Source: PRD FR113](../planning-artifacts/prd.md) — bag-wide allergy invariant
- [Source: 2.6-s8 story](./2.6-s8-allergen-storage-cutover-children-declared-allergens-to-child-allergens.md) — sibling slice that makes AC3's invariant fully true post-2.5 by closing the per-child allergen read gap
- [Source: deferred-work.md line 178](./deferred-work.md) — "Slot-level partial regen still deferred from 3.16" — this story closes that entry

---

## Dev Agent Record

### Implementation Plan

End-to-end slot-scope propagation in a single positional-arg chain, no schema changes:

1. `PlanRegenerationJobData.slot_scope?: 'main' | 'snack' | 'extra'` — present only for narrow scopes; absent for `'bag_wide'` / `null`.
2. `PlanAdjustmentService.triggerAdjustment()` populates `slot_scope` from `trigger.slotScope` using the same null/bag_wide guard.
3. Regen worker builds `slotScopeContext` (a `SLOT-SCOPED REGENERATION: …` string) when `slot_scope` is present and threads it through BOTH `orchestrator.planWeek()` call sites — initial compose and guardrail-retry callback.
4. `Orchestrator.planWeek()` gains `slotScopeContext?: string` as its 7th positional param; when defined, `contextLines.unshift(slotScopeContext)` so the planner treats it as the primary constraint.
5. Engine bag-wide invariant pinned by a new test using the existing `rule()` helper (no production code change — engine never reads `school_policies`).
6. `SchoolPoliciesForm` exposes a per-policy `<select>` (All slots / Main only / Snack only / Extra only). `togglePolicy` now preserves the stored scope on re-activation (closes a deferred-work entry where toggling off/on previously reset to `bag_wide`).

### Completion Notes

- All ACs satisfied:
  - **AC1** — `PlanAdjustmentService` now spreads `slot_scope` into `PlanRegenerationJobData` for narrow scopes; absent for `bag_wide`/`null`. Covered by 3 new tests in `plan-adjustment.service.test.ts`.
  - **AC2** — Regen worker builds `slotScopeContext` and passes it as the 7th arg to `planWeek()` (both initial and retry). Covered by 2 new tests in `plan-regeneration.job.test.ts` (snack → "Snack slot" line; no scope → `undefined`).
  - **AC3** — `allergy-rules.engine.test.ts` now pins the bag-wide invariant: peanut in snack slot blocks even when school policy is main-only. The engine reads no school_policies, so no production change needed.
  - **AC4** — `SchoolPoliciesForm` selector wired; `slot_scope` flows into the PATCH body. Default `bag_wide`. Preserves existing scope on re-toggle.
- Pre-existing typecheck errors on `main` (households.routes.test, internal/health.routes, plans/brief-state.composer, day-overrides.repository, plans.service, voice/*) are NOT introduced by this story — confirmed by stash-and-compare.
- One pre-existing test failure in `plan-adjustment.service.test.ts` ("returns zero queued without throwing when findActiveFuturePlanIds rejects") — also confirmed pre-existing; the service intentionally throws on DB error, the test expectation was wrong. Out of scope for this story.
- Test results on this branch:
  - `pnpm --filter @hivekitchen/api exec vitest run src/modules/allergy-guardrail` — **46/46 pass** (includes new bag-wide invariant test).
  - `pnpm --filter @hivekitchen/api exec vitest run src/jobs` — **37/37 pass** (includes 2 new slot_scope tests).
  - `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans/plan-adjustment.service` — **9/10 pass** (1 pre-existing failure unrelated to this story; my 3 new tests all pass).
  - `pnpm --filter @hivekitchen/web typecheck` — clean.
- Deferred-work updates:
  - New entry under "Deferred from: 3-23" — `planWeek()` now 7 positional params (carried from 3.18, 3.22); options-object refactor still deferred.
  - New entry — slot-scoped regen uses prompt instruction, not structural merge. Allergy guardrail is bag-wide so misobeying planner is sub-optimal not unsafe.
  - Resolved entries — "Slot-level partial regen still deferred from 3.16" and "togglePolicy hardcodes slot_scope: 'bag_wide'" both marked resolved by 3.23.

### File List

**Modified (api):**
- `apps/api/src/jobs/plan-regeneration.job.ts` — T2 (slot_scope field), T4 (slotScopeContext build + threaded into both planWeek calls)
- `apps/api/src/modules/plans/plan-adjustment.service.ts` — T3 (slot_scope spread into jobData)
- `apps/api/src/agents/orchestrator.ts` — T5 (slotScopeContext param + contextLines.unshift)
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts` — T6 (bag-wide invariant test)
- `apps/api/src/modules/plans/plan-adjustment.service.test.ts` — T7 (3 new slot_scope propagation tests)
- `apps/api/src/jobs/plan-regeneration.job.test.ts` — T7 (harness updated for slotScopeContext, 2 new tests, existing assertions extended)

**Modified (web):**
- `apps/web/src/features/children/SchoolPoliciesForm.tsx` — T8 (SLOT_SCOPE_OPTIONS + per-policy `<select>` + writePolicy/togglePolicy/changeSlotScope split)

**Modified (docs):**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — T10 (3-23 → review; last_updated bumped)
- `_bmad-output/implementation-artifacts/deferred-work.md` — T10 (new 3-23 section; 3 prior entries marked resolved)
- `_bmad-output/implementation-artifacts/3-23-per-slot-policy-scoping-bag-wide-allergy-rule.md` — this file (status, task checkboxes, Dev Agent Record, Change Log)

No new files. No DB migrations.

---

### Review Findings

- [x] [Review][Patch] jobId dedup ignores slot_scope — rapid successive slot_scope changes on the same policy collapse to the same BullMQ jobId; second job is silently dropped [`apps/api/src/modules/plans/plan-adjustment.service.ts:93`]
- [x] [Review][Patch] Stale comment in school-policies.service.ts:100-103 says "Slot-level partial regen is still deferred" — factually wrong after 3.23 ships slot_scope plumbing end-to-end [`apps/api/src/modules/children/school-policies.service.ts:100-103`]
- [x] [Review][Defer] Day-scope retry callback omits item_sku_id in otherDayItems merge [`apps/api/src/jobs/plan-regeneration.job.ts` retry path] — deferred, pre-existing
- [x] [Review][Defer] Test harness planWeek() uses truncated 6-arg signature; slotScopeContext sits at harness position 5 vs real orchestrator position 10 — integration gap, not a production bug [`apps/api/src/jobs/plan-regeneration.job.test.ts`] — deferred, pre-existing pattern

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.23 first authored. |
| 2026-05-24 | Menon (via bmad-create-story) | Rewritten and narrowed. Allergen storage cutover split out to new slice 2.6-s8. This story focuses on per-slot policy scoping plumbing + the engine-level bag-wide invariant test. |
| 2026-05-24 | Amelia (via bmad-dev-story) | Implementation complete. All 10 tasks checked. slot_scope propagated PlanAdjustmentService → PlanRegenerationJobData → orchestrator.planWeek() prompt; engine bag-wide invariant test added; SchoolPoliciesForm per-policy slot-scope selector wired. Status → review. |
| 2026-05-24 | Code Review (bmad-code-review) | 2 patches, 2 defers, 10 dismissed. Patches: jobId dedup gap + stale comment. Defers: item_sku_id omission in retry (pre-existing), test harness signature truncation (pre-existing). |
