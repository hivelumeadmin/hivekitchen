-- Story 15-s6 (Canonical Data Model v2 §2, §4.1, §5 row 7, §7.4, §8 step 3) —
-- Normalize `households.preferred_family_language_terms jsonb` into rows.
--
-- The column (20261020000000, slice 5-S10) holds a GROWING SET with provenance:
-- one entry per recognized kinship term, each carrying its own usage_count,
-- ratchet state and timestamps. §7.4 forbids that shape as a JSONB convenience
-- store — it is a table.
--
-- DEVIATION FROM THE SPEC'S LITERAL DDL (recorded deliberately): the spec's
-- sketch is family_language_terms(household_id, term, added_at, source). That is
-- stale against what 5-S10 actually shipped. The live element shape — and the
-- one the repository, the two REST routes and apps/web all depend on today — is
-- {term, maps_to, usage_count, state, first_seen_at, ratified_at}. This table
-- reproduces that shape exactly. `added_at`/`source` are not carried over: no
-- code anywhere reads or writes those field names.
--
-- NO KITCHEN MAP TRIGGER — verified decision, not an omission. §7.3 requires a
-- kitchen_map_version bump trigger on any table READ BY
-- KitchenMapRepository.loadRaw(). This data is not one: Lumi's household
-- snapshot reads active terms through a separate FamilyLanguageRepository.getTerms()
-- call, never through the Kitchen Map projection (grep: zero matches for
-- preferred_family_language_terms in kitchen-map.repository.ts). `households`
-- is also explicitly excluded from Kitchen-Map self-triggering
-- (20260820000000_add_kitchen_map_version.sql:24-27), so writing this column has
-- never bumped the version either — moving it to a non-loadRaw() table changes
-- nothing. If a later slice adds family language to the Kitchen Map projection,
-- that slice adds the trigger using the existing generic bump_kitchen_map_version()
-- (direct-household_id variant, same as cultural_priors_bump_kitchen_map).
--
-- The drop of `households.preferred_family_language_terms` lands in
-- 20261036000100, gated on apps/api/scripts/backfill-family-language-terms.ts
-- having run and its parity gate having passed.
--
-- Mirrors:
--   - apps/api/src/modules/family-language/family-language.repository.ts
--   - packages/contracts/src/family-language.ts (FamilyLanguageTermSchema — UNCHANGED)

DO $$ BEGIN
  CREATE TYPE family_language_state_enum AS ENUM ('candidate', 'active', 'forgotten');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS family_language_terms (
  id             uuid                       NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id   uuid                       NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  term           text                       NOT NULL CHECK (char_length(term) BETWEEN 1 AND 40),
  maps_to        text                       NOT NULL CHECK (char_length(maps_to) BETWEEN 1 AND 40),
  usage_count    integer                    NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  state          family_language_state_enum NOT NULL DEFAULT 'candidate',
  first_seen_at  timestamptz                NOT NULL DEFAULT now(),
  ratified_at    timestamptz                NULL
);

-- No updated_at / set_updated_at trigger: every field-level mutation goes
-- through one of the two functions below, which set usage_count / state /
-- ratified_at directly. `ratified_at` is the only "when did this change" fact
-- any consumer reads.

-- Natural key: one row per distinct term per household. Also the conflict target
-- both the backfill's upsert and record_family_language_usage's insert name, and
-- the lookup key both functions lock on. Case-SENSITIVE: FamilyLanguageTermSchema
-- does not fold case, the detector matches the parent's own spelling, and
-- PostgREST cannot name a functional index as an onConflict target.
CREATE UNIQUE INDEX IF NOT EXISTS family_language_terms_household_term_idx
  ON family_language_terms (household_id, term);

-- Match the project pattern: the API reaches this data only through the
-- service-role client, which bypasses RLS. Enabling RLS with no policy keeps
-- anon/authed Supabase SDK callers out entirely; household scoping is enforced
-- by the API layer. Same shape as school_policies, not extra_library's
-- member-select policy — no direct SDK access is wired for this data.
ALTER TABLE family_language_terms ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Usage recording (replaces the whole-array JSONB read-modify-write)
-- ---------------------------------------------------------------------------
--
-- FamilyLanguageRepository.recordUsage previously read the entire JSONB array,
-- mutated it in memory and wrote it back, serialized only by a module-level
-- in-process async lock. That lock's own comment disclosed the gap: it does not
-- hold across API instances, and a stale write-back could DEMOTE a term that was
-- ratified concurrently (active → candidate), breaking the forward-only ratchet.
--
-- Row storage makes the guard real. Each term is locked individually with
-- SELECT … FOR UPDATE inside this one function (= one transaction), so a
-- concurrent ratify of the same term blocks rather than racing, and bumps of
-- DIFFERENT terms no longer contend at all.
--
-- p_detected is [{"term": text, "maps_to": text, "occurrences": integer}, …].
-- Returns the terms that JUST crossed the ratification threshold on this call,
-- as a JSON array of full rows. The crossing semantics are reproduced from the
-- retired TypeScript verbatim: a term is newly-candidate when it is inserted
-- with occurrences >= threshold, or when an EXISTING candidate's count moves
-- from < threshold to >= threshold. active/forgotten terms only have their count
-- bumped — never re-prompted, never demoted.
CREATE OR REPLACE FUNCTION record_family_language_usage(
  p_household_id uuid,
  p_detected     jsonb,
  p_threshold    integer
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_detected  jsonb;
  v_term      text;
  v_maps_to   text;
  v_occ       integer;
  v_prev      integer;
  v_state     family_language_state_enum;
  v_row       family_language_terms%ROWTYPE;
  v_crossed   jsonb := '[]'::jsonb;
BEGIN
  -- ORDER BY term: a fixed lock-acquisition order across every call. Without
  -- it, two concurrent calls detecting the same terms in different array
  -- order (e.g. [Nani, Thatha] vs [Thatha, Nani]) can each hold one row FOR
  -- UPDATE while waiting on the other's — a textbook deadlock. A single total
  -- order removes the cycle.
  FOR v_detected IN
    SELECT value FROM jsonb_array_elements(coalesce(p_detected, '[]'::jsonb))
    ORDER BY value ->> 'term'
  LOOP
    v_term    := v_detected ->> 'term';
    v_maps_to := v_detected ->> 'maps_to';

    CONTINUE WHEN v_term IS NULL OR v_maps_to IS NULL;

    -- A malformed or negative `occurrences` must not abort every other term in
    -- this batch — skip only this element, the same tolerance the backfill
    -- script applies to the JSONB source.
    BEGIN
      v_occ := coalesce((v_detected ->> 'occurrences')::integer, 0);
    EXCEPTION WHEN invalid_text_representation THEN
      CONTINUE;
    END;
    CONTINUE WHEN v_occ < 0;

    -- Insert-first: the unique index, not a lock, is the authority on who
    -- creates the row. A loser of that race falls through to the bump branch.
    INSERT INTO family_language_terms (household_id, term, maps_to, usage_count)
    VALUES (p_household_id, v_term, v_maps_to, v_occ)
    ON CONFLICT (household_id, term) DO NOTHING
    RETURNING * INTO v_row;

    IF FOUND THEN
      -- Brand new term: prev count was 0, so it crosses iff this call alone
      -- reaches the threshold.
      IF v_occ >= p_threshold THEN
        v_crossed := v_crossed || jsonb_build_array(to_jsonb(v_row));
      END IF;
      CONTINUE;
    END IF;

    -- Existing term. Lock it before reading the count so a concurrent bump or
    -- ratify cannot interleave between the read and the update.
    SELECT f.usage_count, f.state INTO v_prev, v_state
    FROM family_language_terms f
    WHERE f.household_id = p_household_id AND f.term = v_term
    FOR UPDATE;

    CONTINUE WHEN NOT FOUND;

    UPDATE family_language_terms f
    SET usage_count = v_prev + v_occ
    WHERE f.household_id = p_household_id AND f.term = v_term
    RETURNING f.* INTO v_row;

    IF v_state = 'candidate' AND v_prev < p_threshold AND (v_prev + v_occ) >= p_threshold THEN
      v_crossed := v_crossed || jsonb_build_array(to_jsonb(v_row));
    END IF;
  END LOOP;

  RETURN v_crossed;
END;
$$;

-- PUBLIC execution would let any Supabase client inflate or seed any
-- household's family-language terms by guessing a UUID.
REVOKE EXECUTE ON FUNCTION record_family_language_usage(uuid, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_family_language_usage(uuid, jsonb, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Ratification (forward-only ratchet, UX-DR47)
-- ---------------------------------------------------------------------------
--
-- opt_in:         candidate → active (stamps ratified_at); idempotent no-op on
--                 active; no-op on forgotten (a forgotten term cannot opt in).
-- forget:         candidate → forgotten; NO-OP on active — this is the ratchet
--                 lock. NO CODE PATH MAY EVER MOVE state OFF 'active'.
-- tell_lumi_more: never mutates.
--
-- `transitioned_from` is non-NULL ONLY when a real transition happened. The
-- repository maps it straight onto its `from` field, which the route uses to
-- gate the audit write — a no-op must not be audited as a state change.
--
-- Zero rows returned = term not found (the repository maps that to
-- {updated: null, from: null}, which the service turns into a 404).
CREATE OR REPLACE FUNCTION ratify_family_language_term(
  p_household_id uuid,
  p_term         text,
  p_action       text
)
RETURNS TABLE(
  term              text,
  maps_to           text,
  usage_count       integer,
  state             family_language_state_enum,
  first_seen_at     timestamptz,
  ratified_at       timestamptz,
  transitioned_from family_language_state_enum
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_row  family_language_terms%ROWTYPE;
  v_from family_language_state_enum := NULL;
BEGIN
  IF p_action NOT IN ('opt_in', 'forget', 'tell_lumi_more') THEN
    RAISE EXCEPTION 'unknown family-language ratify action: %', p_action;
  END IF;

  SELECT f.* INTO v_row
  FROM family_language_terms f
  WHERE f.household_id = p_household_id AND f.term = p_term
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_action = 'opt_in' AND v_row.state = 'candidate' THEN
    v_from := v_row.state;
    UPDATE family_language_terms f
    SET state = 'active', ratified_at = now()
    WHERE f.id = v_row.id
    RETURNING f.* INTO v_row;
  ELSIF p_action = 'forget' AND v_row.state = 'candidate' THEN
    v_from := v_row.state;
    UPDATE family_language_terms f
    SET state = 'forgotten'
    WHERE f.id = v_row.id
    RETURNING f.* INTO v_row;
  END IF;

  RETURN QUERY SELECT
    v_row.term,
    v_row.maps_to,
    v_row.usage_count,
    v_row.state,
    v_row.first_seen_at,
    v_row.ratified_at,
    v_from;
END;
$$;

REVOKE EXECUTE ON FUNCTION ratify_family_language_term(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ratify_family_language_term(uuid, text, text) TO service_role;
