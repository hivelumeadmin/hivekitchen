-- Story 15-s5 (Canonical Data Model v2 §4.2, §5 row 6, §7.4, §8 step 3) —
-- Normalize `children.extra_rules jsonb {pins,bans}` into rows.
--
-- The JSONB blob is queried by its fields (the planner reads pins/bans per
-- child, snack rotation derives category pins/bans from them, the Kitchen Map
-- projects them), which §7.4 forbids as a convenience store. One row per
-- pin/ban replaces it.
--
-- DEVIATION FROM THE SPEC'S LITERAL DDL (recorded deliberately): the spec's
-- target shape is child_extra_rules(child_id, extra_library_id, rule). It is
-- not implementable as written — `extra_rules.pins`/`.bans` are free-text
-- component-type LABELS that have never been linked to, or validated against,
-- `extra_library` rows anywhere in the codebase (extra_library is a per-household
-- UI-picker catalog rendered as an independent block in the planner prompt).
-- A real FK would require an ambiguous per-household fuzzy reconciliation pass.
-- This table therefore stores `component_type` free-text directly, exactly as
-- the JSONB did. `extra_library` is unchanged and stays unlinked.
--
-- The drop of `children.extra_rules` and of `append_extra_ban()` lands in
-- 20261035000500, gated on apps/api/scripts/backfill-child-extra-rules.ts
-- having run and its parity gate having passed.
--
-- Mirrors:
--   - apps/api/src/modules/children/extra-rules.repository.ts
--   - apps/api/src/modules/kitchen-map/kitchen-map.repository.ts (loadRaw)
--   - packages/contracts/src/extra-rules.ts (ExtraRulesSchema — UNCHANGED)

DO $$ BEGIN
  CREATE TYPE extra_rule_kind AS ENUM ('pin', 'ban');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS child_extra_rules (
  id              uuid            NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  child_id        uuid            NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  rule            extra_rule_kind NOT NULL,
  component_type  text            NOT NULL CHECK (char_length(component_type) BETWEEN 1 AND 50),
  created_at      timestamptz     NOT NULL DEFAULT now()
);

-- No updated_at / set_updated_at trigger: rows are insert-or-delete only.
-- Nothing about an existing row is ever mutated in place — a changed rule set
-- is a different set of rows.

-- Dedup key. Case-SENSITIVE on purpose: ExtraRulesSchema's `unique` refine is
-- `new Set(arr).size === arr.length`, so `pins: ['Fruit', 'fruit']` is a legal
-- payload today. A `lower(component_type)` index would turn that currently-valid
-- PATCH into a 23505 → 500. Case-insensitive dedup of *bans* (the one place the
-- retired append_extra_ban RPC did it) is preserved in ExtraRulesRepository
-- instead, where it belongs. This is also the conflict target the backfill's
-- ON CONFLICT DO NOTHING upsert names — PostgREST cannot target a functional
-- index.
CREATE UNIQUE INDEX IF NOT EXISTS child_extra_rules_child_rule_type_idx
  ON child_extra_rules (child_id, rule, component_type);

-- Planner-context read path: all rules for one child.
CREATE INDEX IF NOT EXISTS child_extra_rules_child_id_idx
  ON child_extra_rules (child_id);

-- Match the project pattern: the API uses the service-role client, which
-- bypasses RLS. Enabling RLS with no policy keeps anon/authed Supabase SDK
-- callers out entirely; household scoping is enforced by the API layer via
-- children.household_id. Same shape as school_policies (child_id only, no
-- direct household_id), not extra_library's member-select policy.
ALTER TABLE child_extra_rules ENABLE ROW LEVEL SECURITY;

-- Kitchen Map cache invalidation. Until now this was covered *implicitly*:
-- extra_rules lived on `children`, and children_bump_kitchen_map fires on any
-- UPDATE to that table. Moving the data off `children` removes that coverage,
-- so the bump has to ship in the same migration that creates the table
-- (canonical-data-model-v2-spec §7.3). Without it, a PATCH /extra-rules would
-- serve a stale Kitchen Map for up to the full Redis TTL.
CREATE TRIGGER child_extra_rules_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON child_extra_rules
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_from_child();

-- ---------------------------------------------------------------------------
-- Full-replace function for PATCH /v1/children/:id/extra-rules
-- ---------------------------------------------------------------------------
--
-- The route is a FULL REPLACE (UpdateExtraRulesInputSchema = ExtraRulesSchema),
-- and the column-based UPDATE it replaces was atomic by Postgres row-lock
-- semantics. A two-call DELETE-then-INSERT from the API layer is NOT equivalent:
-- a crash between the calls leaves the child with zero rules. This function
-- keeps both statements in one transaction.
--
-- Returns FALSE when (p_child_id, p_household_id) does not match a child —
-- the cross-household guard that `.eq('id').eq('household_id')` used to provide
-- on the children UPDATE. The caller maps FALSE to a 404.
CREATE OR REPLACE FUNCTION replace_child_extra_rules(
  p_child_id     uuid,
  p_household_id uuid,
  p_pins         text[],
  p_bans         text[]
)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1 FROM children
  WHERE id = p_child_id AND household_id = p_household_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  DELETE FROM child_extra_rules WHERE child_id = p_child_id;

  -- DISTINCT guards the unique index against an exact duplicate arriving in
  -- the array. The contract layer already rejects duplicates, but this function
  -- is service-role callable and must not depend on that.
  INSERT INTO child_extra_rules (child_id, rule, component_type)
  SELECT DISTINCT p_child_id, 'pin'::extra_rule_kind, t
  FROM unnest(coalesce(p_pins, ARRAY[]::text[])) AS t;

  INSERT INTO child_extra_rules (child_id, rule, component_type)
  SELECT DISTINCT p_child_id, 'ban'::extra_rule_kind, t
  FROM unnest(coalesce(p_bans, ARRAY[]::text[])) AS t;

  RETURN true;
END;
$$;

-- Mirrors the lockdown on append_extra_ban (which 20261035000500 drops) and the
-- other API-layer RPCs. PUBLIC execution would let any Supabase client rewrite
-- any household's extra rules by guessing UUIDs.
REVOKE EXECUTE ON FUNCTION replace_child_extra_rules(uuid, uuid, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_child_extra_rules(uuid, uuid, text[], text[]) TO service_role;
