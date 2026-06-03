-- Story 3-DM-E1 — Adjacent table cleanup.
--
-- 1. Rename day_overrides → plan_day_context
-- 2. Replace day_override_type enum with plan_day_context_type (drop bag_suspended, sick_day)
-- 3. Rename override_type column → context_type
-- 4. Drop recipes.instructions if still present (defensive)
-- 5. Fix plan_slots.main_assignment_id FK: add ON DELETE CASCADE

-- 1. Rename table.
ALTER TABLE day_overrides RENAME TO plan_day_context;

-- 2a. Create new enum with only the composition-context values.
CREATE TYPE plan_day_context_type AS ENUM (
  'half_day', 'field_trip', 'post_dentist',
  'early_release', 'sport_practice', 'test_day'
);

-- 2b. Guard: delete any rows with pause-overlapping values before the type swap.
-- C1 already migrated bag_suspended/sick_day rows to plan_days.paused_at;
-- this is defensive cleanup for any dev-environment stragglers.
DELETE FROM plan_day_context WHERE override_type IN ('bag_suspended', 'sick_day');

-- 2c. Swap the column type.
ALTER TABLE plan_day_context
  ALTER COLUMN override_type TYPE plan_day_context_type
  USING override_type::text::plan_day_context_type;

-- 3. Rename the column.
ALTER TABLE plan_day_context RENAME COLUMN override_type TO context_type;

-- 2d. Drop old enum (after the column type swap succeeds).
DROP TYPE day_override_type;

-- 4. Defensive drop of recipes.instructions (should be gone from A1).
ALTER TABLE recipes DROP COLUMN IF EXISTS instructions;

-- 5. Fix plan_slots.main_assignment_id FK: add ON DELETE CASCADE.
-- The C1 migration created this FK with no ON DELETE action (defaults to
-- RESTRICT), which forced scripts/clear-load-test-plans.ts to delete in
-- explicit order. CASCADE (not SET NULL) because slot_kind='main' rows carry
-- a CHECK that main_assignment_id IS NOT NULL — SET NULL would violate it.
-- Postgres auto-names the inline FK plan_slots_main_assignment_id_fkey; verify
-- with the pre-migration check in the story if a DROP CONSTRAINT error occurs.
ALTER TABLE plan_slots
  DROP CONSTRAINT IF EXISTS plan_slots_main_assignment_id_fkey,
  ADD CONSTRAINT plan_slots_main_assignment_id_fkey
    FOREIGN KEY (main_assignment_id)
    REFERENCES plan_main_assignments(id)
    ON DELETE CASCADE;

-- Down (best-effort dev rollback):
-- ALTER TABLE plan_slots
--   DROP CONSTRAINT plan_slots_main_assignment_id_fkey,
--   ADD CONSTRAINT plan_slots_main_assignment_id_fkey
--     FOREIGN KEY (main_assignment_id) REFERENCES plan_main_assignments(id);
-- ALTER TABLE plan_day_context RENAME COLUMN context_type TO override_type;
-- CREATE TYPE day_override_type AS ENUM (
--   'bag_suspended','half_day','field_trip','sick_day',
--   'post_dentist','early_release','sport_practice','test_day'
-- );
-- ALTER TABLE plan_day_context
--   ALTER COLUMN override_type TYPE day_override_type
--   USING override_type::text::day_override_type;
-- DROP TYPE plan_day_context_type;
-- ALTER TABLE plan_day_context RENAME TO day_overrides;
