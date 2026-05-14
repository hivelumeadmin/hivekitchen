-- Slice A0c — Vocabulary tables (controlled vocabularies for recipe + household tags)
--
-- Four parent vocabulary tables:
--   allergen_tags  — controlled vocabulary for allergen/sensitivity flags
--   dietary_tags   — controlled vocabulary for dietary patterns (religious, health, cuisine)
--   cultural_tags  — controlled vocabulary for cultural identifiers + templates
--   cuisine_tags   — controlled vocabulary for recipe cuisines (with hierarchy)
--
-- These tables hold the canonical vocabulary used as text[] values on:
--   recipes.allergen_flags, recipes.dietary_flags, recipes.cultural_tags,
--   recipes.cuisine_tags, children.declared_allergens, children.cultural_identifiers,
--   children.dietary_preferences, etc.
--
-- Validation pattern: text[] columns are NOT FK-constrained (Postgres can't
-- FK array elements). Service-layer code (RecipesService, ChildrenService, …)
-- queries these tables on insert/update to validate each tag value exists
-- with is_active = true. Strict validation lives at the service boundary,
-- not the DB schema.
--
-- The agent's system prompt is augmented with the current is_active
-- vocabulary at session start, so newly-added tags via SQL INSERT are
-- immediately available to the planner without a deploy.
--
-- Pattern B (lookup tables + denormalized arrays + service validation) was
-- chosen over full normalization (per-tag join tables) because:
--   - Reads are hot (planner pulls 5–10 recipes per plan); joins hurt
--   - Tag relationships carry no per-(recipe, tag) metadata expected
--   - GIN indexes on text[] arrays are sub-millisecond for @>/&&/<@
--
-- Rollback:
--   DROP TABLE IF EXISTS cuisine_tags  CASCADE;
--   DROP TABLE IF EXISTS cultural_tags CASCADE;
--   DROP TABLE IF EXISTS dietary_tags  CASCADE;
--   DROP TABLE IF EXISTS allergen_tags CASCADE;

-- Reuses the shared set_updated_at() trigger function from earlier migrations
-- (CREATE OR REPLACE so this migration is independently runnable).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 1. allergen_tags
-- ============================================================================
-- rule_class drives default safety treatment:
--   'falcpa'      — US legally-mandated; allergy guardrail BLOCKS on match
--   'extended'    — Non-FALCPA real allergy (EU-mandated, regional); BLOCKS by default
--   'sensitivity' — Preference/intolerance (gluten as non-celiac, MSG, dyes); WARN by default
-- A household's actual policy is set by allergy_rules.rule_type — these
-- defaults are fallbacks when no household-specific rule exists.

CREATE TABLE allergen_tags (
  key                 text        NOT NULL PRIMARY KEY,
  display_name        text        NOT NULL,
  rule_class          text        NOT NULL
                      CHECK (rule_class IN ('falcpa','extended','sensitivity')),
  legal_jurisdiction  text[]      NOT NULL DEFAULT '{}',
  severity_default    text        NOT NULL DEFAULT 'block'
                      CHECK (severity_default IN ('block','warn')),
  alias_keys          text[]      NOT NULL DEFAULT '{}',
  display_icon        text,
  description         text,
  is_active           boolean     NOT NULL DEFAULT true,
  sort_order          int         NOT NULL DEFAULT 100,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX allergen_tags_active_idx ON allergen_tags (is_active, sort_order) WHERE is_active;

CREATE TRIGGER allergen_tags_set_updated_at
  BEFORE UPDATE ON allergen_tags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE allergen_tags IS
  'Controlled vocabulary for recipes.allergen_flags / allergy_rules.allergen / '
  'children.declared_allergens. Service-layer validates writes against rows '
  'where is_active = true. Adding a new allergen is a one-row INSERT.';

-- ============================================================================
-- 2. dietary_tags
-- ============================================================================
-- implies graph drives auto-fan-out at the service layer: tagging a recipe
-- as 'vegan' auto-adds 'vegetarian', 'dairy_free', 'egg_free' (transitively).
-- The agent emits the narrowest tag; the service expands the implication
-- closure on insert. Saves prompt tokens and prevents tag-set drift.
--
-- conflicts_with detects accidental incoherence (e.g. 'vegan' + 'pescatarian').

CREATE TABLE dietary_tags (
  key             text        NOT NULL PRIMARY KEY,
  display_name    text        NOT NULL,
  category        text        NOT NULL
                  CHECK (category IN ('religious','plant_based','health','cuisine','allergen_derived')),
  implies         text[]      NOT NULL DEFAULT '{}',
  conflicts_with  text[]      NOT NULL DEFAULT '{}',
  description     text,
  is_active       boolean     NOT NULL DEFAULT true,
  sort_order      int         NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dietary_tags_active_idx ON dietary_tags (is_active, sort_order) WHERE is_active;

CREATE TRIGGER dietary_tags_set_updated_at
  BEFORE UPDATE ON dietary_tags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE dietary_tags IS
  'Controlled vocabulary for recipes.dietary_flags / children.dietary_preferences. '
  'Service-layer validates writes against rows where is_active = true and '
  'expands implies-closure (e.g. ''vegan'' auto-adds ''vegetarian'', ''dairy_free'', ''egg_free'').';

-- ============================================================================
-- 3. cultural_tags
-- ============================================================================
-- is_template = true identifies the subset that HiveKitchen has dedicated
-- prompt logic + observance calendars for (currently halal, kosher,
-- hindu_vegetarian, south_asian, east_african, caribbean — replaces the
-- CHECK constraint on cultural_priors.key in a future retrofit migration).
--
-- parent_key allows grouping queries: "all tags rooted at 'asian'"

CREATE TABLE cultural_tags (
  key                 text        NOT NULL PRIMARY KEY,
  display_name        text        NOT NULL,
  parent_key          text        REFERENCES cultural_tags(key) ON DELETE SET NULL,
  is_template         boolean     NOT NULL DEFAULT false,
  observance_calendar text,
  description         text,
  is_active           boolean     NOT NULL DEFAULT true,
  sort_order          int         NOT NULL DEFAULT 100,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cultural_tags_parent_idx ON cultural_tags (parent_key) WHERE parent_key IS NOT NULL;
CREATE INDEX cultural_tags_active_idx ON cultural_tags (is_active, sort_order) WHERE is_active;
CREATE INDEX cultural_tags_template_idx ON cultural_tags (is_template) WHERE is_template;

CREATE TRIGGER cultural_tags_set_updated_at
  BEFORE UPDATE ON cultural_tags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE cultural_tags IS
  'Controlled vocabulary for recipes.cultural_tags / cultural_priors.key / '
  'children.cultural_identifiers / cultural_calendar_observances.cultural_template. '
  'is_template = true marks the subset HiveKitchen has dedicated planner '
  'prompt logic + calendars for. Existing CHECK constraints on cultural_priors '
  'and cultural_calendar_observances retrofit to FKs in a follow-up migration.';

-- ============================================================================
-- 4. cuisine_tags  (hierarchical: region → sub-region → specific cuisine)
-- ============================================================================

CREATE TABLE cuisine_tags (
  key                 text        NOT NULL PRIMARY KEY,
  display_name        text        NOT NULL,
  parent_key          text        REFERENCES cuisine_tags(key) ON DELETE SET NULL,
  region              text,        -- 'asia','europe','africa','americas','oceania'
  description         text,
  is_active           boolean     NOT NULL DEFAULT true,
  sort_order          int         NOT NULL DEFAULT 100,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cuisine_tags_parent_idx ON cuisine_tags (parent_key) WHERE parent_key IS NOT NULL;
CREATE INDEX cuisine_tags_active_idx ON cuisine_tags (is_active, sort_order) WHERE is_active;
CREATE INDEX cuisine_tags_region_idx ON cuisine_tags (region) WHERE region IS NOT NULL;

CREATE TRIGGER cuisine_tags_set_updated_at
  BEFORE UPDATE ON cuisine_tags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE cuisine_tags IS
  'Controlled vocabulary for recipes.cuisine_tags (food style of a recipe — '
  'distinct from cultural_tags which describes household identity). '
  'Hierarchical via parent_key: region → sub-region → specific cuisine. '
  'Service-layer auto-fans-out parents on insert (recipe tagged ''north_indian'' '
  'auto-gets ''south_asian'' and ''asian'' added too).';

-- ============================================================================
-- 5. RLS
-- ============================================================================
-- Vocabulary tables are READ by authenticated users (e.g. UI listing
-- available dietary preferences when adding a child profile, agent's system
-- prompt loads vocabulary). WRITES are service-role only (curated by ops /
-- migration scripts).

ALTER TABLE allergen_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE dietary_tags  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cultural_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuisine_tags  ENABLE ROW LEVEL SECURITY;

-- Authenticated: SELECT all rows (active and inactive — UI may show
-- "deprecated" labels). No INSERT/UPDATE/DELETE.
CREATE POLICY allergen_tags_authenticated_select  ON allergen_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY allergen_tags_authenticated_no_ins  ON allergen_tags FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY allergen_tags_authenticated_no_upd  ON allergen_tags FOR UPDATE TO authenticated USING (false);
CREATE POLICY allergen_tags_authenticated_no_del  ON allergen_tags FOR DELETE TO authenticated USING (false);

CREATE POLICY dietary_tags_authenticated_select   ON dietary_tags  FOR SELECT TO authenticated USING (true);
CREATE POLICY dietary_tags_authenticated_no_ins   ON dietary_tags  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY dietary_tags_authenticated_no_upd   ON dietary_tags  FOR UPDATE TO authenticated USING (false);
CREATE POLICY dietary_tags_authenticated_no_del   ON dietary_tags  FOR DELETE TO authenticated USING (false);

CREATE POLICY cultural_tags_authenticated_select  ON cultural_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY cultural_tags_authenticated_no_ins  ON cultural_tags FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY cultural_tags_authenticated_no_upd  ON cultural_tags FOR UPDATE TO authenticated USING (false);
CREATE POLICY cultural_tags_authenticated_no_del  ON cultural_tags FOR DELETE TO authenticated USING (false);

CREATE POLICY cuisine_tags_authenticated_select   ON cuisine_tags  FOR SELECT TO authenticated USING (true);
CREATE POLICY cuisine_tags_authenticated_no_ins   ON cuisine_tags  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY cuisine_tags_authenticated_no_upd   ON cuisine_tags  FOR UPDATE TO authenticated USING (false);
CREATE POLICY cuisine_tags_authenticated_no_del   ON cuisine_tags  FOR DELETE TO authenticated USING (false);

-- ============================================================================
-- 6. Seed data — allergen_tags
-- ============================================================================
-- FALCPA top-9 (US, sesame added 2023): always block by default
INSERT INTO allergen_tags (key, display_name, rule_class, legal_jurisdiction, severity_default, alias_keys, sort_order) VALUES
  ('peanut',     'Peanut',         'falcpa', ARRAY['US','EU'], 'block', ARRAY['groundnut','arachis'], 10),
  ('tree_nut',   'Tree Nut',       'falcpa', ARRAY['US','EU'], 'block', ARRAY['treenut'], 20),
  ('dairy',      'Dairy',          'falcpa', ARRAY['US','EU'], 'block', ARRAY['milk','lactose'], 30),
  ('egg',        'Egg',            'falcpa', ARRAY['US','EU'], 'block', ARRAY['eggs'], 40),
  ('wheat',      'Wheat',          'falcpa', ARRAY['US','EU'], 'block', ARRAY[]::text[], 50),
  ('soy',        'Soy',            'falcpa', ARRAY['US','EU'], 'block', ARRAY['soya','soybean'], 60),
  ('fish',       'Fish',           'falcpa', ARRAY['US','EU'], 'block', ARRAY[]::text[], 70),
  ('shellfish',  'Shellfish',      'falcpa', ARRAY['US','EU'], 'block', ARRAY['crustacean','mollusc'], 80),
  ('sesame',     'Sesame',         'falcpa', ARRAY['US','EU'], 'block', ARRAY[]::text[], 90);

-- Extended allergens (non-FALCPA but real allergies — EU-mandated or regional)
INSERT INTO allergen_tags (key, display_name, rule_class, legal_jurisdiction, severity_default, alias_keys, sort_order) VALUES
  ('mustard',    'Mustard',        'extended', ARRAY['EU'], 'block', ARRAY[]::text[], 100),
  ('celery',     'Celery',         'extended', ARRAY['EU'], 'block', ARRAY[]::text[], 110),
  ('lupin',      'Lupin',          'extended', ARRAY['EU'], 'block', ARRAY['lupine'], 120),
  ('corn',       'Corn',           'extended', ARRAY[]::text[], 'block', ARRAY['maize'], 130);

-- Sensitivities (preferences/intolerances — warn by default, household policy decides)
INSERT INTO allergen_tags (key, display_name, rule_class, severity_default, alias_keys, sort_order) VALUES
  ('gluten',     'Gluten',         'sensitivity', 'warn', ARRAY[]::text[], 200),
  ('msg',        'MSG',            'sensitivity', 'warn', ARRAY['monosodium_glutamate'], 210),
  ('food_dye',   'Food Dye',       'sensitivity', 'warn', ARRAY['artificial_color'], 220),
  ('citrus',     'Citrus',         'sensitivity', 'warn', ARRAY[]::text[], 230),
  ('tomato',     'Tomato',         'sensitivity', 'warn', ARRAY['nightshade'], 240);

-- ============================================================================
-- 7. Seed data — dietary_tags
-- ============================================================================

-- Religious
INSERT INTO dietary_tags (key, display_name, category, implies, conflicts_with, sort_order) VALUES
  ('halal',              'Halal',              'religious',   ARRAY[]::text[], ARRAY[]::text[], 10),
  ('kosher',             'Kosher',             'religious',   ARRAY[]::text[], ARRAY[]::text[], 20),
  ('jain',               'Jain',               'religious',   ARRAY['vegetarian','dairy_free']::text[], ARRAY[]::text[], 30),
  ('hindu_vegetarian',   'Hindu Vegetarian',   'religious',   ARRAY['vegetarian']::text[], ARRAY[]::text[], 40),
  ('buddhist_vegetarian','Buddhist Vegetarian','religious',   ARRAY['vegetarian']::text[], ARRAY[]::text[], 50);

-- Plant-based variants
INSERT INTO dietary_tags (key, display_name, category, implies, conflicts_with, sort_order) VALUES
  ('vegetarian',         'Vegetarian',         'plant_based', ARRAY[]::text[], ARRAY['pescatarian']::text[], 100),
  ('lacto_vegetarian',   'Lacto-Vegetarian',   'plant_based', ARRAY['vegetarian','egg_free']::text[], ARRAY[]::text[], 110),
  ('ovo_vegetarian',     'Ovo-Vegetarian',     'plant_based', ARRAY['vegetarian','dairy_free']::text[], ARRAY[]::text[], 120),
  ('pescatarian',        'Pescatarian',        'plant_based', ARRAY[]::text[], ARRAY['vegetarian','vegan']::text[], 130),
  ('vegan',              'Vegan',              'plant_based', ARRAY['vegetarian','dairy_free','egg_free']::text[], ARRAY['pescatarian']::text[], 140);

-- Allergen-derived (cross-listed dietary patterns that map onto allergen avoidance)
INSERT INTO dietary_tags (key, display_name, category, implies, conflicts_with, sort_order) VALUES
  ('gluten_free',        'Gluten-Free',        'allergen_derived', ARRAY[]::text[], ARRAY[]::text[], 200),
  ('dairy_free',         'Dairy-Free',         'allergen_derived', ARRAY[]::text[], ARRAY[]::text[], 210),
  ('nut_free',           'Nut-Free',           'allergen_derived', ARRAY[]::text[], ARRAY[]::text[], 220),
  ('egg_free',           'Egg-Free',           'allergen_derived', ARRAY[]::text[], ARRAY[]::text[], 230),
  ('soy_free',           'Soy-Free',           'allergen_derived', ARRAY[]::text[], ARRAY[]::text[], 240);

-- Health / medical
INSERT INTO dietary_tags (key, display_name, category, implies, conflicts_with, sort_order) VALUES
  ('low_sodium',         'Low Sodium',         'health',      ARRAY[]::text[], ARRAY[]::text[], 300),
  ('low_fodmap',         'Low FODMAP',         'health',      ARRAY[]::text[], ARRAY[]::text[], 310),
  ('low_carb',           'Low Carb',           'health',      ARRAY[]::text[], ARRAY[]::text[], 320),
  ('keto',               'Keto',               'health',      ARRAY['low_carb']::text[], ARRAY[]::text[], 330),
  ('paleo',              'Paleo',              'health',      ARRAY['gluten_free','dairy_free']::text[], ARRAY[]::text[], 340),
  ('aip',                'AIP',                'health',      ARRAY['paleo']::text[], ARRAY[]::text[], 350);

-- Cuisine adherence (dietary pattern, not the same as the recipe's cuisine_tag)
INSERT INTO dietary_tags (key, display_name, category, implies, conflicts_with, sort_order) VALUES
  ('mediterranean',      'Mediterranean Diet', 'cuisine',     ARRAY[]::text[], ARRAY[]::text[], 400);

-- ============================================================================
-- 8. Seed data — cultural_tags
-- ============================================================================
-- Top-level groupings (no parent)
INSERT INTO cultural_tags (key, display_name, parent_key, is_template, sort_order) VALUES
  ('asian',              'Asian',              NULL, false, 10),
  ('european',           'European',           NULL, false, 20),
  ('middle_eastern',     'Middle Eastern',     NULL, false, 30),
  ('african',            'African',            NULL, false, 40),
  ('latin_american',     'Latin American',     NULL, false, 50),
  ('north_american',     'North American',     NULL, false, 60),
  ('oceanic',            'Oceanic',            NULL, false, 70);

-- Sub-region + active templates (is_template = true for the six HiveKitchen
-- has dedicated planner prompts + calendar data for — matches existing
-- CHECK constraint on cultural_priors.key, to be FK-retrofitted later).
INSERT INTO cultural_tags (key, display_name, parent_key, is_template, observance_calendar, sort_order) VALUES
  ('south_asian',        'South Asian',        'asian',          true,  'south_asian',        100),
  ('east_asian',         'East Asian',         'asian',          false, NULL,                  110),
  ('southeast_asian',    'Southeast Asian',    'asian',          false, NULL,                  120),
  ('hindu_vegetarian',   'Hindu Vegetarian',   'asian',          true,  'hindu_vegetarian',   130),
  ('mediterranean',      'Mediterranean',      'european',       false, NULL,                  140),
  ('east_african',       'East African',       'african',        true,  'east_african',       150),
  ('west_african',       'West African',       'african',        false, NULL,                  160),
  ('north_african',      'North African',      'african',        false, NULL,                  170),
  ('caribbean',          'Caribbean',          'latin_american', true,  'caribbean',          180),
  ('halal',              'Halal',              NULL,             true,  'halal',              190),  -- preparation rule, not regional
  ('kosher',             'Kosher',             NULL,             true,  'kosher',             200);  -- preparation rule, not regional

-- ============================================================================
-- 9. Seed data — cuisine_tags (hierarchical, 3 levels)
-- ============================================================================

-- Top-level regional roots
INSERT INTO cuisine_tags (key, display_name, parent_key, region, sort_order) VALUES
  ('asian',                  'Asian',                   NULL,                 'asia',     10),
  ('european',               'European',                NULL,                 'europe',   20),
  ('middle_eastern',         'Middle Eastern',          NULL,                 'asia',     30),
  ('african',                'African',                 NULL,                 'africa',   40),
  ('latin_american',         'Latin American',          NULL,                 'americas', 50),
  ('north_american',         'North American',          NULL,                 'americas', 60);

-- Sub-regions
INSERT INTO cuisine_tags (key, display_name, parent_key, region, sort_order) VALUES
  ('south_asian',            'South Asian',             'asian',              'asia',     100),
  ('east_asian',             'East Asian',              'asian',              'asia',     110),
  ('southeast_asian',        'Southeast Asian',         'asian',              'asia',     120),
  ('central_asian',          'Central Asian',           'asian',              'asia',     130),
  ('mediterranean',          'Mediterranean',           'european',           'europe',   140),
  ('northern_european',      'Northern European',       'european',           'europe',   150),
  ('eastern_european',       'Eastern European',        'european',           'europe',   160),
  ('north_african',          'North African',           'african',            'africa',   170),
  ('east_african',           'East African',            'african',            'africa',   180),
  ('west_african',           'West African',            'african',            'africa',   190),
  ('levantine',              'Levantine',               'middle_eastern',     'asia',     200),
  ('persian',                'Persian',                 'middle_eastern',     'asia',     210),
  ('caribbean',              'Caribbean',               'latin_american',     'americas', 220),
  ('south_american',         'South American',          'latin_american',     'americas', 230);

-- Specific cuisines (starter set; ops/community curates expansion)
INSERT INTO cuisine_tags (key, display_name, parent_key, region, sort_order) VALUES
  -- South Asian
  ('north_indian',           'North Indian',            'south_asian',        'asia',     300),
  ('south_indian',           'South Indian',            'south_asian',        'asia',     310),
  ('bengali',                'Bengali',                 'south_asian',        'asia',     320),
  ('pakistani',              'Pakistani',               'south_asian',        'asia',     330),
  ('sri_lankan',             'Sri Lankan',              'south_asian',        'asia',     340),
  ('nepali',                 'Nepali',                  'south_asian',        'asia',     350),
  -- East Asian
  ('chinese',                'Chinese',                 'east_asian',         'asia',     360),
  ('japanese',               'Japanese',                'east_asian',         'asia',     370),
  ('korean',                 'Korean',                  'east_asian',         'asia',     380),
  -- Southeast Asian
  ('thai',                   'Thai',                    'southeast_asian',    'asia',     390),
  ('vietnamese',             'Vietnamese',              'southeast_asian',    'asia',     400),
  ('filipino',               'Filipino',                'southeast_asian',    'asia',     410),
  ('indonesian',             'Indonesian',              'southeast_asian',    'asia',     420),
  ('malaysian',              'Malaysian',               'southeast_asian',    'asia',     430),
  -- Mediterranean
  ('italian',                'Italian',                 'mediterranean',      'europe',   440),
  ('greek',                  'Greek',                   'mediterranean',      'europe',   450),
  ('spanish',                'Spanish',                 'mediterranean',      'europe',   460),
  ('portuguese',             'Portuguese',              'mediterranean',      'europe',   470),
  -- European (other)
  ('french',                 'French',                  'european',           'europe',   480),
  ('british',                'British',                 'northern_european',  'europe',   490),
  ('german',                 'German',                  'northern_european',  'europe',   500),
  -- Levantine + Middle Eastern
  ('lebanese',               'Lebanese',                'levantine',          'asia',     510),
  ('israeli',                'Israeli',                 'levantine',          'asia',     520),
  ('syrian',                 'Syrian',                  'levantine',          'asia',     530),
  ('turkish',                'Turkish',                 'middle_eastern',     'asia',     540),
  -- North African
  ('moroccan',               'Moroccan',                'north_african',      'africa',   550),
  ('egyptian',               'Egyptian',                'north_african',      'africa',   560),
  ('tunisian',               'Tunisian',                'north_african',      'africa',   570),
  -- East / West African
  ('ethiopian',              'Ethiopian',               'east_african',       'africa',   580),
  ('kenyan',                 'Kenyan',                  'east_african',       'africa',   590),
  ('somali',                 'Somali',                  'east_african',       'africa',   600),
  ('nigerian',               'Nigerian',                'west_african',       'africa',   610),
  ('ghanaian',               'Ghanaian',                'west_african',       'africa',   620),
  ('senegalese',             'Senegalese',              'west_african',       'africa',   630),
  -- Latin American
  ('mexican',                'Mexican',                 'latin_american',     'americas', 640),
  ('jamaican',               'Jamaican',                'caribbean',          'americas', 650),
  ('cuban',                  'Cuban',                   'caribbean',          'americas', 660),
  ('puerto_rican',           'Puerto Rican',            'caribbean',          'americas', 670),
  ('trinidadian',            'Trinidadian',             'caribbean',          'americas', 680),
  ('peruvian',               'Peruvian',                'south_american',     'americas', 690),
  ('brazilian',              'Brazilian',               'south_american',     'americas', 700),
  ('argentine',              'Argentine',               'south_american',     'americas', 710),
  -- North American
  ('tex_mex',                'Tex-Mex',                 'north_american',     'americas', 720),
  ('soul_food',              'Soul Food',               'north_american',     'americas', 730),
  ('cajun',                  'Cajun',                   'north_american',     'americas', 740),
  ('new_american',           'New American',            'north_american',     'americas', 750);
