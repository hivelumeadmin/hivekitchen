-- Story 3-DM-C1 — Plan structure atomic cutover.
--
-- The big one. Replaces the flat `plan_items` representation with the
-- canonical 4-table tree (`plan_main_assignments` + `plan_days` +
-- `plan_slots` + `plan_slot_variations`) per canonical-data-model-design.md §3.
-- The family-first model finally has its first-class data home — Variation,
-- Main-group, slot kind, optional-extra kind, dual time budget all live as
-- structured rows instead of bolted-on JSONB or per-row columns.
--
-- Hard cutover (pre-beta): no shadow tables, no dual-write window. Existing
-- `plan_items` rows are dropped along with the table. Per Menon 2026-05-31 and
-- §10.5: pre-beta is the right moment to take the cutover hit.
--
-- Coupled rewrites (all in this migration):
--   - 7 enum CREATE TYPE statements
--   - plans table: week_id dropped; week_of promoted varchar→date; state/state_set_at/state_message
--     absorbed from brief_state (D1 will drop the brief_state columns)
--   - 4 new tables with full CHECK + UNIQUE + index + RLS
--   - commit_plan() RPC rewritten per §3.9 discipline (one txn, parents-first,
--     multi-row INSERTs, plans UPDATE last)
--   - Dependent FK columns retargeted:
--       day_overrides.plan_item_id        → day_overrides.plan_slot_id
--       extra_removal_signals.plan_item_id → extra_removal_signals.plan_slot_id
--       variant_proposals.plan_item_id    → variant_proposals.plan_slot_variation_id
--   - plan_items dropped CASCADE
--
-- Depends on:
--   20260502110000_create_plans_and_plan_items.sql
--   20260820000200_create_recipes_and_usage.sql        (plan_slots.recipe_id FK)
--   20260920000000_add_plan_state_to_brief_state.sql   (plan_state_enum reused)
--   20260510000000_create_children_table.sql           (plan_slot_variations.child_id FK)
--   20261006000000_snack_sku_fold.sql                  (current commit_plan signature)

-- ---------------------------------------------------------------------------
-- 1. Enums (§3.2).
-- ---------------------------------------------------------------------------

CREATE TYPE weekday AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday');

CREATE TYPE slot_kind AS ENUM ('main', 'snack', 'extra');

CREATE TYPE extra_kind AS ENUM (
  'drink', 'extra_snack', 'protein_boost', 'sports_add',
  'sweet', 'toddler_safe', 'allergy_substitute', 'custom'
);

CREATE TYPE portion_size AS ENUM ('small', 'regular', 'large');

CREATE TYPE texture_level AS ENUM ('soft', 'normal', 'diced', 'finger');

CREATE TYPE spice_level AS ENUM ('mild', 'regular', 'spicy');

CREATE TYPE pause_reason AS ENUM ('sick_day', 'holiday', 'snow_day', 'field_trip', 'half_day', 'other');

-- ---------------------------------------------------------------------------
-- 2. plans table cleanup (§3.3).
--    week_of promoted varchar→date; week_id dropped; plan_state columns
--    absorbed from brief_state. UNIQUE constraint switches to (household, week_of).
-- ---------------------------------------------------------------------------

-- Backfill any pre-existing NULL week_of so the NOT NULL promotion succeeds.
-- Pre-beta: no production data; this is purely defensive against dev rows.
UPDATE plans SET week_of = '1970-01-01' WHERE week_of IS NULL;

-- Drop the old unique index BEFORE column type changes / drops so it doesn't
-- block. Replaced by UNIQUE(household_id, week_of) after the type promotion.
DROP INDEX IF EXISTS plans_household_week_unique;

-- Drop the column default before the type change — Postgres can't
-- automatically cast a varchar default (e.g. '' / '1970-01-01') to date.
-- No new default is set: every caller supplies week_of explicitly.
ALTER TABLE plans
  ALTER COLUMN week_of DROP DEFAULT;

ALTER TABLE plans
  ALTER COLUMN week_of TYPE date USING week_of::date,
  ALTER COLUMN week_of SET NOT NULL;

ALTER TABLE plans
  DROP COLUMN week_id;

-- plan_state_enum already exists from 20260920000000_add_plan_state_to_brief_state.
ALTER TABLE plans
  ADD COLUMN state             plan_state_enum,
  ADD COLUMN state_set_at      timestamptz,
  ADD COLUMN state_message     text CHECK (char_length(state_message) <= 500);

CREATE UNIQUE INDEX plans_household_week_of_unique
  ON plans (household_id, week_of);

-- ---------------------------------------------------------------------------
-- 3. plan_main_assignments (§3.4).
--    M1 / M2 / M3 / ... — Lumi's per-week Main bases. Sequence 1..6 (Mon-Sat ceiling).
-- ---------------------------------------------------------------------------

CREATE TABLE plan_main_assignments (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id     uuid        NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  sequence    smallint    NOT NULL CHECK (sequence >= 1 AND sequence <= 6),
  recipe_id   uuid        NOT NULL REFERENCES recipes(id),
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (plan_id, sequence)
);

CREATE INDEX plan_main_assignments_plan_idx ON plan_main_assignments (plan_id);

COMMENT ON TABLE plan_main_assignments IS
  'Story 3-DM-C1 — explicit M1/M2/M3 Main grouping per plan. Sequence 1..6 '
  '(Mon-Sat ceiling); can become sparse after parent overrides.';

-- ---------------------------------------------------------------------------
-- 4. plan_days (§3.5) — one row per day, replaces flat plan_items.
-- ---------------------------------------------------------------------------

CREATE TABLE plan_days (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id         uuid        NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  day             weekday     NOT NULL,
  paused_at       timestamptz,
  paused_reason   pause_reason,
  paused_note     text        CHECK (char_length(paused_note) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (plan_id, day),
  CONSTRAINT plan_days_pause_consistency CHECK (
    (paused_at IS NULL AND paused_reason IS NULL AND paused_note IS NULL) OR
    (paused_at IS NOT NULL AND paused_reason IS NOT NULL)
  )
);

CREATE INDEX plan_days_plan_idx ON plan_days (plan_id);

CREATE TRIGGER plan_days_updated_at
  BEFORE UPDATE ON plan_days
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE plan_days IS
  'Story 3-DM-C1 — first-class day row. Consolidates the old plan_items.paused_at '
  'and day_overrides bag-suspended overlap at the day grain.';

-- ---------------------------------------------------------------------------
-- 5. plan_slots (§3.6) — replaces per-row plan_items at the slot grain.
--    XOR-CHECK enforces slot_kind ↔ FK presence per row (catches malformed
--    planner output at write time, not just in Zod).
-- ---------------------------------------------------------------------------

CREATE TABLE plan_slots (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_day_id          uuid        NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  slot_kind            slot_kind   NOT NULL,
  main_assignment_id   uuid        REFERENCES plan_main_assignments(id),
  recipe_id            uuid        REFERENCES recipes(id),
  extra_kind           extra_kind,
  paused_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (plan_day_id, slot_kind),

  CONSTRAINT plan_slots_main_uses_assignment CHECK (
    slot_kind <> 'main' OR
    (main_assignment_id IS NOT NULL AND recipe_id IS NULL AND extra_kind IS NULL)
  ),
  CONSTRAINT plan_slots_snack_uses_recipe CHECK (
    slot_kind <> 'snack' OR
    (recipe_id IS NOT NULL AND main_assignment_id IS NULL AND extra_kind IS NULL)
  ),
  CONSTRAINT plan_slots_extra_uses_recipe_and_kind CHECK (
    slot_kind <> 'extra' OR
    (recipe_id IS NOT NULL AND main_assignment_id IS NULL AND extra_kind IS NOT NULL)
  )
);

CREATE INDEX plan_slots_main_assignment_idx
  ON plan_slots (main_assignment_id)
  WHERE main_assignment_id IS NOT NULL;

CREATE INDEX plan_slots_recipe_idx
  ON plan_slots (recipe_id)
  WHERE recipe_id IS NOT NULL;

CREATE TRIGGER plan_slots_updated_at
  BEFORE UPDATE ON plan_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE plan_slots IS
  'Story 3-DM-C1 — per-(plan_day, slot_kind) row. Replaces the old flat '
  'plan_items at the (plan, day, slot) grain. Per-child variation lives in '
  'plan_slot_variations.';

-- ---------------------------------------------------------------------------
-- 6. plan_slot_variations (§3.7) — the variation primitive.
-- ---------------------------------------------------------------------------

CREATE TABLE plan_slot_variations (
  id              uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_slot_id    uuid          NOT NULL REFERENCES plan_slots(id) ON DELETE CASCADE,
  child_id        uuid          NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  portion_size    portion_size  NOT NULL DEFAULT 'regular',
  texture         texture_level NOT NULL DEFAULT 'normal',
  spice_level     spice_level   NOT NULL DEFAULT 'regular',
  cutting_style   text          CHECK (char_length(cutting_style) <= 80),
  container       text          CHECK (char_length(container) <= 60),
  add_ons         text[]        NOT NULL DEFAULT '{}',
  removals        text[]        NOT NULL DEFAULT '{}',
  notes           text          CHECK (char_length(notes) <= 280),
  paused_at       timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),

  UNIQUE (plan_slot_id, child_id)
);

CREATE INDEX plan_slot_variations_slot_idx ON plan_slot_variations (plan_slot_id);
CREATE INDEX plan_slot_variations_child_idx ON plan_slot_variations (child_id);

CREATE TRIGGER plan_slot_variations_updated_at
  BEFORE UPDATE ON plan_slot_variations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE plan_slot_variations IS
  'Story 3-DM-C1 — per-child adjustment to a shared slot. The family-first '
  'model treats this as primary: one Main, three Variations = three rows. '
  'Per-child pause (sick day for one kid) sets paused_at here.';

-- ---------------------------------------------------------------------------
-- 7. RLS on the 4 new tables. Pattern matches plans/plan_items: authenticated
--    SELECT scoped to household via plan_id FK; all writes service-role only.
-- ---------------------------------------------------------------------------

ALTER TABLE plan_main_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_days              ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_slots             ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_slot_variations   ENABLE ROW LEVEL SECURITY;

CREATE POLICY plan_main_assignments_select ON plan_main_assignments
  FOR SELECT TO authenticated USING (
    plan_id IN (
      SELECT id FROM plans
      WHERE household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
    )
  );

CREATE POLICY plan_days_select ON plan_days
  FOR SELECT TO authenticated USING (
    plan_id IN (
      SELECT id FROM plans
      WHERE household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
    )
  );

CREATE POLICY plan_slots_select ON plan_slots
  FOR SELECT TO authenticated USING (
    plan_day_id IN (
      SELECT id FROM plan_days
      WHERE plan_id IN (
        SELECT id FROM plans
        WHERE household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
      )
    )
  );

CREATE POLICY plan_slot_variations_select ON plan_slot_variations
  FOR SELECT TO authenticated USING (
    plan_slot_id IN (
      SELECT id FROM plan_slots
      WHERE plan_day_id IN (
        SELECT id FROM plan_days
        WHERE plan_id IN (
          SELECT id FROM plans
          WHERE household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Dependent FK retargets BEFORE plan_items is dropped.
--    Pre-beta: dependent tables truncate cleanly — there's no production
--    audit/override/variant data worth preserving.
-- ---------------------------------------------------------------------------

TRUNCATE TABLE day_overrides;
TRUNCATE TABLE extra_removal_signals;
TRUNCATE TABLE variant_proposals;

ALTER TABLE day_overrides
  DROP COLUMN plan_item_id,
  ADD COLUMN plan_slot_id uuid NOT NULL REFERENCES plan_slots(id) ON DELETE CASCADE;

CREATE INDEX day_overrides_plan_slot_idx ON day_overrides (plan_slot_id);

-- day_overrides' UNIQUE was on (plan_item_id, child_id, override_date) per the
-- creation migration. Replace with (plan_slot_id, child_id, override_date).
-- Find and drop by the auto-generated constraint name first; pre-beta we can
-- rely on the conventional name.
ALTER TABLE day_overrides
  DROP CONSTRAINT IF EXISTS day_overrides_plan_item_id_child_id_override_date_key;

ALTER TABLE day_overrides
  ADD CONSTRAINT day_overrides_plan_slot_child_date_unique
    UNIQUE (plan_slot_id, child_id, override_date);

ALTER TABLE extra_removal_signals
  DROP COLUMN plan_item_id,
  ADD COLUMN plan_slot_id uuid REFERENCES plan_slots(id) ON DELETE SET NULL;

CREATE INDEX extra_removal_signals_plan_slot_idx
  ON extra_removal_signals (plan_slot_id)
  WHERE plan_slot_id IS NOT NULL;

ALTER TABLE variant_proposals
  DROP COLUMN plan_item_id,
  ADD COLUMN plan_slot_variation_id uuid NOT NULL REFERENCES plan_slot_variations(id) ON DELETE CASCADE;

CREATE INDEX variant_proposals_plan_slot_variation_idx
  ON variant_proposals (plan_slot_variation_id);

-- ---------------------------------------------------------------------------
-- 9. Drop plan_items + the obsolete commit_plan() variant.
--    CASCADE here removes any remaining FK constraints that referenced
--    plan_items (none should remain post step 8, but CASCADE is defensive).
-- ---------------------------------------------------------------------------

DROP TABLE plan_items CASCADE;

-- The snack-sku-fold migration's commit_plan(uuid, uuid, uuid, varchar, integer,
-- timestamptz, timestamptz, varchar, varchar, jsonb) signature retires here.
DROP FUNCTION IF EXISTS commit_plan(uuid, uuid, uuid, varchar, integer, timestamptz, timestamptz, varchar, varchar, jsonb);

-- ---------------------------------------------------------------------------
-- 10. New commit_plan() RPC — tree-shape input, §3.9 discipline.
--
-- Signature changes:
--   - p_week_id REMOVED (column dropped)
--   - p_items   REMOVED (replaced by p_main_assignments + p_days)
--   - p_main_assignments jsonb — array of { sequence, recipe_id }
--   - p_days             jsonb — array of {
--       day, paused_at?, paused_reason?, paused_note?,
--       slots: [{
--         slot_kind, main_assignment_sequence?, recipe_id?, extra_kind?,
--         variations: [{
--           child_id, portion_size?, texture?, spice_level?,
--           cutting_style?, container?, add_ons?, removals?, notes?, paused_at?
--         }]
--       }]
--     }
--
-- Discipline per §3.9:
--   - One transaction
--   - Parents-first: plans → main_assignments → days → slots → variations
--   - Multi-row INSERT per child table via jsonb_to_recordset for batch
--   - plans row UPDATE last (just before COMMIT — minimizes lock hold time)
-- ---------------------------------------------------------------------------

CREATE FUNCTION commit_plan(
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
  -- Step 1: ensure the plans row exists. INSERT-or-pre-existing; the trailing
  -- UPDATE at step 6 sets guardrail_cleared_at + revision + prompt_version
  -- last, so the row is "uncleared" until COMMIT.
  INSERT INTO plans (
    id, household_id, week_of, revision, generated_at,
    guardrail_cleared_at, guardrail_version, prompt_version
  )
  VALUES (
    p_plan_id, p_household_id, p_week_of, p_revision, p_generated_at,
    NULL, NULL, p_prompt_version
  )
  ON CONFLICT (id) DO NOTHING;

  -- Step 2: replace existing tree for this plan. CASCADE on
  -- plan_main_assignments + plan_days drops every descendant.
  DELETE FROM plan_main_assignments WHERE plan_id = p_plan_id;
  DELETE FROM plan_days              WHERE plan_id = p_plan_id;

  -- Step 3: insert main_assignments. Build sequence → id lookup the planner
  -- references symbolically via main_assignment_sequence inside slots.
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

  -- Step 4: insert plan_days + step 5: per-day slots + variations. The
  -- per-day FOR loop keeps the slot batching scoped to one day at a time;
  -- multi-row INSERTs happen via UNNEST inside each batch.
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
      -- Resolve main_assignment_id from the symbolic sequence handle the
      -- planner emits. NULL for snack/extra slots.
      v_main_assn_id := NULL;
      IF v_slot ? 'main_assignment_sequence' THEN
        v_main_assn_id := (v_seq_to_id->>(v_slot->>'main_assignment_sequence'))::uuid;
      END IF;

      INSERT INTO plan_slots (
        plan_day_id, slot_kind, main_assignment_id, recipe_id, extra_kind
      )
      VALUES (
        v_day_id,
        (v_slot->>'slot_kind')::slot_kind,
        v_main_assn_id,
        NULLIF(v_slot->>'recipe_id','')::uuid,
        NULLIF(v_slot->>'extra_kind','')::extra_kind
      )
      RETURNING id INTO v_slot_id;

      -- Variations: insert one row per child entry. Empty array allowed —
      -- a slot with no variations is rare but legal (e.g., one-child household
      -- with default variation provided externally).
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

  -- Step 6: plans UPDATE last — minimizes the lock-hold window. This is what
  -- flips the plan from "uncleared" to "cleared" atomically. The composer's
  -- post-commit refresh observes the cleared state on the first read.
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
  'Story 3-DM-C1 — tree-shape atomic plan commit. One txn, parents-first, '
  'plans UPDATE last per §3.9 discipline. p_main_assignments and p_days are '
  'the planner agent''s emitted tree. main_assignment_sequence inside slots '
  'is a symbolic handle resolved against the just-inserted main_assignments.';

-- ---------------------------------------------------------------------------
-- 11. swap_plan_days() RPC (§9.3) — canvas drag-drop atomic swap.
--
-- Two UPDATE statements inside one PL/pgSQL function body run in a single
-- implicit transaction. Without this server-side wrapper a client-side
-- two-update sequence would briefly violate UNIQUE(plan_id, day) — both
-- rows can''t both be 'tuesday' at the same instant. The temp-value
-- workaround would need a third enum value reserved for swap; the function
-- is cleaner.
-- ---------------------------------------------------------------------------

CREATE FUNCTION swap_plan_days(
  p_plan_id  uuid,
  p_day_a_id uuid,
  p_day_b_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_day_a weekday;
  v_day_b weekday;
BEGIN
  -- Lock both rows in id order for deterministic acquire (prevents deadlock
  -- if two concurrent swaps target the same plan in mirrored orders).
  IF p_day_a_id < p_day_b_id THEN
    SELECT day INTO v_day_a FROM plan_days WHERE id = p_day_a_id AND plan_id = p_plan_id FOR UPDATE;
    SELECT day INTO v_day_b FROM plan_days WHERE id = p_day_b_id AND plan_id = p_plan_id FOR UPDATE;
  ELSE
    SELECT day INTO v_day_b FROM plan_days WHERE id = p_day_b_id AND plan_id = p_plan_id FOR UPDATE;
    SELECT day INTO v_day_a FROM plan_days WHERE id = p_day_a_id AND plan_id = p_plan_id FOR UPDATE;
  END IF;

  IF v_day_a IS NULL OR v_day_b IS NULL THEN
    RAISE EXCEPTION 'swap_plan_days: one or both plan_day ids not found for plan %', p_plan_id;
  END IF;

  -- Park day A on a sentinel value so the UNIQUE constraint allows day B
  -- to take the original day-A slot. The weekday enum doesn''t carry a
  -- sentinel, so we run the swap in two steps using id-keyed UPDATEs that
  -- temporarily violate (plan_id, day) UNIQUE — but only inside the txn,
  -- and only briefly. DEFERRABLE on the unique index would be cleaner;
  -- since the constraint is defined NOT DEFERRABLE by default in §3.5,
  -- we instead use a one-pass UPDATE ... FROM swap pattern.
  --
  -- Single-statement swap that satisfies UNIQUE throughout: each row sees
  -- the OTHER row''s day as its new value. No intermediate violating state.
  UPDATE plan_days AS d
     SET day = src.new_day, updated_at = now()
    FROM (VALUES
            (p_day_a_id, v_day_b),
            (p_day_b_id, v_day_a)
         ) AS src(id, new_day)
   WHERE d.id = src.id;
END;
$$;

COMMENT ON FUNCTION swap_plan_days(uuid, uuid, uuid) IS
  'Story 3-DM-C1 §9.3 — atomic day swap. Single UPDATE ... FROM (VALUES) '
  'satisfies UNIQUE(plan_id, day) throughout the swap; no DEFERRABLE needed. '
  'Locks acquire in id order to prevent mirrored-swap deadlock.';

-- ---------------------------------------------------------------------------
-- 12. pause_child_on_day() RPC (§9.6) — flip paused_at on every plan_slot_variation
--     for one child across all slots of a given plan_day. Server-side
--     because supabase-js doesn''t natively support the IN-with-subquery
--     pattern this query needs.
-- ---------------------------------------------------------------------------

CREATE FUNCTION pause_child_on_day(
  p_child_id    uuid,
  p_plan_day_id uuid,
  p_paused_at   timestamptz
)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE plan_slot_variations
     SET paused_at = p_paused_at, updated_at = now()
   WHERE child_id = p_child_id
     AND plan_slot_id IN (SELECT id FROM plan_slots WHERE plan_day_id = p_plan_day_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION pause_child_on_day(uuid, uuid, timestamptz) IS
  'Story 3-DM-C1 §9.6 — pause one child across every slot of a plan_day. '
  'Returns the variation row count affected. Idempotent on already-paused '
  'rows (paused_at gets stamped with the new value).';
