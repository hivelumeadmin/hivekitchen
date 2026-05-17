-- Slice 4-S1: heart_notes table — parent-authored notes for children's lunch
-- deliveries. S1 stores content as PLAINTEXT; envelope encryption ships in
-- S5 (sacred-channel doctrine). status enum widens in S6 (scheduling).
--
-- RLS scopes reads/writes to the caller's household. The API layer is the
-- only writer in practice (service-role bypasses RLS), but the policy
-- protects against direct PostgREST exposure should that ever land.

CREATE TABLE heart_notes (
  id             uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id   uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id       uuid        NOT NULL REFERENCES children(id)   ON DELETE CASCADE,
  author_user_id uuid        NOT NULL REFERENCES users(id),
  content        text        NOT NULL DEFAULT '',
  status         text        NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','scheduled','delivered','viewed','rated','cancelled')),
  scheduled_for  date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX heart_notes_household_id_idx ON heart_notes (household_id);
CREATE INDEX heart_notes_child_id_idx     ON heart_notes (child_id);

-- Reuse the shared set_updated_at() function created by the households /
-- children trigger migrations. Defensive CREATE OR REPLACE matches existing
-- migrations' pattern (see 20260510000500_children_updated_at_trigger.sql).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER heart_notes_set_updated_at
  BEFORE UPDATE ON heart_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE heart_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY heart_notes_household_member_select ON heart_notes
  FOR SELECT
  USING (household_id = (SELECT household_id FROM users WHERE id = auth.uid()));

CREATE POLICY heart_notes_household_member_insert ON heart_notes
  FOR INSERT
  WITH CHECK (household_id = (SELECT household_id FROM users WHERE id = auth.uid()));

CREATE POLICY heart_notes_household_member_update ON heart_notes
  FOR UPDATE
  USING (household_id = (SELECT household_id FROM users WHERE id = auth.uid()))
  WITH CHECK (household_id = (SELECT household_id FROM users WHERE id = auth.uid()));
