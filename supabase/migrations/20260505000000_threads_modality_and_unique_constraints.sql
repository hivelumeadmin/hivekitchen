-- Story 2.7 Round-2 review:
--   * R2-D2 — add `modality` discriminator to `threads` so voice and text
--     onboarding never share an active thread (eliminates the cross-modality
--     contamination window during the ElevenLabs post-call webhook gap).
--   * R2-D1 — enforce one active thread per (household_id, type, modality) at
--     the database; enforce one onboarding.summary system_event per thread
--     at the database. Eliminates duplicate-thread and duplicate-summary
--     races that the service-layer read-then-act sequences cannot prevent.
-- Rollback:
--   DROP INDEX threads_one_active_per_household_type_modality;
--   DROP INDEX thread_turns_one_summary_per_thread;
--   ALTER TABLE threads DROP COLUMN modality;

-- Backfill: pre-2.7 Story 2.6 was the only producer of `threads`, all rows
-- are voice. Default lets the column land NOT NULL without a separate UPDATE.
ALTER TABLE threads
  ADD COLUMN modality text NOT NULL DEFAULT 'voice'
  CHECK (modality IN ('voice', 'text'));

-- New rows must specify modality explicitly going forward.
ALTER TABLE threads ALTER COLUMN modality DROP DEFAULT;

CREATE UNIQUE INDEX threads_one_active_per_household_type_modality
  ON threads(household_id, type, modality)
  WHERE status = 'active';

CREATE UNIQUE INDEX thread_turns_one_summary_per_thread
  ON thread_turns(thread_id, ((body->>'event')))
  WHERE (body->>'type') = 'system_event' AND (body->>'event') = 'onboarding.summary';
