-- Story 3.5: atomic plan commit via PostgreSQL function.
--
-- supabase-js v2 has no client-side BEGIN/COMMIT, so the only way to write
-- the plans row, replace the plan_items rows, AND set guardrail_cleared_at +
-- guardrail_version atomically is to push the whole transaction into the DB.
-- The function body runs in one implicit transaction — if any statement
-- raises, the entire write rolls back.
--
-- Replace semantics on commit: re-committing a plan_id deletes existing
-- plan_items for that plan and inserts the new set. This is safe because the
-- caller is the API service-role client; authenticated users never invoke
-- this RPC directly (RLS would gate the underlying tables anyway).
--
-- The function is SECURITY INVOKER (default) — it relies on the caller
-- having the right to write plans/plan_items. The API service role bypasses
-- RLS; if this RPC ever needs to be exposed to authenticated callers, switch
-- to SECURITY DEFINER and add explicit household_id checks.

CREATE OR REPLACE FUNCTION commit_plan(
  p_plan_id              uuid,
  p_household_id         uuid,
  p_week_id              uuid,
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
  -- Upsert the plan row. ON CONFLICT (id) handles re-commits of the same
  -- plan_id; the unique index on (household_id, week_id) handles the
  -- "first commit per week" case via primary-key conflict not week conflict
  -- (the caller chooses plan_id; the same plan_id is reused across revisions).
  INSERT INTO plans (
    id, household_id, week_id, revision, generated_at,
    guardrail_cleared_at, guardrail_version, prompt_version
  )
  VALUES (
    p_plan_id, p_household_id, p_week_id, p_revision, p_generated_at,
    p_guardrail_cleared_at, p_guardrail_version, p_prompt_version
  )
  ON CONFLICT (id) DO UPDATE
    SET revision             = EXCLUDED.revision,
        generated_at         = EXCLUDED.generated_at,
        guardrail_cleared_at = EXCLUDED.guardrail_cleared_at,
        guardrail_version    = EXCLUDED.guardrail_version,
        prompt_version       = EXCLUDED.prompt_version,
        updated_at           = now();

  -- Replace plan_items for this plan. ON DELETE CASCADE on the FK is not
  -- enough here because we're keeping the parent plan row.
  DELETE FROM plan_items WHERE plan_id = p_plan_id;

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
