-- Slice 2.5-s2 — narrow the memory_nodes.node_type enum from 7 values to 3.
--
-- Removed values: 'preference', 'cultural_rhythm', 'allergy', 'school_policy'.
-- Backfill + soft-forgetting already ran in 20260904000100 (and the app-layer
-- script for JSONB columns). The guard below aborts the migration if any
-- non-forgotten rows of the removed types remain — re-run the backfill first.
--
-- Pattern: create a new enum, ALTER TABLE ... ALTER COLUMN ... USING CASE,
-- DROP the old enum, RENAME the new one. The existing index
-- memory_nodes_household_type_forgotten_idx on (household_id, node_type,
-- hard_forgotten) rebuilds automatically with the new column type.
--
-- Rollback: revert by re-adding the removed values via ALTER TYPE ADD VALUE
-- and restoring soft-forgotten rows manually.

-- ---------------------------------------------------------------------------
-- Guard: refuse to narrow until all non-hard-forgotten deprecated rows are soft-forgotten.
-- hard_forgotten=true rows are inert (scheduled for nightly deletion) and are
-- intentionally excluded from the guard — they will be remapped to 'other' by
-- the USING ELSE clause below, which is safe since hard-forgotten rows are
-- opaque to the application.
-- ---------------------------------------------------------------------------
DO $$
DECLARE remaining_count integer;
BEGIN
  SELECT COUNT(*) INTO remaining_count
  FROM memory_nodes
  WHERE node_type IN ('preference','cultural_rhythm','allergy','school_policy')
    AND soft_forget_at IS NULL
    AND hard_forgotten = false;
  IF remaining_count > 0 THEN
    RAISE EXCEPTION
      '2.5-s2 guard: % non-forgotten rows with deprecated node_types remain — run 20260904000100 (and the 2-5-s2-backfill.ts script) before applying this migration',
      remaining_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Safety: if node_type_v2 already exists (re-run after a partial failure that
-- aborted between CREATE TYPE and DROP TYPE), clean it up before proceeding.
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS node_type_v2;

-- ---------------------------------------------------------------------------
-- Narrow the enum
-- ---------------------------------------------------------------------------

CREATE TYPE node_type_v2 AS ENUM ('rhythm', 'child_obsession', 'other');

ALTER TABLE memory_nodes
  ALTER COLUMN node_type TYPE node_type_v2
  USING (
    CASE node_type::text
      WHEN 'rhythm' THEN 'rhythm'::node_type_v2
      WHEN 'child_obsession' THEN 'child_obsession'::node_type_v2
      WHEN 'other' THEN 'other'::node_type_v2
      ELSE 'other'::node_type_v2
    END
  );

DROP TYPE node_type;
ALTER TYPE node_type_v2 RENAME TO node_type;
