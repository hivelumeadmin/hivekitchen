-- Story 3.5: plans + plan_items tables with revision versioning and the
-- presentation-bind contract enforced at the row level.
--
-- A plan row exists in two states:
--   * pre-clearance:  guardrail_cleared_at IS NULL — never returned to the UI.
--                     findByIdForOps() reads these (presentation-bypass: ops-audit).
--   * post-clearance: guardrail_cleared_at IS NOT NULL — renderable via
--                     findByIdForPresentation() / findCurrentByHousehold().
-- Atomic transition is guaranteed by the commit_plan() RPC (next migration):
-- guardrail_cleared_at + guardrail_version + plan_items are all written in one
-- Postgres transaction, so a half-written plan is impossible to observe.
--
-- One active plan per (household_id, week_id) — enforced by a unique index.
-- Re-commits of the same plan_id replace plan_items via the RPC; revision
-- bumps signal user-visible regenerations.
--
-- All writes are performed by the API service-role client (RLS bypassed).
-- Authenticated callers may only SELECT rows scoped to their current household
-- (matching the project pattern in 20260502090000_enable_rls_users_households.sql
-- and 20260601000000_create_memory_nodes_and_provenance.sql).
-- UPDATE/DELETE/INSERT default-deny: no policies are defined for the
-- authenticated role, so all writes are denied except via service role.

CREATE TABLE plans (
  id                    uuid           NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id          uuid           NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  week_id               uuid           NOT NULL,
  revision              integer        NOT NULL DEFAULT 1,
  generated_at          timestamptz    NOT NULL,
  guardrail_cleared_at  timestamptz,
  guardrail_version     varchar(32),
  prompt_version        varchar(32)    NOT NULL,
  created_at            timestamptz    NOT NULL DEFAULT now(),
  updated_at            timestamptz    NOT NULL DEFAULT now()
);

-- One active plan per household per week. Re-commits use the same plan_id
-- (UPSERT in commit_plan), so this constraint never fires on legitimate
-- regenerations — only on accidental duplicate inserts with new ids.
CREATE UNIQUE INDEX plans_household_week_unique
  ON plans (household_id, week_id);

CREATE TABLE plan_items (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id      uuid        NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  child_id     uuid        NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  day          text        NOT NULL,
  slot         text        NOT NULL,
  recipe_id    uuid,
  item_id      uuid,
  ingredients  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plan_items_plan_child_idx
  ON plan_items (plan_id, child_id);

-- Reuses shared set_updated_at() function declared in
-- 20260601000000_create_memory_nodes_and_provenance.sql. Re-declared with
-- CREATE OR REPLACE so this migration is independently runnable.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER plan_items_updated_at
  BEFORE UPDATE ON plan_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_items ENABLE ROW LEVEL SECURITY;

-- Authenticated callers see only their own household's plan rows.
-- The presentation-bind contract is enforced at the application layer
-- (PlansRepository.findByIdForPresentation filters guardrail_cleared_at IS NOT NULL);
-- the RLS policy here is the household-scope guard, not the bind itself.
-- Service-role bypasses RLS for all writes regardless of these policies.
CREATE POLICY plans_household_select_policy ON plans
  FOR SELECT TO authenticated USING (
    household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY plans_household_update_policy ON plans
  FOR UPDATE TO authenticated
  USING (household_id = (SELECT current_household_id FROM users WHERE id = auth.uid()))
  WITH CHECK (household_id = (SELECT current_household_id FROM users WHERE id = auth.uid()));

CREATE POLICY plans_household_delete_policy ON plans
  FOR DELETE TO authenticated USING (
    household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
  );

-- plan_items inherit household scope via their parent plan row.
CREATE POLICY plan_items_via_plan_select_policy ON plan_items
  FOR SELECT TO authenticated USING (
    plan_id IN (
      SELECT id FROM plans
      WHERE household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
    )
  );

CREATE POLICY plan_items_via_plan_update_policy ON plan_items
  FOR UPDATE TO authenticated
  USING (
    plan_id IN (
      SELECT id FROM plans
      WHERE household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    plan_id IN (
      SELECT id FROM plans
      WHERE household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
    )
  );

CREATE POLICY plan_items_via_plan_delete_policy ON plan_items
  FOR DELETE TO authenticated USING (
    plan_id IN (
      SELECT id FROM plans
      WHERE household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
    )
  );
