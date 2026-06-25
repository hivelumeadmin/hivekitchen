-- Structural redesign — replace the 13 boolean allergen/dietary columns on
-- snack_skus with two constrained text[] tag arrays.
--
-- Rationale: the per-flag boolean layout (9 FALCPA + 4 dietary, from
-- 20261028000000) is impractical to author and edit. Tag arrays collapse that to
-- two columns while keeping allergens DETERMINISTICALLY CHECKABLE — the CHECK on
-- allergen_tags pins the FALCPA-9 vocabulary, so 3-s43's Phase-2 fail-closed
-- safety check stays a set-membership comparison (NOT free text / fuzzy match).
--
-- dietary_tags is preference, not safety, so its CHECK is informational.
--
-- The booleans are currently dormant (no reader except the repository row type),
-- so this is a no-behaviour-change refactor. Existing boolean values are
-- backfilled into the arrays before the columns are dropped.
--
-- Depends on:
--   20261028000000_snack_sku_rotation_unfold.sql  (snack_skus + the 13 booleans)
--
-- Rollback (re-add booleans, backfill from tags, drop arrays) is intentionally
-- omitted — this is a forward-only pre-beta model change.

-- ---------------------------------------------------------------------------
-- 1. New tag columns. NOT NULL DEFAULT '{}' so existing rows are valid before
--    backfill. CHECK added after backfill (step 3) to avoid ordering hazards.
-- ---------------------------------------------------------------------------

ALTER TABLE snack_skus
  ADD COLUMN allergen_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN dietary_tags  text[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- 2. Backfill from the booleans. ARRAY(SELECT ... WHERE x IS NOT NULL) compacts
--    out the unchecked flags, yielding '{}' when none apply.
-- ---------------------------------------------------------------------------

UPDATE snack_skus SET
  allergen_tags = ARRAY(
    SELECT t FROM unnest(ARRAY[
      CASE WHEN contains_peanut    THEN 'peanut'    END,
      CASE WHEN contains_tree_nut  THEN 'tree_nut'  END,
      CASE WHEN contains_dairy     THEN 'dairy'     END,
      CASE WHEN contains_egg       THEN 'egg'       END,
      CASE WHEN contains_wheat     THEN 'wheat'     END,
      CASE WHEN contains_soy       THEN 'soy'       END,
      CASE WHEN contains_fish      THEN 'fish'      END,
      CASE WHEN contains_shellfish THEN 'shellfish' END,
      CASE WHEN contains_sesame    THEN 'sesame'    END
    ]) AS t WHERE t IS NOT NULL
  ),
  dietary_tags = ARRAY(
    SELECT t FROM unnest(ARRAY[
      CASE WHEN is_vegan      THEN 'vegan'      END,
      CASE WHEN is_vegetarian THEN 'vegetarian' END,
      CASE WHEN is_halal      THEN 'halal'      END,
      CASE WHEN is_kosher     THEN 'kosher'     END
    ]) AS t WHERE t IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 3. Vocabulary CHECKs. allergen_tags is the safety-critical one: only FALCPA-9
--    values, so a child's declared allergen can be matched by set membership.
-- ---------------------------------------------------------------------------

ALTER TABLE snack_skus
  ADD CONSTRAINT snack_skus_allergen_tags_falcpa CHECK (
    allergen_tags <@ ARRAY[
      'peanut','tree_nut','dairy','egg','wheat','soy','fish','shellfish','sesame'
    ]::text[]
  ),
  ADD CONSTRAINT snack_skus_dietary_tags_vocab CHECK (
    dietary_tags <@ ARRAY['vegan','vegetarian','halal','kosher']::text[]
  );

COMMENT ON COLUMN snack_skus.allergen_tags IS
  'FALCPA-9 allergen tags present in this snack. CHECK-pinned vocabulary so '
  '3-s43 Phase-2 can fail-closed via set membership against child allergens.';
COMMENT ON COLUMN snack_skus.dietary_tags IS
  'Dietary/cultural attributes the snack satisfies (vegan/vegetarian/halal/'
  'kosher). Preference signal, not a safety gate.';

-- ---------------------------------------------------------------------------
-- 4. Drop the 13 boolean columns.
-- ---------------------------------------------------------------------------

ALTER TABLE snack_skus
  DROP COLUMN contains_peanut,
  DROP COLUMN contains_tree_nut,
  DROP COLUMN contains_dairy,
  DROP COLUMN contains_egg,
  DROP COLUMN contains_wheat,
  DROP COLUMN contains_soy,
  DROP COLUMN contains_fish,
  DROP COLUMN contains_shellfish,
  DROP COLUMN contains_sesame,
  DROP COLUMN is_halal,
  DROP COLUMN is_kosher,
  DROP COLUMN is_vegetarian,
  DROP COLUMN is_vegan;
