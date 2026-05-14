-- Slice — Recipes catalog + per-household usage + community comments.
--
-- Closes the long-standing gap logged in
-- _bmad-output/implementation-artifacts/deferred-work.md (2026-05-13):
--   "plan_items.recipe_id is a nullable uuid with NO foreign key …
--    There is no `recipes` table to FK to."
--
-- Depends on: 20260514005000_create_vocabulary_tables.sql
-- (allergen_tags, dietary_tags, cultural_tags, cuisine_tags vocabulary tables).
-- The text[] tag columns on recipes are validated by RecipesService against
-- those vocabulary tables on insert/update (Postgres can't FK array elements).
--
-- Three tables + one view:
--   recipes                   — canonical recipe rows; sharable as a community pool
--   household_recipe_usage    — per-(household, recipe) engagement; drives confidence + favourites
--   recipe_comments           — stored with full authorship (for moderation)
--   recipe_comments_public    — VIEW exposing only the public fields for anonymous display
--
-- Lifecycle:
--   Recipes are populated by PlansService.commit() at the moment a plan
--   clears the deterministic allergy guardrail. The agent emits a structured
--   ingredients array + allergen_flags + dietary_flags + cuisine_tags as
--   part of plan composition; the service validates each tag against the
--   vocabulary tables, derives ingredient_keys from ingredients[].key, and
--   inserts the row. No DB triggers — composition is too contextual.
--
-- plan_items.recipe_id retrofit:
--   Today's column is `uuid` with no FK. Existing values reference nothing
--   useful (the synthetic recipe_ids the planner emits today are opaque tags;
--   the authoritative content lives in plan_items.ingredients jsonb). This
--   migration NULLs those values and adds the FK constraint. If specific
--   historic plans need their recipe_ids preserved, run the backfill
--   before applying this migration.
--
-- Rollback:
--   DROP VIEW IF EXISTS recipe_comments_public;
--   DROP TABLE IF EXISTS recipe_comments;
--   DROP TABLE IF EXISTS household_recipe_usage;
--   ALTER TABLE plan_items DROP CONSTRAINT IF EXISTS plan_items_recipe_id_fk;
--   DROP TABLE IF EXISTS recipes;

-- ---------------------------------------------------------------------------
-- 1. recipes — canonical catalogue
-- ---------------------------------------------------------------------------

CREATE TABLE recipes (
  id                          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Identity
  canonical_name              text        NOT NULL,
  slug                        text,                                              -- optional URL-friendly form

  -- Structured ingredient list (Zod-enforced in app code; see
  -- packages/contracts/src/recipe.ts → RecipeIngredientSchema).
  -- Each entry has the shape:
  --   {
  --     key:         text,           // canonical base ingredient ('chicken','yogurt','lemon')
  --     modifier:    text | null,    // variant ('thigh','greek',null when none)
  --     display:     text,           // human form ("4 boneless skinless chicken thighs")
  --     quantity:    number | null,  // null = "to taste" / "for garnish" / non-quantified
  --     unit:        text | null,    // 'piece','clove','cup','tbsp','tsp','oz','g','ml','pinch','dash' or null
  --     optional:    boolean,        // garnish/optional ingredients
  --     substitutes: Array<{ key: text, modifier: text | null }>
  --   }
  -- One entry per ingredient. Combined display lines ("Salt and pepper to taste")
  -- split into separate entries; the display text reflects the split.
  ingredients                 jsonb       NOT NULL DEFAULT '[]'::jsonb,
  instructions                jsonb,                                             -- nullable: lightweight v1 ok without

  -- Denormalised base-key array for fast lookups. BASE KEYS ONLY, deduplicated.
  -- Derived from ingredients[].key by RecipesService on every write. Powers
  -- pantry-cookable / leftover-matching / variety / grocery-overlap queries
  -- via GIN-indexed @>, &&, <@ operations. Variant-specific queries (e.g.
  -- "Greek yogurt only") drop into the ingredients jsonb path.
  ingredient_keys             text[]      NOT NULL DEFAULT '{}',

  -- Headline ingredient for leftover matching + variety scoring. Base key
  -- only (never includes modifier). Null when the recipe has no single
  -- hero (snack platters, mixed salads, parfaits with balanced components).
  primary_ingredient_key      text,

  -- Tag arrays — vocabulary controlled by 20260514005000 vocabulary tables.
  -- Service-layer validates each value exists in the corresponding *_tags
  -- table with is_active = true. Postgres can't FK array elements so the
  -- enforcement lives in RecipesService.
  --
  -- allergen_flags: from allergen_tags vocabulary. The allergy guardrail
  --   reads this for O(1) per-recipe evaluation rather than parsing
  --   ingredient text. FALCPA-vs-extended-vs-sensitivity distinction lives
  --   in allergen_tags.rule_class + the household's allergy_rules.rule_type.
  -- dietary_flags: from dietary_tags vocabulary. Service expands the implies-
  --   closure on insert (e.g. tagging 'vegan' auto-adds 'vegetarian',
  --   'dairy_free', 'egg_free').
  -- cultural_tags: from cultural_tags vocabulary. Recipe's cultural identity
  --   (vs cuisine_tags = food style). A halal-tagged recipe says "this
  --   recipe is halal-prepared"; the household's cultural_priors decide
  --   whether they need that.
  -- cuisine_tags: from cuisine_tags vocabulary (hierarchical). Service
  --   auto-fans-out parents on insert (recipe tagged 'north_indian' auto-
  --   gets 'south_asian' and 'asian' added too) for retrieval ease.
  allergen_flags              text[]      NOT NULL DEFAULT '{}',
  dietary_flags               text[]      NOT NULL DEFAULT '{}',
  cultural_tags               text[]      NOT NULL DEFAULT '{}',
  cuisine_tags                text[]      NOT NULL DEFAULT '{}',

  -- Slot fit + practicality
  applicable_slots            text[]      NOT NULL DEFAULT ARRAY['main']::text[],
  prep_time_minutes           int,

  -- Provenance
  source                      text        NOT NULL
                              CHECK (source IN ('agent_generated','curated','imported')),
  created_by_household_id     uuid        REFERENCES households(id) ON DELETE SET NULL,

  -- Visibility for community pool
  visibility                  text        NOT NULL DEFAULT 'private'
                              CHECK (visibility IN ('private','shared')),

  -- Aggregate community signals (denormalized; maintained by RecipesService)
  community_use_count         int         NOT NULL DEFAULT 0,
  community_rating_avg        numeric(3,2),
  community_rating_count      int         NOT NULL DEFAULT 0,

  is_active                   boolean     NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recipes_created_by_household_idx
  ON recipes (created_by_household_id);

-- Hot read pattern: "community-pool browse, optionally filtered by template"
CREATE INDEX recipes_visibility_active_idx
  ON recipes (visibility, is_active)
  WHERE visibility = 'shared' AND is_active = true;

-- Tag array GINs — power the planner / swap-agent / community-browse queries.
-- All are @>, &&, <@ tested for membership / overlap / containment.
CREATE INDEX recipes_ingredient_keys_gin_idx
  ON recipes USING gin (ingredient_keys);
CREATE INDEX recipes_allergen_flags_gin_idx
  ON recipes USING gin (allergen_flags);
CREATE INDEX recipes_dietary_flags_gin_idx
  ON recipes USING gin (dietary_flags);
CREATE INDEX recipes_cultural_tags_gin_idx
  ON recipes USING gin (cultural_tags);
CREATE INDEX recipes_cuisine_tags_gin_idx
  ON recipes USING gin (cuisine_tags);

-- Leftover matching: "I have leftover chicken — what recipes feature it?"
CREATE INDEX recipes_primary_ingredient_key_idx
  ON recipes (primary_ingredient_key)
  WHERE primary_ingredient_key IS NOT NULL;

-- Column documentation (visible via \d+ recipes in psql) -------------------

COMMENT ON COLUMN recipes.ingredients IS
  'Structured ingredient list. Array of objects: '
  '{ key, modifier, display, quantity, unit, optional, substitutes }. '
  'Validated by RecipeIngredientSchema (packages/contracts/src/recipe.ts) at the '
  'service boundary. One entry per ingredient — combined display lines split.';

COMMENT ON COLUMN recipes.ingredient_keys IS
  'Base ingredient keys only (no modifier suffix), deduplicated. Maintained by '
  'RecipesService on every write from ingredients[].key. Use for pantry/leftover/'
  'overlap queries (@>, &&, <@). For variant-specific filtering, query the '
  'ingredients jsonb directly.';

COMMENT ON COLUMN recipes.primary_ingredient_key IS
  'Headline ingredient (base key only, no modifier). Used for leftover matching '
  'and variety scoring. Null when no single hero ingredient (snack platters, '
  'mixed salads, parfaits with balanced components).';

COMMENT ON COLUMN recipes.allergen_flags IS
  'Vocabulary: allergen_tags table. Service-layer validates each value exists '
  'with is_active = true. FALCPA/extended/sensitivity distinction lives in '
  'allergen_tags.rule_class.';

COMMENT ON COLUMN recipes.dietary_flags IS
  'Vocabulary: dietary_tags table. Service-layer validates and expands '
  'implies-closure on insert (e.g. ''vegan'' auto-adds ''vegetarian'', '
  '''dairy_free'', ''egg_free'').';

COMMENT ON COLUMN recipes.cultural_tags IS
  'Vocabulary: cultural_tags table. Recipe''s cultural identity / preparation '
  'tradition (vs cuisine_tags which is the recipe''s food style).';

COMMENT ON COLUMN recipes.cuisine_tags IS
  'Vocabulary: cuisine_tags table (hierarchical). Service-layer auto-fans-out '
  'parents on insert (e.g. ''north_indian'' auto-adds ''south_asian'' + ''asian''). '
  'Multi-cuisine recipes (e.g. ''Korean BBQ tacos'' → [''korean'',''mexican'']) '
  'natively supported.';

-- Reuses the shared set_updated_at() trigger function from earlier migrations
-- (defined as CREATE OR REPLACE in 20260502110000 + others).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER recipes_set_updated_at
  BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. household_recipe_usage — per-household engagement + confidence
-- ---------------------------------------------------------------------------

CREATE TABLE household_recipe_usage (
  household_id              uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  recipe_id                 uuid        NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,

  -- Engagement counters (incremented by RecipesService on plan commit + outcome events)
  use_count                 int         NOT NULL DEFAULT 0,
  acceptance_count          int         NOT NULL DEFAULT 0,   -- committed AND not swapped/skipped
  swap_out_count            int         NOT NULL DEFAULT 0,   -- parent swapped this away mid-week
  positive_outcome_count    int         NOT NULL DEFAULT 0,   -- child rating: loved/liked
  negative_outcome_count    int         NOT NULL DEFAULT 0,   -- child rating: didn't like / didn't eat

  -- Derived signal; maintained by RecipesService whenever any counter changes.
  -- Heuristic: clamp(0, 100, 20*use + 10*pos - 15*neg - 10*swap)
  confidence_score          smallint    NOT NULL DEFAULT 50
                            CHECK (confidence_score >= 0 AND confidence_score <= 100),

  -- Stable signals — deliberate household actions, not auto-derived from counters.
  -- These gate "use without asking" planning + permanent exclusions.
  is_household_favorite     boolean     NOT NULL DEFAULT false,
  is_household_banned       boolean     NOT NULL DEFAULT false,

  first_used_at             timestamptz NOT NULL DEFAULT now(),
  last_used_at              timestamptz NOT NULL DEFAULT now(),
  last_outcome_at           timestamptz,

  PRIMARY KEY (household_id, recipe_id),

  CONSTRAINT household_recipe_usage_not_both_flagged
    CHECK (NOT (is_household_favorite AND is_household_banned))
);

-- Planner's hottest read: "give me this household's recipes ranked by confidence,
-- excluding banned ones, for context injection."
CREATE INDEX household_recipe_usage_household_confidence_idx
  ON household_recipe_usage (household_id, confidence_score DESC)
  WHERE is_household_banned = false;

-- Maintenance read: per-recipe rollup for community_use_count refresh.
CREATE INDEX household_recipe_usage_recipe_idx
  ON household_recipe_usage (recipe_id);

-- ---------------------------------------------------------------------------
-- 3. recipe_comments — full authorship stored, public read via view
-- ---------------------------------------------------------------------------

CREATE TABLE recipe_comments (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id           uuid        NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,

  -- Authorship: stored for moderation / one-comment-per-recipe / abuse tracking.
  -- NEVER returned to non-owner read paths. RLS + the public view enforce this.
  author_household_id uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  author_user_id      uuid        NOT NULL REFERENCES users(id)      ON DELETE CASCADE,

  -- Public display
  display_handle      text        NOT NULL,                              -- e.g. "A South Asian household"
  rating              smallint    CHECK (rating BETWEEN 1 AND 5),        -- nullable: rating-only comments allowed
  prose_text          text,                                              -- nullable: rating w/o prose allowed

  -- Moderation
  is_hidden           boolean     NOT NULL DEFAULT false,
  hidden_reason       text,
  hidden_at           timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- One author can leave at most one comment per recipe (edit-in-place via service).
  CONSTRAINT recipe_comments_one_per_author_per_recipe
    UNIQUE (recipe_id, author_user_id)
);

CREATE INDEX recipe_comments_recipe_visible_idx
  ON recipe_comments (recipe_id, created_at DESC)
  WHERE is_hidden = false;

CREATE TRIGGER recipe_comments_set_updated_at
  BEFORE UPDATE ON recipe_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Public view: the only thing authenticated callers can read. Strips
-- author_household_id / author_user_id; filters out hidden rows.
-- RLS on the underlying table denies authenticated SELECT entirely, so the
-- view is the sole read path for non-service-role callers.
CREATE OR REPLACE VIEW recipe_comments_public AS
  SELECT
    id,
    recipe_id,
    display_handle,
    rating,
    prose_text,
    created_at
  FROM recipe_comments
  WHERE is_hidden = false;

-- ---------------------------------------------------------------------------
-- 4. plan_items.recipe_id retrofit
-- ---------------------------------------------------------------------------

-- Today's column has no FK; values are opaque UUIDs the planner generates per
-- plan that reference nothing. Real meal content lives in plan_items.ingredients
-- jsonb. Null the existing values, then add the FK constraint. From this point
-- forward, every recipe_id in plan_items references a real recipes row.

UPDATE plan_items
  SET recipe_id = NULL
  WHERE recipe_id IS NOT NULL;

ALTER TABLE plan_items
  ADD CONSTRAINT plan_items_recipe_id_fk
  FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS plan_items_recipe_id_idx
  ON plan_items (recipe_id)
  WHERE recipe_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Kitchen Map version-bump on stable usage flips only
-- ---------------------------------------------------------------------------
-- Bumping kitchen_map_version on every counter increment would thrash the
-- cache (every plan commit writes use_count). Only the deliberate boolean
-- flags (is_household_favorite, is_household_banned) and INSERT/DELETE
-- shape changes are projection-relevant.

CREATE OR REPLACE FUNCTION bump_kitchen_map_from_recipe_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE households
      SET kitchen_map_version = kitchen_map_version + 1
      WHERE id = NEW.household_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE households
      SET kitchen_map_version = kitchen_map_version + 1
      WHERE id = OLD.household_id;
    RETURN OLD;
  END IF;

  -- UPDATE: only bump when stable flags change. Counter-only updates are
  -- silent (cache stays warm; planner re-reads counters when it actually
  -- needs them via tool call, not via Kitchen Map injection).
  IF OLD.is_household_favorite IS DISTINCT FROM NEW.is_household_favorite
     OR OLD.is_household_banned IS DISTINCT FROM NEW.is_household_banned
  THEN
    UPDATE households
      SET kitchen_map_version = kitchen_map_version + 1
      WHERE id = NEW.household_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER household_recipe_usage_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON household_recipe_usage
  FOR EACH ROW EXECUTE FUNCTION bump_kitchen_map_from_recipe_usage();

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
-- Pattern matches the rest of the project: service-role bypasses RLS (all
-- writes go through the API), authenticated role has narrow SELECT only.

ALTER TABLE recipes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_recipe_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_comments        ENABLE ROW LEVEL SECURITY;

-- recipes: authenticated may SELECT shared recipes OR recipes their household
-- created OR recipes their household has a usage row for.
CREATE POLICY recipes_authenticated_select_policy ON recipes
  FOR SELECT TO authenticated USING (
    visibility = 'shared'
    OR created_by_household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM household_recipe_usage hru
      WHERE hru.recipe_id = recipes.id
        AND hru.household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
    )
  );

-- Explicit no-INSERT/UPDATE/DELETE for authenticated — service-role-only writes.
CREATE POLICY recipes_authenticated_no_insert ON recipes FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY recipes_authenticated_no_update ON recipes FOR UPDATE TO authenticated USING (false);
CREATE POLICY recipes_authenticated_no_delete ON recipes FOR DELETE TO authenticated USING (false);

-- household_recipe_usage: only your own household's rows.
CREATE POLICY hru_authenticated_select_policy ON household_recipe_usage
  FOR SELECT TO authenticated USING (
    household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY hru_authenticated_no_insert ON household_recipe_usage FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY hru_authenticated_no_update ON household_recipe_usage FOR UPDATE TO authenticated USING (false);
CREATE POLICY hru_authenticated_no_delete ON household_recipe_usage FOR DELETE TO authenticated USING (false);

-- recipe_comments: authenticated CANNOT read the raw table; they read the
-- recipe_comments_public view instead (which strips authorship). Writes go
-- through the API service-role.
CREATE POLICY recipe_comments_authenticated_no_select ON recipe_comments FOR SELECT TO authenticated USING (false);
CREATE POLICY recipe_comments_authenticated_no_insert ON recipe_comments FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY recipe_comments_authenticated_no_update ON recipe_comments FOR UPDATE TO authenticated USING (false);
CREATE POLICY recipe_comments_authenticated_no_delete ON recipe_comments FOR DELETE TO authenticated USING (false);

-- The public view inherits the underlying table's RLS by default, which would
-- make it unreadable. Grant SELECT explicitly to authenticated on the view.
GRANT SELECT ON recipe_comments_public TO authenticated;
