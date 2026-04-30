-- Story 2.10: convert households.caregiver_relationships from jsonb to text
-- to support envelope encryption. Existing non-null rows are cast to text (lazy
-- re-encryption on next application write). RLS not affected — write via service_role.
--
-- ROLLBACK NOTE: This migration is intentionally irreversible.
-- Reverting (ALTER COLUMN ... TYPE jsonb) after encrypted-text rows have been
-- written will corrupt those rows — Postgres cannot parse AES-GCM ciphertext
-- as JSONB. As of Story 2.10, caregiver_relationships is always NULL (the column
-- was provisioned in 2.1 but no live code path writes to it yet). Rollback risk
-- is therefore zero for beta. Accepted: 2026-04-28.
ALTER TABLE households
  ALTER COLUMN caregiver_relationships TYPE text
  USING caregiver_relationships::text;
