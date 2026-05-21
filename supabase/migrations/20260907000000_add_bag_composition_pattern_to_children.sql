-- Slice 2.5-s8 — Moment 4 ("What goes in the bag") column.
--
-- Captures the parent-stated bag composition pattern declared in Moment 4 of
-- the chaptered onboarding interview. Coexists with the legacy
-- `bag_composition` JSONB column (`{ main, snack, extra }` booleans) which
-- remains the planner-facing source of truth — the planner still derives a
-- pattern from the booleans when this column is NULL, and slice 2.5-s11 will
-- begin projecting this column into the Kitchen Map directly.
--
-- The four valid values mirror BagCompositionPatternSchema in
-- packages/contracts/src/kitchen-map.ts. A CHECK constraint enforces them at
-- the DB layer so the column cannot drift away from the contract enum.
-- Nullable: pre-Epic-2.5 children and any future child that hasn't completed
-- Moment 4 yet sit as NULL until the parent answers.
--
-- Not encrypted: enum-valued, low PII surface (the planner already sees the
-- equivalent boolean struct in plaintext).
--
-- Trigger note: the `children_bump_kitchen_map` trigger from
-- 20260820000000_add_kitchen_map_version.sql already fires on every UPDATE,
-- so writes to this column automatically invalidate the cached projection.
-- No new trigger needed.
--
-- Rollback:
--   ALTER TABLE children DROP CONSTRAINT IF EXISTS children_bag_composition_pattern_valid;
--   ALTER TABLE children DROP COLUMN IF EXISTS bag_composition_pattern;

ALTER TABLE children
  ADD COLUMN bag_composition_pattern text;

ALTER TABLE children
  ADD CONSTRAINT children_bag_composition_pattern_valid
    CHECK (
      bag_composition_pattern IS NULL
      OR bag_composition_pattern IN (
        'main_only',
        'main_plus_snack',
        'main_plus_extra',
        'main_plus_snack_plus_extra'
      )
    );

COMMENT ON COLUMN children.bag_composition_pattern IS
  'Slice 2.5-s8 — parent-stated bag composition pattern captured in Moment 4. '
  'NULL until the parent answers. CHECK-constrained to four enum values that '
  'mirror BagCompositionPatternSchema in @hivekitchen/contracts. Coexists with '
  'the legacy bag_composition JSONB column (the planner-facing boolean struct).';
