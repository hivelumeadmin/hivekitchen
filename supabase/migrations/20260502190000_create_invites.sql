-- Rollback: DROP TABLE invites;
-- Story 2.3 — Secondary Caregiver invite primitive (signed JWT, single-use jti, 14-day TTL).
-- Story 5.5 will add revoke + transfer-primary endpoints on top of this table.
-- RLS is enabled with no user-facing policies: only the service-role client (which bypasses RLS)
-- should ever access this table. Enabling RLS denies direct authenticated-client access by default.

CREATE TABLE invites (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id        uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  role                text        NOT NULL CHECK (role IN ('secondary_caregiver', 'guest_author')),
  invited_by_user_id  uuid        NOT NULL REFERENCES users(id),
  invited_email       text,
  expires_at          timestamptz NOT NULL,
  redeemed_at         timestamptz,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invites_household_id_idx ON invites (household_id);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
