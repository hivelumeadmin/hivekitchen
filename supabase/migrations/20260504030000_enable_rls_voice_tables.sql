-- Rollback:
--   DROP POLICY threads_member_select_policy ON threads;
--   DROP POLICY thread_turns_member_select_policy ON thread_turns;
--   DROP POLICY voice_sessions_self_select_policy ON voice_sessions;
--   ALTER TABLE threads        DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE thread_turns   DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE voice_sessions DISABLE ROW LEVEL SECURITY;
-- Story 2.6 review patch — defense-in-depth alignment with users/households (Story 2.2).
-- The HiveKitchen API uses the service-role client which bypasses these policies; this
-- migration only guards direct Supabase-client (anon/authenticated) access in case of leak.
-- Pattern matches 20260502090000: SELECT-only policies, mutations stay on the service role.

ALTER TABLE threads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_turns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;

-- Threads: authenticated users may only read threads in their current household.
CREATE POLICY threads_member_select_policy ON threads
  FOR SELECT USING (
    household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
  );

-- Thread turns: readable only when the parent thread belongs to the user's household.
CREATE POLICY thread_turns_member_select_policy ON thread_turns
  FOR SELECT USING (
    thread_id IN (
      SELECT id FROM threads
      WHERE household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
    )
  );

-- Voice sessions: authenticated users may only read their own sessions.
CREATE POLICY voice_sessions_self_select_policy ON voice_sessions
  FOR SELECT USING (user_id = auth.uid());
