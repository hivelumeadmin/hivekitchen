-- Slice 2.5-s1 — Foundation: child_allergens structured table.
--
-- Per-child medical allergens. One row per allergen per child. Replaces the
-- existing encrypted-JSONB-array column children.declared_allergens long-term;
-- both coexist through Epic 2.5 (the JSONB column remains the live read
-- source until slice 2.5-s2's backfill). NO severity column — allergens are
-- uniformly hard per FR122.
--
-- Encryption: `allergen` is AES-256-GCM ciphertext under the household DEK
-- (see apps/api/src/lib/envelope-encryption.ts). `allergen_hash` is
-- SHA-256(lower(trim(plaintext))) and serves as the dedupe key — see
-- normalizedHash() in envelope-encryption.ts.
--
-- Idempotency: UNIQUE (child_id, allergen_hash). A re-emission of the same
-- allergen for the same child becomes a no-op at the DB layer.
--
-- Rollback:
--   DROP TABLE IF EXISTS child_allergens;

CREATE TABLE child_allergens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  allergen text NOT NULL,
  allergen_hash text NOT NULL,
  source text NOT NULL CHECK (source IN (
    'onboarding_declared',
    'memory_promoted',
    'vocabulary_inferred',
    'parent_edited',
    'backfill_migration'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX child_allergens_child_hash_uniq
  ON child_allergens (child_id, allergen_hash);

CREATE INDEX child_allergens_household_idx
  ON child_allergens (household_id);
