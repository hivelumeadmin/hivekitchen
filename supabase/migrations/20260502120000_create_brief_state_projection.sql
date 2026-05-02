-- Story 3.6: brief_state projection — one row per household.
-- Architecture §1.5: Tier B projection — O(1) read by household_id for the
-- <3s Brief SLO. Maintained by the application writer
-- (apps/api/src/modules/plans/brief-state.composer.ts) on plan.updated /
-- memory.updated / thread.turn events. Never a materialized view.
--
-- All writes go through the API service-role client (bypasses RLS).
-- The plan_revision column is the application-level guard against stale
-- overwrites (see brief-state.repository.ts).
--
-- RLS policy follows the project's `auth.uid()` / `current_household_id`
-- pattern (matches 20260601000000_create_memory_nodes_and_provenance.sql).
-- Write policies are intentionally absent — service-role bypasses RLS for
-- all writes (same pattern as memory_nodes and plan_items).

CREATE TABLE brief_state (
  household_id        uuid          NOT NULL PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  moment_headline     text          NOT NULL DEFAULT '',
  lumi_note           text          NOT NULL DEFAULT '',
  memory_prose        text          NOT NULL DEFAULT '',
  plan_tile_summaries jsonb         NOT NULL DEFAULT '[]'::jsonb,
  generated_at        timestamptz   NOT NULL DEFAULT now(),
  plan_revision       integer       NOT NULL DEFAULT 0,
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

-- Reuses shared set_updated_at() function declared in earlier migrations
-- (e.g., 20260502110000_create_plans_and_plan_items.sql).
-- Re-declared with CREATE OR REPLACE so this migration is independently runnable.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER brief_state_updated_at
  BEFORE UPDATE ON brief_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE brief_state ENABLE ROW LEVEL SECURITY;

-- SELECT only: household members read their own row. All writes go through
-- the API service-role client — no INSERT/UPDATE/DELETE policies are defined,
-- so non-service-role writes default-deny.
CREATE POLICY brief_state_household_select_policy ON brief_state
  FOR SELECT USING (
    household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
  );
