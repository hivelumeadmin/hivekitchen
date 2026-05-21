-- Slice 2.5-s1 — Foundation: favorite_lunches structured table.
--
-- Household-scoped cold-start seed for plan generation. Captures the 10
-- favorite lunch items from Moment 5 (FR124 — see sprint-change-proposal-
-- 2026-05-19). Order matters for display; provenance distinguishes the
-- onboarding seed from later parent additions and plan promotions.
--
-- Encryption: `item` is AES-256-GCM ciphertext under the household DEK.
-- `item_hash` is SHA-256(lower(trim(plaintext))) for idempotency.
--
-- Idempotency: UNIQUE (household_id, item_hash) — re-emitting the same lunch
-- item is a no-op. Re-ordering via UPDATE on position is allowed.
--
-- Rollback:
--   DROP TABLE IF EXISTS favorite_lunches;

CREATE TABLE favorite_lunches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  item text NOT NULL,
  item_hash text NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('onboarding_seed', 'parent_added', 'plan_promoted')),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX favorite_lunches_household_hash_uniq
  ON favorite_lunches (household_id, item_hash);

CREATE INDEX favorite_lunches_household_position_idx
  ON favorite_lunches (household_id, position);
