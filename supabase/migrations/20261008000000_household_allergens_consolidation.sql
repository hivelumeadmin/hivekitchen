-- Story 3-DM-B2 — Allergen consolidation: household_allergens + household_cultural_identifiers.
--
-- Creates the two consolidation tables per canonical §6.1 and §6.2. Drops of
-- legacy columns (`child_allergens` table, `households.{declared_allergens,
-- cultural_identifiers,dietary_preferences}`, `children.{declared_allergens,
-- cultural_identifiers,dietary_preferences}`) land in a follow-up migration
-- AFTER the backfill script's verification gate passes — see
-- `apps/api/scripts/backfill-household-allergens.ts` and
-- `20261008000100_drop_legacy_allergen_columns.sql`.
--
-- household_allergens absorbs both per-child medical allergens (formerly the
-- separate `child_allergens` table) and household-wide kitchen rules
-- (formerly `households.declared_allergens` encrypted JSONB). `child_id` is
-- nullable: NULL = household-wide rule (the common case); non-NULL = parent-
-- attributed to a specific kid as metadata. The guardrail treats every row
-- the same — kitchen-shared constraint, no per-kid scoping.
--
-- household_cultural_identifiers extracts the household-level cultural tag
-- list out of the encrypted `households.cultural_identifiers` text column
-- into a structured, vocab-validated table. Mirrors the pattern of
-- dietary_preferences / household_rules.
--
-- Encryption (allergen text only): AES-256-GCM under household DEK; hash is
-- SHA-256(lower(trim(plaintext))) for dedupe — see
-- `apps/api/src/lib/envelope-encryption.ts` (matches the 2.5-s1
-- child_allergens pattern). cultural_tag is closed-vocab → not encrypted.
--
-- Rollback:
--   DROP TABLE IF EXISTS household_allergens;
--   DROP TABLE IF EXISTS household_cultural_identifiers;

CREATE TABLE household_allergens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id uuid REFERENCES children(id) ON DELETE CASCADE,
  -- NULL  = household-wide rule (default; the common case).
  -- NOT NULL = parent attributed to a specific kid; guardrail behavior is
  --            unchanged (the kitchen avoids the allergen for everyone).
  allergen text NOT NULL,
  allergen_hash text NOT NULL,
  source text NOT NULL CHECK (source IN (
    'onboarding_declared',
    'child_medical',
    'memory_promoted',
    'parent_edited',
    'backfill_migration'
  )),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
  -- COALESCE-sentinel uniqueness moved to a CREATE UNIQUE INDEX below.
  -- Postgres table-level UNIQUE constraints only accept column references,
  -- not expressions like COALESCE — the expression form requires a UNIQUE
  -- INDEX, which is the pattern dietary_preferences / food_preferences also
  -- use for the same NULL-child-id-distinct semantic.
);

-- COALESCE-sentinel UNIQUE: treats NULL child_id as a distinct value so a
-- household-wide row and a per-kid row for the same allergen don't violate
-- uniqueness. Mirrors the existing dietary_preferences / food_preferences
-- pattern (see 20260903000200 / 20260903000300).
CREATE UNIQUE INDEX household_allergens_scope_hash_uniq
  ON household_allergens (
    household_id,
    COALESCE(child_id, '00000000-0000-0000-0000-000000000000'::uuid),
    allergen_hash
  );

CREATE INDEX household_allergens_household_idx ON household_allergens (household_id);

CREATE INDEX household_allergens_child_idx
  ON household_allergens (child_id)
  WHERE child_id IS NOT NULL;

CREATE TABLE household_cultural_identifiers (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  cultural_tag text NOT NULL,
  enforcement enforcement_level NOT NULL DEFAULT 'default',
  source text NOT NULL CHECK (source IN (
    'onboarding_declared',
    'memory_promoted',
    'parent_edited',
    'backfill_migration'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (household_id, cultural_tag)
);
