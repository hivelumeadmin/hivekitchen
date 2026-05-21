-- Slice 2.5-s1 — Foundation: household_rules structured table.
--
-- Household-wide rules with enforcement strength. Closed enum for common
-- rule types (no_pork, no_alcohol, etc.) plus a 'custom' escape hatch with
-- a free-text label.
--
-- Encryption: `custom_label` is AES-256-GCM ciphertext under the household
-- DEK when present (NULL for non-custom rules). `custom_label_hash` is
-- SHA-256(lower(trim(plaintext))) for idempotency on the custom path.
--
-- Idempotency:
--   - Non-custom rules: UNIQUE (household_id, rule_type). One row per
--     non-custom rule type per household.
--   - Custom rules: UNIQUE (household_id, custom_label_hash). One row per
--     unique custom label per household.
-- The CHECK constraint ensures custom_label_hash is present iff
-- rule_type='custom'.
--
-- Rollback:
--   DROP TABLE IF EXISTS household_rules;

CREATE TABLE household_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  rule_type text NOT NULL CHECK (rule_type IN (
    'no_pork',
    'no_alcohol',
    'no_beef',
    'no_overnight_leftovers',
    'no_microwave_at_school',
    'custom'
  )),
  custom_label text,
  custom_label_hash text,
  enforcement enforcement_level NOT NULL DEFAULT 'strong',
  source text NOT NULL CHECK (source IN (
    'onboarding_declared',
    'memory_promoted',
    'parent_edited',
    'backfill_migration'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT household_rules_custom_label_consistency CHECK (
    (rule_type = 'custom' AND custom_label IS NOT NULL AND custom_label_hash IS NOT NULL)
    OR (rule_type <> 'custom' AND custom_label IS NULL AND custom_label_hash IS NULL)
  )
);

CREATE UNIQUE INDEX household_rules_non_custom_uniq
  ON household_rules (household_id, rule_type)
  WHERE rule_type <> 'custom';

CREATE UNIQUE INDEX household_rules_custom_uniq
  ON household_rules (household_id, custom_label_hash)
  WHERE rule_type = 'custom';

CREATE INDEX household_rules_household_idx
  ON household_rules (household_id);
