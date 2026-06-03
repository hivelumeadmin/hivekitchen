-- Slice 4-S15: extend food_preferences.source to allow 'child_request'.
--
-- An approved child lunch request is mirrored into food_preferences as a soft,
-- advisory planner signal (valence='likes', enforcement='just_for_context').
-- The original CHECK (migration 20260903000200) did not include 'child_request',
-- so the existing constraint is dropped and re-added with the new value appended
-- to the REAL allowed set (NOT the placeholder set in the slice doc, which would
-- have rejected every existing row).

ALTER TABLE food_preferences
  DROP CONSTRAINT IF EXISTS food_preferences_source_check;

ALTER TABLE food_preferences
  ADD CONSTRAINT food_preferences_source_check
  CHECK (source IN (
    'onboarding_declared',
    'memory_promoted',
    'rating_signal',
    'parent_edited',
    'backfill_migration',
    'child_request'
  ));
