-- Slice 5-S13 — caption-only (text only) accessibility preference.
-- When true, the ambient Lumi voice-session hook skips TTS playback; captions
-- still stream to the thread. Read only on the per-user /v1/users/me fetch, so
-- no index is needed.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS caption_only_mode BOOLEAN NOT NULL DEFAULT false;
