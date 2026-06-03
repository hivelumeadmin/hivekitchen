-- Slice 4-S15: Child Request-a-Lunch + Parent Approval (FR42, Boundary 1).
--
-- child_lunch_requests captures a child's free-text "request a lunch" suggestion
-- submitted from the Lunch Link (public child surface). One request per
-- lunch-link session (UNIQUE on session_id) — the DB constraint is the single
-- source of truth for dedup; the service maps the unique-violation to 409.
--
-- The request_text is stored VERBATIM — never modified by AI (sacred-channel
-- doctrine). On parent approval it is mirrored into food_preferences as a soft,
-- advisory planner signal (enforcement='just_for_context'); it never writes to
-- child_allergens or household_rules.
--
-- status uses TEXT CHECK (not a Postgres enum) to match the heart_notes.status
-- precedent and avoid enum-migration cost.

CREATE TABLE child_lunch_requests (
  id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id         UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id             UUID        NOT NULL REFERENCES children(id)   ON DELETE CASCADE,
  session_id           UUID        NOT NULL REFERENCES lunch_link_sessions(id) ON DELETE CASCADE,
  request_text         TEXT        NOT NULL CHECK (char_length(request_text) BETWEEN 1 AND 200),
  status               TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','approved','declined')),
  resolved_at          TIMESTAMPTZ,
  resolved_by_user_id  UUID        REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id)  -- one request per lunch-link session; enforces idempotency
);

CREATE INDEX child_lunch_requests_household_status_idx
  ON child_lunch_requests(household_id, status, created_at DESC);

CREATE INDEX child_lunch_requests_child_idx
  ON child_lunch_requests(child_id);

ALTER TABLE child_lunch_requests ENABLE ROW LEVEL SECURITY;
-- Matches the inline-subquery RLS form used by every other household-scoped
-- table (e.g. child_preferences, plans). There is no current_household_id()
-- SQL function in this codebase.
CREATE POLICY child_lunch_requests_household_rw ON child_lunch_requests
  FOR ALL
  USING (household_id = (SELECT current_household_id FROM users WHERE id = auth.uid()));
