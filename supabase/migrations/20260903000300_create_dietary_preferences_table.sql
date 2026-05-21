-- Slice 2.5-s1 — Foundation: dietary_preferences structured table.
--
-- Per-child OR household-scoped closed-vocabulary dietary identity. The `tag`
-- is validated against dietary_tags vocabulary at write time (see
-- VocabularyService.validateDietary). Closed vocab → no encryption, no hash.
--
-- This table coexists with the legacy encrypted JSONB column
-- households.dietary_preferences (which holds household-scoped tags today).
-- The new table is the long-term home; reconciliation lands in slice 2.5-s2.
--
-- Idempotency: UNIQUE on (household_id, COALESCE(child_id, sentinel), tag).
--
-- NOTE: this table NAME collides with the legacy column NAME by design —
-- mirrors the existing child_allergens-table-vs-children.declared_allergens
-- pattern. SQL queries always qualify with table name; TypeScript uses
-- distinct schemas (KitchenMapDietarySchema vs KitchenMapHouseholdSchema.
-- dietary_preferences).
--
-- Rollback:
--   DROP TABLE IF EXISTS dietary_preferences;

CREATE TABLE dietary_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id uuid REFERENCES children(id) ON DELETE CASCADE,
  tag text NOT NULL,
  enforcement enforcement_level NOT NULL DEFAULT 'default',
  source text NOT NULL CHECK (source IN (
    'onboarding_declared',
    'vocabulary_inferred',
    'parent_edited',
    'backfill_migration'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX dietary_preferences_scope_tag_uniq
  ON dietary_preferences (
    household_id,
    COALESCE(child_id, '00000000-0000-0000-0000-000000000000'::uuid),
    tag
  );

CREATE INDEX dietary_preferences_household_idx
  ON dietary_preferences (household_id);

CREATE INDEX dietary_preferences_child_idx
  ON dietary_preferences (child_id)
  WHERE child_id IS NOT NULL;
