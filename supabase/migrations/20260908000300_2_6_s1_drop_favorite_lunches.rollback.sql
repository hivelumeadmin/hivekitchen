-- Slice 2.6-s1 — ROLLBACK script for the favorite_lunches drop migration.
--
-- This file is NOT auto-applied by `supabase migration up`. It exists as a
-- last-resort recovery path if 20260908000200_2_6_s1_drop_favorite_lunches.sql
-- needs to be reversed in production.
--
-- Recovery path documented in AC8:
--   1. Re-create the `favorite_lunches` table with the original 2.5-s9 schema
--      plus the `migration_status` column that 20260908000000 added.
--   2. Copy back from recipes + household_recipe_usage:
--        - All household_recipe_usage rows with catalog_provenance='declared'
--        - JOINed to recipes for canonical_name
--        - Re-encrypted under the household DEK
--      Application-level recovery (a one-shot script) is the realistic path
--      for re-encryption; this SQL only re-creates the schema.
--
-- Rollback strategy: re-encryption is application-only (envelope-encryption
-- helpers live in apps/api/src/lib/envelope-encryption.ts). The SQL below
-- re-creates the table shape so a recovery script has somewhere to write to;
-- the script itself would call decryptField/encryptField like the original
-- migrate-favorite-lunches.ts but in reverse.

CREATE TABLE IF NOT EXISTS favorite_lunches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  item text NOT NULL,
  item_hash text NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('onboarding_seed', 'parent_added', 'plan_promoted')),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  migration_status text NOT NULL DEFAULT 'pending'
    CHECK (migration_status IN ('pending','migrated','quarantined'))
);

CREATE UNIQUE INDEX IF NOT EXISTS favorite_lunches_household_hash_uniq
  ON favorite_lunches (household_id, item_hash);

CREATE INDEX IF NOT EXISTS favorite_lunches_household_position_idx
  ON favorite_lunches (household_id, position);

CREATE INDEX IF NOT EXISTS favorite_lunches_migration_status_idx
  ON favorite_lunches (migration_status)
  WHERE migration_status <> 'migrated';

-- Operator note: after this DDL succeeds, run a recovery script that:
--   1. SELECTs from household_recipe_usage WHERE catalog_provenance='declared'
--      JOIN recipes ON recipes.id = recipe_id
--   2. For each row: encryptField(canonical_name, household DEK) → item
--      SHA256(lower(trim(canonical_name))) → item_hash
--      INSERT into favorite_lunches with provenance='onboarding_seed'
--      and migration_status='migrated' (round-trip marker).
-- Operationally this is the bridge back to the 2.5-s9 shape; once verified,
-- the drop and rollback can be re-applied if needed.
