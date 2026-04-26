-- Rollback: DROP TABLE threads;
-- Story 2.6 — conversation thread model shared by text and voice modalities.
-- All turns (text and voice) for the same logical conversation share one thread_id.

CREATE TABLE threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  type          text NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now()
);
