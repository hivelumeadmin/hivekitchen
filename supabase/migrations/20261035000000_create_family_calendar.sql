-- Story 15-s1 (Epic 15, Canonical Data Model v2 §4.6) — the Family Calendar.
--
-- Until now nothing told the planner which days actually need a lunch. The
-- weekday set was implicit: the planner prompt said "Monday through Friday by
-- default" and the model composed whatever days it liked. A half-term break or
-- a school trip could only be expressed AFTER composition, as plan_days.paused_at.
--
-- calendar_terms carries the recurring rhythm (which weekdays need a lunch, over
-- what date range); calendar_exceptions carries one-off overrides. Whether a
-- given date is a Lunch Day is DERIVED from these two tables at plan time
-- (family-calendar.resolver.ts) — it is never stored.
--
-- child_id NULL = whole household; non-NULL = that child only. This mirrors the
-- household_allergens scoping convention (20261008000000).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS calendar_exceptions_bump_kitchen_map ON calendar_exceptions;
--   DROP TRIGGER IF EXISTS calendar_terms_bump_kitchen_map ON calendar_terms;
--   DROP TABLE IF EXISTS calendar_exceptions;
--   DROP TABLE IF EXISTS calendar_terms;
--   DROP TYPE IF EXISTS calendar_exception_kind;
--   DROP TYPE IF EXISTS calendar_source;

-- 1. Enums.

DO $$ BEGIN
  CREATE TYPE calendar_source AS ENUM ('manual', 'google_readonly', 'school_import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE calendar_exception_kind AS ENUM (
    'no_lunch',
    'early_release',
    'school_meal',
    'trip',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Tables.

-- weekdays holds ISO weekday numbers (1 = Monday … 6 = Saturday). Sunday (7) is
-- deliberately unrepresentable: the weekday enum (20261010000000) stops at
-- saturday, so a Sunday term could never map onto a plan day.
CREATE TABLE IF NOT EXISTS calendar_terms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id     uuid REFERENCES children(id) ON DELETE CASCADE,
  label        text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  weekdays     smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  source       calendar_source NOT NULL DEFAULT 'manual',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_terms_date_order CHECK (end_date >= start_date),
  CONSTRAINT calendar_terms_weekdays_valid CHECK (
    array_length(weekdays, 1) >= 1
    AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6]::smallint[]
  )
);

CREATE TABLE IF NOT EXISTS calendar_exceptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id     uuid REFERENCES children(id) ON DELETE CASCADE,
  on_date      date NOT NULL,
  kind         calendar_exception_kind NOT NULL,
  note         text CHECK (note IS NULL OR char_length(note) <= 200),
  source       calendar_source NOT NULL DEFAULT 'manual',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 3. Indexes.

-- One exception per scope per date. Postgres table-level UNIQUE constraints only
-- accept column references, not expressions like COALESCE — the expression form
-- requires a UNIQUE INDEX. Same pattern and rationale as household_allergens
-- (20261008000000:51-67), dietary_preferences, and food_preferences.
CREATE UNIQUE INDEX IF NOT EXISTS calendar_exceptions_scope_date_uniq
  ON calendar_exceptions (
    household_id,
    COALESCE(child_id, '00000000-0000-0000-0000-000000000000'::uuid),
    on_date
  );

CREATE INDEX IF NOT EXISTS calendar_terms_household_idx
  ON calendar_terms (household_id);

-- The resolver's hot query is a date-range overlap for one household's week.
CREATE INDEX IF NOT EXISTS calendar_terms_range_idx
  ON calendar_terms (household_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS calendar_exceptions_household_date_idx
  ON calendar_exceptions (household_id, on_date);

CREATE INDEX IF NOT EXISTS calendar_terms_child_idx
  ON calendar_terms (child_id) WHERE child_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_exceptions_child_idx
  ON calendar_exceptions (child_id) WHERE child_id IS NOT NULL;

-- 4. RLS.
--
-- The API reaches these tables with the service-role client, which bypasses RLS;
-- household scoping is enforced at the route layer. RLS is still enabled so the
-- anon/authenticated SDK keys cannot read across households. There is no
-- current_household_id() SQL function in this codebase — the household claim is
-- resolved with an inline subquery, matching child_preferences (20261013000000)
-- and child_lunch_requests (20261015000000).

ALTER TABLE calendar_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_terms_household_rw ON calendar_terms
  FOR ALL
  USING (household_id = (SELECT current_household_id FROM users WHERE id = auth.uid()));

ALTER TABLE calendar_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_exceptions_household_rw ON calendar_exceptions
  FOR ALL
  USING (household_id = (SELECT current_household_id FROM users WHERE id = auth.uid()));

-- 5. Kitchen-map cache invalidation.
--
-- These tables do not feed KitchenMapRepository.loadRaw() yet — the projection
-- is a later slice. The triggers ship now anyway: a source table added to
-- loadRaw() without a version-bump trigger leaves the Redis cache stale for up
-- to an hour, which is a bug this repo has already shipped once (the gap
-- 20261008000200 was written to close). Both tables carry a direct household_id,
-- so they reuse bump_kitchen_map_version() (20260820000000) unchanged.

CREATE TRIGGER calendar_terms_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON calendar_terms
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();

CREATE TRIGGER calendar_exceptions_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON calendar_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();
