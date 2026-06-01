-- Story 3-DM-B1 — Child profile attributes + bag_composition_pattern enum promotion.
--
-- Adds the three variation-driving enums (appetite_level, texture_needs,
-- spice_tolerance) the family-first model uses to auto-derive per-child
-- plan_slot_variations. Promotes bag_composition_pattern from text+CHECK
-- to a proper enum. Drops the legacy bag_composition jsonb column and the
-- allergen_rule_version stamp (versioning now lives on allergen_tags.rule_class).
--
-- Depends on: 20260907000000_add_bag_composition_pattern_to_children.sql
--             20260520000000_add_bag_composition_to_children.sql

-- ---------------------------------------------------------------------------
-- 1. Create enums per canonical §5.2.
-- ---------------------------------------------------------------------------
CREATE TYPE appetite_level AS ENUM ('light', 'normal', 'heavy');
CREATE TYPE texture_needs AS ENUM ('soft', 'mixed', 'normal');
CREATE TYPE spice_tolerance AS ENUM ('mild', 'regular', 'spicy');
CREATE TYPE bag_composition_pattern AS ENUM (
  'main_only',
  'main_plus_snack',
  'main_plus_extra',
  'main_plus_snack_plus_extra'
);

-- ---------------------------------------------------------------------------
-- 2. Backfill bag_composition_pattern from the legacy jsonb for any row
--    whose pattern is still NULL — required before the NOT NULL promotion
--    in step 3. The four jsonb combinations map 1:1 to the enum values.
-- ---------------------------------------------------------------------------
UPDATE children
   SET bag_composition_pattern = CASE
     WHEN (bag_composition->>'snack')::boolean
      AND (bag_composition->>'extra')::boolean THEN 'main_plus_snack_plus_extra'
     WHEN (bag_composition->>'snack')::boolean THEN 'main_plus_snack'
     WHEN (bag_composition->>'extra')::boolean THEN 'main_plus_extra'
     ELSE 'main_only'
   END
 WHERE bag_composition_pattern IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Promote bag_composition_pattern: drop the CHECK, change column type to
--    the enum, NOT NULL with a sensible default. Future onboarding writes
--    set this explicitly; pre-existing rows are covered by the backfill above.
-- ---------------------------------------------------------------------------
ALTER TABLE children DROP CONSTRAINT IF EXISTS children_bag_composition_pattern_valid;

ALTER TABLE children
  ALTER COLUMN bag_composition_pattern TYPE bag_composition_pattern
    USING bag_composition_pattern::bag_composition_pattern;

ALTER TABLE children
  ALTER COLUMN bag_composition_pattern SET NOT NULL;

ALTER TABLE children
  ALTER COLUMN bag_composition_pattern SET DEFAULT 'main_plus_snack_plus_extra';

-- ---------------------------------------------------------------------------
-- 4. Add new variation-driving attribute columns. NOT NULL with defaults so
--    existing rows immediately have valid values; onboarding overrides when
--    parents declare per-child preferences.
-- ---------------------------------------------------------------------------
ALTER TABLE children
  ADD COLUMN appetite_level   appetite_level  NOT NULL DEFAULT 'normal',
  ADD COLUMN texture_needs    texture_needs   NOT NULL DEFAULT 'normal',
  ADD COLUMN spice_tolerance  spice_tolerance NOT NULL DEFAULT 'mild';

COMMENT ON COLUMN children.appetite_level IS
  'Story 3-DM-B1 — drives portion_size auto-derivation per plan_slot_variation. '
  'Default ''normal'' covers the unspecified case; onboarding moments capture '
  'overrides.';
COMMENT ON COLUMN children.texture_needs IS
  'Story 3-DM-B1 — drives texture_level auto-derivation. ''soft'' for younger '
  'children or sensory-needs households; ''mixed'' for transitional children; '
  '''normal'' default.';
COMMENT ON COLUMN children.spice_tolerance IS
  'Story 3-DM-B1 — drives spice_level auto-derivation. Default ''mild'' is the '
  'safe choice — parents opt into spicier explicitly so no kid is accidentally '
  'over-spiced.';

-- ---------------------------------------------------------------------------
-- 5. Drop superseded columns + CHECK constraints. The bag_composition jsonb
--    is fully replaced by bag_composition_pattern (the parent's actual mental
--    model). allergen_rule_version moves to allergen_tags.rule_class where
--    the vocabulary table already version-stamps per allergen.
-- ---------------------------------------------------------------------------
ALTER TABLE children DROP CONSTRAINT IF EXISTS children_bag_main_true;
ALTER TABLE children DROP COLUMN bag_composition;
ALTER TABLE children DROP COLUMN allergen_rule_version;
