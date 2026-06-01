-- Slice 2.6-s6 — cold-start fallback flag persisted in moment state.
-- Allows the m5_complete finalize gate threshold to relax (>=3 vs >=10)
-- on subsequent turns and for telemetry/cohort analysis.
--
-- Once flipped true, the flag is never reset by the onboarding service —
-- the cold-start event is a real first-impression signal, not a function
-- of the current catalog state. See 2.6-s6 story §Edge Cases.
--
-- Rollback:
--   ALTER TABLE onboarding_moment_state
--     DROP COLUMN IF EXISTS cold_start_triggered,
--     DROP COLUMN IF EXISTS cold_start_trigger_reason;

ALTER TABLE onboarding_moment_state
  ADD COLUMN IF NOT EXISTS cold_start_triggered  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cold_start_trigger_reason  text
    CHECK (cold_start_trigger_reason IN (
      'per_cuisine_floor', 'stage1_timeout', 'stage2_terminal'
    ));
