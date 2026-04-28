-- Rollback: DROP TABLE vpc_consents;
-- Story 2.8 — immutable COPPA soft-VPC consent record.
-- No UPDATE or DELETE RLS policies — rows are append-only by design.
--
-- ON DELETE RESTRICT on signed_by_user_id: a primary parent who signed cannot
-- be hard-deleted while their consent row exists. Account deletion flows
-- (Story 7.5) must either anonymize signed_by_user_id (transition to a
-- "deleted user" sentinel) or migrate the row to a successor primary parent
-- BEFORE removing the user. household_id remains ON DELETE CASCADE because
-- household removal is a full data-erasure event and the consent record
-- naturally goes with it.
CREATE TABLE vpc_consents (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  mechanism           text        NOT NULL CHECK (mechanism = 'soft_signed_declaration'),
  signed_at           timestamptz NOT NULL DEFAULT now(),
  signed_by_user_id   uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document_version    text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vpc_consents_household_mechanism_version_uniq
    UNIQUE (household_id, mechanism, document_version)
);

ALTER TABLE vpc_consents ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read their own household's consent record (e.g., audit view in Story 7.8).
CREATE POLICY vpc_consents_select_own ON vpc_consents
  FOR SELECT USING (
    household_id = (
      SELECT current_household_id FROM users WHERE id = auth.uid()
    )
  );
-- No UPDATE or DELETE policies — rows are immutable.
