-- Story 2.10 review: enforce NOT NULL on the three envelope-encrypted child columns.
-- Distinguishes "no allergens declared" (encrypted empty array []) from
-- "allergen data was never written" (which should never exist and now cannot).
--
-- NOOP:W10= is base64(JSON.stringify([])) — the dev/test encoding of an empty array.
-- Any existing NULL rows (there should be none in beta) are patched to this sentinel
-- before the constraint is applied. In staging/production the NOT NULL constraint
-- alone is sufficient: the application always encrypts before INSERT.
UPDATE children
  SET declared_allergens   = 'NOOP:W10=',
      cultural_identifiers = 'NOOP:W10=',
      dietary_preferences  = 'NOOP:W10='
  WHERE declared_allergens   IS NULL
     OR cultural_identifiers IS NULL
     OR dietary_preferences  IS NULL;

ALTER TABLE children
  ALTER COLUMN declared_allergens   SET NOT NULL,
  ALTER COLUMN cultural_identifiers SET NOT NULL,
  ALTER COLUMN dietary_preferences  SET NOT NULL;
