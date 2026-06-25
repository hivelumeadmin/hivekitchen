-- Story 3-S44 — Snack SKU: UPC barcode + package type.
--
-- Extends snack_skus (created in 20261028000000, soft-delete added in
-- 20261029000000) with two OPTIONAL product-metadata columns. Both are nullable;
-- NULL means "not specified". They enrich Lumi's product context and let a parent
-- identify the exact item they buy. No allergen or enforcement semantics.
--
-- No trigger changes: the snack_skus_bump_kitchen_map trigger (20261029000000)
-- already fires on UPDATE/INSERT, so these columns are covered by cache
-- invalidation automatically.
--
-- Depends on:
--   20261028000000_snack_sku_rotation_unfold.sql  (snack_skus table)
--   20261029000000_snack_shelf_family_add_remove.sql (kitchen_map_version trigger)
--
-- Rollback:
--   ALTER TABLE snack_skus DROP COLUMN IF EXISTS package_type;
--   ALTER TABLE snack_skus DROP COLUMN IF EXISTS upc_code;

-- ---------------------------------------------------------------------------
-- 1. UPC barcode. Freeform parent-entered string — UPC-A is 12 digits, EAN-13
--    is 13, but parents may type partial codes or add dashes. Stored as TEXT
--    with no DB-level format CHECK; the contract layer enforces .max(20).
-- ---------------------------------------------------------------------------

ALTER TABLE snack_skus ADD COLUMN upc_code TEXT;

COMMENT ON COLUMN snack_skus.upc_code IS
  'Story 3-S44 — optional freeform UPC/EAN barcode entered by the parent. '
  'NULL = not specified. Length enforced by the contract (.max(20)), not the DB.';

-- ---------------------------------------------------------------------------
-- 2. Package type. CHECK-constrained enum. The five values MUST match
--    SnackPackageTypeSchema in packages/contracts/src/snack-shelf.ts exactly —
--    a divergence throws a Postgres CHECK violation at INSERT time.
-- ---------------------------------------------------------------------------

ALTER TABLE snack_skus
  ADD COLUMN package_type TEXT CHECK (package_type IN ('bag', 'box', 'cup', 'pouch', 'other'));

COMMENT ON COLUMN snack_skus.package_type IS
  'Story 3-S44 — optional package form factor. One of bag/box/cup/pouch/other. '
  'NULL = not specified. Must match SnackPackageTypeSchema in contracts.';
