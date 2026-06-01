# Story 3-DM-D1: Brief state payload consolidation + plan_state moves to plans

Status: planned

## Story

As Epic 3 data-model solutioning,
We want to consolidate `brief_state`'s 4 jsonb-shaped columns (`plan_tile_summaries`, `cleared_allergies`, `scaffolding_diff`, `plan_state*`) into a single `payload jsonb` column AND move the `plan_state*` columns to the `plans` table where they belong,
So that future projection extensions don't trigger another `ALTER TABLE` per concern AND plan-state-as-projection-mirror is the correct read pattern (source of truth lives on `plans`).

## Acceptance Criteria

1. `plans` table gains:
   - `state plan_state_enum NULL`
   - `state_set_at timestamptz NULL`
   - `state_message text CHECK (state_message IS NULL OR char_length(state_message) <= 500)`
2. `brief_state` table gains: `payload jsonb NOT NULL DEFAULT '{}'`.
3. `BriefStatePayloadSchema` defined in new file `packages/contracts/src/brief-state.ts`. Shape includes:
   - `tile_summaries: PlanTileSummary[]`
   - `cleared_allergies: ClearedAllergyEntry[]`
   - `scaffolding_diff: ScaffoldingDiff | null`
   - `plan_state_snapshot?: { state, set_at, message }` (mirror of `plans.state*` for read convenience)
4. Existing `brief_state.plan_state*` columns one-shot migrated to `plans.state*` via join.
5. Existing `brief_state.plan_tile_summaries`, `cleared_allergies`, `scaffolding_diff` one-shot migrated into `brief_state.payload` via `jsonb_build_object`.
6. After verification:
   - `ALTER TABLE brief_state DROP COLUMN plan_tile_summaries, cleared_allergies, scaffolding_diff, plan_state, plan_state_set_at, plan_state_message;`
7. `BriefStateComposer.refresh()`:
   - Writes single `payload` shape via `BriefStatePayloadSchema.parse()` to ensure schema-validity at write time
   - Reads `plans.state` (not `brief_state.plan_state`)
8. SSE plan_state event handler uses `plans.state` as source.

## Dependencies & Context

**Design references:**
- Authoritative: canonical `§7` (Brief State Projection) and `§10.2` (Q2 decision — single payload)
- Breakdown: phase-4 doc Story D1
- Phase 3 finding: Brief composer's 8 reads (Q1) are fine without coalescing; this story doesn't address coalescing (deferred per `§10.6`)

**Story dependencies:** none — parallel-safe with A and B.

**Downstream blockers:** C1 can read `plans.state` instead of `brief_state.plan_state` after this lands (mild dependency — C1 can also tolerate the old shape if needed).

**Key invariants:**
- Brief state is a **Tier B projection** (architecture §1.5) — denormalized for read speed. The single `payload` shape preserves the projection invariants.
- Source of truth for plan state lives on `plans`; projection mirrors for read convenience.
- Composer write must validate against `BriefStatePayloadSchema` to catch shape drift early.

## Tasks / Subtasks

### Task 1 — Plans state columns

- [ ] Create `supabase/migrations/<timestamp>_brief_state_payload.sql`
- [ ] `ALTER TABLE plans ADD COLUMN state plan_state_enum, ADD COLUMN state_set_at timestamptz, ADD COLUMN state_message text CHECK (state_message IS NULL OR char_length(state_message) <= 500);`
- [ ] No new enum (plan_state_enum already exists from Story 3.29)

### Task 2 — Brief state payload column

- [ ] `ALTER TABLE brief_state ADD COLUMN payload jsonb NOT NULL DEFAULT '{}';`

### Task 3 — Data migration

- [ ] One-shot UPDATE to populate `plans.state` from `brief_state.plan_state` via join on `plan_id`:
  ```sql
  UPDATE plans p
    SET state = bs.plan_state,
        state_set_at = bs.plan_state_set_at,
        state_message = bs.plan_state_message
    FROM brief_state bs
    WHERE bs.plan_id = p.id AND bs.plan_state IS NOT NULL;
  ```
- [ ] One-shot UPDATE to populate `brief_state.payload`:
  ```sql
  UPDATE brief_state
    SET payload = jsonb_build_object(
      'tile_summaries',   plan_tile_summaries,
      'cleared_allergies', cleared_allergies,
      'scaffolding_diff',  scaffolding_diff
    );
  ```

### Task 4 — Verification gate

- [ ] Verify zero plans with `state IS NOT NULL` correspond to `brief_state.plan_state IS NOT NULL` rows (1:1)
- [ ] Verify `brief_state.payload` contains the three expected keys for all rows

### Task 5 — Drop superseded columns

- [ ] `ALTER TABLE brief_state DROP COLUMN plan_tile_summaries, cleared_allergies, scaffolding_diff, plan_state, plan_state_set_at, plan_state_message;`

### Task 6 — Composer + repository rewrite

- [ ] `apps/api/src/modules/plans/brief-state.composer.ts`:
  - Build `payload` object in-memory; call `BriefStatePayloadSchema.parse(payload)` to validate
  - Single column write via `briefStateRepo.upsert({ ..., payload })`
  - Read `plans.state*` directly when building the `plan_state_snapshot` mirror
- [ ] `apps/api/src/modules/plans/brief-state.repository.ts`:
  - Update schema columns (drop old jsonb fields; add `payload`)
  - `BriefStateUpsertInput` interface updated
- [ ] `apps/api/src/modules/plans/plans.repository.ts`:
  - Add `updateState({planId, state, message})` method
- [ ] `apps/api/src/modules/plans/plans.service.ts`:
  - `handleDegradedPlan()` writes to `plans.state` (not `brief_state.plan_state`)
  - Existing degraded-plan tests cover this

### Task 7 — Orchestrator / SSE

- [ ] `apps/api/src/agents/orchestrator.hook.ts`: SSE plan_state event sources from `plans.state` via a `plansRepo.findStateById()` lookup
- [ ] Audit: any other code that read `brief_state.plan_state` (lunch-link delivery? brief composer mirror? — check thoroughly)

### Task 8 — Contracts

- [ ] Create `packages/contracts/src/brief-state.ts` exporting `BriefStatePayloadSchema`
- [ ] `packages/contracts/src/plan.ts`: `PlanRowSchema` gains `state`, `state_set_at`, `state_message`
- [ ] `packages/contracts/src/index.ts`: re-export new schemas
- [ ] `packages/types/src/index.ts`: types regenerate

## Test Plan

- `brief-state.composer.test.ts`:
  - Refactor to assert single `payload` write
  - Validate schema parse error path (writing invalid payload errors at composer level)
- `plans.service.test.ts`:
  - Degraded-plan tests assert `state` on `plans`, not `brief_state.plan_state`
- New unit tests for `plans.repository.updateState()`
- Estimated: ~10 test changes

## Rollback

Revert PR. Down migration:
- Re-add `brief_state.plan_state*` columns
- Re-add `brief_state.plan_tile_summaries`, `cleared_allergies`, `scaffolding_diff` columns
- Redistribute `payload` jsonb back to the structured columns via UPDATE + jsonb extraction
- Restore `plan_state` data back to brief_state from plans via reverse join
- Drop `plans.state*` columns and `brief_state.payload` column

Pre-beta hard cutover: minor data redistribution loss is acceptable per Menon 2026-05-31.
