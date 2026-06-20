-- Story 3-S40 — Un-fold snack_skus back out of recipes (Option B, approved).
--
-- Re-creates the snack_skus table that was DROPPED in 20261006000000_snack_sku_fold.sql:120.
-- Adds plan_slots.snack_sku_id so snack slots can carry a SKU reference instead of
-- a recipe_id. Rewrites the plan_slots_snack_uses_recipe CHECK to enforce exactly
-- one of (recipe_id, snack_sku_id). Adds snack_sku_id IS NULL guard to the main
-- and extra CHECKs. Rewrites commit_plan() to persist snack_sku_id. Deactivates
-- the 10 snack rows folded into recipes so they are never offered as recipe snacks.
--
-- Depends on:
--   20261010000000_plan_structure_canonical.sql (plan_slots + commit_plan current sig)
--   20261006000000_snack_sku_fold.sql           (the DROP this reverses)

-- ---------------------------------------------------------------------------
-- 1. Re-create snack_skus.
--    Mirrors the original 20260730000000 columns plus created_by_household_id
--    (NULL = global seed; non-NULL = household row, populated in 3-s41).
-- ---------------------------------------------------------------------------

CREATE TABLE snack_skus (
  id                      uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name                    text        NOT NULL,
  brand                   text,
  category                text        NOT NULL,
  -- FALCPA top-9 allergen flags (Phase-2 deterministic checking lands in 3-s43).
  contains_peanut         boolean     NOT NULL DEFAULT false,
  contains_tree_nut       boolean     NOT NULL DEFAULT false,
  contains_dairy          boolean     NOT NULL DEFAULT false,
  contains_egg            boolean     NOT NULL DEFAULT false,
  contains_wheat          boolean     NOT NULL DEFAULT false,
  contains_soy            boolean     NOT NULL DEFAULT false,
  contains_fish           boolean     NOT NULL DEFAULT false,
  contains_shellfish      boolean     NOT NULL DEFAULT false,
  contains_sesame         boolean     NOT NULL DEFAULT false,
  -- Cultural / dietary flags.
  is_halal                boolean     NOT NULL DEFAULT true,
  is_kosher               boolean     NOT NULL DEFAULT true,
  is_vegetarian           boolean     NOT NULL DEFAULT true,
  is_vegan                boolean     NOT NULL DEFAULT false,
  is_active               boolean     NOT NULL DEFAULT true,
  -- NULL = global catalog row. Non-NULL = household-scoped row (3-s41).
  created_by_household_id uuid        REFERENCES households(id) ON DELETE CASCADE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX snack_skus_household_idx ON snack_skus (created_by_household_id)
  WHERE created_by_household_id IS NOT NULL;

COMMENT ON TABLE snack_skus IS
  'Story 3-S40 — un-folded from recipes (was DROPPED in 20261006000000). '
  'Global rows have created_by_household_id = NULL. Household rows land in 3-s41.';

-- ---------------------------------------------------------------------------
-- 2. Seed 10 global rows. Allergen/dietary flags are conservative canonical
--    representations of each item class, not brand-specific.
-- ---------------------------------------------------------------------------

INSERT INTO snack_skus (name, category, contains_dairy, is_vegan, created_by_household_id) VALUES
  ('Apple',        'fruit',     false, true,  NULL),
  ('Banana',       'fruit',     false, true,  NULL),
  ('Baby Carrots', 'vegetable', false, true,  NULL),
  ('Celery Sticks','vegetable', false, true,  NULL),
  ('Rice Cakes',   'grain',     false, true,  NULL),
  ('Edamame',      'protein',   false, true,  NULL),
  ('Hummus Cup',   'protein',   false, true,  NULL);

INSERT INTO snack_skus (name, category, contains_dairy, is_vegan, created_by_household_id) VALUES
  ('String Cheese','dairy',     true,  false, NULL),
  ('Yogurt Cup',   'dairy',     true,  false, NULL);

INSERT INTO snack_skus (name, category, contains_wheat, is_vegan, created_by_household_id) VALUES
  ('Granola Bar',  'grain',     true,  false, NULL);

-- ---------------------------------------------------------------------------
-- 3. RLS — SELECT-only, authenticated users can see global rows and their
--    household's own rows. Pattern mirrors extra_library.
-- ---------------------------------------------------------------------------

ALTER TABLE snack_skus ENABLE ROW LEVEL SECURITY;

CREATE POLICY snack_skus_select ON snack_skus
  FOR SELECT TO authenticated USING (
    created_by_household_id IS NULL OR
    created_by_household_id = (
      SELECT current_household_id FROM users WHERE id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Add snack_sku_id to plan_slots.
-- ---------------------------------------------------------------------------

ALTER TABLE plan_slots
  ADD COLUMN snack_sku_id uuid REFERENCES snack_skus(id) ON DELETE SET NULL;

CREATE INDEX plan_slots_snack_sku_idx ON plan_slots (snack_sku_id)
  WHERE snack_sku_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Rewrite the three plan_slots CHECK constraints.
--
--    Before:
--      plan_slots_main_uses_assignment — no snack_sku_id guard
--      plan_slots_snack_uses_recipe    — only recipe_id allowed
--      plan_slots_extra_uses_recipe_and_kind — no snack_sku_id guard
--
--    After:
--      main/extra CHECKs gain snack_sku_id IS NULL (cannot carry a SKU).
--      snack CHECK becomes exactly-one: (recipe_id XOR snack_sku_id).
-- ---------------------------------------------------------------------------

ALTER TABLE plan_slots
  DROP CONSTRAINT plan_slots_main_uses_assignment,
  DROP CONSTRAINT plan_slots_snack_uses_recipe,
  DROP CONSTRAINT plan_slots_extra_uses_recipe_and_kind;

ALTER TABLE plan_slots
  ADD CONSTRAINT plan_slots_main_uses_assignment CHECK (
    slot_kind <> 'main' OR
    (main_assignment_id IS NOT NULL AND recipe_id IS NULL AND extra_kind IS NULL AND snack_sku_id IS NULL)
  ),
  ADD CONSTRAINT plan_slots_snack_uses_recipe CHECK (
    slot_kind <> 'snack' OR
    (
      (
        (recipe_id IS NOT NULL AND snack_sku_id IS NULL) OR
        (snack_sku_id IS NOT NULL AND recipe_id IS NULL)
      )
      AND main_assignment_id IS NULL AND extra_kind IS NULL
    )
  ),
  ADD CONSTRAINT plan_slots_extra_uses_recipe_and_kind CHECK (
    slot_kind <> 'extra' OR
    (recipe_id IS NOT NULL AND main_assignment_id IS NULL AND extra_kind IS NOT NULL AND snack_sku_id IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 6. Rewrite commit_plan() to persist snack_sku_id in the plan_slots INSERT.
--    Signature is unchanged (10 args); only the slots INSERT gains the column.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION commit_plan(
  p_plan_id              uuid,
  p_household_id         uuid,
  p_week_of              date,
  p_revision             integer,
  p_generated_at         timestamptz,
  p_guardrail_cleared_at timestamptz,
  p_guardrail_version    varchar(32),
  p_prompt_version       varchar(32),
  p_main_assignments     jsonb,
  p_days                 jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq_to_id    jsonb := '{}'::jsonb;
  v_assn         RECORD;
  v_day          RECORD;
  v_day_id       uuid;
  v_slot         jsonb;
  v_slot_id      uuid;
  v_main_assn_id uuid;
  v_variation    jsonb;
BEGIN
  INSERT INTO plans (
    id, household_id, week_of, revision, generated_at,
    guardrail_cleared_at, guardrail_version, prompt_version
  )
  VALUES (
    p_plan_id, p_household_id, p_week_of, p_revision, p_generated_at,
    NULL, NULL, p_prompt_version
  )
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM plan_main_assignments WHERE plan_id = p_plan_id;
  DELETE FROM plan_days              WHERE plan_id = p_plan_id;

  FOR v_assn IN
    SELECT (e->>'sequence')::smallint AS sequence,
           (e->>'recipe_id')::uuid    AS recipe_id
    FROM jsonb_array_elements(p_main_assignments) AS e
  LOOP
    INSERT INTO plan_main_assignments (plan_id, sequence, recipe_id)
    VALUES (p_plan_id, v_assn.sequence, v_assn.recipe_id)
    RETURNING id INTO v_main_assn_id;

    v_seq_to_id := v_seq_to_id || jsonb_build_object(v_assn.sequence::text, v_main_assn_id::text);
  END LOOP;

  FOR v_day IN
    SELECT (e->>'day')::weekday                            AS day,
           NULLIF(e->>'paused_at','')::timestamptz         AS paused_at,
           NULLIF(e->>'paused_reason','')::pause_reason    AS paused_reason,
           NULLIF(e->>'paused_note','')                    AS paused_note,
           e->'slots'                                       AS slots
    FROM jsonb_array_elements(p_days) AS e
  LOOP
    INSERT INTO plan_days (plan_id, day, paused_at, paused_reason, paused_note)
    VALUES (p_plan_id, v_day.day, v_day.paused_at, v_day.paused_reason, v_day.paused_note)
    RETURNING id INTO v_day_id;

    FOR v_slot IN SELECT * FROM jsonb_array_elements(v_day.slots)
    LOOP
      v_main_assn_id := NULL;
      IF v_slot ? 'main_assignment_sequence' THEN
        v_main_assn_id := (v_seq_to_id->>(v_slot->>'main_assignment_sequence'))::uuid;
      END IF;

      -- Story 3-S40: persist snack_sku_id alongside recipe_id; exactly one
      -- will be non-NULL on a snack slot per the plan_slots_snack_uses_recipe CHECK.
      INSERT INTO plan_slots (
        plan_day_id, slot_kind, main_assignment_id, recipe_id, extra_kind, snack_sku_id
      )
      VALUES (
        v_day_id,
        (v_slot->>'slot_kind')::slot_kind,
        v_main_assn_id,
        NULLIF(v_slot->>'recipe_id','')::uuid,
        NULLIF(v_slot->>'extra_kind','')::extra_kind,
        NULLIF(v_slot->>'snack_sku_id','')::uuid
      )
      RETURNING id INTO v_slot_id;

      IF (v_slot ? 'variations') AND jsonb_typeof(v_slot->'variations') = 'array' THEN
        FOR v_variation IN SELECT * FROM jsonb_array_elements(v_slot->'variations')
        LOOP
          INSERT INTO plan_slot_variations (
            plan_slot_id, child_id,
            portion_size, texture, spice_level,
            cutting_style, container, add_ons, removals, notes, paused_at
          )
          VALUES (
            v_slot_id,
            (v_variation->>'child_id')::uuid,
            COALESCE((v_variation->>'portion_size')::portion_size, 'regular'),
            COALESCE((v_variation->>'texture')::texture_level, 'normal'),
            COALESCE((v_variation->>'spice_level')::spice_level, 'regular'),
            NULLIF(v_variation->>'cutting_style',''),
            NULLIF(v_variation->>'container',''),
            COALESCE(
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_variation->'add_ons','[]'::jsonb))),
              ARRAY[]::text[]
            ),
            COALESCE(
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_variation->'removals','[]'::jsonb))),
              ARRAY[]::text[]
            ),
            NULLIF(v_variation->>'notes',''),
            NULLIF(v_variation->>'paused_at','')::timestamptz
          );
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE plans
     SET revision             = p_revision,
         generated_at         = p_generated_at,
         guardrail_cleared_at = p_guardrail_cleared_at,
         guardrail_version    = p_guardrail_version,
         prompt_version       = p_prompt_version,
         updated_at           = now()
   WHERE id = p_plan_id;

  RETURN p_plan_id;
END;
$$;

COMMENT ON FUNCTION commit_plan(uuid, uuid, date, integer, timestamptz, timestamptz, varchar, varchar, jsonb, jsonb) IS
  'Story 3-S40 — adds snack_sku_id to plan_slots INSERT. Signature unchanged from '
  '3-DM-C1; only the slot INSERT gains the new column.';

-- ---------------------------------------------------------------------------
-- 7. AC7: Deactivate the 10 recipe rows that were folded in from snack_skus
--    by 20261006000000 so they are never offered as recipe snacks again.
--    Identified by canonical_name + snack applicable_slots + curated source.
-- ---------------------------------------------------------------------------

UPDATE recipes
   SET is_active = false,
       updated_at = now()
 WHERE canonical_name IN (
   'Apple', 'Banana', 'Baby Carrots', 'Celery Sticks', 'Rice Cakes',
   'Edamame', 'Hummus Cup', 'String Cheese', 'Yogurt Cup', 'Granola Bar'
 )
   AND 'snack' = ANY(applicable_slots)
   AND source = 'curated'
   AND created_by_household_id IS NULL;
