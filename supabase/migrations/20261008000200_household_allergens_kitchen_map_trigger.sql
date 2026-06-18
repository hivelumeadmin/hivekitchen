-- Story 3-DM-B2 follow-up — kitchen_map_version trigger for household_allergens.
--
-- The consolidation migration (20261008000000) created household_allergens to
-- absorb both the old child_allergens table and households.declared_allergens.
-- The drop migration (20261008000100) removed child_allergens together with
-- its kitchen_map_version trigger (20260903000900). household_allergens was
-- never given its own trigger, leaving the Redis kitchen-map cache stale after
-- any allergen write — per-child allergens declared during onboarding would not
-- appear in the Kitchen Profile panel until the cache key rotated.
--
-- household_allergens carries a direct household_id column, so it reuses the
-- existing bump_kitchen_map_version() trigger function unchanged.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS household_allergens_bump_kitchen_map ON household_allergens;
--   DROP TRIGGER IF EXISTS household_cultural_identifiers_bump_kitchen_map ON household_cultural_identifiers;

CREATE TRIGGER household_allergens_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON household_allergens
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();

-- household_cultural_identifiers was created in the same consolidation
-- migration and also lacks a trigger. It contributes to KitchenMapHouseholdSchema
-- (household.cultural_identifiers), so it needs the same treatment.
CREATE TRIGGER household_cultural_identifiers_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON household_cultural_identifiers
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();
