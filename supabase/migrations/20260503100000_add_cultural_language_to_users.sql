-- Rollback: ALTER TABLE users DROP COLUMN cultural_language; DROP TYPE cultural_language_preference;
-- Story 2.5 — adds cultural_language column to users for FR105/FR106 family-language preference.
-- The notification_prefs jsonb column already exists (added in 20260501120000_create_users_and_households.sql)
-- and is reused by Story 2.5 — no schema change needed for it here.
-- Enum values align with FR6 cultural-template families. The 'default' member preserves
-- English family terms (Grandma/Grandpa); all other members are non-reversible per UX-DR47
-- (forward-only family-language ratchet enforced at the service layer).

CREATE TYPE cultural_language_preference AS ENUM (
  'default',
  'south_asian',
  'hispanic',
  'east_african',
  'middle_eastern',
  'east_asian',
  'caribbean'
);

ALTER TABLE users
  ADD COLUMN cultural_language cultural_language_preference NOT NULL DEFAULT 'default';
