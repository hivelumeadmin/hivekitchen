-- Slice 2-s27 — household-vs-child scoping.
-- Move cultural_identifiers, dietary_preferences, declared_allergens UP to the
-- household level. These three are household traits, not per-person traits;
-- the existing per-child columns stay (override path) but are now optional.
--
-- All three columns hold envelope-encrypted JSON arrays (AES-GCM under the
-- household DEK), mirroring the pattern from migration
-- 20260510000200_encrypt_caregiver_relationships.sql. NULL means "no
-- household-level value set yet" — the application reads NULL as [].
--
-- Backfill from the union of children's arrays runs in a separate one-shot
-- Node script (apps/api/scripts/backfill-household-food-identity.ts) because
-- envelope encryption is application-layer (AES-GCM via node:crypto), not
-- something Postgres can compute on its own.

ALTER TABLE households
  ADD COLUMN cultural_identifiers text,
  ADD COLUMN dietary_preferences  text,
  ADD COLUMN declared_allergens   text;
