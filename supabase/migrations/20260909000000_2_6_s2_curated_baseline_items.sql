-- Slice 2.6-s2 — global curated baseline items (Stage 0 catalog safety net)
-- + households.stage0_materialized_at column.
--
-- See: _bmad-output/implementation-artifacts/2.6-s2-stage-0-curated-baseline.md
--
-- Three changes:
--   1. CREATE TABLE curated_baseline_items (global reference; no household FK)
--   2. ALTER TABLE households ADD COLUMN stage0_materialized_at timestamptz
--   3. INSERT ~50 hand-tagged seed items matching
--      apps/api/src/seeds/curated-baseline.ts one-to-one
--
-- No RLS on curated_baseline_items: this is a service-role-only read at
-- household creation + M3 completion. The supabase client used by the
-- API server holds the service role and bypasses RLS; no authenticated
-- role ever reads this table.
--
-- The "broad safe seed" invariant (see seed file): every row in
-- curated_baseline_items MUST have allergen_flags = '{}' and MUST NOT
-- contain any pork-derived dietary flag. Stage 0 fires at household
-- creation BEFORE allergens are declared, so seeds must be safe for an
-- unknown household. The CuratedBaselineMaterializationService also
-- runs each candidate through AllergyGuardrailService.evaluate() as a
-- belt-and-suspenders check before INSERTing into recipes /
-- household_recipe_usage.
--
-- Rollback:
--   ALTER TABLE households DROP COLUMN stage0_materialized_at;
--   DROP TABLE IF EXISTS curated_baseline_items;

-- ---------------------------------------------------------------------------
-- 1. curated_baseline_items
-- ---------------------------------------------------------------------------

CREATE TABLE curated_baseline_items (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  canonical_name    text        NOT NULL,
  allergen_flags    text[]      NOT NULL DEFAULT '{}',
  dietary_flags     text[]      NOT NULL DEFAULT '{}',
  cultural_tags     text[]      NOT NULL DEFAULT '{}',
  cuisine_tags      text[]      NOT NULL DEFAULT '{}',
  applicable_slots  text[]      NOT NULL DEFAULT ARRAY['main']::text[],
  notes             text,
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Authoring uniqueness — prevents accidental duplicate INSERTs on
  -- repeated migration runs and gives the seed block its idempotent
  -- ON CONFLICT (canonical_name) DO NOTHING target.
  CONSTRAINT curated_baseline_items_canonical_name_uniq UNIQUE (canonical_name)
);

-- Stage 0 materialization filters on (is_active = true) and either no cuisine
-- filter (initial) or cuisine_tags && :cuisineTags (M3 re-seed). The cuisine
-- GIN supports the && overlap operator.
CREATE INDEX curated_baseline_items_active_idx
  ON curated_baseline_items (is_active)
  WHERE is_active = true;

CREATE INDEX curated_baseline_items_cuisine_tags_gin_idx
  ON curated_baseline_items USING gin (cuisine_tags);

COMMENT ON TABLE curated_baseline_items IS
  'Global reference table for Stage 0 catalog materialization (slice 2.6-s2). '
  'Hand-tagged ~50 items spanning major cuisine x dietary x allergen-free '
  'intersections. NOT per-household — no created_by_household_id, no FK to '
  'households. Read only via service-role at materialization time '
  '(CuratedBaselineMaterializationService.materialize / .rematerialize); no '
  'RLS policies are defined because no authenticated role ever queries it.';

COMMENT ON COLUMN curated_baseline_items.allergen_flags IS
  'MUST be empty for the broad-safe-seed invariant — Stage 0 fires before '
  'household allergens are declared. Future authoring discipline; the '
  'materialization service also runs AllergyGuardrailService on each item.';

COMMENT ON COLUMN curated_baseline_items.notes IS
  'Authoring hint only — NEVER exposed to frontend or to LLM prompts. '
  'Used by curators to remember why a tag set was chosen.';

-- ---------------------------------------------------------------------------
-- 2. households.stage0_materialized_at
-- ---------------------------------------------------------------------------
-- NULL = initial Stage 0 materialization has not yet completed for this
-- household. Set to now() by CuratedBaselineMaterializationService.materialize
-- on success. M3 re-materialization (.rematerialize) does NOT check or
-- update this column — re-seeding is always allowed and relies on row-level
-- ON CONFLICT DO NOTHING for idempotency.

ALTER TABLE households
  ADD COLUMN stage0_materialized_at timestamptz;

COMMENT ON COLUMN households.stage0_materialized_at IS
  'Slice 2.6-s2 — timestamp of initial Stage 0 catalog materialization. '
  'NULL = not yet materialized; set to now() by '
  'CuratedBaselineMaterializationService.materialize() after the first '
  'pass succeeds. M3 re-materialization does not consult this column.';

-- ---------------------------------------------------------------------------
-- 3. Seed INSERT — mirrors apps/api/src/seeds/curated-baseline.ts exactly
-- ---------------------------------------------------------------------------
-- Idempotent: ON CONFLICT (canonical_name) DO NOTHING — re-running this
-- migration on a partially-seeded database is a no-op for rows already
-- present (allows editing the seed file + replaying without losing data
-- nor duplicating). When EDITING THIS SEED, prefer:
--   - Adding new rows (append with the same DO NOTHING guard)
--   - Toggling is_active = false on rows you want retired (via a follow-up
--     migration; do NOT delete here — referential history matters even
--     though there's no FK from recipes back to this table)

INSERT INTO curated_baseline_items
  (canonical_name, allergen_flags, dietary_flags, cultural_tags, cuisine_tags, applicable_slots, notes)
VALUES
  -- ---- Anglo (10) ------------------------------------------------------
  ('Grilled chicken with rice',            ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['north_american']::text[],                                  ARRAY['main']::text[], 'anglo — protein + grain staple'),
  ('Roast turkey lunch box',               ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['north_american','british']::text[],                        ARRAY['main']::text[], 'anglo — cold-protein lunch box'),
  ('Beef sweet potato bowl',               ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['north_american']::text[],                                  ARRAY['main']::text[], 'anglo — grain-free protein bowl'),
  ('Quinoa veggie bowl',                   ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['north_american','new_american']::text[],                   ARRAY['main']::text[], 'anglo — vegan grain bowl'),
  ('Rice with black beans',                ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['north_american']::text[],                                  ARRAY['main']::text[], 'anglo — protein-complete vegan plate'),
  ('Apple grape lunch pack',               ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['north_american']::text[],                                  ARRAY['main']::text[], 'anglo — fruit-forward lunch (light main)'),
  ('Carrot stick veggie box',              ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['north_american']::text[],                                  ARRAY['main']::text[], 'anglo — raw-veg lunch box'),
  ('Banana oat snack box',                 ARRAY[]::text[], ARRAY['vegetarian']::text[],           ARRAY[]::text[],            ARRAY['british','north_american']::text[],                        ARRAY['main']::text[], 'anglo — oat-fruit lunch (school-safe)'),
  ('Mini chicken rice cups',               ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['north_american']::text[],                                  ARRAY['main']::text[], 'anglo — portioned chicken-rice'),
  ('Sweet potato veggie box',              ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['north_american']::text[],                                  ARRAY['main']::text[], 'anglo — roasted veg lunch'),

  -- ---- South Asian (10) -----------------------------------------------
  ('Dal chawal thermos',                   ARRAY[]::text[], ARRAY['vegetarian']::text[],           ARRAY['south_asian']::text[], ARRAY['south_asian','north_indian']::text[],                    ARRAY['main']::text[], 'south_asian — lentil + rice staple'),
  ('Khichdi thermos',                      ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY['south_asian']::text[], ARRAY['south_asian']::text[],                                   ARRAY['main']::text[], 'south_asian — one-pot lentil-rice'),
  ('Aloo gobi rice plate',                 ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY['south_asian']::text[], ARRAY['south_asian','north_indian']::text[],                    ARRAY['main']::text[], 'south_asian — potato-cauliflower curry plate'),
  ('Chana masala bowl',                    ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY['south_asian']::text[], ARRAY['south_asian','north_indian']::text[],                    ARRAY['main']::text[], 'south_asian — chickpea protein bowl'),
  ('Lemon rice lunch',                     ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY['south_asian']::text[], ARRAY['south_asian','south_indian']::text[],                    ARRAY['main']::text[], 'south_asian — tempered south indian rice'),
  ('Tomato rice tiffin',                   ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY['south_asian']::text[], ARRAY['south_asian','south_indian']::text[],                    ARRAY['main']::text[], 'south_asian — tomato-tempered rice'),
  ('Sambar rice plate',                    ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY['south_asian']::text[], ARRAY['south_asian','south_indian']::text[],                    ARRAY['main']::text[], 'south_asian — tamarind-lentil stew with rice'),
  ('Tandoori chicken rice plate',          ARRAY[]::text[], ARRAY['halal']::text[],                ARRAY['south_asian','halal']::text[], ARRAY['south_asian','north_indian','pakistani']::text[],  ARRAY['main']::text[], 'south_asian — clay-oven chicken with rice'),
  ('Vegetable rice tiffin',                ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY['south_asian']::text[], ARRAY['south_asian']::text[],                                   ARRAY['main']::text[], 'south_asian — mixed vegetable rice'),
  ('Spinach rice palak',                   ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY['south_asian']::text[], ARRAY['south_asian','north_indian']::text[],                    ARRAY['main']::text[], 'south_asian — palak (spinach) rice'),

  -- ---- East Asian (6) -------------------------------------------------
  ('Chicken fried rice',                   ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['east_asian','chinese']::text[],                            ARRAY['main']::text[], 'east_asian — wok-style chicken rice'),
  ('Veggie fried rice',                    ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['east_asian','chinese']::text[],                            ARRAY['main']::text[], 'east_asian — vegan wok rice'),
  ('Plain congee with chicken',            ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['east_asian','chinese']::text[],                            ARRAY['main']::text[], 'east_asian — porridge-style rice with chicken'),
  ('Korean rice bowl',                     ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['east_asian','korean']::text[],                             ARRAY['main']::text[], 'east_asian — bibimbap-style rice bowl (no gochujang assumed)'),
  ('Steamed rice wrap dumplings',          ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['east_asian','chinese']::text[],                            ARRAY['main']::text[], 'east_asian — rice-paper dumplings (gluten-free wrapper assumed)'),
  ('Asian veggie rice bowl',               ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['east_asian']::text[],                                      ARRAY['main']::text[], 'east_asian — generic vegan asian rice bowl'),

  -- ---- Middle Eastern (6) ---------------------------------------------
  ('Lemon herb chicken with rice',         ARRAY[]::text[], ARRAY['halal']::text[],                ARRAY['halal']::text[],     ARRAY['middle_eastern','lebanese']::text[],                       ARRAY['main']::text[], 'middle_eastern — herb-marinated chicken'),
  ('Chickpea rice plate',                  ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['middle_eastern','levantine']::text[],                      ARRAY['main']::text[], 'middle_eastern — chickpea protein plate'),
  ('Persian saffron chicken rice',         ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['middle_eastern','persian']::text[],                        ARRAY['main']::text[], 'middle_eastern — saffron-scented chicken rice'),
  ('Lentil rice mujadara',                 ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['middle_eastern','levantine','lebanese']::text[],           ARRAY['main']::text[], 'middle_eastern — caramelized-onion lentil-rice'),
  ('Roasted veggie rice plate',            ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['middle_eastern']::text[],                                  ARRAY['main']::text[], 'middle_eastern — roasted vegetable plate'),
  ('Grilled chicken kebab with rice',      ARRAY[]::text[], ARRAY['halal']::text[],                ARRAY['halal']::text[],     ARRAY['middle_eastern','turkish']::text[],                        ARRAY['main']::text[], 'middle_eastern — skewered grilled chicken'),

  -- ---- Latin American (5) ---------------------------------------------
  ('Mexican citrus chicken rice',          ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['latin_american','mexican']::text[],                        ARRAY['main']::text[], 'latin_american — citrus-grilled chicken plate (avoid "pollo" token; matches "pollock" synonym)'),
  ('Veggie burrito rice bowl',             ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['latin_american','mexican']::text[],                        ARRAY['main']::text[], 'latin_american — deconstructed burrito over rice'),
  ('Cuban black beans rice',               ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['latin_american','caribbean','cuban']::text[],              ARRAY['main']::text[], 'latin_american — moros y cristianos staple (use plural "beans"; "bean" token matches "soybean" synonym)'),
  ('Caribbean chicken rice',               ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['latin_american','caribbean','puerto_rican']::text[],       ARRAY['main']::text[], 'latin_american — arroz con pollo style (avoid "pollo" token; matches "pollock" synonym)'),
  ('Plantain rice plate',                  ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['latin_american','caribbean']::text[],                      ARRAY['main']::text[], 'latin_american — sweet plantain side'),

  -- ---- African (5) ----------------------------------------------------
  ('Jollof rice with chicken',             ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['african','west_african','nigerian']::text[],               ARRAY['main']::text[], 'african — west african tomato rice with chicken'),
  ('Doro wat rice plate',                  ARRAY[]::text[], ARRAY[]::text[],                       ARRAY['east_african']::text[], ARRAY['african','east_african','ethiopian']::text[],            ARRAY['main']::text[], 'african — berbere-spiced chicken stew'),
  ('Senegalese chicken rice',              ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['african','west_african','senegalese']::text[],             ARRAY['main']::text[], 'african — thieboudienne-style (chicken substitution)'),
  ('Veggie pilau rice',                    ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY['east_african']::text[], ARRAY['african','east_african','kenyan']::text[],               ARRAY['main']::text[], 'african — spiced east african rice'),
  ('Somali chicken rice',                  ARRAY[]::text[], ARRAY['halal']::text[],                ARRAY['east_african','halal']::text[], ARRAY['african','east_african','somali']::text[],         ARRAY['main']::text[], 'african — somali bariis-style chicken rice'),

  -- ---- Mediterranean (5) ----------------------------------------------
  ('Mediterranean chicken rice bowl',      ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['mediterranean']::text[],                                   ARRAY['main']::text[], 'mediterranean — herb-and-olive-oil chicken bowl'),
  ('Greek chicken rice',                   ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['mediterranean','greek']::text[],                           ARRAY['main']::text[], 'mediterranean — lemon-oregano chicken'),
  ('Italian veggie rice',                  ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['mediterranean','italian']::text[],                         ARRAY['main']::text[], 'mediterranean — italian-style veggie risotto (gluten-free)'),
  ('Spanish saffron chicken rice',         ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['mediterranean','spanish']::text[],                         ARRAY['main']::text[], 'mediterranean — paella-style chicken (no seafood)'),
  ('Mediterranean veggie rice plate',      ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['mediterranean']::text[],                                   ARRAY['main']::text[], 'mediterranean — roasted vegetable plate'),

  -- ---- Global (3) — multi-cuisine cross-cultural ----------------------
  ('Mixed grain veggie bowl',              ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['north_american','mediterranean']::text[],                  ARRAY['main']::text[], 'global — cross-cultural vegan grain bowl'),
  ('Family-style chicken rice bowl',       ARRAY[]::text[], ARRAY[]::text[],                       ARRAY[]::text[],            ARRAY['north_american','south_asian']::text[],                    ARRAY['main']::text[], 'global — fusion family lunch'),
  ('Rainbow veggie rice plate',            ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[],   ARRAY[]::text[],            ARRAY['north_american','mediterranean','south_asian']::text[],    ARRAY['main']::text[], 'global — multi-color veggie plate (broad appeal)')

ON CONFLICT (canonical_name) DO NOTHING;
