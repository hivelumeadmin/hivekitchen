-- Rollback: DROP TABLE voice_sessions;
-- Story 2.6 — maps an ElevenLabs conversation_id to a HiveKitchen thread/user.
-- elevenlabs_conversation_id is set at token-issue time via include_conversation_id=true
-- and is the sole lookup key for both the LLM endpoint and the post-call webhook.

CREATE TABLE voice_sessions (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id               uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  thread_id                  uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  elevenlabs_conversation_id text UNIQUE,
  status                     text NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'closed', 'timed_out')),
  started_at                 timestamptz NOT NULL DEFAULT now(),
  ended_at                   timestamptz
);
