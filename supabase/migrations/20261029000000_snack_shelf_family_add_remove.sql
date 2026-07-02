-- Story 3-S41 — Family Snack Shelf (add / remove).
--
-- Extends the snack_skus table (created in 20261028000000_snack_sku_rotation_unfold.sql)
-- with a soft-delete column so a household can remove a snack it added without
-- breaking plan_slots references or audit history. Adds the kitchen_map_version
-- bump trigger that 3-S40 deferred (D-3S40-CR4): household-scoped snack writes
-- now exist, so the Redis cache-invalidation trigger becomes live.
--
-- Column naming note: snack_skus carries created_by_household_id, NOT the
-- household_id that the generic bump_kitchen_map_version() trigger reads. We
-- therefore write a bespoke trigger function that resolves the FK alias.
-- Global seed rows (created_by_household_id IS NULL) are a no-op.
--
-- Depends on:
--   20261028000000_snack_sku_rotation_unfold.sql (snack_skus table)
--   20260820000000_add_kitchen_map_version.sql   (households.kitchen_map_version + pattern)
--
-- Rollback:
--   DROP TRIGGER IF EXISTS snack_skus_bump_kitchen_map ON snack_skus;
--   DROP FUNCTION IF EXISTS bump_kitchen_map_from_snack_sku();
--   ALTER TABLE snack_skus DROP COLUMN IF EXISTS archived_at;

-- ---------------------------------------------------------------------------
-- 1. Soft-delete column.
--    NULL = active; non-null = family-removed. Distinct from is_active so a
--    future Phase-2 system-disable (3-s43) can be told apart from a family
--    removal. The rotation's existing is_active filter already excludes both.
-- ---------------------------------------------------------------------------

ALTER TABLE snack_skus ADD COLUMN archived_at timestamptz;

COMMENT ON COLUMN snack_skus.archived_at IS
  'Story 3-S41 — non-null when a family removed this household-added snack. '
  'Set alongside is_active = false. NULL on global seeds and active rows.';

-- ---------------------------------------------------------------------------
-- 2. Kitchen Map cache-invalidation trigger (resolves 3-S40 D-3S40-CR4).
--    Mirrors bump_kitchen_map_version() but reads created_by_household_id
--    instead of household_id. SECURITY DEFINER + locked search_path matches
--    the project's other bump functions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bump_kitchen_map_from_snack_sku()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_household_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_household_id := OLD.created_by_household_id;
  ELSE
    target_household_id := NEW.created_by_household_id;
  END IF;

  -- Global seed rows (created_by_household_id IS NULL) → no-op.
  IF target_household_id IS NOT NULL THEN
    UPDATE households
      SET kitchen_map_version = kitchen_map_version + 1
      WHERE id = target_household_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER snack_skus_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON snack_skus
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_from_snack_sku();

-- ---------------------------------------------------------------------------
-- 3. Audit event types (AC2).
--    audit_log.event_type is the Postgres ENUM audit_event_type (created in
--    20260501110000). New values must be added to the enum AND to
--    AUDIT_EVENT_TYPES in apps/api/src/audit/audit.types.ts. The values are not
--    used within this migration, so ADD VALUE in the same transaction is safe.
-- ---------------------------------------------------------------------------

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.snack_sku_added';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.snack_sku_archived';
