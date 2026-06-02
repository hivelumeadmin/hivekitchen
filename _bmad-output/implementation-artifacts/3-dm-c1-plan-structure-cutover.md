# Story 3-DM-C1: Plan structure — atomic cutover (the big one)

Status: in-progress

## Implementation log

### 2026-06-01 — Phase 8 done (test factory tree-shape additions)

Authored:

- `apps/api/test/factories/index.ts` — four new tree-shape row factories
  + a convenience tree composer:
  - `buildPlanMainAssignment(overrides)` → `PlanMainAssignmentRow`
  - `buildPlanDay(overrides)` → `PlanDayRow`
  - `buildPlanSlot(overrides)` → `PlanSlotRow` (default = main slot;
    snack/extra callers override `main_assignment_id` → null and supply
    `recipe_id`)
  - `buildPlanSlotVariation(overrides)` → `PlanSlotVariationRow`
  - `buildPlanTree(overrides)` → `PlanTreeFixture { plan, mainAssignments,
    days, slots, variations }` — 1-of-each-kind minimal fixture, override
    any layer with full-arrays
  - `TEST_IDS` extended with `mainAssignment`, `planDay`, `planSlot`,
    `planSlotVariation` UUIDs.
- `apps/api/test/factories/tree.test.ts` — 9 tests. Each factory's
  default output parses against its `Phase 2 contract schema
  (PlanMainAssignmentRowSchema, PlanDayRowSchema, PlanSlotRowSchema,
  PlanSlotVariationRowSchema) — so any drift between factory defaults
  and the migration shape surfaces at test time. Includes XOR violation
  case (main slot with `recipe_id` rejected by PlanSlotRowSchema), and
  buildPlanTree composer overrides.

**`buildPlanItem` not removed** — Phase 9 deletes it alongside applying
the migration. The 60-80 plan test call sites STILL legitimately consume
the flat factory because the production paths (BriefStateComposer.refresh,
plansService.commit, day-overrides.service.setOverride, etc.) still use
the flat shape. Migrating those test sites pre-cutover would require
parallel tests for both shapes; cleaner to migrate them with the
production swap in Phase 9.

Verification:
- 9/9 new factory tests pass.
- Full API sweep: 12 files / 33 tests fail — same baseline. Total
  passing tests up by 9 (1356 → 1365).
- Typecheck: 20 errors — same baseline.

Phase 9 (final cutover commit — migration apply, swap consumers from
flat→tree, delete the flat surface, status flip to done) is the last
phase. Realistic scope and risk profile documented at the bottom of this
file.

### 2026-06-01 — Phase 7 done (plan-generation.job buildCommitInputTree)

Authored:

- `apps/api/src/jobs/plan-generation.job.ts` — `buildCommitInputTree(output, requestId)`
  added next to `buildCommitInput`. Pure conversion from `PlanComposeTreeOutput`
  → `CommitPlanTreeInput`. Simpler than the flat path because the tree shape is
  already canonical: `main_assignments` and `days[].slots[].variations` pass
  through 1:1; the new `commit_plan()` RPC resolves
  `slot.main_assignment_sequence` against just-inserted assignments DB-side.
  `requestId` threads through as `plan_build_id` for Story 3-31's discover-
  candidate resolver. `week_id` intentionally absent — the migration drops
  `plans.week_id` and `week_of` becomes the sole plan identifier.
- `apps/api/src/jobs/plan-generation.job.tree.test.ts` — 9 tests:
  pass-through of plan_id / household_id / week_of / prompt_version,
  requestId → plan_build_id wiring, revision=1 + fresh generated_at,
  main_assignments 1:1, days[] 1:1 (no flattening), variation attribute
  preservation (portion_size / texture / removals / add_ons), snack slot
  with recipe_candidate_id (discover path), absence of legacy week_id
  and items[] fields.

Out of scope for Phase 7 (deferred to Phase 9):

- **`PlanRegenerationJobData.week_id` drop** — the job-data payload reshape
  cascades through plans.routes / regen worker / plan-adjustment.service /
  day-overrides.service — every consumer in the regen chain swaps together
  in the Phase 9 commit.
- **`PlansService.commitTree()` wiring** — the flat `commit()` carries
  substantial business logic (guardrail clearance loop with retries,
  recipe materialization for main-slot items, household_recipe_usage
  bumps, brief refresh, variant_proposal handoff, audit writes). The
  tree-shape commit path is simpler (no recipe materialization — the
  planner emits real recipe_ids from recipe.search / recipe.fetch under
  PLANNER_PROMPT_TREE; discover candidates live only on snack/extra
  slots), but replicating the surrounding orchestration cleanly is more
  scope than Phase 7 should swallow. Phase 9 wires this through.

Verification:
- 9/9 new Phase 7 tests pass.
- Full API sweep: 12 files / 33 tests fail — same baseline. Total
  passing tests up by 9 (1347 → 1356).
- Typecheck: 20 errors — same baseline.

Phase 8 (test factory rewrite — `buildPlanMainAssignment`, `buildPlanDay`,
`buildPlanSlot`, `buildPlanSlotVariation`; remove `buildPlanItem`; refactor
60-80 plan test call sites) is the heaviest mechanical sweep of the cutover.

### 2026-06-01 — Phase 6 done (adjacent services tree-shape, additive)

Two repositories + two services gain tree-shape mirror methods. Plan-adjustment
service has no surface change in Phase 6 — its inputs are plan-level
(week_of / week_id are the only C1-impacted fields, and `week_id` propagates
through `PlanRegenerationJobData` which Phase 7 reshapes).

Files touched:

- `apps/api/src/modules/plans/variant-proposal.repository.ts` — new
  `VARIANT_PROPOSAL_TREE_COLUMNS` + `CreateVariantProposalTreeInput` +
  `createTree()` method writing `plan_slot_variation_id` instead of
  `plan_item_id`.
- `apps/api/src/modules/plans/variant-proposal.service.ts` — new
  `createFromTreePlanOutput(opts)` consuming `PlanComposeTreeOutput`.
  Resolves (child_id, day, slot_kind) → `plan_slot_variation_id` by
  walking the tree in memory. Caller-supplied `recipeNameById` lookup
  drives `base_recipe_name` (the canonical model drops per-item free-text
  ingredients, so the tree path doesn't infer names from ingredients).
  Falls back to "Unknown dish" when the lookup misses.
- `apps/api/src/modules/plans/day-overrides.repository.ts` — new
  `OVERRIDE_TREE_COLUMNS` + `UpsertDayOverrideTreeInput` +
  `upsertTree()` / `revertTree()` / `findActiveByIdTree()` methods, all
  scoped by `plan_slot_id` instead of `plan_item_id`.
- `apps/api/src/modules/plans/day-overrides.service.ts` — new
  `setOverrideTree()` and `revertOverrideTree()` methods. **Pause-overlapping
  types narrowed**: `bag_suspended` and `sick_day` are REJECTED on the tree
  path (`ConflictError` surfaces "use plansRepo.pauseChildOnDay() instead").
  Composition-changing types (field_trip / half_day / post_dentist /
  sport_practice / test_day) still enqueue day-scope regen; the regen
  payload reshape is Phase 7's job.

Tests:
- `variant-proposal.service.tree.test.ts` — 8 tests (no-op on absent
  proposal, skip on base==variant, skip on existing proposal, skip on
  missing variation id, write with plan_slot_variation_id, skip on
  unresolvable (child, day, slot), recipe-name lookup hit + miss).
- `day-overrides.service.tree.test.ts` — 7 tests (bag_suspended and
  sick_day rejected with ConflictError, upsertTree writes plan_slot_id,
  regen-day-override enqueued with correct day, audit metadata carries
  plan_slot_id, revertOverrideTree NotFound + audit happy paths).

Type-cast carve-outs documented inline: the legacy `DayOverride` and
`VariantProposal` type definitions still carry `plan_item_id` because
they live in `@hivekitchen/types` and the schema cutover is deferred to
Phase 9. Tree-shape methods use `as unknown as DayOverride` /
`as unknown as VariantProposal` to acknowledge the deliberate
plan_slot_id / plan_slot_variation_id divergence without forcing a
contract-package change ahead of time.

Verification:
- 15/15 new Phase 6 tests pass.
- Full API sweep: 12 files / 33 tests fail — same baseline. Total
  passing tests up by 15 (1332 → 1347).
- Typecheck: 20 errors — same baseline (the 3 transient errors I
  introduced via incorrect direct casts were fixed before commit).

Phase 7 (plan-generation.job — buildCommitInput tree shape) is next.

### 2026-06-01 — Phase 5 done (orchestrator + planner prompt tree-shape, additive)

Authored:

- `apps/api/src/modules/plans/plans.service.ts` — `composeTree()` method
  added alongside `compose()`. Same pass-through-with-plan_id pattern;
  accepts `PlanComposeTreeInput`, returns `PlanComposeTreeOutput`.
- `apps/api/src/agents/tools/plan.tools.ts` — `createPlanComposeTreeSpec()`
  registers a second tool named `plan.compose.tree`. Same shape as
  `createPlanComposeSpec` but uses the tree contract schemas + routes
  through `planService.composeTree`. `MANIFESTED_TOOL_NAMES` extended to
  `['plan.compose', 'plan.compose.tree']`.
- `apps/api/src/agents/orchestrator.ts` — `TOOL_MANIFEST.set('plan.compose.tree', ...)`
  registered next to the flat one. Both tools live side-by-side; only the
  prompt's `toolsAllowed` list determines which the LLM sees.
- `apps/api/src/agents/prompts/planner.prompt.ts` — `PLANNER_PROMPT_TREE`
  exported (v2.0.0). New body documents the tree shape (main_assignments
  + days[].slots[].variations), the slot↔FK XOR rules per slot_kind, the
  variation attribute set, the family-first allergen-fork pattern via
  removals + add_ons. Embeds **two worked examples** inline per §10.7's
  prompt-engineering risk control: Example 1 (shared-Main Monday, 2 kids,
  portion + texture variation), Example 2 (allergen-fork Wednesday, 3 kids,
  one variation removes peanut paste + adds coconut cream — same Main,
  same row count, no Main split). `toolsAllowed` swaps `plan.compose` →
  `plan.compose.tree`. The legacy `PLANNER_PROMPT` (v1.5.0) is unchanged
  and remains the live default; `PlansService.planWeek()` still points at
  it. Phase 9 swaps the active prompt.
- `apps/api/src/agents/tools/plan.tools.tree.test.ts` — §10.7's
  "synthetic plan_compose gate" surfaced as 8 Vitest checks. Drives the
  two worked examples through `plan.compose.tree`'s input + output schemas
  + the tool fn (with a stubbed `plansService.composeTree`), then exercises
  the three most likely LLM regression shapes: flat items[] body, main slot
  carrying recipe_id (XOR violation), slot referencing an undeclared
  main_assignment_sequence.

Prompt rollback plan (documented inline above PLANNER_PROMPT_TREE per §10.7):
if post-cutover bad-output rate >5% in the first 24 hours, restore
`PLANNER_PROMPT` text-only to its v1.5.0 body while `PLANNER_PROMPT_TREE.toolsAllowed`
keeps pointing at the new tool. The resulting flat output will be rejected
by the new RPC — that's the correct failure mode, not silent shape mixing.

Verification:
- 8/8 synthetic plan_compose tree-shape tests pass.
- Full API sweep: 12 files / 33 tests fail — same baseline. Total
  passing tests up by 8 (1324 → 1332).
- Typecheck: 20 errors — same baseline.

Phase 6 (adjacent services migration: plan-adjustment / day-overrides /
variant-proposal) is next.

### 2026-06-01 — Phase 4 done (BriefStateComposer additive tree-shape)

Authored: `apps/api/src/modules/plans/brief-state.composer.ts` (+
`refreshTree()` + 3 tree-walk helpers + the pure `composePlanTree()`
helper exported for testing) and
`apps/api/src/modules/plans/brief-state.composer.tree.test.ts` (11 tests,
all green). The flat `refresh()` + `buildTileSummaries` + `buildClearedAllergies`
+ `buildScaffoldingDiff` path remains in place — Phase 9 swaps the seven
call sites (lunch-link.routes, day-overrides.service ×2, plans.service ×4)
and removes the flat methods.

Implementation per canonical §9.1:

- `refreshTree(householdId, weekId, requestId, opts)` — 6-way parallel
  read (previousBrief + main_assignments + plan_days + children +
  suppression + ratings via `Promise.all`), then a 2-way batched fan-out
  for slots-by-day-ids + variations-by-slot-ids (depends on days).
- `composePlanTree({ days, mainAssignments, slots, variations })` —
  pure function. Builds a typed tree:
    `PlanTree { days: PlanTreeDay[], mainAssignmentsBySequence, mainAssignmentsById }`
  Days sorted Mon→Sat (DB returns alphabetic — 'friday' before 'monday').
  Slots inside each day sorted main→snack→extra. Main slots resolve their
  `mainAssignment` reference by id; snack/extra carry `recipe_id` directly.
- `buildTileSummariesTree(tree, suppression, ratings)` — same output
  shape as the flat path (`PlanTileSummary[]`). `paused` flips when EITHER
  the day-level `paused_at` is set OR every variation on the day is paused
  (consolidates §3.5/§3.6/§3.7 pause grains). `recipe_id` on each tile
  item derives from main_assignment for main slots, slot.recipe_id for
  snack/extra. **Intentional shape difference**: per-tile `ingredients` is
  `[]` because the canonical model owns ingredients on the recipe row, not
  the tile — this is the seam where D1's BriefStatePayloadSchema cleanup
  picks up.
- `buildClearedAllergiesTree(tree, children)` — same semantics as flat
  path: emits one entry per `(child, allergen)` for children who appear at
  least once in the plan's variations and have a non-empty
  `declared_allergens`.
- `buildScaffoldingDiffTree(prevSummaries, tree, userInitiated)` —
  same QuietDiff phrasing as flat path. Ingredient comparison in tree
  mode uses `recipe_id` swap as the trigger (since tile ingredients are
  `[]`); per-string diff retires when D1 lands.

Verification:
- 11/11 tree-shape composer tests pass (parallelism, composition shape,
  pause aggregation, audit-on-failure, lunch-link suppression overlay).
- Full API sweep: 12 files / 33 tests fail — same baseline. Total
  passing tests up by 11 (1313 → 1324).
- Typecheck: 20 errors — same baseline.

Phase 5 (orchestrator `plan.compose` tool + planner prompt rewrite) is next.

### 2026-06-01 — Phase 3 done (PlansRepository additive tree-shape methods)

Authored: `apps/api/src/modules/plans/plans.repository.ts` (+ tree-shape
methods) and `apps/api/src/modules/plans/plans.repository.tree.test.ts`
(17 tests, all green). The flat plan_items methods (`findItemsByPlanId`,
`findItemById`, `updateItemIngredients`, `pauseDay`, `pauseItemById`,
`unpauseItemById`, `countItemsForDay`, `findAllItemsByPlanId`,
`findSwapHistory`, `commit`) stay in place — Phase 9 removes them along
with applying the migration in one coordinated commit.

Methods added (per §9 query patterns):

- **Reads**: `findMainAssignmentsByPlanId`, `findDaysByPlanId`,
  `findSlotsByPlanId` (composer's batch), `findSlotsByDayId` (per-day
  Wall-Card path), `findSlotsByDayIds` (IN-clause batch),
  `findVariationsBySlotIds` (IN-clause batch). All short-circuit on
  empty inputs to avoid wasted DB round-trips.
- **Commands**: `swapDays` (§9.3 — calls new `swap_plan_days` RPC),
  `updateVariation` (§9.4), `pauseDayById` + `unpauseDayById` (§9.5),
  `pauseChildOnDay` (§9.6 — calls new `pause_child_on_day` RPC),
  `swapMain` (§9.7).
- **Commit**: `commitTree(input: CommitPlanTreeInput, ...)` maps to the
  new commit_plan() 10-arg signature (drops p_week_id, drops p_items,
  adds p_main_assignments + p_days).
- **Helper**: `sortPlanDaysByWeekday()` — pure function. The DB returns
  plan_days alphabetically by enum text (friday before monday); the
  composer + Wall Card paths re-sort with this for predictable rendering.

Migration update: `supabase/migrations/20261010000000_plan_structure_canonical.sql`
extended with two server-side RPCs the new repository methods reference:

- `swap_plan_days(p_plan_id, p_day_a_id, p_day_b_id)` — single
  `UPDATE ... FROM (VALUES)` that satisfies `UNIQUE(plan_id, day)`
  throughout the swap (no DEFERRABLE needed). FOR UPDATE locks acquire
  in id order to prevent mirrored-swap deadlock.
- `pause_child_on_day(p_child_id, p_plan_day_id, p_paused_at)` —
  wraps the IN-with-subquery pattern that supabase-js doesn't natively
  support. Returns affected row count.

Verification:
- 17/17 new tree-shape repository tests pass — exercises call shapes for
  every find / update / RPC method.
- Full API sweep: 12 files / 33 tests fail — same count via stash-and-rerun.
  Total passing tests up by 17. All pre-existing failures unrelated.
- Typecheck: 20 errors — same baseline (pre-existing, all in unrelated
  files: voice.routes / voice.service.test / plans.service.test
  RecipeService duplicate / heart-notes $ZodIssue).

Phase 4 (BriefStateComposer rewrite) consumes the new find* methods next.

### 2026-06-01 — Phase 2 done (contracts additive tree-shape schemas)

Authored: `packages/contracts/src/plan.ts` (+ tree-shape schemas additively
appended), `packages/types/src/index.ts` (+ inferred types), and
`packages/contracts/src/plan-tree.test.ts` (25 tests, all green). The flat
schemas (`PlanComposeItemSchema`, `PlanComposeOutputSchema`,
`PlanItemRowSchema`, `PlanItemWriteSchema`, `CommitPlanInputSchema`) remain
in place — Phase 9 removes them along with applying the migration.

Schemas added (all suffixed `Tree*` / `Canonical*` / `Planner*Input*` to make
the deprecation seam visually unambiguous):

- **Enums**: `WeekdaySchema`, `SlotKindSchema`, `ExtraKindSchema`,
  `PortionSizeSchema`, `TextureLevelSchema`, `SpiceLevelSchema`,
  `PauseReasonSchema` — mirror migration §3.2.
- **DB row shapes**: `PlanMainAssignmentRowSchema`, `PlanDayRowSchema`,
  `PlanSlotRowSchema`, `PlanSlotVariationRowSchema`, `PlanRowCanonicalSchema`.
  The day + slot row schemas mirror the DB `CHECK` constraints
  (pause consistency, slot_kind ↔ FK XOR) via `superRefine` — defense-in-depth
  catches a malformed read before it reaches a render.
- **Planner tree inputs**: `PlannerMainAssignmentInputSchema`,
  `PlannerVariationInputSchema`, `PlannerSlotInputSchema`,
  `PlannerDayInputSchema` with the same XOR + pause-consistency invariants.
- **Cross-validated wrappers**: `PlanComposeTreeInputSchema` and
  `PlanComposeTreeOutputSchema` cross-validate every
  `slot.main_assignment_sequence` against the declared `main_assignments[].sequence`
  and assert sequence uniqueness — catches a bad planner emission at
  parse time, before the RPC.
- **Repository RPC input**: `CommitPlanTreeInputSchema` mirrors the new
  `commit_plan()` signature in the migration; carries `plan_build_id` for the
  Story 3-31 discover-candidate materialization path.

Verification:
- 25/25 new tree-schema tests pass.
- contracts baseline unchanged (3 pre-existing failed test files —
  heart-notes `validResponse` missing `delivered_at`/`cancelled_at`).
- Full API sweep: 12 files / 33 tests fail — identical count to pre-Phase-2
  via stash-and-rerun. All pre-existing, unrelated.

Phase 3 (PlansRepository rewrite) starts from this surface.

### 2026-06-01 — Phase 1 staged (schema + RPC only; NOT yet applied)

Authored: `supabase/migrations/20261010000000_plan_structure_canonical.sql`
(~360 lines). Covers AC1, AC2, AC3, AC9, AC10 + the FK retargets on AC8 dependents
(day_overrides, extra_removal_signals, variant_proposals — pre-beta TRUNCATE before
column swap). The migration is staged in the repo but **not applied to a running
database yet** because the cutover is meant to be ATOMIC and the code side has
not been migrated.

**Why staged-only**: 60 files in the codebase reference `plan_items` / `PlanItemRow` /
`PlanComposeItem` / `commit_plan(uuid,uuid,uuid,...)` / `findItemsByPlanId` /
`plan_item_id`. Applying the migration without the corresponding code rewrite
would leave the API expecting the old shape against a schema that no longer has
it. The atomic-cutover discipline only works if every layer moves in the same
PR. Phase 1's value: the schema target is concrete and reviewable, the RPC
contract is fixed, and the code-side work is no longer estimating against
TBD shape.

### Hand-off — phases remaining (8 of 9)

In execution order, each one self-contained enough to land in a single
follow-up session:

| Phase | Scope | AC coverage | Realistic session count |
|---|---|---|---|
| 2 | Contracts rewrite — `PlanComposeOutputSchema` → tree shape; add `PlanMainAssignmentSchema`, `PlanDaySchema`, `PlanSlotSchema`, `PlanSlotVariationSchema`; remove `PlanItemRowSchema`, `PlanComposeItemSchema`. | AC5 | 1 |
| 3 | `PlansRepository` rewrite — drop `findItemsByPlanId` / `findItemById`; add `findMainAssignmentsByPlanId` / `findDaysByPlanId` / `findSlotsByPlanId` / `findVariationsBySlotIds` / `swapDays` / `updateVariation` / `pauseDayById` / `pauseChildOnDay` / `swapMain` per §9. | AC4 | 1 |
| 4 | `BriefStateComposer` rewrite — `refresh()` per §9.1 (parallel reads), `buildTileSummaries()` walks the tree, flat-array methods removed. | AC4 | 1 |
| 5 | Orchestrator `plan.compose` tool schema → tree shape; planner prompt examples rewritten (shared-Main day + allergen-fork day); synthetic plan_compose test against stubbed LLM. | AC6, AC7 | 1 |
| 6 | Adjacent services — `plan-adjustment.service.ts` → `plan_slots`/`plan_slot_variations`; `day-overrides.service.ts` → `plan_slot_id` FK + drop pause-overlapping enum values; `variant-proposal.service.ts` → `plan_slot_variation_id` rename. | AC8 | 1 |
| 7 | `plan-generation.job.ts` — `buildCommitInput()` emits tree shape against new `commit_plan()` signature. | AC8 | 0.5 |
| 8 | Test factories — `apps/api/test/factories/index.ts` adds `buildPlanMainAssignment` / `buildPlanDay` / `buildPlanSlot` / `buildPlanSlotVariation`; removes `buildPlanItem`. Refactor ~60-80 test call sites. | AC11 | 1-2 |
| 9 | Pre-cutover gates — synthetic plan_compose Vitest gate (Task 10); load-test gate (100 concurrent `commit_plan()`, p99 < 250ms) is DEFERRED to staging environment validation, not Vitest. Apply migration. Status flip. | AC12 | 0.5 |

**60-file impact surface** (grep `plan_items|PlanItemRow|PlanComposeItem|buildPlanItem|makeItemRow|item_sku_id|commit_plan|findItemsByPlanId|plan_item_id` in `apps/` + `packages/`). The TypeScript compiler is the primary breakage detector — phases 2 → 3 → 4 cascade through the type system; phases 5 → 8 are mostly mechanical.

**Recommended cadence**: phases 2–4 in one session (contracts + repository + composer rewrite + immediate consumer fixes), phases 5–7 in a second session (agents + services + job), phase 8 in a third session (test factory sweep), phase 9 as a small final session including the migration apply + status flip. Each session ends with a committable green state.

**Rollback for the staged migration**: delete `supabase/migrations/20261010000000_plan_structure_canonical.sql` and revert this status flip. Pre-beta hard-cutover means no production-side concerns until the migration is applied.

## Story

As Epic 3 data-model solutioning,
We want to atomically cut over from flat `plan_items` to the canonical 4-table tree (`plan_main_assignments` + `plan_days` + `plan_slots` + `plan_slot_variations`) in a single coordinated PR — including the orchestrator tool schema rewrite and planner prompt rewrite,
So that the family-first model has its first-class data home AND the bolt-on accumulation on `plan_items` retires entirely.

## Acceptance Criteria

1. All 7 new enums exist per `canonical §3.2`:
   - `weekday` (Mon-Sat, **including Saturday**)
   - `slot_kind` (main, snack, extra)
   - `extra_kind` (8 values per canonical)
   - `portion_size` (small, regular, large)
   - `texture_level` (soft, normal, diced, finger)
   - `spice_level` (mild, regular, spicy)
   - `pause_reason` (sick_day, holiday, snow_day, field_trip, half_day, other)
2. Four new tables exist with full constraints per `canonical §3.4–§3.7`:
   - `plan_main_assignments` (with `sequence BETWEEN 1 AND 6` per Q3)
   - `plan_days` (with pause consistency CHECK)
   - `plan_slots` (with XOR CHECK enforcing slot_kind ↔ FK presence)
   - `plan_slot_variations`
3. `commit_plan()` RPC rewritten per `canonical §3.9` discipline:
   - One transaction (never staged)
   - Insert order: plans → plan_main_assignments → plan_days → plan_slots → plan_slot_variations
   - Multi-row INSERTs per table (not per row)
   - Plans row UPDATE last (just before COMMIT)
4. `BriefStateComposer.refresh()` rewritten to read from the new tree per `canonical §9.1`.
5. `PlanComposeOutputSchema` in contracts rewritten to tree shape per `canonical §10.7`.
6. Orchestrator `plan.compose` tool schema updated to tree shape.
7. Planner prompt examples in `apps/api/src/agents/prompts/planner.prompt.ts` rewritten with at least 2 representative tree-shape examples (one shared-Main day, one allergen-fork split day).
8. Adjacent services migrated:
   - `plan-adjustment.service.ts` operates on `plan_slots` + `plan_slot_variations`
   - `day-overrides.service.ts` FK retargets to `plan_slot_id` (or `plan_day_id`); pause-overlapping types DROP here (move to paused_at on the appropriate row)
   - `variant-proposal.service.ts` FK retargets per Q4 (`plan_slot_variation_id` replaces `plan_item_id`)
9. `plan_items` table DROPPED (CASCADE drops old FK relationships).
10. `plans.week_id` column DROPPED (`week_of` is sole identifier).
11. Test factories from A3 updated to produce tree shape; old `buildPlanItem` removed.
12. **Pre-cutover gates passed**:
    - Load test on `commit_plan()`: 100 concurrent calls complete under p99 budget (TBD specify budget in implementation spec — propose 250ms p99 for 6-day plan with 18 variations)
    - Synthetic plan_compose runs validate tree-shape tool I/O against stubbed LLM responses

## Dependencies & Context

**Design references:**
- Authoritative: `canonical §3` (Plan Structure — full DDL for all 4 tables + enums) and `§3.9` (commit_plan pattern) and `§9` (query patterns) and `§10.7` (orchestrator + prompt scope)
- Breakdown: phase-4 doc Story C1

**Story dependencies:**
- **A1 must land** (recipe_steps + finish_time_minutes — referenced by plan_main_assignments FK chain)
- **A2 must land** (snack fold — `plan_slots.recipe_id` is the single FK for all slot kinds)
- **A3 must land** (test factories — refactor scope is huge without them)
- **B1 must land** (children profile attrs for variation auto-derivation by Lumi)
- **B2 must land** (household_allergens single-source for guardrail re-eval during commit)
- **D1 recommended** (plans.state instead of brief_state.plan_state — cleaner cutover)

**Downstream blockers:** C2 (cleanup), E1 (adjacent table cleanup that depends on C1's deletes).

**Key invariants:**
- All family-first memories apply: [[family-first-main-then-variations]], [[three-main-weekly-pattern]], [[three-slot-weighted-structure]], [[day-detail-action-vocabulary]], [[recipe-vs-method-distinction]], [[prep-and-finish-are-activity-modes]], [[cooking-time-budgets]]
- This is the ATOMIC migration — all schema + RPC + composer + orchestrator + prompt changes ship in ONE PR

## Tasks / Subtasks

### Task 1 — Schema creation

- [ ] Create `supabase/migrations/<timestamp>_plan_structure_canonical.sql`
- [ ] All 7 enum `CREATE TYPE` statements
- [ ] `CREATE TABLE plan_main_assignments (...)` per canonical §3.4
- [ ] `CREATE TABLE plan_days (...)` per canonical §3.5
- [ ] `CREATE TABLE plan_slots (...)` per canonical §3.6 with XOR-CHECK
- [ ] `CREATE TABLE plan_slot_variations (...)` per canonical §3.7
- [ ] All indexes per canonical sections
- [ ] RLS on all 4 new tables (service-role-only writes; authenticated SELECT inherits via plans household scope)

### Task 2 — RPC rewrite

- [ ] DROP old `commit_plan(uuid, uuid, uuid, varchar, integer, timestamptz, timestamptz, varchar, varchar, jsonb)`
- [ ] CREATE new `commit_plan()` function signature accepts tree-shaped jsonb
- [ ] Implement per `canonical §3.9` discipline:
  - Parents-first insert order
  - Multi-row INSERTs
  - Plans UPDATE last
  - Single transaction; no error catching at row level (let CHECK violations roll back the whole txn)

### Task 3 — Composer rewrite

- [ ] `BriefStateComposer.refresh()` rewritten per `canonical §9.1`:
  - 8 parallel reads via `Promise.all`: plan + main_assignments + plan_days + plan_slots + plan_slot_variations + children + suppression + ratings
  - Build payload tree in-memory
  - Single upsert via `briefStateRepo.upsert({ payload, plan_revision })`
- [ ] `BriefStateComposer.buildTileSummaries()` rewritten to walk the tree
- [ ] Old methods that operated on flat `plan_items` array removed

### Task 4 — Repository rewrite

- [ ] `PlansRepository`:
  - `findItemsByPlanId` REMOVED
  - `findItemById` REMOVED
  - NEW: `findMainAssignmentsByPlanId(planId)`
  - NEW: `findDaysByPlanId(planId)`
  - NEW: `findSlotsByDayId(dayId)` and `findSlotsByPlanId(planId)` (batch query)
  - NEW: `findVariationsBySlotIds(slotIds)`
  - NEW: `swapDays(planId, dayA, dayB)` — for canvas drag-drop (single UPDATE pair in txn per `canonical §9.3`)
  - NEW: `updateVariation(variationId, patch)` — per `canonical §9.4`
  - NEW: `pauseDayById(dayId, reason)` — per `canonical §9.5`
  - NEW: `pauseChildOnDay(childId, dayId)` — per `canonical §9.6`
  - NEW: `swapMain(mainAssignmentId, newRecipeId)` — per `canonical §9.7`
- [ ] `PlanComposeItemSchema` REMOVED
- [ ] `PlanItemRowSchema` REMOVED
- [ ] All `plan_items` table references in any code REMOVED

### Task 5 — Contracts rewrite

- [ ] `packages/contracts/src/plan.ts`:
  - `PlanComposeOutputSchema` rewritten to tree shape per `canonical §10.7` example
  - NEW schemas: `PlanMainAssignmentSchema`, `PlanDaySchema`, `PlanSlotSchema`, `PlanSlotVariationSchema`
  - OLD schemas removed: `PlanItemRowSchema`, `PlanComposeItemSchema`
- [ ] `packages/types/src/index.ts`: types regenerate
- [ ] All consumers update import statements

### Task 6 — Orchestrator + prompt rewrite

- [ ] `apps/api/src/agents/orchestrator.ts`: `plan.compose` tool I/O schema updated to tree shape
- [ ] `apps/api/src/agents/prompts/planner.prompt.ts`:
  - Replace flat-array examples with tree-shape examples (min 2: one shared-Main day, one allergen-fork day)
  - Update the system prompt to describe the new tree structure
- [ ] **Prompt rollback plan documented**: if bad-output rate >5% post-cutover, restore prompt-only to prior version while example library is refined
- [ ] Synthetic plan_compose runs (Vitest, stubbed LLM) validate tool I/O before live planner

### Task 7 — Adjacent services migration

- [ ] `plan-adjustment.service.ts`:
  - Operations targeting old plan_items → target plan_slots (slot-level) or plan_slot_variations (per-child)
- [ ] `day-overrides.service.ts`:
  - FK retarget: `day_overrides.plan_item_id` → `plan_slot_id` (or `plan_day_id` depending on override scope)
  - Pause-overlapping enum values DROPPED (`bag_suspended`, `sick_day` move to `plan_days.paused_at` + `paused_reason`)
- [ ] `variant-proposal.service.ts` per Q4:
  - Rename `plan_item_id` column → `plan_slot_variation_id`
  - Update FK to `plan_slot_variations(id)`
  - Update service write/read paths

### Task 8 — Plan generation job

- [ ] `apps/api/src/jobs/plan-generation.job.ts`:
  - `buildCommitInput()` builds the tree shape (not flat array)
  - Adapt to the new `commit_plan()` signature

### Task 9 — Drops

- [ ] `DROP TABLE plan_items CASCADE;` (acceptable per hard-cutover decision)
- [ ] `ALTER TABLE plans DROP COLUMN week_id;`
- [ ] Re-add proper FK constraints on `day_overrides` (or `plan_day_context` per E1) and `variant_proposals` to point at the new tree tables

### Task 10 — Pre-cutover gates

- [ ] **Load test gate**: spin up 100 concurrent `commit_plan()` calls against staging; assert p99 < specified budget (250ms proposed)
- [ ] **Synthetic plan_compose gate**: stub LLM responses with tree-shape outputs; validate tool I/O, schema parse, downstream commit
- [ ] Both gates must pass before the PR is mergeable

### Task 11 — Test factory updates

- [ ] `apps/api/test/factories/plan.factory.ts` REWRITTEN to produce tree shape
- [ ] OLD `buildPlanItem` REMOVED; REPLACED by `buildPlanSlot` + `buildPlanSlotVariation`
- [ ] NEW: `buildPlanMainAssignment`, `buildPlanDay`
- [ ] All plan-related tests refactored to use new factories (~60-80 test changes, mechanical via TypeScript-guided refactor)

## Test Plan

- ~60-80 test changes across plan tests, composer tests, orchestrator tests, day-overrides tests, variant-proposal tests, plan-adjustment tests
- TypeScript compiler is the primary breakage detector (all tests Vitest-mocked per Phase 3 Q3)
- New test additions:
  - Tree-shape `commit_plan()` integration test
  - Synthetic plan_compose with stubbed LLM (Task 6)
  - 100-concurrent load test scenario (Task 10)

## Rollback

Revert PR + restore from backup. **Pre-beta hard cutover** means this is acceptable per Menon 2026-05-31.

If cutover fails at the prompt regression layer (Task 6): restore the prior planner prompt while keeping the new schema/code (Lumi reverts to emitting v1 flat-array; the new schema accepts via translation shim — DOCUMENT THIS RESCUE PATH but don't build it unless cutover fails).
