-- Story 3-DM-B2 — Drop legacy allergen / cultural / dietary storage.
--
-- Runs AFTER `apps/api/scripts/backfill-household-allergens.ts` has executed
-- against this database and its verification gate has passed (count parity
-- between the source rows and household_allergens / household_cultural_identifiers
-- / dietary_preferences). The script ABORTs on mismatch, so re-applying this
-- migration after a failed backfill is a no-op data-loss event by design — do
-- NOT run the migration before the gate passes.
--
-- Pre-beta hard cutover (per Menon 2026-05-31): rollback data loss is
-- acceptable; restoring the encrypted-column / child_allergens shape would
-- need backup restore + a regenerated DEK if those columns ever held real
-- production data.
--
-- Rollback:
--   The down path restores `child_allergens` from canonical 2.5-s1 DDL
--   (see 20260903000100_create_child_allergens_table.sql) and back-fills it
--   from household_allergens WHERE child_id IS NOT NULL. The households /
--   children encrypted columns can be re-added as nullable text and left NULL
--   for pre-beta — production data restore is the only honest rollback path.

DROP TABLE IF EXISTS child_allergens;

ALTER TABLE households
  DROP COLUMN IF EXISTS declared_allergens,
  DROP COLUMN IF EXISTS cultural_identifiers,
  DROP COLUMN IF EXISTS dietary_preferences;

ALTER TABLE children
  DROP COLUMN IF EXISTS declared_allergens,
  DROP COLUMN IF EXISTS cultural_identifiers,
  DROP COLUMN IF EXISTS dietary_preferences;
