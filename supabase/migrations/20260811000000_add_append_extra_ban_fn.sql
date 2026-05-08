-- Story 3.22 code-review patch: atomic ban append for children.extra_rules.
--
-- Background: passive-bias application (ExtraRemovalSignalService.applyBias)
-- previously did a read-then-write on children.extra_rules:
--     find current → append componentType → write whole {pins,bans}
-- Two concurrent applyBias calls for *different* component types on the
-- same child could both read [X], compute [X,Y] / [X,Z], and the later
-- write would overwrite the earlier one — losing one of the bans.
--
-- This function performs the containment check and the JSONB array append
-- inside a single UPDATE statement. Because Postgres serializes concurrent
-- UPDATEs to the same row, the second writer re-evaluates its WHERE clause
-- against the already-committed state from the first writer and either
-- appends its own component_type or short-circuits as 'already_banned'.
--
-- Code-review Pass 2 patches applied here:
--   (a) Case-insensitive containment check via lower() normalisation —
--       prevents duplicate bans when stored casing differs from signal casing.
--   (b) Disambiguation SELECT uses IF NOT FOUND (PL/pgSQL FOUND variable)
--       instead of IF v_current IS NULL, so a child row with a NULL extra_rules
--       column is correctly returned as 'already_banned' rather than 'not_found'.
--
-- Returned status values:
--   'appended'       — a new component_type was added to bans
--   'already_banned' — the type was already present (case-insensitive); bans unchanged
--   'not_found'      — no row with (id, household_id) — caller should leave
--                      signals unapplied so a retry can succeed
CREATE OR REPLACE FUNCTION append_extra_ban(
  p_child_id uuid,
  p_household_id uuid,
  p_component_type text
)
RETURNS TABLE(
  extra_rules jsonb,
  status text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated jsonb;
  v_current jsonb;
  v_type    text;
BEGIN
  -- Normalise once; used in both the containment check and the appended value
  -- so that bans are stored consistently lowercase and lookups are case-blind.
  v_type := lower(p_component_type);

  UPDATE children
  SET extra_rules = jsonb_set(
        coalesce(extra_rules, '{"pins":[],"bans":[]}'::jsonb),
        '{bans}',
        coalesce(extra_rules->'bans', '[]'::jsonb) || to_jsonb(v_type)
      ),
      updated_at = now()
  WHERE id = p_child_id
    AND household_id = p_household_id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(coalesce(extra_rules->'bans', '[]'::jsonb)) AS ban
      WHERE lower(ban) = v_type
    )
  RETURNING children.extra_rules INTO v_updated;

  IF v_updated IS NOT NULL THEN
    RETURN QUERY SELECT v_updated, 'appended'::text;
    RETURN;
  END IF;

  -- No row updated. Disambiguate: row missing/wrong household, or already banned.
  -- Use FOUND (set by SELECT INTO) rather than IS NULL so a row that exists with
  -- a NULL extra_rules column is correctly identified as 'already_banned'.
  SELECT c.extra_rules INTO v_current
  FROM children c
  WHERE c.id = p_child_id AND c.household_id = p_household_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::jsonb, 'not_found'::text;
  ELSE
    RETURN QUERY SELECT coalesce(v_current, '{"pins":[],"bans":[]}'::jsonb), 'already_banned'::text;
  END IF;
END;
$$;

-- Mirrors the lockdown applied to other API-layer RPCs (ack_parental_notice,
-- create_household_and_user). PUBLIC execution would let any Supabase client
-- mutate any household's extra_rules by guessing UUIDs.
REVOKE EXECUTE ON FUNCTION append_extra_ban(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION append_extra_ban(uuid, uuid, text) TO service_role;
