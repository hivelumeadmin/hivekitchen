-- 5-S15: Voice retention controls
-- Add per-user retention mode to users table.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS voice_retention_mode TEXT NOT NULL DEFAULT 'standard'
    CHECK (voice_retention_mode IN ('standard', 'immediate_delete'));

-- Add user_id to voice_transcripts for per-user scoping (insert + delete by user).
-- Nullable to avoid breaking existing rows (5-S5 inserts had no user_id).
-- ON DELETE CASCADE: if a user is hard-deleted (7-S11), their transcripts go too.
ALTER TABLE voice_transcripts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

-- Index backs per-user queries (AC1, AC5).
CREATE INDEX IF NOT EXISTS idx_voice_transcripts_user_id ON voice_transcripts(user_id);
