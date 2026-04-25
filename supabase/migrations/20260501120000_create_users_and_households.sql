-- Rollback: DROP FUNCTION create_household_and_user(uuid, text, text);
--           DROP TABLE users CASCADE; DROP TABLE households CASCADE;
-- Story 2.2 adds RLS policies in supabase/migrations/20260503090000_create_rls_policies.sql.
-- household_id NOT NULL on every per-household table (architecture §1.1) — exception: users
-- carries current_household_id which is nullable until first household creation.

-- Households first — referenced by users.current_household_id; self-referenced via
-- primary_parent_user_id with DEFERRABLE FK so the bootstrap function can insert
-- household and user in one transaction (FK check happens at COMMIT, not statement).
CREATE TABLE households (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name                     text,
  primary_parent_user_id   uuid        NOT NULL,
  timezone                 text        NOT NULL DEFAULT 'America/New_York',
  tier_variant             text        NOT NULL DEFAULT 'beta',
  caregiver_relationships  jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                              uuid        NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                           text        NOT NULL UNIQUE,
  display_name                    text,
  preferred_language              text        NOT NULL DEFAULT 'en',
  current_household_id            uuid        REFERENCES households(id) ON DELETE SET NULL,
  role                            user_role   NOT NULL DEFAULT 'primary_parent',
  notification_prefs              jsonb       NOT NULL DEFAULT '{}',
  parental_notice_acknowledged_at timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE households
  ADD CONSTRAINT households_primary_parent_user_id_fk
  FOREIGN KEY (primary_parent_user_id) REFERENCES users(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX households_primary_parent_user_id_idx ON households (primary_parent_user_id);
CREATE INDEX users_current_household_id_idx ON users (current_household_id);

-- Atomic bootstrap function — PostgREST .rpc() runs the whole function in a single
-- transaction. Without this, two separate .insert() calls from auth.repository would
-- cross transaction boundaries and the deferrable FK can't help (PostgREST commits
-- per request). The function returns the new user row shape that AuthRepository.UserRow
-- expects, so the caller does not need a follow-up SELECT.
--
-- SECURITY DEFINER + locked search_path matches the audit-partition function pattern
-- from migration 20260501140000.
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
    VALUES (p_user_id, p_email, p_display_name, new_household_id, 'primary_parent');
  RETURN QUERY
    SELECT u.id, u.email, u.display_name, u.current_household_id, u.role
    FROM users u WHERE u.id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_household_and_user(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_household_and_user(uuid, text, text) TO service_role;
