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

### Hand-off — Phase 9 (cutover commit, 1 of 9 remaining)

**Updated 2026-06-01 (post-attempt).** Phases 1–8 landed additive across 8
commits (`34bd395` → `6958791`). The migration is staged, every tree-shape
counterpart is in place next to its flat predecessor, every layer has its
own green test coverage. The flat surface is still the live path because
the cutover must be atomic — Phase 9 swaps every consumer and deletes the
flat surface in one coordinated commit.

**One Phase 9 attempt was made and reverted within the same session
(2026-06-01).** Surprises discovered during the attempt are encoded into
the per-step notes below so the next attempt budgets correctly. Net
typecheck delta after the partial attempt: +13 errors (20 baseline → 33).
Reverted because the remaining cascade depth would not fit the session
budget, and committing a broken-state cutover to `main` is worse than
not starting.

**Realistic session budget (revised):** the previous estimate of "1
long focused session OR 2 split sessions" was optimistic. Realistic is
**2–3 dedicated focused sessions** in the shape below:

- **Session 9a** (production swap to typecheck-green): items 2–6 + 9
  below. End with API typecheck green, tests broken, no commit until
  green. ~4–6 hours of focused work.
- **Session 9b** (test sweep): items 7–10 below. ~3–5 hours.
- **Session 9c** (deploy + verify + status flip): items 1, 11–13.
  ~1–2 hours.

Each session ends with a green commit. The atomic-cutover principle is
preserved because all three sessions ship as one PR (or each session is
its own atomic commit landing in close succession).

#### What Phase 9 must land (all together, single commit)

1. **Apply the migration** —
   `supabase/migrations/20261010000000_plan_structure_canonical.sql`
   against the local + staging databases. The migration is internally
   atomic (one transaction at apply time). Verify enums + 4 new tables +
   FK retargets land cleanly; verify `plan_items` is dropped CASCADE.
2. **Swap orchestrator + prompt** —
   `apps/api/src/agents/prompts/planner.prompt.ts`:
   `PLANNER_PROMPT` ← `PLANNER_PROMPT_TREE` (rename the symbols);
   `apps/api/src/agents/tools/plan.tools.ts`:
   `plan.compose.tree` → `plan.compose` (drop the dual registration);
   `apps/api/src/agents/orchestrator.ts`: single registration.
3. **Swap PlansService.commit() path** — rewrite `commit()` to take
   `CommitPlanTreeInput` and call `repo.commitTree()`. **This is the
   heaviest single change in Phase 9.** Concrete surgery required:
   - Drop `materializeRecipesForCommit()` and the surrounding
     `recipeService` materialization wiring entirely — the planner
     emits real `recipe_id`s under the tree prompt; discover
     candidates only land on snack/extra slots and resolve at
     `commit_plan()` directly.
   - Rewrite the guardrail clearance loop's `guardrailItems` mapping
     — it currently does `current.items.map(...)` (flat); needs a tree
     walk producing `PlanItemForGuardrail[]` from
     `days[].slots[].variations[]`.
   - Swap `findActiveByHouseholdAndWeek({ householdId, weekId })` →
     a tree variant that takes `weekOf` instead (plans.week_id is
     dropped).
   - Swap `repo.commit(current, ...)` → `repo.commitTree(current, ...)`.
   - Swap `briefStateComposer.refresh(...)` → `refreshTree(...)`.
   - Swap `variantProposalService.createFromPlanOutput(...)` →
     `createFromTreePlanOutput(...)`.
   - Preserve: `household_recipe_usage` bumps post-commit (recipe ids
     now come straight from `commitInput.main_assignments[].recipe_id`
     + `days[].slots[].recipe_id`, no materialization needed).
   - Also rewrite `getCurrentPlanItems()` → `getCurrentPlanTree()`
     returning `{ mainAssignments, days, slots, variations }` — used
     by `plan-regeneration.job.ts` for the day-scope merge.
4. **Swap BriefStateComposer call sites** — 7 call sites identified in
   the Phase 4 log: `lunch-link.routes`, `day-overrides.service` ×2,
   `plans.service` ×4. Each one switches `refresh()` → `refreshTree()`.
5. **Swap day-overrides + variant-proposal routes** — route handlers
   call `setOverrideTree()` / `revertOverrideTree()` /
   `createFromTreePlanOutput()`. Route params change:
   `planItemId` → `planSlotId` on the day-overrides routes.
6. **Drop `PlanRegenerationJobData.week_id`** — cascades through
   `plans.routes`, the regen worker, `plan-adjustment.service`,
   `day-overrides.service`. Single coordinated rename.

   **Also**: `plan-regeneration.job.ts` day-scope merge needs a tree-
   shape rewrite. Today it does:
   `commitInput.items = [...otherDayItems, ...commitInput.items]` —
   a flat-array merge of "other days' items keep, target day's items
   replace". In tree mode this becomes a day-merge: replace the target
   day's tree (its slots + variations) while keeping the other days'
   subtrees intact. `main_assignments` stay the same across the regen
   (the M-group is plan-level, not day-level). `swap-retry.helper.ts`'s
   `trySurgicalSwap()` returns a `CommitPlanInput` today — needs tree
   variant returning `CommitPlanTreeInput`.
7. **Delete the flat surface across `packages/contracts/src/plan.ts`** —
   `PlanComposeInputSchema`, `PlanComposeOutputSchema`,
   `PlanComposeItemSchema`, `PlanComposeDaySchema`, `PlanItemRowSchema`,
   `PlanItemWriteSchema`, `CommitPlanInputSchema`, `PlanRowSchema` (the
   one with `week_id`). Rename `PlanRowCanonicalSchema` → `PlanRowSchema`.
   Delete the matching type exports in `packages/types/src/index.ts`.
8. **Delete the flat surface in `apps/api/src/modules/plans/`** —
   `PlansRepository.findItemsByPlanId`, `findItemById`,
   `updateItemIngredients`, `pauseDay`, `pauseItemById`,
   `unpauseItemById`, `countItemsForDay`, `findAllItemsByPlanId`,
   `findSwapHistory`, `commit()` (the flat one), the
   `PLAN_ITEM_COLUMNS` constant; the flat compose/buildTileSummaries
   methods on `BriefStateComposer`; flat setOverride/revertOverride on
   `DayOverridesService`; `createFromPlanOutput()` on
   `VariantProposalService`; flat `OVERRIDE_COLUMNS` + `upsert` +
   `revert` + `findActiveById` on `DayOverridesRepository`; flat `create`
   + `CreateVariantProposalInput` on `VariantProposalRepository`.
9. **Migrate ~60-80 plan test call sites** — `grep` for
   `buildPlanItem|makeItemRow|makePlan|PlanItemRow|PlanItemWrite` and
   replace with `buildPlanSlot` / `buildPlanSlotVariation` /
   `buildPlanDay` / `buildPlanMainAssignment` / `buildPlanTree`. The
   tests' production-paths have switched to tree shape; the test
   fixtures need to match. Delete `buildPlanItem` after.
10. **Drop the flat `apps/api/src/jobs/plan-generation.job.ts`
    helpers** — `buildCommitInput()` and its `PlanItemWrite[]` import.
    `plan-regeneration.job.ts` swaps to `buildCommitInputTree()`.
11. **Run the load-test gate** — 100 concurrent `commit_plan()` calls
    against staging, assert p99 < 250ms per AC12. (Not a Vitest test —
    needs live Postgres infra. Author the script + run it manually.)
12. **Status flip** — story header `Status: in-progress` →
    `Status: done`. Sprint-status YAML updates with final test counts.
13. **Update the deferred-work entry for composer coalescing**
    (§10.6) — only if relevant; the post-beta debounce is unrelated to
    the cutover itself but the canonical model unblocks it.

#### Realistic risk profile

- **TypeScript compiler is the primary safety net.** Deleting any flat
  symbol surfaces every consumer that hadn't switched. Run
  `pnpm -F @hivekitchen/api typecheck` after each delete to keep the
  blast radius narrow.
- **The prompt swap is the highest user-facing risk.** Per §10.7's
  rollback plan, if the first 24 hours post-cutover show
  bad-output rate > 5%, restore `PLANNER_PROMPT` text-only to its v1.5.0
  body while `PLANNER_PROMPT_TREE.toolsAllowed` keeps pointing at the
  (now-renamed) `plan.compose`. The flat output will be rejected by the
  new RPC — that's the correct failure mode, not silent shape mixing.
- **The 60-80 test refactor is mechanical but tedious.** Each call site
  has a pattern: replace the flat builder call with a tree builder call
  + restructure assertions to look at the variation/slot/day grain
  instead of the flat (child, day, slot) tuple. Use the typescript
  compiler errors as the work-list.

#### Realistic session count for Phase 9 (revised post-attempt)

**3 dedicated sessions** with the split below. Each session ends with a
green commit. The single-session form was attempted on 2026-06-01 and
reverted — even minimal Phase-9.2 scope (orchestrator + prompt rename)
cascades into 5+ production files immediately, and the
PlansService.commit() rewrite is genuinely a 30-60 minute focused
operation on its own.

- **Session 9a — production swap to typecheck-green** (~4–6 hours):
  items 2–6 + 10 + (no migration yet). Rewrite the orchestrator return
  type, the planner prompt + tool, plan-generation + plan-regeneration
  jobs (including the tree-shape day-scope merge), swap-retry.helper,
  PlansService.commit() (the big one — guardrail loop, brief refresh,
  variant proposal handoff, recipe materialization removal,
  getCurrentPlanItems → getCurrentPlanTree). Composer call-site swaps.
  Day-overrides + variant-proposal route param changes.
  PlanRegenerationJobData.week_id drop. End state: API typecheck green,
  tests mostly red. **Commit when typecheck is green** — broken-state
  tests are tolerated for this commit because the test sweep is its own
  dedicated session.

- **Session 9b — test sweep + flat-surface deletion** (~3–5 hours):
  items 7–9. Delete the flat contracts schemas + types. Delete the flat
  PlansRepository + composer + service methods + flat repositories' flat
  columns + flat builders in test factories. Migrate the ~60-80 plan
  test call sites. End state: typecheck green + all tests green.

- **Session 9c — apply + verify + flip** (~1–2 hours): items 1, 11–13.
  Apply the migration locally + against staging. Author and run the
  load-test gate (100 concurrent commit_plan() calls, p99 < 250ms).
  Status flip to `done`. Final sprint-status update.

All three sessions ship as one PR — the atomic-cutover principle is
preserved by the PR-level atomicity, not the commit-level atomicity.

#### Rollback

Revert the Phase 9 commit + restore the database from the pre-migration
backup. Pre-beta hard-cutover means no production users affected. The
8 additive commits stay in main as the staged scaffolding for a
re-attempt.

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
