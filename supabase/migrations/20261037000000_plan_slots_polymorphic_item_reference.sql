-- Story 15-s7 — plan_slots polymorphic item reference: the one true cutover.
--
-- Replaces plan_slots' three nullable item columns (main_assignment_id,
-- recipe_id, snack_sku_id) with ONE typed reference (item_type, item_id) per
-- canonical-data-model-v2-spec.md §4.7 / §9-B. The slot gets one meaning
-- instead of the "two nullable FKs" regression the snack un-fold reintroduced.
--
-- Shape: atomic hard cutover in ONE file (§8 step 4), following the 3-DM-C1
-- precedent — DDL + in-SQL backfill + RPC rewrite together, one transaction,
-- parents-first. NOT the 15-s4/s5/s6 strangler pattern: the source data
-- already lives in queryable columns, so no external TS backfill script and no
-- later USER-SIDE drop step exist. Nothing is left to drop after this file.
--
-- Depends on:
--   20261010000000_plan_structure_canonical.sql — plan_slots + commit_plan()
--                                                  current shape, original 3
--                                                  XOR CHECKs
--   20261012000000_plan_day_context_rename.sql  — main_assignment_id FK fixed
--                                                  to ON DELETE CASCADE
--   20261028000000_snack_sku_rotation_unfold.sql — snack_sku_id column, the
--                                                  CHECK/commit_plan version
--                                                  being replaced here
--
-- ===========================================================================
-- DISCLOSED BEHAVIOR CHANGES (verified decisions, not oversights)
-- ===========================================================================
--
-- (A) Referential integrity moves from native FKs to triggers. A polymorphic
--     column cannot carry a real FK, so the three current ON DELETE actions
--     (recipe_id = NO ACTION, snack_sku_id = SET NULL, main_assignment_id =
--     CASCADE) are no longer expressible. Replaced by:
--       - one AFTER INSERT/UPDATE trigger on plan_slots that validates the
--         (item_type, item_id) pair against the referenced table, and
--       - three BEFORE DELETE triggers on recipes / snack_skus /
--         plan_main_assignments that RESTRICT a delete while a plan_slots row
--         still points at it.
--
-- (B) snack_skus: SET NULL -> RESTRICT. SET NULL is structurally impossible
--     once item_id is NOT NULL and paired with item_type. Note the old SET
--     NULL was already not survivable in practice: nulling snack_sku_id on a
--     snack slot violated plan_slots_snack_uses_recipe, so the delete failed
--     anyway — with a confusing CHECK error instead of a legible one. RESTRICT
--     makes the same outcome loud.
--
-- (C) plan_main_assignments: CASCADE -> RESTRICT for DIRECT deletes only.
--     Cascaded deletes (pg_trigger_depth() > 1) are allowed through — see the
--     DEVIATION note on the delete triggers below. Direct deletes of a
--     plan_main_assignments row now require its slots to be gone first, which
--     is why commit_plan()'s recommit wipe deletes plan_days BEFORE
--     plan_main_assignments (flipped from the previous order). Without that
--     flip every plan recommit would raise from its own new trigger.
--
-- (D) No Kitchen Map trigger. plan_slots is not a KitchenMapRepository
--     .loadRaw() source (grep-verified: zero plan_slots references in
--     kitchen-map.repository.ts / kitchen-map.service.ts) and does not become
--     one here, so spec §7.3's "ship the kitchen_map_version bump trigger with
--     the table" does not apply. Recorded, not silently skipped.
--
-- (E) No RLS change. plan_slots' RLS was enabled in 3-DM-C1 and its policy is
--     scoped by plan_day_id, not by the item columns — untouched by this
--     migration.
--
-- (F) No swap_plan_days() / pause_child_on_day() change. Re-read against the
--     new schema: swap_plan_days only writes plan_days.day; pause_child_on_day
--     only writes plan_slot_variations.paused_at, joining through
--     plan_slots.id / plan_day_id. Neither reads the item columns.
--
-- (G) commit_plan()'s per-slot item_type resolution is kind-scoped, not a
--     bare "snack_sku_id present -> snack_sku" fallthrough: only a slot_kind
--     'snack' can resolve to item_type 'snack_sku'. An 'extra' slot payload
--     carrying a stray snack_sku_id (malformed planner/caller output) always
--     falls through to the recipe branch, which then either succeeds or
--     raises the function's own descriptive item-reference error below —
--     never the new item_type_matches_kind CHECK's generic constraint error.
--     Unreachable today (PlannerSlotInputSchema's Zod schema enforces XOR
--     upstream), but scoped explicitly rather than relying on that alone.

-- ---------------------------------------------------------------------------
-- 1. slot_item_type enum.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE slot_item_type AS ENUM ('main_assignment', 'recipe', 'snack_sku');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Add the polymorphic pair, nullable, so the backfill can run first.
-- ---------------------------------------------------------------------------

ALTER TABLE plan_slots
  ADD COLUMN IF NOT EXISTS item_type slot_item_type,
  ADD COLUMN IF NOT EXISTS item_id   uuid;

-- ---------------------------------------------------------------------------
-- 3. Backfill from the three legacy columns. Pure SQL — the source values are
--    already queryable columns, unlike the JSONB removals in 15-s4/s5/s6.
--
--    Exactly one of the three is non-NULL on every existing row per the three
--    CHECKs dropped in step 5, so the CASE and the COALESCE always agree.
-- ---------------------------------------------------------------------------

UPDATE plan_slots SET
  item_type = CASE
    WHEN main_assignment_id IS NOT NULL THEN 'main_assignment'::slot_item_type
    WHEN snack_sku_id       IS NOT NULL THEN 'snack_sku'::slot_item_type
    WHEN recipe_id          IS NOT NULL THEN 'recipe'::slot_item_type
  END,
  item_id = COALESCE(main_assignment_id, snack_sku_id, recipe_id);

-- Fail loudly and specifically (not via the opaque "column contains null
-- values" error the later SET NOT NULL would otherwise raise) if any row had
-- all three legacy columns NULL — a pre-existing data-integrity bug the old
-- CHECKs already forbade.
DO $$
DECLARE
  v_bad_id uuid;
BEGIN
  SELECT id INTO v_bad_id FROM plan_slots WHERE item_type IS NULL LIMIT 1;
  IF v_bad_id IS NOT NULL THEN
    RAISE EXCEPTION 'plan_slots.% has all three legacy item columns NULL — cannot backfill item_type', v_bad_id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Constrain. A pre-existing row with all three columns NULL would fail
--    here — deliberately loud: that is a data-integrity bug the old CHECKs
--    already forbade, and masking it would carry it forward.
-- ---------------------------------------------------------------------------

ALTER TABLE plan_slots
  ALTER COLUMN item_type SET NOT NULL,
  ALTER COLUMN item_id   SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Replace the three XOR-by-slot_kind CHECKs with the item_type matrix.
--
--    The old plan_slots_extra_uses_recipe_and_kind carried TWO invariants: the
--    item reference AND extra_kind presence. Only the first moves into the
--    matrix; the second is carried forward as its own constraint rather than
--    dropped along with it.
-- ---------------------------------------------------------------------------

ALTER TABLE plan_slots
  DROP CONSTRAINT IF EXISTS plan_slots_main_uses_assignment,
  DROP CONSTRAINT IF EXISTS plan_slots_snack_uses_recipe,
  DROP CONSTRAINT IF EXISTS plan_slots_extra_uses_recipe_and_kind;

ALTER TABLE plan_slots
  DROP CONSTRAINT IF EXISTS plan_slots_item_type_matches_kind,
  DROP CONSTRAINT IF EXISTS plan_slots_extra_kind_presence;

ALTER TABLE plan_slots
  ADD CONSTRAINT plan_slots_item_type_matches_kind CHECK (
    (slot_kind = 'main'  AND item_type = 'main_assignment') OR
    (slot_kind = 'snack' AND item_type IN ('recipe', 'snack_sku')) OR
    (slot_kind = 'extra' AND item_type = 'recipe')
  ),
  ADD CONSTRAINT plan_slots_extra_kind_presence CHECK (
    (slot_kind = 'extra') = (extra_kind IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 6. Drop the legacy columns. Their FKs and partial indexes
--    (plan_slots_main_assignment_idx, plan_slots_recipe_idx,
--    plan_slots_snack_sku_idx) go with them.
-- ---------------------------------------------------------------------------

ALTER TABLE plan_slots
  DROP COLUMN IF EXISTS main_assignment_id,
  DROP COLUMN IF EXISTS recipe_id,
  DROP COLUMN IF EXISTS snack_sku_id;

CREATE INDEX IF NOT EXISTS plan_slots_item_idx ON plan_slots (item_type, item_id);

COMMENT ON COLUMN plan_slots.item_type IS
  'Story 15-s7 — which table item_id points at. Enforced against slot_kind by '
  'plan_slots_item_type_matches_kind and against row existence by '
  'plan_slots_validate_item_reference.';

-- ---------------------------------------------------------------------------
-- 7. Existence validation — the trigger-based half of the polymorphic FK.
--
--    Plain IF/ELSIF dispatch on a closed 3-value enum, NOT dynamic SQL
--    (EXECUTE format(...) against a computed table name). There is no possible
--    fourth table, so dynamic SQL would buy nothing but injection-shaped
--    surface area. Scoped to `OF item_type, item_id` so unrelated updates
--    (paused_at, updated_at) don't re-validate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validate_plan_slot_item_reference() RETURNS trigger AS $$
BEGIN
  IF NEW.item_type = 'main_assignment' THEN
    IF NOT EXISTS (SELECT 1 FROM plan_main_assignments WHERE id = NEW.item_id) THEN
      RAISE EXCEPTION 'plan_slots.item_id % does not reference an existing plan_main_assignments row', NEW.item_id;
    END IF;
  ELSIF NEW.item_type = 'recipe' THEN
    IF NOT EXISTS (SELECT 1 FROM recipes WHERE id = NEW.item_id) THEN
      RAISE EXCEPTION 'plan_slots.item_id % does not reference an existing recipes row', NEW.item_id;
    END IF;
  ELSIF NEW.item_type = 'snack_sku' THEN
    IF NOT EXISTS (SELECT 1 FROM snack_skus WHERE id = NEW.item_id) THEN
      RAISE EXCEPTION 'plan_slots.item_id % does not reference an existing snack_skus row', NEW.item_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS plan_slots_validate_item_reference ON plan_slots;
CREATE TRIGGER plan_slots_validate_item_reference
  AFTER INSERT OR UPDATE OF item_type, item_id ON plan_slots
  FOR EACH ROW EXECUTE FUNCTION validate_plan_slot_item_reference();

-- ---------------------------------------------------------------------------
-- 8. The other half of the polymorphic FK: RESTRICT-on-delete companions.
--
--    The AFTER trigger above only fires on writes TO plan_slots — it can never
--    see a DELETE FROM recipes / snack_skus / plan_main_assignments. Without
--    these three, dropping a referenced row would silently strand a slot.
--
--    DEVIATION from story 15-s7 Decision D1 (blanket RESTRICT), with cause:
--    cascaded deletes are allowed through via pg_trigger_depth() > 1, the same
--    escape 20261035000200's signals append-only guard uses. Reason —
--    `DELETE FROM plans` is a live path (DELETE /v1/dev/reset-plans, the
--    account-deletion job, scripts/clear-load-test-plans.ts) and it cascades
--    to BOTH plan_main_assignments and plan_days. Postgres queues those two
--    cascades independently; when the plan_main_assignments cascade runs
--    first, the plan_days cascade has not yet removed the referencing slots,
--    so a blanket RESTRICT would abort every plan deletion — breaking dev
--    reset and account deletion. A cascade is by definition a structural
--    teardown in which those slots are being deleted in the same statement,
--    so allowing it is correct, not a loophole. Direct deletes — including
--    commit_plan()'s recommit wipe — still get full RESTRICT, which is what
--    makes the delete-order flip in step 9 load-bearing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION restrict_delete_if_referenced_by_plan_slot() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1 FROM plan_slots
    WHERE item_type = TG_ARGV[0]::slot_item_type AND item_id = OLD.id
  ) THEN
    RAISE EXCEPTION '% % is still referenced by an existing plan_slots row', TG_ARGV[0], OLD.id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recipes_restrict_delete_if_slotted ON recipes;
CREATE TRIGGER recipes_restrict_delete_if_slotted
  BEFORE DELETE ON recipes FOR EACH ROW
  EXECUTE FUNCTION restrict_delete_if_referenced_by_plan_slot('recipe');

DROP TRIGGER IF EXISTS snack_skus_restrict_delete_if_slotted ON snack_skus;
CREATE TRIGGER snack_skus_restrict_delete_if_slotted
  BEFORE DELETE ON snack_skus FOR EACH ROW
  EXECUTE FUNCTION restrict_delete_if_referenced_by_plan_slot('snack_sku');

DROP TRIGGER IF EXISTS plan_main_assignments_restrict_delete_if_slotted ON plan_main_assignments;
CREATE TRIGGER plan_main_assignments_restrict_delete_if_slotted
  BEFORE DELETE ON plan_main_assignments FOR EACH ROW
  EXECUTE FUNCTION restrict_delete_if_referenced_by_plan_slot('main_assignment');

-- ---------------------------------------------------------------------------
-- 9. commit_plan() rewrite. Signature UNCHANGED (same 10 args) and the jsonb
--    input shape is UNCHANGED — p_days slots still carry slot_kind /
--    main_assignment_sequence / recipe_id / snack_sku_id / extra_kind exactly
--    as PlannerSlotInputSchema emits them. item_type/item_id are resolved
--    INSIDE the function, the same way main_assignment_id is already resolved
--    from the symbolic main_assignment_sequence.
--
--    TWO changes vs 20261028000000:
--      (a) the recommit wipe deletes plan_days BEFORE plan_main_assignments
--          (flipped) so plan_slots is empty for this plan — via the untouched
--          plan_day_id ON DELETE CASCADE — before the new
--          plan_main_assignments_restrict_delete_if_slotted trigger can fire;
--      (b) the slot INSERT writes (item_type, item_id) instead of the three
--          legacy columns.
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
  v_slot_kind    slot_kind;
  v_main_assn_id uuid;
  v_item_type    slot_item_type;
  v_item_id      uuid;
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

  -- Story 15-s7: plan_days FIRST. Its ON DELETE CASCADE clears every
  -- plan_slots row for this plan (main, snack and extra alike), so the
  -- plan_main_assignments delete below sees zero referencing slots and its
  -- new RESTRICT trigger passes. Reversing these two lines makes every
  -- recommit of an existing plan raise.
  DELETE FROM plan_days              WHERE plan_id = p_plan_id;
  DELETE FROM plan_main_assignments  WHERE plan_id = p_plan_id;

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
      v_slot_kind := (v_slot->>'slot_kind')::slot_kind;

      v_main_assn_id := NULL;
      IF v_slot ? 'main_assignment_sequence' THEN
        v_main_assn_id := (v_seq_to_id->>(v_slot->>'main_assignment_sequence'))::uuid;
      END IF;

      -- Story 15-s7: collapse the three legacy fields into one typed
      -- reference. Precedence matches the old CHECK matrix — a main slot is
      -- always its assignment; a snack slot prefers the SKU when present;
      -- everything else is a recipe.
      IF v_slot_kind = 'main' THEN
        v_item_type := 'main_assignment';
        v_item_id   := v_main_assn_id;
      ELSIF v_slot_kind = 'snack' AND NULLIF(v_slot->>'snack_sku_id','') IS NOT NULL THEN
        v_item_type := 'snack_sku';
        v_item_id   := (v_slot->>'snack_sku_id')::uuid;
      ELSE
        v_item_type := 'recipe';
        v_item_id   := NULLIF(v_slot->>'recipe_id','')::uuid;
      END IF;

      -- Raise with context rather than letting a bare 23502 surface: an
      -- unresolvable main_assignment_sequence or a missing recipe_id is
      -- malformed planner output, and the day/kind is what a human needs.
      IF v_item_id IS NULL THEN
        RAISE EXCEPTION 'commit_plan: % slot on % has no resolvable item reference (item_type %)',
          v_slot_kind, v_day.day, v_item_type;
      END IF;

      INSERT INTO plan_slots (
        plan_day_id, slot_kind, item_type, item_id, extra_kind
      )
      VALUES (
        v_day_id,
        v_slot_kind,
        v_item_type,
        v_item_id,
        NULLIF(v_slot->>'extra_kind','')::extra_kind
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
  'Story 15-s7 — writes plan_slots.(item_type, item_id) instead of the three '
  'legacy nullable columns. Signature and jsonb input shape unchanged from '
  '3-S40. The recommit wipe deletes plan_days BEFORE plan_main_assignments so '
  'the new RESTRICT-on-delete trigger sees zero referencing slots.';
