-- Slice 2.6-s3 — Stage 1 catalog seeding schema additions.
--
-- See: _bmad-output/implementation-artifacts/2.6-s3-stage-1-async-seeding-layer-1.md
--
-- Two ALTER TABLE statements:
--   1. households.stage1_completed_at — NULL until Stage 1 completes (success
--      path only). 2.6-s4 polls this column to gate M5 chip entry; on timeout
--      (NULL after 5s), the cold-start fallback path is invoked.
--   2. household_recipe_usage.discover_failed_at — set by PlansService Layer 2
--      materialization when RecipeAgent.discover() fails for a specific
--      (household_id, recipe_id). Signals to the planner that this item must
--      be skipped on retry rather than re-attempting the same failing fetch.
--
-- Rollback:
--   ALTER TABLE household_recipe_usage DROP COLUMN discover_failed_at;
--   ALTER TABLE households DROP COLUMN stage1_completed_at;

-- ---------------------------------------------------------------------------
-- 1. households.stage1_completed_at
-- ---------------------------------------------------------------------------
-- NULL = Stage 1 catalog seeding has not yet completed (or failed without
-- setting the timestamp — see catalog-seed.service.ts AC5). Set to now() by
-- CatalogSeedService.seedForHousehold() on the success path (regardless of
-- post-guardrail count — zero survivors is a valid degraded state). Stage 1
-- failure paths (LLM timeout, response schema invalid) deliberately leave
-- this column NULL so 2.6-s4's polling window expires and the cold-start
-- fallback path runs.

ALTER TABLE households
  ADD COLUMN stage1_completed_at timestamptz;

COMMENT ON COLUMN households.stage1_completed_at IS
  'Slice 2.6-s3 — timestamp of Stage 1 LLM catalog seeding completion. '
  'NULL = not yet completed (or Stage 1 failure path took the silent NULL '
  'branch). Set to now() by CatalogSeedService.seedForHousehold() on the '
  'success path. 2.6-s4 polls this column to gate M5 chip card entry — a '
  'NULL value past the 5s polling window routes to the cold-start fallback.';

-- ---------------------------------------------------------------------------
-- 2. household_recipe_usage.discover_failed_at
-- ---------------------------------------------------------------------------
-- NULL by default. Set to now() by PlansService.materializeBeforeCommit() when
-- Layer 2 RecipeAgent.discover() fails for this (household_id, recipe_id) pair.
-- The planner consults this flag and excludes such items from retry attempts
-- so a permanently-unfetchable catalog_seeded recipe doesn't block plan commit
-- forever.

ALTER TABLE household_recipe_usage
  ADD COLUMN discover_failed_at timestamptz;

COMMENT ON COLUMN household_recipe_usage.discover_failed_at IS
  'Slice 2.6-s3 — Layer 2 discovery failure timestamp. NULL = no failure (or '
  'discovery never attempted). Set by PlansService.layer2Materialize() when '
  'RecipeAgent.discover() returns no candidates for a catalog_seeded recipe. '
  'The planner uses this flag on commit retry to skip the failing item rather '
  'than re-attempting the same fetch.';
