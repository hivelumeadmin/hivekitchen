-- Story 3.13: change commit_plan() in two ways:
--   1. Accept p_week_of so the plans row stores the human-readable week date.
--   2. Archive old plan_items instead of deleting them: set replaced_by_plan_id = p_plan_id
--      on current items (replaced_by_plan_id IS NULL) before inserting the new set.
--      Self-reference semantics: "this item was superseded the last time this plan committed."

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
  -- Upsert plan row (ON CONFLICT (id) handles re-commits of the same plan_id).
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

  -- Archive existing current items for this plan before inserting the new set.
  -- Sets replaced_by_plan_id = p_plan_id (self-reference: "this plan's current
  -- revision superseded these items"). Skips already-archived rows (IS NULL guard).
  UPDATE plan_items
    SET replaced_by_plan_id = p_plan_id,
        updated_at          = now()
    WHERE plan_id = p_plan_id
      AND replaced_by_plan_id IS NULL;

  -- Insert new items for this revision with replaced_by_plan_id = NULL (current).
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
