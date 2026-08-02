-- Story 15-s2 (Epic 15, Canonical Data Model v2 §4.9) — the signals log.
--
-- "The family told us something" is currently written in five scattered places
-- (lunch_link_sessions.rating, child_lunch_requests, extra_removal_signals,
-- food_preferences, child_preferences). This table collapses the INPUTS into
-- one append-only event log; the aggregates stay where they are and become
-- projections in a later slice (15-s3). This slice only dual-writes.
--
-- Append-only: a correction is a NEW signal; the log is the replayable learning
-- record. UPDATE, direct DELETE, and TRUNCATE are blocked by trigger — RLS
-- alone cannot enforce this because the API's service-role client bypasses RLS.
-- CASCADED deletes (household/child erasure via FK ON DELETE CASCADE — the
-- account-deletion job deletes the households row and re-throws on failure)
-- are deliberately allowed: append-only must not make GDPR erasure impossible
-- (15-s2 code review patch).
--
-- NO kitchen_map_version bump trigger, deliberately: §7.3 binds bump triggers
-- to tables KitchenMapRepository.loadRaw() reads, and loadRaw() does not read
-- signals (verified 2026-08-02, kitchen-map.repository.ts:283-441). The 15-s1
-- precedent (20261035000000) shipped triggers pre-emptively because calendar
-- tables were already scheduled as loadRaw() sources; signals is not — the
-- 15-s3 child_preferences projection gets its own trigger when it becomes one.
--
-- child_id NULL = household-level; non-NULL = that child. payload is jsonb
-- typed per kind and Zod-validated at the write boundary (spec §7.4c); free-text
-- payload fields (lunch_request.text, preference_edit.item) arrive as AES-256-GCM
-- ciphertext under the household DEK (spec §7.1).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS signals_no_truncate ON signals;
--   DROP TRIGGER IF EXISTS signals_append_only ON signals;
--   DROP FUNCTION IF EXISTS signals_block_mutation();
--   DROP TABLE IF EXISTS signals;
--   DROP TYPE IF EXISTS signal_kind;
--   DROP TYPE IF EXISTS signal_source;

-- 1. Enums.

-- leftover_log is RESERVED: no producer exists yet (the leftover feature is
-- deferred to Epic 6 — plan-adjustment.types.ts 'pantry_leftover_changed').
DO $$ BEGIN
  CREATE TYPE signal_kind AS ENUM (
    'lunch_rating',
    'lunch_request',
    'leftover_log',
    'extra_removal',
    'preference_edit'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE signal_source AS ENUM ('lunch_link', 'app', 'voice', 'import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Table.

CREATE TABLE IF NOT EXISTS signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id     uuid REFERENCES children(id) ON DELETE CASCADE,
  kind         signal_kind NOT NULL,
  subject_ref  jsonb,
  payload      jsonb NOT NULL,
  occurred_at  timestamptz NOT NULL,
  source       signal_source NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 3. Indexes (spec §4.9 verbatim, named).

CREATE INDEX IF NOT EXISTS signals_household_kind_occurred_idx
  ON signals (household_id, kind, occurred_at DESC);

CREATE INDEX IF NOT EXISTS signals_child_kind_idx
  ON signals (child_id, kind) WHERE child_id IS NOT NULL;

-- 4. RLS.
--
-- The API reaches this table with the service-role client, which bypasses RLS;
-- household scoping is enforced at the (already-authenticated) write seams. RLS
-- is still enabled so the anon/authenticated SDK keys cannot read across
-- households. SELECT-only, deliberately: writes go exclusively through the
-- service-role SignalsService boundary (Zod validation + DEK encryption) — an
-- INSERT policy would let a browser client append plaintext/malformed payloads
-- that can never be corrected (15-s2 code review patch). No
-- current_household_id() SQL function exists — inline subquery, matching
-- family-calendar (20261035000000) and child_preferences (20261013000000);
-- auth.uid() wrapped in a scalar subquery for initplan caching.

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY signals_household_read ON signals
    FOR SELECT
    USING (household_id = (SELECT current_household_id FROM users WHERE id = (SELECT auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. Append-only guard.
--
-- pg_trigger_depth() is 1 when this fires from a direct DELETE, >= 2 when it
-- fires inside another trigger — i.e. the FK ON DELETE CASCADE from
-- households/children. Cascaded erasure is allowed; everything else raises.

CREATE OR REPLACE FUNCTION signals_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'signals is append-only (canonical-data-model-v2 §4.9): corrections are new rows';
END; $$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER signals_append_only
    BEFORE UPDATE OR DELETE ON signals
    FOR EACH ROW EXECUTE FUNCTION signals_block_mutation();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- TRUNCATE bypasses row-level triggers; block it at statement level so the
-- append-only guarantee has no service-role escape hatch.
DO $$ BEGIN
  CREATE TRIGGER signals_no_truncate
    BEFORE TRUNCATE ON signals
    FOR EACH STATEMENT EXECUTE FUNCTION signals_block_mutation();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
