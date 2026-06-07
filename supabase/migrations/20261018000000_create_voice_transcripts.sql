-- Slice 5-S5 — voice_transcripts: persisted user-speech transcripts for voice turns.
--
-- One row per voice turn, anchored to the Lumi turn it produced (turn_id →
-- thread_turns.id, matching the 5-S15 model where the user reviews a transcript
-- alongside the Lumi reply and its retention countdown). `retention_until` is
-- stamped at insert (default now()+90d; 5-S15 adds the per-household override).
--
-- The idx on retention_until backs the nightly purge job 5-S15 will run; cheap
-- now, prevents a full-table scan later.
--
-- RLS: SELECT-only, matching the sibling voice tables (20260504030000). The API
-- uses the service-role client which bypasses RLS for writes; this policy only
-- guards a direct anon/authenticated read in case of leak. The inline subquery
-- against threads.household_id mirrors thread_turns_member_select_policy — there
-- is no current_household_id() helper in this schema.
--
-- Rollback:
--   DROP POLICY voice_transcripts_member_select_policy ON voice_transcripts;
--   DROP TABLE IF EXISTS voice_transcripts;

CREATE TABLE IF NOT EXISTS voice_transcripts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  turn_id         uuid NOT NULL REFERENCES thread_turns(id) ON DELETE CASCADE,
  transcript      text NOT NULL,
  retention_until timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_voice_transcripts_thread_id ON voice_transcripts(thread_id);
CREATE INDEX idx_voice_transcripts_retention_until ON voice_transcripts(retention_until);

ALTER TABLE voice_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_transcripts_member_select_policy ON voice_transcripts
  FOR SELECT USING (
    thread_id IN (
      SELECT id FROM threads
      WHERE household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
    )
  );
