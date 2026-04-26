-- Rollback: DROP TABLE refresh_tokens;
-- Story 2.2 enforces rotation-on-use (replaced_by chain) and reuse → revoke-all-by-family_id.
-- Story 2.1 only inserts and revokes-on-logout.
-- RLS is enabled with no user-facing policies: only the service-role client (which bypasses RLS)
-- should ever access this table. Enabling RLS denies direct authenticated-client access by default.

CREATE TABLE refresh_tokens (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid        NOT NULL,
  token_hash  text        NOT NULL UNIQUE,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid        REFERENCES refresh_tokens(id) ON DELETE SET NULL
);

CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
