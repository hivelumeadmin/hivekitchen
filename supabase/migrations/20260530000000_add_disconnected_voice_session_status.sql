-- Add 'disconnected' to voice_sessions status CHECK constraint.
-- 'disconnected' is written when a client WS connection drops mid-session
-- (client_disconnect close reason). Previously the constraint only listed
-- 'active', 'closed', and 'timed_out', causing a DB error on disconnect.
ALTER TABLE voice_sessions DROP CONSTRAINT IF EXISTS voice_sessions_status_check;
ALTER TABLE voice_sessions ADD CONSTRAINT voice_sessions_status_check
  CHECK (status IN ('active', 'closed', 'timed_out', 'disconnected'));
