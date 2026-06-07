-- Slice 5-S3: PackerOfTheDay + Family Thread Schema (FR27, UX-DR29).
--
-- day_assignments records who is responsible for packing a given day's lunch.
-- One row per (household_id, date) — the composite primary key is the UPSERT
-- conflict target, so re-assigning a day overwrites the existing packer rather
-- than inserting a duplicate.
--
-- packer_user_id is nullable: clearing an assignment ("Nobody") sets it NULL
-- rather than deleting the row, so assigned_by / assigned_at retain the audit
-- trail of who last touched the day.
--
-- threads / thread_turns already exist (Epic 12 migrations 20260504000000,
-- 20260504010000, 20260505000000). This migration ONLY adds day_assignments.

CREATE TABLE day_assignments (
  household_id   UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  date           DATE        NOT NULL,
  packer_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
  assigned_by    UUID        NOT NULL REFERENCES users(id),
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, date)
);

CREATE INDEX idx_day_assignments_household_date
  ON day_assignments (household_id, date);

ALTER TABLE day_assignments ENABLE ROW LEVEL SECURITY;
-- Matches the inline-subquery RLS form used by every other household-scoped
-- table (e.g. child_lunch_requests, plans). There is no current_household_id()
-- SQL function in this codebase.
CREATE POLICY day_assignments_household_rw ON day_assignments
  FOR ALL
  USING (household_id = (SELECT current_household_id FROM users WHERE id = auth.uid()));
