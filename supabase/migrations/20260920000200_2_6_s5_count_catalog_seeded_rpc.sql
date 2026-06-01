-- Slice 2.6-s5 — RPC for counting catalog-seeded recipes available to a household.
-- Used by CatalogRecoveryService (floor breach check) and CatalogSeedService
-- (Stage 2 trigger evaluation after Stage 1 completes).
--
-- A dedicated function is used instead of a supabase-js joined-table count query
-- because cross-table column filters on head:true (count-only) requests have
-- inconsistent behavior across PostgREST versions.

CREATE OR REPLACE FUNCTION count_catalog_seeded_for_household(p_household_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(hru.recipe_id)
  FROM household_recipe_usage hru
  INNER JOIN recipes r ON r.id = hru.recipe_id
  WHERE hru.household_id = p_household_id
    AND r.source = 'catalog_seeded'
    AND r.is_active = true;
$$;
