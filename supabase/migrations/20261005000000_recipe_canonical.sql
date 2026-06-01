-- Story 3-DM-A1 — Recipe canonical: structured method steps + finish_time_minutes.
--
-- Phase A of the Epic-3 data-model canonicalization. Adds the data backing for
-- the Wall Card's Prep / Finish mode toggle: each recipe gains a structured
-- recipe_steps table where every step is tagged with the activity mode it
-- belongs to (prep = make-ahead / evening, finish = morning-of). Adds
-- recipes.finish_time_minutes so the dual-budget design (Finish ≤15 / Total
-- ≤40) can be enforced at the recipe layer.
--
-- Replaces: recipes.instructions (opaque jsonb, dropped in the follow-up
-- migration 20261005000100_drop_recipes_instructions.sql after backfill).
--
-- Companion artefact: apps/api/scripts/backfill-recipe-steps.ts — reads
-- existing recipes.instructions rows and emits one recipe_steps row per step
-- with mode = 'prep' (Lumi re-tags with the real mode on next agent fetch).
--
-- Depends on: 20260820000200_create_recipes_and_usage.sql

-- ---------------------------------------------------------------------------
-- 1. step_mode enum — backs recipe_steps.mode AND the Wall Card toggle.
-- ---------------------------------------------------------------------------
CREATE TYPE step_mode AS ENUM ('prep', 'finish');

-- ---------------------------------------------------------------------------
-- 2. recipes.finish_time_minutes — separate from prep_time_minutes so the
--    Wall Card can render both halves of the dual budget independently and
--    the planner can enforce Finish ≤15 at generation time.
-- ---------------------------------------------------------------------------
ALTER TABLE recipes
  ADD COLUMN finish_time_minutes int CHECK (finish_time_minutes >= 0);

COMMENT ON COLUMN recipes.finish_time_minutes IS
  'Active morning-of cook time. Read alongside prep_time_minutes to compute '
  'the recipe''s total time budget. NULL until the recipe-agent re-emits the '
  'recipe with structured steps and timing splits.';

-- ---------------------------------------------------------------------------
-- 3. recipe_steps — one row per method step, tagged with prep | finish.
-- ---------------------------------------------------------------------------
CREATE TABLE recipe_steps (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id   uuid        NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,

  -- 1-based ordinal within (recipe_id, mode-merged sequence). The agent emits
  -- one continuous sequence per recipe; mode is an orthogonal classification.
  sequence    smallint    NOT NULL CHECK (sequence >= 1),

  mode        step_mode   NOT NULL,
  text        text        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 600),

  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (recipe_id, sequence)
);

-- Hot read pattern 1: Wall Card render — fetch all steps for a recipe in
-- sequence order. Supports both modes in one scan.
CREATE INDEX recipe_steps_recipe_seq_idx
  ON recipe_steps (recipe_id, sequence);

-- Hot read pattern 2: Prep / Finish toggle filter — fetch only the steps for
-- the active mode. Index supports `WHERE recipe_id = ? AND mode = ?`.
CREATE INDEX recipe_steps_recipe_mode_idx
  ON recipe_steps (recipe_id, mode);

COMMENT ON TABLE recipe_steps IS
  'Structured recipe method. One row per step. Mode classification (prep | '
  'finish) backs the Wall Card''s mode toggle; sequence orders steps within '
  'the recipe. Replaces the opaque recipes.instructions jsonb (Story 3-DM-A1).';

-- ---------------------------------------------------------------------------
-- 4. RLS — mirror the recipes table. service-role-only writes; authenticated
--    SELECT inherits from the parent recipes row's visibility.
-- ---------------------------------------------------------------------------
ALTER TABLE recipe_steps ENABLE ROW LEVEL SECURITY;

-- An authenticated user may read a step iff they may read its recipe. We
-- replicate the recipes SELECT predicate rather than join to recipes_authenticated_select_policy
-- because Postgres has no policy-composition primitive.
CREATE POLICY recipe_steps_authenticated_select_policy ON recipe_steps
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM recipes r
      WHERE r.id = recipe_steps.recipe_id
        AND (
          r.visibility = 'shared'
          OR r.created_by_household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
          OR EXISTS (
            SELECT 1 FROM household_recipe_usage hru
            WHERE hru.recipe_id = r.id
              AND hru.household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
          )
        )
    )
  );

CREATE POLICY recipe_steps_authenticated_no_insert ON recipe_steps
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY recipe_steps_authenticated_no_update ON recipe_steps
  FOR UPDATE TO authenticated USING (false);
CREATE POLICY recipe_steps_authenticated_no_delete ON recipe_steps
  FOR DELETE TO authenticated USING (false);
