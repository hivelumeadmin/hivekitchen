-- Story 3.20: Snack items are modeled as unit-level SKUs, separate from
-- Main items (which use recipe_id) and Extra items (which can use either).
-- snack_skus is the unit-level catalog the planner references; the structured
-- contains_* flags let the allergy guardrail evaluate snack items by
-- pre-computed allergen presence rather than by ingredient text matching.

CREATE TABLE IF NOT EXISTS snack_skus (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  brand           TEXT,
  category        TEXT NOT NULL,
  -- FALCPA top-9 allergen flags. false = not present, true = present (or
  -- "may contain"). Conservative: an unknown SKU should be marked true
  -- rather than false on each potential allergen.
  contains_peanut    BOOLEAN NOT NULL DEFAULT false,
  contains_tree_nut  BOOLEAN NOT NULL DEFAULT false,
  contains_dairy     BOOLEAN NOT NULL DEFAULT false,
  contains_egg       BOOLEAN NOT NULL DEFAULT false,
  contains_wheat     BOOLEAN NOT NULL DEFAULT false,
  contains_soy       BOOLEAN NOT NULL DEFAULT false,
  contains_fish      BOOLEAN NOT NULL DEFAULT false,
  contains_shellfish BOOLEAN NOT NULL DEFAULT false,
  contains_sesame    BOOLEAN NOT NULL DEFAULT false,
  -- Cultural template compatibility flags. is_halal/is_kosher default true
  -- because most plant- and dairy-based snacks are compatible by default;
  -- planner-side filtering still applies the household's ratified template.
  is_halal       BOOLEAN NOT NULL DEFAULT true,
  is_kosher      BOOLEAN NOT NULL DEFAULT true,
  is_vegetarian  BOOLEAN NOT NULL DEFAULT true,
  is_vegan       BOOLEAN NOT NULL DEFAULT false,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed a minimal candidate set so the planner has something to reference
-- before a curated catalog ships. Allergen flags reflect the canonical form
-- of each item — not specific brand SKUs.
INSERT INTO snack_skus (name, category, contains_dairy, is_vegan) VALUES
  ('Apple', 'fruit', false, true),
  ('Banana', 'fruit', false, true),
  ('Baby Carrots', 'vegetable', false, true),
  ('Celery Sticks', 'vegetable', false, true),
  ('Rice Cakes', 'grain', false, true),
  ('Edamame', 'protein', false, true),
  ('Hummus Cup', 'protein', false, true)
ON CONFLICT DO NOTHING;

INSERT INTO snack_skus (name, category, contains_dairy, is_vegan) VALUES
  ('String Cheese', 'dairy', true, false),
  ('Yogurt Cup', 'dairy', true, false)
ON CONFLICT DO NOTHING;

INSERT INTO snack_skus (name, category, contains_wheat, is_vegan) VALUES
  ('Granola Bar', 'grain', true, false)
ON CONFLICT DO NOTHING;

-- Add item_sku_id to plan_items. Nullable: Main items use recipe_id; Snack
-- items use item_sku_id; Extra may use either. ON DELETE SET NULL preserves
-- audit history when a SKU is retired from the catalog.
ALTER TABLE plan_items
  ADD COLUMN IF NOT EXISTS item_sku_id UUID REFERENCES snack_skus(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plan_items_item_sku_id
  ON plan_items(item_sku_id)
  WHERE item_sku_id IS NOT NULL;

-- Update commit_plan() to persist item_sku_id alongside the existing
-- recipe_id / item_id fields. Without this, the planner agent could compose
-- snack rows referencing a SKU but the column would always insert NULL.
CREATE OR REPLACE FUNCTION commit_plan(
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
      plan_id, child_id, day, slot, recipe_id, item_id, item_sku_id, ingredients
    )
    VALUES (
      p_plan_id,
      (v_item->>'child_id')::uuid,
      v_item->>'day',
      v_item->>'slot',
      NULLIF(v_item->>'recipe_id', '')::uuid,
      NULLIF(v_item->>'item_id', '')::uuid,
      NULLIF(v_item->>'item_sku_id', '')::uuid,
      COALESCE(v_item->'ingredients', '[]'::jsonb)
    );
  END LOOP;

  RETURN p_plan_id;
END;
$$;
