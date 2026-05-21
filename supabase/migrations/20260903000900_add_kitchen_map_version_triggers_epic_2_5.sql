-- Slice 2.5-s1 — Foundation: kitchen_map_version triggers for new Epic 2.5
-- satellite tables.
--
-- All five new tables (child_allergens, food_preferences,
-- dietary_preferences, favorite_lunches, household_rules) carry a direct
-- household_id column, so they reuse the existing bump_kitchen_map_version()
-- trigger function from migration 20260820000000.
--
-- The composer reads from these tables via KitchenMapRepository.loadRaw;
-- the Redis cache is keyed by households.kitchen_map_version. Without these
-- triggers, writes through the new tables would leave the cache stale.
--
-- onboarding_moment_state and cultural_priors.enforcement are NOT triggered
-- here:
--   - onboarding_moment_state is not part of the KitchenMap projection
--     (it's onboarding session bookkeeping, not household state).
--   - cultural_priors already has a trigger from 20260820000000; the new
--     enforcement column writes go through the existing trigger.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS household_rules_bump_kitchen_map ON household_rules;
--   DROP TRIGGER IF EXISTS favorite_lunches_bump_kitchen_map ON favorite_lunches;
--   DROP TRIGGER IF EXISTS dietary_preferences_bump_kitchen_map ON dietary_preferences;
--   DROP TRIGGER IF EXISTS food_preferences_bump_kitchen_map ON food_preferences;
--   DROP TRIGGER IF EXISTS child_allergens_bump_kitchen_map ON child_allergens;

CREATE TRIGGER child_allergens_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON child_allergens
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();

CREATE TRIGGER food_preferences_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON food_preferences
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();

CREATE TRIGGER dietary_preferences_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON dietary_preferences
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();

CREATE TRIGGER favorite_lunches_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON favorite_lunches
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();

CREATE TRIGGER household_rules_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON household_rules
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();
