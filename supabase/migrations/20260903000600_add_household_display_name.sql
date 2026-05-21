-- Slice 2.5-s1 — Foundation: households.display_name column.
--
-- Parent-chosen household label (e.g. "The Menons", "Apartment 4B"). Used
-- across Kitchen Profile, Lunch Link recipient signatures, and ambient Lumi
-- copy. Real values land via the `household.set_name` tool from Moment 1
-- (slice 2.5-s5); existing rows get backfilled to a deterministic placeholder
-- so downstream code never sees NULL.
--
-- Not encrypted: household_id-equivalent visibility, low PII surface, used
-- as a display label across surfaces.
--
-- Rollback:
--   ALTER TABLE households DROP COLUMN IF EXISTS display_name;

ALTER TABLE households
  ADD COLUMN display_name text;

-- Backfill existing rows with a stable placeholder derived from the
-- household id so onboarded households have something to render until the
-- next parent edit. Length-checked at the contract boundary (max 120).
UPDATE households
  SET display_name = 'Household ' || SUBSTRING(id::text FROM 1 FOR 8)
  WHERE display_name IS NULL;
