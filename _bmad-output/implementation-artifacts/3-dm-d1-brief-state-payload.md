# Story 3-DM-D1: brief_state.payload consolidation + plan_state write path migration

Status: review

## Story

As Epic 3 data-model solutioning,
I want to consolidate brief_state's four loose JSONB columns (`plan_tile_summaries`, `cleared_allergies`, `scaffolding_diff`, `plan_state*`) into a single validated `payload jsonb` column, and route the `plan_state` write path from brief_state to the `plans` table where it belongs,
so that the brief_state table is a true projection cache with one structured payload, and plan state (degraded/hard_failed) lives on the plan row that owns it.

## Acceptance Criteria

1. **`payload` column exists on `brief_state`.** `brief_state.payload jsonb NOT NULL DEFAULT '{}'` exists. The six legacy columns (`plan_tile_summaries`, `cleared_allergies`, `scaffolding_diff`, `plan_state`, `plan_state_set_at`, `plan_state_message`) are dropped.

2. **`plans.state` backfilled from `brief_state`.** `plans.state/state_set_at/state_message` (columns added by C1 migration `20261010000000`) are backfilled from `brief_state` for any rows where `brief_state.plan_state IS NOT NULL` — preserving any degraded/hard_failed signals that existed before the migration.

3. **`BriefStatePayloadSchema` defined in contracts.** Validates the structure the composer writes and the Brief route reads:
   ```
   {
     tile_summaries: PlanTileSummary[],
     cleared_allergies: ClearedAllergyEntry[],
     scaffolding_diff: ScaffoldingDiff | null,
     // plan_state mirror — source of truth is plans.state.
     // Null when no degradation/failure.
     plan_state: 'hard_failed' | 'degraded' | null,
     plan_state_set_at: string | null,
     plan_state_message: string | null,
   }
   ```

4. **`BriefStateRowSchema` updated.** Drops the six legacy fields; adds `payload: BriefStatePayloadSchema`. `BriefStateUpsertInput` in `brief-state.repository.ts` replaces the three separate JSONB fields (`plan_tile_summaries`, `cleared_allergies`, `scaffolding_diff`) with a single `payload: BriefStatePayload` field.

5. **`BriefStateComposer.refreshTree()` writes payload.** Builds a single `payload` object. Carries forward `plan_state`/`plan_state_set_at`/`plan_state_message` from `previousBrief?.payload` so a brief refresh does NOT silently clear a degraded state that was set between commits.

6. **`plan_state` write path routes to `plans` table.** `BriefStateRepository.setPlanState()` and `clearDegradedPlanState()` are removed. Two new methods added to `PlansRepository`: `setPlanState(opts)` and `clearDegradedPlanState(householdId)`. Each updates `plans` row(s) and also patches the `brief_state.payload` plan_state mirror (fetch + merge + update).

7. **`PlansService.handleDegradedPlan()` extended.** `planId: string` added to opts. Routes to `this.repo.setPlanState(planId, ...)`. The plan-generation job caller threads `planId` through to this call.

8. **`PLAN_COLUMNS` corrected in `plans.repository.ts`.** Removes stale `week_id` (column dropped in C1 migration `20261010000000`) and adds `state, state_set_at, state_message` so all `PlansRepository` reads return the state fields.

9. **SSE plan_state write path confirmed correct.** The `plan_state` write path (AC6) makes `plans.state` the source of truth for any future SSE implementation. No new SSE implementation is in scope for D1.

10. **Tests remain at baseline; ~10-15 targeted updates.** `brief-state.composer.tree.test.ts` assertions switch from separate fields to `payload.*`. `plans.service.test.ts` `handleDegradedPlan` tests update mock from `briefStateRepo.setPlanState` → `plansRepo.setPlanState`. Pre-existing 22-test API failure baseline is not touched.

## Dependencies & Context

**Predecessor:** 3-DM-C2 (done 2026-06-02). C1's migration `20261010000000_plan_structure_canonical.sql` added `state/state_set_at/state_message` to `plans` with the inline comment *"absorbed from brief_state (D1 will drop the brief_state columns)"*. D1 closes that loop.

**Parallel-safe with:** E1 (day_overrides → plan_day_context rename). D1 and E1 don't share file edits except sprint-status.yaml — if both start in parallel, coordinate the yaml merge.

**What C1 left for D1 specifically:**
- `brief_state.plan_tile_summaries`, `brief_state.cleared_allergies`, `brief_state.scaffolding_diff` still exist in DB; written by `BriefStateComposer.refreshTree()` as separate columns.
- `brief_state.plan_state`, `brief_state.plan_state_set_at`, `brief_state.plan_state_message` still exist in DB; written by `BriefStateRepository.setPlanState()` / `clearDegradedPlanState()`.
- `PLAN_COLUMNS` in `plans.repository.ts` includes stale `week_id` (dropped by C1 migration) and is missing `state/state_set_at/state_message`. This silently prevents `PlansRepository` reads from returning state fields — tests are mocked so it hasn't caused failures yet.
- `BriefStateRowSchema` in `packages/contracts/src/plan.ts` still has the six legacy fields (`plan_tile_summaries`, `cleared_allergies`, `scaffolding_diff`, `plan_state`, `plan_state_set_at`, `plan_state_message`).

**C2 invariant (from C2 AC5):** "Don't touch `brief_state.plan_tile_summaries` / `cleared_allergies` / `scaffolding_diff` — those are D1's job." C2 Task 5 only updated COMMENTS that referenced these columns. The actual write code in `brief-state.repository.ts.setPlanState()` still writes to `brief_state.plan_state*` columns. After D1's migration drops those columns, those methods will throw at runtime — D1 removes/reroutes them.

**Canonical references:**
- `_bmad-output/planning-artifacts/canonical-data-model-design.md` §7 (brief_state canonical shape) + §10.2 (payload decision)
- `_bmad-output/planning-artifacts/phase-4-migration-story-breakdown.md` §Phase D / Story D1

## Tasks / Subtasks

### Task 1 — DB migration: add `payload`, backfill, drop legacy columns (AC #1, #2)

New migration file: `supabase/migrations/20261011000000_brief_state_payload.sql`

```sql
-- Story 3-DM-D1 — brief_state payload consolidation.
--
-- Context: C1 migration (20261010000000) added plans.state/state_set_at/state_message
-- with the comment "D1 will drop the brief_state columns". This migration closes that loop.
--
-- Steps:
--   1. Add payload column (nullable first for backfill)
--   2a. Backfill plans.state from brief_state (for rows where plans.state is still null)
--   2b. Populate payload on all brief_state rows
--   3. Drop 6 legacy columns from brief_state

-- 1. Add payload column as nullable so existing rows can be updated before NOT NULL enforced.
ALTER TABLE brief_state ADD COLUMN payload jsonb;

-- 2a. Backfill plans.state from brief_state.
-- C1 added the plans columns but never backfilled from brief_state.
-- This is defensive for dev rows; pre-beta there should be none with non-null plan_state.
UPDATE plans p
SET state         = bs.plan_state,
    state_set_at  = bs.plan_state_set_at,
    state_message = bs.plan_state_message,
    updated_at    = now()
FROM brief_state bs
WHERE bs.plan_id = p.id
  AND bs.plan_state IS NOT NULL
  AND p.state IS NULL;

-- 2b. Populate payload on all existing brief_state rows.
-- The plan_state mirror fields are included for read convenience.
UPDATE brief_state
SET payload = jsonb_build_object(
  'tile_summaries',     COALESCE(plan_tile_summaries, '[]'::jsonb),
  'cleared_allergies',  COALESCE(cleared_allergies,   '[]'::jsonb),
  'scaffolding_diff',   scaffolding_diff,
  'plan_state',         plan_state,
  'plan_state_set_at',  plan_state_set_at,
  'plan_state_message', plan_state_message
);

-- Make payload NOT NULL now that all rows have been populated.
ALTER TABLE brief_state ALTER COLUMN payload SET NOT NULL;
ALTER TABLE brief_state ALTER COLUMN payload SET DEFAULT '{}';

-- 3. Drop legacy columns.
ALTER TABLE brief_state
  DROP COLUMN plan_tile_summaries,
  DROP COLUMN cleared_allergies,
  DROP COLUMN scaffolding_diff,
  DROP COLUMN plan_state,
  DROP COLUMN plan_state_set_at,
  DROP COLUMN plan_state_message;

-- Down (best-effort restore for dev rollback):
-- ALTER TABLE brief_state
--   ADD COLUMN plan_tile_summaries jsonb NOT NULL DEFAULT '[]',
--   ADD COLUMN cleared_allergies   jsonb NOT NULL DEFAULT '[]',
--   ADD COLUMN scaffolding_diff    jsonb,
--   ADD COLUMN plan_state          plan_state_enum,
--   ADD COLUMN plan_state_set_at   timestamptz,
--   ADD COLUMN plan_state_message  text;
-- UPDATE brief_state SET
--   plan_tile_summaries = COALESCE((payload->>'tile_summaries')::jsonb, '[]'::jsonb),
--   cleared_allergies   = COALESCE((payload->>'cleared_allergies')::jsonb, '[]'::jsonb),
--   scaffolding_diff    = payload->'scaffolding_diff';
-- ALTER TABLE brief_state DROP COLUMN payload;
```

**Verification gate (run before marking Task 1 done):**
```sql
-- Must return 0 (no rows with null payload):
SELECT count(*) FROM brief_state WHERE payload IS NULL;
-- Must return 0 rows (columns are gone):
SELECT column_name FROM information_schema.columns
WHERE table_name = 'brief_state'
  AND column_name IN ('plan_tile_summaries','cleared_allergies','scaffolding_diff',
                      'plan_state','plan_state_set_at','plan_state_message');
```

Apply the migration with: `supabase db push --include-all` or `supabase migration up`.

### Task 2 — Define `BriefStatePayloadSchema` in contracts (AC #3)

**Circular import check first.** `packages/contracts/src/plan.ts` already defines `PlanTileSummarySchema`, `ClearedAllergyEntrySchema`, and `ScaffoldingDiffSchema`. If `BriefStatePayloadSchema` is placed in a new `brief-state.ts` that imports these from `plan.ts`, AND `plan.ts` imports `BriefStatePayloadSchema` from `brief-state.ts`, you have a circular import — TypeScript/Node will error at runtime.

**Recommended approach (avoids the circular import):** define `BriefStatePayloadSchema` at the bottom of `packages/contracts/src/plan.ts`, right after `ScaffoldingDiffSchema`. No new file needed.

```typescript
// In packages/contracts/src/plan.ts, after ScaffoldingDiffSchema:

// D1: single payload column shape for brief_state.
// Source of truth for plan state lives on plans.state; the plan_state*
// fields here are a mirror for routes that read brief_state only.
export const BriefStatePayloadSchema = z.object({
  tile_summaries: z.array(PlanTileSummarySchema).default([]),
  cleared_allergies: z.array(ClearedAllergyEntrySchema).default([]),
  scaffolding_diff: ScaffoldingDiffSchema.nullable().default(null),
  plan_state: z.enum(['hard_failed', 'degraded']).nullable().default(null),
  plan_state_set_at: z.string().datetime({ offset: true }).nullable().default(null),
  plan_state_message: z.string().max(500).nullable().default(null),
});
```

If you choose to create a new `packages/contracts/src/brief-state.ts` instead:
- Move `PlanTileSummarySchema`, `ClearedAllergyEntrySchema`, `ScaffoldingDiffSchema` OUT of `plan.ts` and INTO `brief-state.ts`.
- In `plan.ts`, import those three schemas from `./brief-state.js`.
- Define `BriefStatePayloadSchema` in `brief-state.ts`.
- This avoids circularity and is architecturally cleaner, but requires updating all existing imports of those three schemas across the codebase. **Only take this route if the inline approach feels wrong.**

**Export from index:**
- `packages/contracts/src/index.ts`: add `export { BriefStatePayloadSchema } from './plan.js';` (or `'./brief-state.js'` if using the new-file approach)
- `packages/types/src/index.ts`: add `export type BriefStatePayload = z.infer<typeof BriefStatePayloadSchema>;`

### Task 3 — Update `BriefStateRowSchema` in contracts (AC #4)

In `packages/contracts/src/plan.ts`, update `BriefStateRowSchema`:

**Remove these six fields:**
- `plan_tile_summaries: z.array(PlanTileSummarySchema)`
- `cleared_allergies: z.array(ClearedAllergyEntrySchema).default([])`
- `scaffolding_diff: ScaffoldingDiffSchema.nullable().default(null)`
- `plan_state: z.enum(['hard_failed', 'degraded']).nullable().default(null)`
- `plan_state_set_at: z.string().datetime({ offset: true }).nullable().default(null)`
- `plan_state_message: z.string().min(1).max(500).nullable().default(null)`

**Add:**
- `payload: BriefStatePayloadSchema`

The `BriefResponseSchema.brief` already uses `BriefStateRowSchema.nullable()` — no change needed there.

### Task 4 — Update `brief-state.repository.ts` (AC #4, #6)

**`BRIEF_STATE_COLUMNS`:** replace the six dropped columns with `payload`:
```typescript
const BRIEF_STATE_COLUMNS =
  'household_id, plan_id, moment_headline, lumi_note, memory_prose, payload, generated_at, plan_revision, updated_at';
```

**`BriefStateUpsertInput` interface:** remove the three separate JSONB fields, add `payload`:
```typescript
export interface BriefStateUpsertInput {
  household_id: string;
  plan_id: string | null;
  moment_headline: string;
  lumi_note: string;
  memory_prose: string;
  payload: BriefStatePayload;        // replaces plan_tile_summaries, cleared_allergies, scaffolding_diff
  generated_at: string;
  plan_revision: number;
}
```

Add `import type { BriefStatePayload } from '@hivekitchen/types';` at the top.

**`upsert()` method body:** no change — it spreads `{ ...input, updated_at }` into the Supabase upsert. Since `input.payload` is now the correct shape, the spread works automatically.

**Remove `setPlanState()` and `clearDegradedPlanState()` entirely.** Their replacement lives in `PlansRepository` (Task 5). Also update the `BriefStateRepository` class to remove these method signatures.

### Task 5 — `plans.repository.ts`: add state methods + fix PLAN_COLUMNS (AC #6, #8)

**Fix `PLAN_COLUMNS`** — remove stale `week_id` (column was dropped in C1 migration `20261010000000`), add the three state columns:

```typescript
const PLAN_COLUMNS =
  'id, household_id, week_of, revision, generated_at, guardrail_cleared_at, guardrail_version, prompt_version, state, state_set_at, state_message, created_at, updated_at';
```

**Add `setPlanState()` method:**

```typescript
async setPlanState(opts: {
  planId: string;
  householdId: string;
  planState: 'degraded' | 'hard_failed';
  setAt: string;
  message: string;
}): Promise<void> {
  const now = new Date().toISOString();

  // 1. Update the plans row.
  const { data, error } = await this.client
    .from('plans')
    .update({
      state: opts.planState,
      state_set_at: opts.setAt,
      state_message: opts.message,
      updated_at: now,
    })
    .eq('id', opts.planId)
    .eq('household_id', opts.householdId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (data === null) {
    throw new Error(
      `setPlanState: no plans row for plan ${opts.planId} / household ${opts.householdId}`,
    );
  }

  // 2. Mirror into brief_state.payload (best-effort; row may not exist yet).
  // Safe under per-household BullMQ serialization (one plan-gen job per household at a time).
  const { data: bs } = await this.client
    .from('brief_state')
    .select('payload')
    .eq('household_id', opts.householdId)
    .maybeSingle();
  if (bs) {
    const merged = {
      ...(bs.payload as Record<string, unknown>),
      plan_state: opts.planState,
      plan_state_set_at: opts.setAt,
      plan_state_message: opts.message,
    };
    const { error: bsErr } = await this.client
      .from('brief_state')
      .update({ payload: merged, updated_at: now })
      .eq('household_id', opts.householdId);
    if (bsErr) {
      // Non-fatal: plans row is updated; brief_state mirror can lag.
      // The next refreshTree() will carry forward the plan_state from payload.
    }
  }
}
```

**Add `clearDegradedPlanState()` method:**

```typescript
async clearDegradedPlanState(householdId: string): Promise<void> {
  const now = new Date().toISOString();

  // 1. Clear on plans (only rows currently in 'degraded' state — hard_failed stays).
  const { error } = await this.client
    .from('plans')
    .update({
      state: null,
      state_set_at: null,
      state_message: null,
      updated_at: now,
    })
    .eq('household_id', householdId)
    .eq('state', 'degraded');
  if (error) throw error;

  // 2. Clear the plan_state mirror in brief_state.payload.
  const { data: bs } = await this.client
    .from('brief_state')
    .select('payload')
    .eq('household_id', householdId)
    .maybeSingle();
  if (bs) {
    const merged = {
      ...(bs.payload as Record<string, unknown>),
      plan_state: null,
      plan_state_set_at: null,
      plan_state_message: null,
    };
    await this.client
      .from('brief_state')
      .update({ payload: merged, updated_at: now })
      .eq('household_id', householdId);
  }
}
```

### Task 6 — `BriefStateComposer.refreshTree()`: write payload (AC #5)

**Update the `upsertInput` build in `refreshTree()`:**

Replace:
```typescript
plan_tile_summaries: this.buildTileSummariesTree(tree, suppressionByDay, ratingsMap),
cleared_allergies: this.buildClearedAllergiesTree(tree, children),
scaffolding_diff: this.buildScaffoldingDiffTree(previousTileSummaries, tree, opts.userInitiated ?? false),
```

With:
```typescript
payload: {
  tile_summaries: this.buildTileSummariesTree(tree, suppressionByDay, ratingsMap),
  cleared_allergies: this.buildClearedAllergiesTree(tree, children),
  scaffolding_diff: this.buildScaffoldingDiffTree(
    previousTileSummaries,
    tree,
    opts.userInitiated ?? false,
  ),
  // Carry forward plan_state mirror from previous payload so a brief refresh
  // does NOT silently clear a degraded state that was set between commits.
  plan_state: previousBrief?.payload?.plan_state ?? null,
  plan_state_set_at: previousBrief?.payload?.plan_state_set_at ?? null,
  plan_state_message: previousBrief?.payload?.plan_state_message ?? null,
},
```

**Update `previousTileSummaries` extraction** from:
```typescript
const previousTileSummaries = previousBrief?.plan_tile_summaries ?? null;
```
to:
```typescript
const previousTileSummaries = previousBrief?.payload?.tile_summaries ?? null;
```

**Add import** for `BriefStatePayload` type at the top of `brief-state.composer.ts`:
```typescript
import type { ..., BriefStatePayload } from '@hivekitchen/types';
```

The `BriefStateUpsertInput.payload` is typed as `BriefStatePayload`, so TypeScript enforces the shape.

**Note:** `previousBrief?.payload?.plan_state` is typed as `BriefStatePayload['plan_state']` (the union or null). Since `BriefStatePayloadSchema` uses `z.enum(...)`, the type inference is correct.

### Task 7 — `plans.service.ts`: update handleDegradedPlan + clearDegradedPlanState (AC #7)

**`handleDegradedPlan()`:** add `planId` to opts and route through `this.repo.setPlanState()`:

```typescript
async handleDegradedPlan(opts: {
  householdId: string;
  planId: string;        // D1: required for plans table write
  requestId: string;
}): Promise<void> {
  const message =
    "This week's plan couldn't honor every rule strictly. Try alternating whose rules lead each day?";
  await this.repo.setPlanState({
    planId: opts.planId,
    householdId: opts.householdId,
    planState: 'degraded',
    setAt: new Date().toISOString(),
    message,
  });
  try {
    await this.auditService.write({
      event_type: 'plan.cultural_degraded',
      household_id: opts.householdId,
      request_id: opts.requestId,
      metadata: { reason: 'CULTURAL_INTERSECTION_EMPTY' },
    });
  } catch (err) {
    this.logger.error(
      { err, household_id: opts.householdId },
      'audit write failed for plan.cultural_degraded',
    );
  }
}
```

**`clearDegradedPlanState()`:** delegate to repo:
```typescript
async clearDegradedPlanState(householdId: string): Promise<void> {
  await this.repo.clearDegradedPlanState(householdId);
}
```

`briefStateRepo` remains a constructor dep for the `upsert()` path (still needed). Only the two method calls are rerouted.

### Task 8 — `plan-generation.job.ts`: thread planId to handleDegradedPlan (AC #7)

Find the `handleDegradedPlan` call site (should be exactly one) and thread `planId`:

```typescript
// Before D1:
await plansService.handleDegradedPlan({
  householdId: opts.householdId,
  requestId,
});

// After D1 — planId comes from the commit() result above:
await plansService.handleDegradedPlan({
  householdId: opts.householdId,
  planId: committedPlanId,   // available from commit() return value at this call site
  requestId,
});
```

Trace: `commit()` in `plans.service.ts` returns the committed plan's ID. That value should be in scope at the `handleDegradedPlan` call site. If it's not already named `committedPlanId`, find the variable that holds the plan.id after commit and use it.

### Task 9 — Test updates (AC #10)

**`apps/api/src/modules/plans/brief-state.composer.tree.test.ts`:**

Update all assertions from separate field paths to `payload.*`. Key changes:

```typescript
// BEFORE:
type UpsertCall = {
  plan_tile_summaries: Array<{ day: string; ... }>;
  cleared_allergies: Array<{ child_id: string; allergen: string }>;
  scaffolding_diff: ...;
};
expect(upsertCall.plan_tile_summaries).toHaveLength(1);
expect(upsertCall.plan_tile_summaries[0]?.day).toBe('monday');
expect(upsertCall.cleared_allergies).toEqual([...]);

// AFTER:
type UpsertCall = {
  payload: {
    tile_summaries: Array<{ day: string; ... }>;
    cleared_allergies: Array<{ child_id: string; allergen: string }>;
    scaffolding_diff: ...;
    plan_state: null;
    plan_state_set_at: null;
    plan_state_message: null;
  };
};
expect(upsertCall.payload.tile_summaries).toHaveLength(1);
expect(upsertCall.payload.tile_summaries[0]?.day).toBe('monday');
expect(upsertCall.payload.cleared_allergies).toEqual([...]);
```

Also update the `previousBrief` mock shape from:
```typescript
previousBrief?: { plan_tile_summaries: [] } | null;
```
to:
```typescript
previousBrief?: { payload: { tile_summaries: []; plan_state: null; plan_state_set_at: null; plan_state_message: null } } | null;
```

**`apps/api/src/modules/plans/plans.service.test.ts` — `handleDegradedPlan` describe block (around line 1160):**

- Add `planId: 'plan-uuid'` to the `handleDegradedPlan` opts in all test calls.
- Change mock setup from `briefStateRepo.setPlanState` to `plansRepo.setPlanState` (if the test mocks a separate `briefStateRepo`, check if `plansRepo` is already mocked in that describe block's scope).
- Update the assertion from `expect(briefStateRepo.setPlanState).toHaveBeenCalledTimes(1)` to `expect(plansRepo.setPlanState).toHaveBeenCalledTimes(1)`.
- Update the `clearDegradedPlanState` delegation test to assert on `plansRepo.clearDegradedPlanState` instead of `briefStateRepo.clearDegradedPlanState`.

**`apps/api/src/modules/plans/plans.routes.test.ts`:** Grep for any assertion on `brief.plan_tile_summaries` or `brief.plan_state` in route test responses. If found, update to `brief.payload.tile_summaries` / `brief.payload.plan_state`.

**Total estimate:** 12-15 assertion/mock line changes across 2-3 test files.

### Review Findings (AI)

Code review outcome: **Changes Requested** (3 patches, 5 deferred, 6 dismissed)

#### Patch items (must fix before done)

- [x] [Review][Patch] `clearDegradedPlanState` does not capture `{ error: bsErr }` on brief_state mirror update — fixed: added `const { error: bsErr } =` destructure + non-fatal comment block, matching `setPlanState` style [apps/api/src/modules/plans/plans.repository.ts — clearDegradedPlanState mirror block]
- [x] [Review][Patch] `clearDegradedPlanState` clears brief_state mirror even when no plans rows matched the `.eq('state', 'degraded')` filter — fixed: added `.select('id')` to the plans UPDATE and early-return when `cleared.length === 0`; mirror is now only patched when a degraded row was actually cleared [apps/api/src/modules/plans/plans.repository.ts — clearDegradedPlanState]
- [x] [Review][Patch] Empty `plan_state_message` (`""`) passes `z.string().max(500)` schema and the `planStateMessage !== null` render guard — fixed: added `&& planStateMessage !== ''` to the render condition [apps/web/src/features/plan/BriefCanvas.tsx:364]

#### Deferred items

- [x] [Review][Defer] `setPlanState` brief_state SELECT error is silently discarded (no logger in PlansRepository — repo layer lacks `this.logger` by project pattern) [apps/api/src/modules/plans/plans.repository.ts:471] — deferred, pre-existing architectural constraint
- [x] [Review][Defer] `refreshTree` vs `setPlanState` race: swap-triggered refreshTree calls (outside BullMQ serialization) can transiently overwrite the brief_state mirror with `plan_state: null` — plans.state (source of truth) remains correct [apps/api/src/modules/plans/brief-state.composer.ts:241] — deferred, pre-existing concurrency trade-off with carry-forward Option A
- [x] [Review][Defer] First-run edge case: if `refreshTree` fails before `brief_state` row is created AND plan is degraded, `setPlanState` skips the mirror write (no row exists) and the next `refreshTree` creates the row with `plan_state: null` — deferred, requires cascaded failures
- [x] [Review][Defer] `findActiveFuturePlanIds` SELECTs `week_id` in its projection list — pre-existing C1 issue (week_id was dropped by 20261010000000); will fail at runtime against the real DB — deferred, pre-existing C1 regression, not introduced by D1
- [x] [Review][Defer] `makeBrief()` in BriefCanvas.test.tsx: `...payloadOverrides` spread sets `undefined` values on keys rather than omitting keys — test fidelity gap (component's `?? null` guard masks the distinction) — deferred, test-only, no production impact

### Task 10 — Verification and sprint status (AC #10)

- [x] Run `pnpm --filter @hivekitchen/api test` — 22-test failing baseline unchanged (1280 passed / 22 failed / 13 skipped; the 10 failing files are the pre-existing set — none are D1-touched).
- [x] Run `pnpm --filter @hivekitchen/web test` — 374/374 green.
- [x] Run per-package `tsc --noEmit` — API 13, Web 3, Contracts 1, Types 1 (all baseline; no new errors; recursive `pnpm -r exec` trips on `packages/tsconfig`, so run per-package).
- [ ] Apply migration: `supabase db push --include-all`. **USER-SIDE GATE** — destructive (drops 6 brief_state columns) against linked remote Supabase; deferred to the user per C1/C2 apply precedent.
- [ ] Run verification SQL from Task 1. **USER-SIDE GATE** — runs after the migration is applied.
- [x] Update `_bmad-output/implementation-artifacts/sprint-status.yaml`: `3-dm-d1-brief-state-payload` → `review` (dev-story workflow Step 9 routes to review; flips to `done` after the migration-apply gate + code review).

## Test Plan

D1's new test surface is small:

**`brief-state.composer.tree.test.ts`** (~8 assertion changes): update `plan_tile_summaries/cleared_allergies/scaffolding_diff` field paths to `payload.tile_summaries/payload.cleared_allergies/payload.scaffolding_diff`. Update `previousBrief` mock shape. No new test cases needed — the composer behavior is unchanged; only the upsert shape changes.

**`plans.service.test.ts`** (~5 changes): update `handleDegradedPlan` tests to mock `plansRepo.setPlanState` instead of `briefStateRepo.setPlanState`. Add `planId` to opts. Update assertion target. Update `clearDegradedPlanState` delegation test.

**No new test files** for `plans.repository.ts` `setPlanState` / `clearDegradedPlanState` — these methods make two Supabase calls each (plans UPDATE + brief_state payload patch). The Supabase client is mocked elsewhere in plans.repository.tree.test.ts; if adding tests, follow that pattern. Low priority — the methods are thin wrappers over the Supabase client.

**Migration verification** via the two SQL checks in Task 1, not a test suite.

## Rollback

- **Task 1 (migration):** run the down migration to restore 6 columns + drop `payload`. Any `plans.state` data written post-migration is lost on rollback — acceptable pre-beta.
- **Tasks 2-4 (contracts/schema):** revert schema changes in `plan.ts` / `index.ts` / `types/index.ts`.
- **Task 4 (brief-state.repository):** restore `BRIEF_STATE_COLUMNS`, `BriefStateUpsertInput`, `setPlanState()`, `clearDegradedPlanState()`.
- **Task 5 (plans.repository):** revert `PLAN_COLUMNS`; remove `setPlanState()` and `clearDegradedPlanState()`.
- **Task 6 (composer):** restore three separate fields in `refreshTree()`.
- **Tasks 7-8 (service + job):** restore `briefStateRepo.setPlanState()` call; remove `planId` from opts.
- **Task 9 (tests):** restore field-path assertions.

C1 and C2 stay untouched in all rollback paths.

## Dev Notes

### Architecture compliance

- **`brief_state` is a Tier B projection.** Source of truth for plan state lives on `plans.state`. The `payload.plan_state` mirror exists so routes that read only `brief_state` (the Brief route at `GET /v1/households/:id/brief`) don't need a second join to `plans`. This is why the composer carries forward `plan_state` from `previousBrief?.payload` — it preserves the mirror across refresh cycles.

- **No business logic in the migration.** The SQL in Task 1 is a data shape change + backfill. No conditional logic, no service-level Zod parsing in SQL.

- **PII guard on `brief_state.payload`.** The payload contains `cleared_allergies` entries with child name (display name) and allergen labels. This is a pre-existing PII exposure — D1 doesn't change the data, only reshapes the column. Do NOT log payload content in Pino; the existing `brief.projection.failure` audit emit logs only structural metadata, not payload values.

- **`week_id` in `PLAN_COLUMNS` is load-bearing.** The stale `week_id` column in the constant would produce PostgREST errors on any query that hits the real DB (Supabase returns an error if you SELECT a non-existent column). Tests are mocked which is why no failure is visible yet. Fixing this (Task 5) is critical before any real-DB interaction with `PlansRepository`.

### Circular import (Task 2)

Before creating `packages/contracts/src/brief-state.ts`, confirm the import graph. If `brief-state.ts` needs to import from `plan.ts` AND `plan.ts` needs to import from `brief-state.ts`, you have a cycle. Safest default: define `BriefStatePayloadSchema` in `plan.ts` at the bottom of the file, after the schemas it depends on (`PlanTileSummarySchema`, `ClearedAllergyEntrySchema`, `ScaffoldingDiffSchema`). Export it. Done.

### Carry-forward plan_state mirror (Task 6)

The carry-forward pattern (Option A in the story spec) means: if `refreshTree()` runs while a plan is degraded, the brief_state.payload will preserve the degraded state. This is correct — the composer doesn't re-evaluate degradation; it just rewrites the tile summaries. The degraded state is cleared ONLY when `clearDegradedPlanState()` is explicitly called (sovereignty-mode selection). Do NOT reset `plan_state: null` unconditionally in the composer.

### `handleDegradedPlan` planId threading (Tasks 7-8)

The plan-generation job (`apps/api/src/jobs/plan-generation.job.ts`) already knows the `planId` from the `commit()` result. Check the call-site scope — `committedPlanId` or similar should already be in scope when `handleDegradedPlan` is called. If not, trace `commit()` → its return value → the variable that holds the plan ID.

### `PLAN_COLUMNS` fix impact

After removing `week_id` and adding `state/state_set_at/state_message`:
- Any code that accesses `.week_id` on a `PlanRow` will be caught by TypeScript (since `PlanRowSchema` already dropped `week_id` in C1 step-5). Fix any such instances.
- Any code that expects state fields on a `PlanRow` and was previously getting `undefined` (because the SELECT didn't include them) will now get actual values. This is correct behavior.

### Source-tree files touched

**New:**
- `supabase/migrations/20261011000000_brief_state_payload.sql`

**Modified — packages:**
- `packages/contracts/src/plan.ts` — add `BriefStatePayloadSchema`; update `BriefStateRowSchema` (drop 6 fields, add `payload`)
- `packages/contracts/src/index.ts` — export `BriefStatePayloadSchema`
- `packages/types/src/index.ts` — add `BriefStatePayload` type

**Modified — apps/api:**
- `apps/api/src/modules/plans/brief-state.repository.ts` — `BRIEF_STATE_COLUMNS`, `BriefStateUpsertInput`, import; remove `setPlanState()` and `clearDegradedPlanState()`
- `apps/api/src/modules/plans/brief-state.composer.ts` — `refreshTree()`: build payload, carry forward plan_state mirror; update `previousTileSummaries` extraction
- `apps/api/src/modules/plans/plans.repository.ts` — fix `PLAN_COLUMNS`; add `setPlanState()` and `clearDegradedPlanState()`
- `apps/api/src/modules/plans/plans.service.ts` — `handleDegradedPlan()` (add `planId` + reroute); `clearDegradedPlanState()` (reroute)
- `apps/api/src/jobs/plan-generation.job.ts` — thread `planId` to `handleDegradedPlan()`

**Modified — tests:**
- `apps/api/src/modules/plans/brief-state.composer.tree.test.ts` — payload assertion updates
- `apps/api/src/modules/plans/plans.service.test.ts` — `handleDegradedPlan` mock + assertion updates

### References

- C1 story: `_bmad-output/implementation-artifacts/3-dm-c1-plan-structure-cutover.md`
- C2 story: `_bmad-output/implementation-artifacts/3-dm-c2-phase-c-cleanup.md`
- Phase 4 breakdown (D1 spec): `_bmad-output/planning-artifacts/phase-4-migration-story-breakdown.md`
- Canonical model §7 + §10.2: `_bmad-output/planning-artifacts/canonical-data-model-design.md`
- C1 migration (state columns + "D1 will drop" comment): `supabase/migrations/20261010000000_plan_structure_canonical.sql`

## Previous Story Intelligence

From 3-DM-C2 (done 2026-06-02) and 3-DM-C1:

- **C2 baseline:** API 22 tests failing (same 10 file categories, all pre-existing); Web 374/374; API typecheck 13; Web 3. D1 must not introduce new failures.
- **C1 migration added `plans.state*` columns but DID NOT drop `brief_state.plan_state*`.** The migration comment explicitly says "D1 will drop the brief_state columns." So today both sets of columns coexist — the source (plans) and the legacy origin (brief_state).
- **C2 Task 5 updated COMMENTS only.** The actual write code in `brief-state.repository.ts.setPlanState()` still writes to the `brief_state.plan_state*` columns. After D1's migration drops those columns, those writes will throw. D1 removes/reroutes them (Tasks 4+5).
- **`PLAN_COLUMNS` has stale `week_id`.** Pre-existing silent bug: C1 dropped the DB column but the constant was never updated. Tests are mocked so no failure is visible. D1 (Task 5) is the natural fix point.
- **D1 and E1 are parallel-safe.** If E1 starts before D1 ships, coordinate sprint-status.yaml merge.
- **No scope expansion.** D1 is migration + payload consolidation + plan_state write re-route. Do not absorb the "Tree" suffix rename, `VariantProposalSchema.plan_item_id` rename, or any of the 22 pre-existing test failures.

## Git Intelligence Summary

```
416efb2 feat(3-dm-c2): Phase C cleanup — close out post-cutover loose ends
39544eb feat(3-dm-c1): Phase 9b part 4 steps 3-5 + Phase 9c — finish the cutover
```

Follow the per-task commit cadence from C1/C2:
- `feat(3-dm-d1): Task 1 — brief_state payload migration + column drops`
- `feat(3-dm-d1): Tasks 2-4 — BriefStatePayloadSchema + BriefStateRowSchema payload field`
- `feat(3-dm-d1): Tasks 5-8 — plans.repository state methods + service + job wiring`
- `chore(3-dm-d1): Task 9 — test updates for payload shape`
- `feat(3-dm-d1): close out brief_state payload consolidation` (final status flip)

## Latest Tech Information

- **Supabase JS JSONB merge pattern** — `client.from('table').update({ col: mergedObject })` replaces the entire column value. The fetch-then-merge pattern used in `setPlanState()` and `clearDegradedPlanState()` is safe under the existing per-household BullMQ serialization (one plan-generation job per household at a time per story 3.7).
- **`BriefStatePayloadSchema` with `.default()`** — define all sub-fields with `.default()` or `.optional()` so parsing `'{}'` (the column default for new rows) succeeds without error. This means a row with no briefing content yet parses cleanly to the empty-payload defaults.
- **Zod 3.23 (project-locked, story 1-16)** — `z.string().max(500)` is the correct form. No `z.string().trim()` unless needed.

## Project Context Reference

- **Contracts are the wire truth.** `BriefStateRowSchema` must match the DB column set after the migration. The six dropped columns must be removed from the schema, and `payload` must be added.
- **No `any` at API boundaries.** `bs.payload as Record<string, unknown>` in `setPlanState()` / `clearDegradedPlanState()` is acceptable for the fetch-merge-update pattern since we control the payload shape. For stricter safety: `BriefStatePayloadSchema.parse(bs.payload)` then spread — but this adds a Zod parse on every state-change call, which is acceptable given the low frequency.
- **One logical change per commit.** Migration commit is independent and revertable. Code-change commits follow separately.

## Story Completion Status

Ultimate context engine analysis completed — comprehensive developer guide created. Story status: `ready-for-dev`.

The developer has:
- ✅ Exact migration SQL with verification gates and a safe down-migration
- ✅ `BriefStatePayloadSchema` definition with circular-import risk flagged and the inline-in-plan.ts alternative clearly stated
- ✅ `week_id` stale `PLAN_COLUMNS` fix explicitly called out (pre-existing silent bug; D1 is the right fix moment)
- ✅ `setPlanState()` / `clearDegradedPlanState()` re-routing design: to `PlansRepository`, with fetch-then-merge for the `brief_state.payload` mirror
- ✅ Carry-forward plan_state mirror in composer (Option A — preserve from previous payload so refreshTree doesn't silently clear degraded state)
- ✅ `handleDegradedPlan()` signature extension with `planId`, including instruction to find the planId in `plan-generation.job.ts`
- ✅ Precise test update targets (composer.tree.test.ts assertions + service.test.ts mock changes)
- ✅ Baseline: 22 API failures (pre-existing), 374/374 web, typecheck ≤13 API / 3 web / 1 contracts / 1 types

## Dev Agent Record

### Implementation Plan / Decisions

- **Scope correction surfaced before coding (web wire break).** The story's File List omitted the web frontend, but `BriefStateRowSchema` is the brief *response* wire shape (`BriefResponseSchema.brief`), and `BriefCanvas.tsx` / `BriefWhyPanel.tsx` / `PlanPage.tsx` read the six flat fields directly. Dropping them to `payload` breaks web typecheck + the runtime wire. Surfaced to Menon, who chose **payload wire + migrate web** — so the web consumers were migrated to `brief.payload.*` (and the e2e brief fixtures nested into `payload` for runtime coherence). This is the only deviation from the story's stated File List, and it was an explicit user decision.
- **Contracts:** `BriefStatePayloadSchema` defined inline in `plan.ts` directly after `ScaffoldingDiffSchema` (the recommended no-new-file path — avoids the flagged circular import). All sub-fields carry `.default()` so the `'{}'` column default parses cleanly. `index.ts` needed no edit — it re-exports via `export * from './plan.js'`.
- **`week_id` in `PLAN_COLUMNS`:** confirmed dropped by C1 migration `20261010000000` (line 79–80). The `.eq('week_id', …)` query methods in `plans.repository.ts` were left untouched per the story's explicit no-scope-expansion guardrail — only the `PLAN_COLUMNS` constant was corrected (week_id removed; state/state_set_at/state_message added).
- **plan_state write path** rerouted to `PlansRepository.setPlanState()` / `clearDegradedPlanState()` (plans row = source of truth; brief_state.payload patched best-effort as a read-convenience mirror). `BriefStateRepository.setPlanState`/`clearDegradedPlanState` removed; `briefStateRepo` stays a `PlansService` dep for the `getBrief` / `upsert` paths.
- **Carry-forward (Option A):** composer preserves `plan_state*` from `previousBrief?.payload` so a brief refresh never silently clears a degraded state.
- **`handleDegradedPlan` planId:** threaded `committedPlanId` (already in scope at the `plan-generation.job.ts` call site) into the opts.

### Completion Notes

- All 10 ACs satisfied at the code/contract/test level.
- **Verification:** API tests 1280 passed / 22 failed (pre-existing baseline — the 10 failing files are `auth.routes`, `children.repository`, `extra-library.repository`, `day-overrides.repository`, `onboarding.tools`, `audit.types`, `catalog-seed.service`, `lunch-link.routes`, `memory.service`, `plan-adjustment.service` — none D1-touched). Web tests 374/374. Typecheck: API 13, Web 3, Contracts 1, Types 1 (all baseline; no new errors).
- **Two user-side gates remain** (both deferred per C1/C2 apply precedent, not run autonomously because the migration is destructive against linked remote Supabase): (1) `supabase db push --include-all`; (2) the Task-1 verification SQL. The migration file is authored and ready.
- **Not committed** — work left in the working tree (on `main`; project convention forbids committing to `main`). Suggested per-task commit cadence is in the story's Git Intelligence Summary; create a `feat/3-dm-d1-brief-state-payload` branch to land it.

## File List

**New:**
- `supabase/migrations/20261011000000_brief_state_payload.sql`

**Modified — packages:**
- `packages/contracts/src/plan.ts` — add `BriefStatePayloadSchema`; reshape `BriefStateRowSchema` (drop 6 fields, add `payload`)
- `packages/types/src/index.ts` — import `BriefStatePayloadSchema`; add `BriefStatePayload` type

**Modified — apps/api:**
- `apps/api/src/modules/plans/brief-state.repository.ts` — `BRIEF_STATE_COLUMNS`, `BriefStateUpsertInput` (payload), import; removed `setPlanState`/`clearDegradedPlanState`
- `apps/api/src/modules/plans/brief-state.composer.ts` — `refreshTree()` builds `payload`, carries forward plan_state mirror, `previousTileSummaries` from `payload.tile_summaries`
- `apps/api/src/modules/plans/plans.repository.ts` — fix `PLAN_COLUMNS`; add `setPlanState()` + `clearDegradedPlanState()`
- `apps/api/src/modules/plans/plans.service.ts` — `handleDegradedPlan()` (+`planId`, route to repo); `clearDegradedPlanState()` route to repo
- `apps/api/src/jobs/plan-generation.job.ts` — thread `committedPlanId` to `handleDegradedPlan()`

**Modified — apps/api tests:**
- `apps/api/src/modules/plans/brief-state.composer.tree.test.ts` — payload assertions + `previousBrief` shape
- `apps/api/src/modules/plans/plans.service.test.ts` — `buildRepo` gains `setPlanState`/`clearDegradedPlanState`; `handleDegradedPlan` block asserts repo + `planId`
- `apps/api/test/factories/index.ts` — `buildBriefState` payload shape

**Modified — apps/web (per Menon's payload-wire + migrate-web decision):**
- `apps/web/src/features/plan/BriefCanvas.tsx` — read `brief.payload.*` (tile_summaries / cleared_allergies / scaffolding_diff / plan_state)
- `apps/web/src/features/plan/BriefWhyPanel.tsx` — `brief.payload.cleared_allergies`
- `apps/web/src/features/plan/PlanPage.tsx` — `brief.payload.cleared_allergies`
- `apps/web/src/features/plan/BriefCanvas.test.tsx` — `makeBrief` payload shape + override routing
- `apps/web/test/e2e/{3-8,3-9,3-10,3-11,3-12,3-13,3-19,3-22}-*.spec.ts` — brief route fixtures nested into `payload`

## Change Log

| Date | Change |
|------|--------|
| 2026-06-02 | Implemented D1: consolidated `brief_state`'s four loose JSONB columns + plan_state mirror into a single `payload jsonb`; rerouted the plan_state write path from `brief_state` to `plans` (source of truth) with a best-effort payload mirror; fixed stale `week_id` in `PLAN_COLUMNS`. Migrated web brief consumers + e2e fixtures to `brief.payload.*` (Menon decision: payload wire). All automated gates at baseline (API 22-fail baseline unchanged, Web 374/374, typecheck clean). Status → review. Migration apply + verification SQL remain as user-side gates. |
