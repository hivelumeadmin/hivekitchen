-- Rollback: DROP POLICY ... ; ALTER TABLE users DISABLE ROW LEVEL SECURITY;
--           ALTER TABLE households DISABLE ROW LEVEL SECURITY;
-- Story 2.1 deferred RLS to this story (AC8: "RLS policies deferred to Story 2.2").
-- auth.uid() returns the Supabase Auth user id, which equals users.id (both reference auth.users.id).
-- The API service role bypasses all policies; policies guard direct Supabase-client access.
-- UPDATE policies intentionally omitted: all mutations go through the service-role client (which
-- bypasses RLS) via the HiveKitchen API. Granting UPDATE to the authenticated role with only a
-- USING clause (no WITH CHECK) would allow field-level privilege escalation (e.g., role → 'ops').

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE households ENABLE ROW LEVEL SECURITY;

-- Users: authenticated users may only read their own profile row.
CREATE POLICY users_self_select_policy ON users
  FOR SELECT USING (auth.uid() = id);

-- Households: authenticated users may only read the household they currently belong to.
CREATE POLICY households_member_select_policy ON households
  FOR SELECT USING (
    id = (SELECT current_household_id FROM users WHERE id = auth.uid())
  );
