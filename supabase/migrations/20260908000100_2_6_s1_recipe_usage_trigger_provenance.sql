-- Slice 2.6-s1 patch — extend the kitchen-map version bump trigger to also
-- fire when catalog_provenance changes on an existing household_recipe_usage row.
--
-- Background:
--   The original trigger (20260820000200) fires on INSERT/DELETE and on UPDATE
--   when is_household_favorite or is_household_banned changes. catalog_provenance
--   was added in 20260908000000 but was not added to the trigger condition.
--
--   projectFavoriteLunchesFromUsage (kitchen-map.composer.ts) includes rows
--   whose catalog_provenance is 'declared' or 'parent_added' even when
--   is_household_favorite=false. A provenance-only change (e.g. 'inferred' →
--   'declared') can therefore add or remove items from the favorite_lunches
--   projection without bumping the kitchen_map_version, leaving the Redis
--   cache stale until the next unrelated update.

CREATE OR REPLACE FUNCTION bump_kitchen_map_from_recipe_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE households
      SET kitchen_map_version = kitchen_map_version + 1
      WHERE id = NEW.household_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE households
      SET kitchen_map_version = kitchen_map_version + 1
      WHERE id = OLD.household_id;
    RETURN OLD;
  END IF;

  -- UPDATE: bump when any projection-relevant column changes. Counter-only
  -- updates (use_count, last_used_at, confidence_score) are intentionally
  -- silent so plan commits don't thrash the cache.
  IF OLD.is_household_favorite IS DISTINCT FROM NEW.is_household_favorite
     OR OLD.is_household_banned  IS DISTINCT FROM NEW.is_household_banned
     OR OLD.catalog_provenance   IS DISTINCT FROM NEW.catalog_provenance
  THEN
    UPDATE households
      SET kitchen_map_version = kitchen_map_version + 1
      WHERE id = NEW.household_id;
  END IF;

  RETURN NEW;
END;
$$;
