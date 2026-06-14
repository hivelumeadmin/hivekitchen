-- 5-S16: Voice tier cap — weekly per-user voice usage counter.
--
-- One row per (user, ISO week). `week_start` is the Monday (UTC) of the week,
-- stored as a date; `ms_consumed` accumulates the estimated duration of each
-- successfully-transcribed WAV utterance. The standard-tier cap (600_000 ms /
-- 10 min) is enforced in the API (LumiService + POST /voice/sessions); this
-- table is just the counter. Prior weeks' rows are retained as natural history
-- (no rollover; each Monday begins a fresh row).
--
-- The increment is atomic via increment_voice_usage() below (INSERT ... ON
-- CONFLICT DO UPDATE) so the counter never under-counts under concurrent turns.
--
-- RLS: SELECT-only, scoped to the owning user, matching the sibling voice tables
-- (voice_transcripts, 20261018000000). The API uses the service-role client
-- which bypasses RLS for writes; this policy only guards a direct
-- anon/authenticated read in case of leak.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS increment_voice_usage(uuid, date, bigint);
--   DROP POLICY voice_usage_owner_select_policy ON voice_usage;
--   DROP TABLE IF EXISTS voice_usage;

CREATE TABLE IF NOT EXISTS voice_usage (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start  date NOT NULL,                          -- Monday UTC, 'YYYY-MM-DD'
  ms_consumed bigint NOT NULL DEFAULT 0,
  CONSTRAINT voice_usage_pkey PRIMARY KEY (user_id, week_start)
);

-- Atomic increment via INSERT ... ON CONFLICT DO UPDATE.
-- Called by VoiceUsageRepository.incrementUsage via rpc().
CREATE OR REPLACE FUNCTION increment_voice_usage(
  p_user_id     uuid,
  p_week_start  date,
  p_duration_ms bigint
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO voice_usage (user_id, week_start, ms_consumed)
  VALUES (p_user_id, p_week_start, p_duration_ms)
  ON CONFLICT (user_id, week_start)
  DO UPDATE SET ms_consumed = voice_usage.ms_consumed + EXCLUDED.ms_consumed;
$$;

ALTER TABLE voice_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_usage_owner_select_policy ON voice_usage
  FOR SELECT USING (user_id = auth.uid());
