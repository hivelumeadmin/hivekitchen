-- Stage 1 catalog seeding — retry accounting.
--
-- Before this, the Stage 1 enqueue was edge-triggered exactly once, on the
-- m2_safe → m3_taste transition. Miss that edge (queue undefined at route
-- registration, a reconstructed moment that never stepped through m2_safe, an
-- LLM timeout) and the household was stuck with only the Stage 0 curated
-- baseline forever: nothing reconciled `stage1_completed_at IS NULL`, and
-- Stage 2 recovery could not help because it early-returns once the household
-- has >= 35 seeded rows, which the 50-row Stage 0 baseline always satisfies.
--
-- These two columns let the enqueue become an idempotent "ensure": re-checked
-- at M5 entry, bounded by an attempt counter so a permanently failing
-- household cannot spin the queue.
--
--   stage1_attempts   — incremented on every enqueue, NOT on every job run.
--                       Bounds retries even if the worker never picks the job up.
--   stage1_last_error — the reason string from the most recent failure
--                       ('llm_timeout', 'response_not_json', …). Purely
--                       diagnostic; makes stuck households queryable:
--                         SELECT id, stage1_attempts, stage1_last_error
--                         FROM households WHERE stage1_completed_at IS NULL;
--
-- Rollback:
--   ALTER TABLE households DROP COLUMN stage1_attempts;
--   ALTER TABLE households DROP COLUMN stage1_last_error;

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS stage1_attempts   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stage1_last_error text;

COMMENT ON COLUMN households.stage1_attempts IS
  'Stage 1 catalog seed enqueue count. Bounds the idempotent ensure-retry; reset to 0 to force a re-seed.';

COMMENT ON COLUMN households.stage1_last_error IS
  'Reason string from the most recent Stage 1 failure. NULL when Stage 1 has never failed.';
