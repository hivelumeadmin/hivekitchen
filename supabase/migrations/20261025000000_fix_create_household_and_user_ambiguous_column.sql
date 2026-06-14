-- Fix ambiguous column reference in create_household_and_user (PostgreSQL error 42702).
--
-- RETURNS TABLE declares an output variable named `id`. The ON CONFLICT (id)
-- clause's column reference is therefore ambiguous between the PL/pgSQL output
-- variable and the users.id table column. Identical pattern to the
-- ack_parental_notice fix in 20260902000500.
-- Fix: replace ON CONFLICT (id) with ON CONFLICT ON CONSTRAINT users_pkey so
-- there is no column name to misresolve.
--
-- Rollback: revert to ON CONFLICT (id) DO NOTHING (migration 20260501120500).

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
    ON CONFLICT ON CONSTRAINT users_pkey DO NOTHING;
  RETURN QUERY
    SELECT u.id, u.email, u.display_name, u.current_household_id, u.role
    FROM users u WHERE u.id = p_user_id;
END;
$$;
