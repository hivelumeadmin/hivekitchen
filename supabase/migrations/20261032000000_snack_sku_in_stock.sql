-- Add a per-snack in-stock / pause flag, distinct from removal.
--
-- is_active (+ archived_at) is a PERMANENT soft-delete: the snack leaves the
-- shelf. in_stock is a REVERSIBLE "I'm temporarily out of this" toggle: the snack
-- stays on the shelf but is excluded from the weekly rotation until re-enabled.
--
-- Default true so every existing and newly-added snack starts in stock. Only
-- household-owned rows are toggled in practice (the route scopes writes to
-- created_by_household_id, mirroring remove); global seeds stay in_stock = true.
--
-- No trigger change — the snack_skus_bump_kitchen_map trigger (20261029000000)
-- already fires on UPDATE, so toggling in_stock invalidates the kitchen-map cache.
--
-- Depends on:
--   20261028000000_snack_sku_rotation_unfold.sql  (snack_skus)
--
-- Rollback:
--   ALTER TABLE snack_skus DROP COLUMN IF EXISTS in_stock;

ALTER TABLE snack_skus ADD COLUMN in_stock boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN snack_skus.in_stock IS
  'Reversible pause flag. true = available, included in the weekly snack rotation. '
  'false = temporarily out of stock, hidden from rotation but still on the shelf. '
  'Distinct from is_active/archived_at (permanent removal).';
