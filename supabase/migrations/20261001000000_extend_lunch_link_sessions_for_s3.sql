-- Slice 4-S3: add HMAC token + session-tracking columns to lunch_link_sessions.
-- The table was created as a stub by Story 3-28 (20260840000000).

ALTER TABLE lunch_link_sessions
  ADD COLUMN IF NOT EXISTS nonce                    text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS exp                      timestamptz,
  ADD COLUMN IF NOT EXISTS first_opened_at          timestamptz,
  ADD COLUMN IF NOT EXISTS rating                   text
    CHECK (rating IN ('loved', 'ok', 'not-really')),
  ADD COLUMN IF NOT EXISTS rating_submitted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_after_exp_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at               timestamptz NOT NULL DEFAULT now();

-- Project convention: shared set_updated_at() trigger function
-- (defined in 20260510000500_children_updated_at_trigger.sql).
DROP TRIGGER IF EXISTS lunch_link_sessions_updated_at ON lunch_link_sessions;
CREATE TRIGGER lunch_link_sessions_updated_at
  BEFORE UPDATE ON lunch_link_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Atomic increment to avoid read-modify-write races when several child opens
-- arrive concurrently after the link has expired.
CREATE OR REPLACE FUNCTION increment_lunch_link_reopen_count(
  p_child_id uuid,
  p_date     date
) RETURNS void LANGUAGE sql AS $$
  UPDATE lunch_link_sessions
  SET reopened_after_exp_count = reopened_after_exp_count + 1
  WHERE child_id = p_child_id AND date = p_date;
$$;
