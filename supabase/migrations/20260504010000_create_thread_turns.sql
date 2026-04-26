-- Rollback: DROP TABLE thread_turns;
-- Story 2.6 — per-turn record for a conversation thread.
-- server_seq is a monotonic integer assigned by the API; UNIQUE (thread_id, server_seq)
-- enforces ordering and prevents duplicates. modality distinguishes text vs voice turns.

CREATE TABLE thread_turns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  server_seq bigint NOT NULL,
  role       text NOT NULL CHECK (role IN ('user', 'lumi', 'system')),
  body       jsonb NOT NULL,
  modality   text NOT NULL DEFAULT 'text' CHECK (modality IN ('text', 'voice')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, server_seq)
);
