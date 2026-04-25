-- Rollback: Replace with original function body from 20260501120000.
-- Story 2-1 review (P6): guard against TOCTOU race on concurrent first-login.
-- Two simultaneous OAuth callbacks for the same new user can both pass
-- findUserByAuthId (both read NULL before either commits) and both attempt
-- create_household_and_user. The second call's user INSERT now silently no-ops
-- via ON CONFLICT DO NOTHING; the trailing SELECT returns the committed row.
-- Side-effect: the losing call inserts an orphaned household row (valid FK,
-- never referenced as current_household_id). This is acceptable given the
-- extreme rarity of the race and can be cleaned up by a future maintenance job.

CREATE OR REPLACE FUNCTION create_household_and_user(
  p_user_id      uuid,
  p_email        text,
  p_display_name text
)
RETURNS TABLE (
  id                   uuid,
  email                text,
  display_name         text,
  current_household_id uuid,
  role                 user_role
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  new_household_id uuid;
BEGIN
  new_household_id := gen_random_uuid();
  INSERT INTO households (id, primary_parent_user_id) VALUES (new_household_id, p_user_id);
  INSERT INTO users (id, email, display_name, current_household_id, role)
    VALUES (p_user_id, p_email, p_display_name, new_household_id, 'primary_parent')
    ON CONFLICT (id) DO NOTHING;
  RETURN QUERY
    SELECT u.id, u.email, u.display_name, u.current_household_id, u.role
    FROM users u WHERE u.id = p_user_id;
END;
$$;
