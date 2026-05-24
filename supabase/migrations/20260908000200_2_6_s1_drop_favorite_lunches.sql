-- Slice 2.6-s1 — drop the standalone `favorite_lunches` table.
--
-- Gating (per slice AC8):
--   1. The migration script `apps/api/scripts/migrate-favorite-lunches.ts`
--      must have flipped every row to migration_status='migrated' OR
--      operations must have explicitly signed off on the residual
--      'quarantined' rows.
--   2. All code references to the `favorite_lunches` table must be removed.
--      This was verified pre-shipping; the migration script reads from the
--      table but is invoked once and then archived.
--
-- Verification query (run BEFORE applying this migration):
--   SELECT migration_status, COUNT(*) FROM favorite_lunches GROUP BY 1;
--   -- All rows MUST be 'migrated' OR ops sign-off in writing for residual
--   -- 'quarantined' rows.
--
-- Rollback strategy: see companion migration
--   20260908000300_2_6_s1_drop_favorite_lunches.rollback.sql
-- which re-creates the table, copies migrated rows back from
-- recipes + household_recipe_usage, and re-encrypts canonical_name under
-- the household DEK. The rollback is intended as a last-resort safety net;
-- post-drop, real recovery is the backups, not this script.

-- Guard: abort if any rows remain pending. All rows must be 'migrated' (or
-- ops must have explicitly accepted residual 'quarantined' rows) before this
-- migration is applied. See verification query in the header comment above.
DO $$
DECLARE v_pending bigint;
BEGIN
  IF to_regclass('public.favorite_lunches') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_pending
      FROM favorite_lunches
      WHERE migration_status = 'pending';
    IF v_pending > 0 THEN
      RAISE EXCEPTION
        'favorite_lunches drop blocked: % pending row(s) remain. '
        'Run apps/api/scripts/migrate-favorite-lunches.ts first.',
        v_pending;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS favorite_lunches;
