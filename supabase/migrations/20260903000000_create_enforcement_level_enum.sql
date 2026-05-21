-- Slice 2.5-s1 — Foundation: enforcement gradient enum.
--
-- Five-rung enforcement strength used by dietary_preferences,
-- food_preferences, household_rules, and (via ALTER) cultural_priors.
-- Order is meaningful (increasing strictness):
--   non_negotiable   → hard rule; planner MUST NOT violate
--   strong           → elevated; planner avoids, confirms before exceptions
--   default          → standard preference; planner respects, may surface alternatives
--   soft             → gentle bias; planner weighs but does not gate
--   just_for_context → informational only; planner never enforces
--
-- Allergens are intentionally NOT routed through this enum — they are
-- uniformly hard (FR122).
--
-- Parity: packages/contracts/src/enforcement.ts ENFORCEMENT_LEVEL_VALUES
-- mirrors this enum exactly. The integration test
-- apps/api/test/integration/enforcement-enum-parity.test.ts queries pg_enum
-- and asserts equality.
--
-- Rollback:
--   DROP TYPE IF EXISTS enforcement_level;

CREATE TYPE enforcement_level AS ENUM (
  'non_negotiable',
  'strong',
  'default',
  'soft',
  'just_for_context'
);
