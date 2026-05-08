-- Story 3.19: per (child, plan_item) one-off context overrides.
-- Overrides auto-revert after the day — enforced by a nightly job
-- (apps/api/src/jobs/day-override-revert.job.ts) or at-read filtering.
-- One active override per (plan_item_id, child_id, override_date) pair at a
-- time; the upsert path updates an existing row in place via ON CONFLICT.
--
-- Mirrors:
--   - apps/api/src/modules/plans/day-overrides.repository.ts
--   - packages/contracts/src/day-override.ts (DayOverrideTypeSchema, DayOverrideSchema)

DO $$ BEGIN
  CREATE TYPE day_override_type AS ENUM (
    'bag_suspended',
    'half_day',
    'field_trip',
    'sick_day',
    'post_dentist',
    'early_release',
    'sport_practice',
    'test_day'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS day_overrides (
  id                uuid              NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_item_id      uuid              NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  child_id          uuid              NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  household_id      uuid              NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  override_date     date              NOT NULL,
  override_type     day_override_type NOT NULL,
  is_lumi_proposed  boolean           NOT NULL DEFAULT false,
  confirmed_at      timestamptz       NULL,
  reverted_at       timestamptz       NULL,
  created_at        timestamptz       NOT NULL DEFAULT now(),
  updated_at        timestamptz       NOT NULL DEFAULT now(),
  UNIQUE (plan_item_id, child_id, override_date)
);

-- Active-override lookup (planner context, nightly revert job, GET routes).
-- Partial on reverted_at IS NULL keeps the index tight to live overrides.
CREATE INDEX IF NOT EXISTS day_overrides_household_date_idx
  ON day_overrides (household_id, override_date)
  WHERE reverted_at IS NULL;

CREATE TRIGGER day_overrides_set_updated_at
  BEFORE UPDATE ON day_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- API uses the service-role client which bypasses RLS. Enabling RLS keeps
-- anon/authed Supabase SDK callers out by default; household scoping is
-- enforced by the API layer via household_id WHERE clauses.
ALTER TABLE day_overrides ENABLE ROW LEVEL SECURITY;
