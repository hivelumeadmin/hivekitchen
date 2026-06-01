-- Story 3-DM-A2 — Fold snack_skus into recipes; retire Story 3.20's dual-FK pattern.
--
-- Migrates the 10 curated snack_skus seed rows into `recipes` with
-- applicable_slots=['snack'], translating the 9 contains_* FALCPA booleans
-- into allergen_flags and the cultural / dietary booleans into tag arrays.
-- Repoints any plan_items.item_sku_id reference to plan_items.recipe_id
-- (same UUID since we preserve ids on insert), then drops the dual-FK column
-- + index + the snack_skus table + the now-obsolete commit_plan() arg.
--
-- After this migration: every plan slot — main, snack, extra — resolves
-- through a single column (plan_items.recipe_id → recipes.id). The
-- PlanComposeItemSchema.superRefine that policed the slot ↔ FK XOR retires
-- with it (contracts/plan.ts).
--
-- Depends on:
--   20260730000000_create_snack_skus_and_item_sku_id.sql (table + column to drop)
--   20260820000200_create_recipes_and_usage.sql           (recipes target)
--   20261005000000_recipe_canonical.sql                    (recipe_steps coexist; snacks ship with zero steps)

-- ---------------------------------------------------------------------------
-- 1. Vocabulary sanity check — FALCPA top-9 tags should already exist in
--    allergen_tags from the seed migration. NOTICE rather than EXCEPTION so a
--    missing vocab row doesn't block the fold; the recipes still get the tag
--    values, and the allergy guardrail's text-matching path catches the gap.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing_tags text;
BEGIN
  SELECT string_agg(v.tag, ', ') INTO missing_tags
  FROM (VALUES ('peanut'), ('tree_nut'), ('dairy'), ('egg'), ('wheat'),
               ('soy'), ('fish'), ('shellfish'), ('sesame')) AS v(tag)
  WHERE NOT EXISTS (
    SELECT 1 FROM allergen_tags
    WHERE key = v.tag AND is_active = true
  );
  IF missing_tags IS NOT NULL THEN
    RAISE NOTICE
      'Story 3-DM-A2: allergen_tags missing for folded snacks: %. Folded recipes will still carry the tag string; guardrail text-matching path will catch any gaps.',
      missing_tags;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Insert each snack_skus row as a recipes row, preserving id so any
--    existing plan_items.item_sku_id reference can be repointed by UUID
--    without a name-based lookup.
-- ---------------------------------------------------------------------------
INSERT INTO recipes (
  id,
  canonical_name,
  ingredients,
  ingredient_keys,
  primary_ingredient_key,
  allergen_flags,
  dietary_flags,
  cultural_tags,
  cuisine_tags,
  applicable_slots,
  prep_time_minutes,
  source,
  created_by_household_id,
  visibility,
  is_active
)
SELECT
  s.id,
  s.name,
  '[]'::jsonb,
  ARRAY[]::text[],
  NULL,
  -- 9-way FALCPA boolean → allergen_flags translation
  ARRAY_REMOVE(ARRAY[
    CASE WHEN s.contains_peanut    THEN 'peanut'    END,
    CASE WHEN s.contains_tree_nut  THEN 'tree_nut'  END,
    CASE WHEN s.contains_dairy     THEN 'dairy'     END,
    CASE WHEN s.contains_egg       THEN 'egg'       END,
    CASE WHEN s.contains_wheat     THEN 'wheat'     END,
    CASE WHEN s.contains_soy       THEN 'soy'       END,
    CASE WHEN s.contains_fish      THEN 'fish'      END,
    CASE WHEN s.contains_shellfish THEN 'shellfish' END,
    CASE WHEN s.contains_sesame    THEN 'sesame'    END
  ], NULL),
  -- Cultural compatibility booleans → dietary_flags
  ARRAY_REMOVE(ARRAY[
    CASE WHEN s.is_vegetarian THEN 'vegetarian' END,
    CASE WHEN s.is_vegan      THEN 'vegan'      END
  ], NULL),
  -- Religious compatibility booleans → cultural_tags
  ARRAY_REMOVE(ARRAY[
    CASE WHEN s.is_halal  THEN 'halal'  END,
    CASE WHEN s.is_kosher THEN 'kosher' END
  ], NULL),
  ARRAY[]::text[],
  ARRAY['snack']::text[],
  NULL,
  'curated',
  NULL,
  'shared',
  s.is_active
FROM snack_skus s
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Repoint existing plan_items.item_sku_id → plan_items.recipe_id. Same
--    UUID values because step 2 preserved ids. WHERE recipe_id IS NULL keeps
--    main-slot items (which already have recipe_id from upstream) intact.
-- ---------------------------------------------------------------------------
UPDATE plan_items
   SET recipe_id = item_sku_id,
       updated_at = now()
 WHERE item_sku_id IS NOT NULL
   AND recipe_id IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Drop the dual-FK pattern: index, column, table.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_plan_items_item_sku_id;
ALTER TABLE plan_items DROP COLUMN item_sku_id;
DROP TABLE snack_skus;

-- ---------------------------------------------------------------------------
-- 5. Rewrite commit_plan() to drop the item_sku_id arg from the INSERT clause.
--    Signature otherwise unchanged so caller paths in plan-generation.job /
--    plan-regeneration.job continue to bind the same positional jsonb payload.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS commit_plan(uuid, uuid, uuid, varchar, integer, timestamptz, timestamptz, varchar, varchar, jsonb);

CREATE FUNCTION commit_plan(
  p_plan_id              uuid,
  p_household_id         uuid,
  p_week_id              uuid,
  p_week_of              varchar(10),
  p_revision             integer,
  p_generated_at         timestamptz,
  p_guardrail_cleared_at timestamptz,
  p_guardrail_version    varchar(32),
  p_prompt_version       varchar(32),
  p_items                jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_item jsonb;
BEGIN
  INSERT INTO plans (
    id, household_id, week_id, week_of, revision, generated_at,
    guardrail_cleared_at, guardrail_version, prompt_version
  )
  VALUES (
    p_plan_id, p_household_id, p_week_id, p_week_of, p_revision, p_generated_at,
    p_guardrail_cleared_at, p_guardrail_version, p_prompt_version
  )
  ON CONFLICT (id) DO UPDATE
    SET week_of              = EXCLUDED.week_of,
        revision             = EXCLUDED.revision,
        generated_at         = EXCLUDED.generated_at,
        guardrail_cleared_at = EXCLUDED.guardrail_cleared_at,
        guardrail_version    = EXCLUDED.guardrail_version,
        prompt_version       = EXCLUDED.prompt_version,
        updated_at           = now();

  UPDATE plan_items
    SET replaced_by_plan_id = p_plan_id,
        updated_at          = now()
    WHERE plan_id = p_plan_id
      AND replaced_by_plan_id IS NULL;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO plan_items (
      plan_id, child_id, day, slot, recipe_id, item_id, ingredients
    )
    VALUES (
      p_plan_id,
      (v_item->>'child_id')::uuid,
      v_item->>'day',
      v_item->>'slot',
      NULLIF(v_item->>'recipe_id', '')::uuid,
      NULLIF(v_item->>'item_id', '')::uuid,
      COALESCE(v_item->'ingredients', '[]'::jsonb)
    );
  END LOOP;

  RETURN p_plan_id;
END;
$$;
