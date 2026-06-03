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
