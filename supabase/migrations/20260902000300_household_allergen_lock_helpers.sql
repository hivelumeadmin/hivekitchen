-- PostgreSQL advisory lock helpers for HouseholdsService.addAllergens.
-- Serialises concurrent read-modify-write operations on household allergen data
-- so that a second agent turn cannot overwrite allergens written by the first.
--
-- Session-level (not xact-level): the caller MUST invoke release in a finally
-- block. The lock is automatically released when the DB connection is closed,
-- providing a safety net against application crashes between acquire and release.

CREATE OR REPLACE FUNCTION acquire_household_allergen_lock(p_household_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM pg_advisory_lock(hashtext(p_household_id::text));
END;
$$;

CREATE OR REPLACE FUNCTION release_household_allergen_lock(p_household_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM pg_advisory_unlock(hashtext(p_household_id::text));
END;
$$;
