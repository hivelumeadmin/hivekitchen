-- Slice 2.6-s1 — schema extensions to fold the M5 lunch catalog into the
-- existing `recipes` + `household_recipe_usage` infrastructure (shipped by
-- story 3-31). Companion migrations:
--   20260908000100  — TS migration script `migrate-favorite-lunches.ts`
--                    populates a quarantine column on `favorite_lunches`
--                    and writes migrated rows here.
--   20260908000200  — `DROP TABLE favorite_lunches`, gated on AC8.
--
-- Three changes here (all reversible):
--   1. New column  household_recipe_usage.catalog_provenance (NOT NULL,
--      DEFAULT 'plan_promoted', CHECK enum). Existing rows backfill as
--      'plan_promoted' — they were created by the planner via 3-31.
--   2. Extend the recipes.source CHECK to accept 'catalog_seeded' and
--      'parent_declared' (folds the favorite_lunches concept into recipes;
--      see Epic 2.6 brief §3 "Encryption decision" — plaintext canonical_name
--      + RLS + visibility='private' replaces the encrypted favorite_lunches.item).
--   3. New partial UNIQUE index on recipes (created_by_household_id,
--      normalized_name) for the per-household idempotency required by AC2's
--      conflict-recovery path (Stage 0/1 may seed the same item Moment 5 also
--      writes; the migration script reuses the existing row).
--
-- Rollback:
--   ALTER TABLE favorite_lunches DROP COLUMN migration_status;
--   DROP INDEX IF EXISTS recipes_household_normalized_name_uniq;
--   ALTER TABLE recipes DROP CONSTRAINT recipes_source_check;
--   ALTER TABLE recipes ADD CONSTRAINT recipes_source_check
--     CHECK (source IN ('agent_generated','curated','imported'));
--   ALTER TABLE household_recipe_usage DROP COLUMN catalog_provenance;

-- ---------------------------------------------------------------------------
-- 1. household_recipe_usage.catalog_provenance
-- ---------------------------------------------------------------------------
-- Per-household provenance for catalog entries (vs recipes.source which is a
-- per-recipe origin). Allows the SAME recipe row to be 'declared' in one
-- household (parent-stated in Moment 5) and 'plan_promoted' in another
-- (surfaced by the planner). Default 'plan_promoted' backfills the existing
-- 3-31-era rows, which all entered the catalog via PlansService.commit().

ALTER TABLE household_recipe_usage
  ADD COLUMN catalog_provenance text NOT NULL DEFAULT 'plan_promoted'
  CHECK (catalog_provenance IN ('declared','inferred','parent_added','plan_promoted'));

COMMENT ON COLUMN household_recipe_usage.catalog_provenance IS
  'How this row entered the household catalog. '
  'declared      — parent stated in Moment 5 / FR124 (or via recipe.declare). '
  'inferred      — Stage 1 LLM seeding (slice 2.6-s3) from household profile. '
  'parent_added  — parent added in-app after onboarding (Epic 7+). '
  'plan_promoted — surfaced by the planner; default for backfill of existing rows.';

-- ---------------------------------------------------------------------------
-- 2. recipes.source — extend CHECK with two new values
-- ---------------------------------------------------------------------------
-- The constraint name on the original migration is the conventional
-- `<table>_<column>_check` Postgres assigns to inline CHECKs.

ALTER TABLE recipes
  DROP CONSTRAINT recipes_source_check;

ALTER TABLE recipes
  ADD CONSTRAINT recipes_source_check
  CHECK (source IN (
    'agent_generated',
    'curated',
    'imported',
    'catalog_seeded',
    'parent_declared'
  ));

-- ---------------------------------------------------------------------------
-- 3. Per-household normalized canonical_name unique index
-- ---------------------------------------------------------------------------
-- Normalization rule for the IMMUTABLE function: lowercase, then strip ASCII
-- whitespace, hyphens, and apostrophes. Application code (the migration
-- script + the favorite_lunch.add tool) normalizes the stored canonical_name
-- to Unicode NFC BEFORE insert so the index sees consistent codepoints.
--
-- Partial index — restricted to rows with created_by_household_id IS NOT NULL.
-- Shared/curated rows (created_by_household_id may be NULL for imported)
-- legitimately share canonical_name across households.

CREATE OR REPLACE FUNCTION recipes_normalized_canonical_name(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(lower(name), '[\s\-'']+', '', 'g')
$$;

CREATE UNIQUE INDEX recipes_household_normalized_name_uniq
  ON recipes (created_by_household_id, recipes_normalized_canonical_name(canonical_name))
  WHERE created_by_household_id IS NOT NULL;

COMMENT ON INDEX recipes_household_normalized_name_uniq IS
  'Per-household idempotency index for the M5 catalog (slice 2.6-s1). Allows '
  'the favorite_lunch.add tool and the migrate-favorite-lunches script to '
  'detect "same item already in catalog" via a normalized canonical_name match '
  'and reuse the existing recipes.id (AC2 conflict-recovery path).';

-- ---------------------------------------------------------------------------
-- 4. favorite_lunches.migration_status — temporary quarantine flag
-- ---------------------------------------------------------------------------
-- Used by the migrate-favorite-lunches script (slice 2.6-s1 AC3) to mark
-- each row as 'pending' (initial), 'migrated' (successfully folded into
-- recipes + household_recipe_usage), or 'quarantined' (DEK decryption failed
-- — row left alone, surfaced to ops). The drop migration (AC8) gates on
-- zero pending/quarantined rows OR explicit ops sign-off.

ALTER TABLE favorite_lunches
  ADD COLUMN migration_status text NOT NULL DEFAULT 'pending'
  CHECK (migration_status IN ('pending','migrated','quarantined'));

CREATE INDEX favorite_lunches_migration_status_idx
  ON favorite_lunches (migration_status)
  WHERE migration_status <> 'migrated';

COMMENT ON COLUMN favorite_lunches.migration_status IS
  'Slice 2.6-s1 quarantine flag for the favorite_lunches → recipes fold. '
  'pending (default) — not yet processed by migrate-favorite-lunches. '
  'migrated — successfully folded; row will be dropped with the table. '
  'quarantined — DEK decryption failed; row left in place for ops triage.';
