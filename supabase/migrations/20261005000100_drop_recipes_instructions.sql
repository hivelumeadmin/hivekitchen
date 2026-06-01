-- Story 3-DM-A1 — Drop recipes.instructions after backfill verification.
--
-- The opaque jsonb instructions column is fully replaced by the structured
-- recipe_steps table created in 20261005000000_recipe_canonical.sql.
--
-- Run order:
--   1. Apply 20261005000000_recipe_canonical.sql (creates recipe_steps).
--   2. Run apps/api/scripts/backfill-recipe-steps.ts (populates recipe_steps
--      from existing recipes.instructions, mode='prep' default).
--   3. Apply this migration (verifies backfill, drops the column).
--
-- The verification block aborts the migration if any recipe has a non-null
-- instructions value with no corresponding recipe_steps rows. Pre-beta this
-- catches a missed backfill run; post-beta we'd not be here at all (the
-- drop would have shipped with Phase A).

DO $$
DECLARE
  unmigrated_count int;
BEGIN
  SELECT count(*) INTO unmigrated_count
  FROM recipes r
  WHERE r.instructions IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM recipe_steps s WHERE s.recipe_id = r.id
    );

  IF unmigrated_count > 0 THEN
    RAISE EXCEPTION
      'recipes.instructions backfill incomplete: % rows have instructions but no recipe_steps. '
      'Run apps/api/scripts/backfill-recipe-steps.ts before applying this migration.',
      unmigrated_count;
  END IF;
END $$;

ALTER TABLE recipes DROP COLUMN instructions;
