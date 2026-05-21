-- Story 3.28: minimal stub for lunch_link_sessions.
-- Epic 4 Story 4-S3 will expand this table with HMAC, rating, and full delivery columns.
-- This stub exists only to support Lunch Link suppression (suppressed_at).
-- Forward-compatible: Epic 4's migration should use ADD COLUMN IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS lunch_link_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          UUID NOT NULL,
  child_id              UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  -- The school day this session covers (date only — delivery window is computed per-timezone).
  date                  DATE NOT NULL,
  -- Suppression: set when parent pauses Lunch Link for this (child, date).
  suppressed_at         TIMESTAMPTZ,
  suppressed_by_user_id UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Uniqueness: one session per (child, date).
  CONSTRAINT uq_lunch_link_sessions_child_date UNIQUE (child_id, date)
);

CREATE INDEX idx_lunch_link_sessions_household_date
  ON lunch_link_sessions(household_id, date);
