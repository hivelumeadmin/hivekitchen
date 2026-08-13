-- Re-seed curated_baseline_items: break the rice monoculture in the Stage 0
-- catalog safety net.
--
-- PROBLEM. 39 of the original 50 baseline items were rice-based (78%). Because
-- Stage 0 seeds every household at creation and the ~20 M5 chips are drawn from
-- the merged catalog, a parent's first view of "what could go in the bag" read
-- as fifteen versions of the same lunch: "Greek chicken rice", "Caribbean
-- chicken rice", "Somali chicken rice", "Spanish saffron chicken rice", and so
-- on — the exact near-duplicate pattern (same protein + same starch, different
-- cuisine adjective) that catalog-seed.prompt.ts has always forbidden.
--
-- WHY IT HAPPENED. The ≤4-rice hard cap lives only in the Stage 1 LLM prompt.
-- Stage 0 is hand-curated and was never updated to match — curated-baseline.ts
-- had exactly one commit in its history, its original authoring. Measured on a
-- live seeded household: 43 of 97 recipes were rice, of which Stage 1
-- contributed exactly 4 (its cap, honoured precisely) and Stage 0 the other 39.
-- The LLM was never the problem.
--
-- The skew was structural, not careless. The broad-safe invariant requires
-- allergen_flags = '{}', which bans wheat — so bread, pasta, noodles and wraps
-- are unavailable, and the first pass leaned on rice as the only obvious safe
-- starch. It is not the only one: potato, sweet potato, corn, masa, polenta,
-- quinoa, millet, teff, oat, plantain, cassava, taro and legume-forward bowls
-- are all FALCPA-clear.
--
-- CHANGE. Full replace of the 50 rows, rice capped at 8 (16%), proteins varied
-- alongside starches so the roster does not simply trade a rice monoculture for
-- a potato one. Verified mechanically against every authoring rule in
-- curated-baseline.ts: 50 items, allergen_flags empty throughout, no FALCPA
-- synonym substring in any canonical_name, no literal "and", applicable_slots
-- always ['main'], no protein+starch combination appearing more than twice, and
-- every AC3 cuisine minimum met (anglo 11/8, south_asian 11/8, east_asian 7/6,
-- middle_eastern 6/6, latin_american 6/5, african 6/5, mediterranean 7/5,
-- global 3/3).
--
-- SAFE TO REPLACE. No table carries a foreign key to curated_baseline_items
-- (grep-verified across supabase/migrations). Materialization COPIES rows into
-- `recipes`, so nothing references these ids and a DELETE cannot orphan a
-- household's catalog.
--
-- ALREADY-SEEDED HOUSEHOLDS ARE NOT REWRITTEN. Their `recipes` rows were
-- materialized from the old baseline and stay as they are; this migration fixes
-- what every FUTURE household receives. `pnpm db:reset` deliberately PRESERVES
-- curated_baseline_items, so a reset alone would never have picked this up —
-- that is precisely why the fix has to ship as a migration.
--
-- Mirrors apps/api/src/seeds/curated-baseline.ts one-to-one (the TS array is
-- the source of truth for git history; these rows were generated from it, not
-- hand-transcribed). The original insert in
-- 20260909000000_2_6_s2_curated_baseline_items.sql is already applied and is
-- deliberately left untouched.

DELETE FROM curated_baseline_items;

INSERT INTO curated_baseline_items
  (canonical_name, allergen_flags, dietary_flags, cultural_tags, cuisine_tags, applicable_slots, notes)
VALUES
  ('Roast turkey lunch box',                ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY[]::text[],                          ARRAY['north_american','british']::text[],                      ARRAY['main']::text[], 'anglo — cold-protein lunch box'),
  ('Beef sweet potato bowl',                ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY[]::text[],                          ARRAY['north_american']::text[],                                ARRAY['main']::text[], 'anglo — protein + root vegetable'),
  ('Quinoa veggie bowl',                    ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['north_american','new_american']::text[],                 ARRAY['main']::text[], 'anglo — quinoa grain bowl'),
  ('Sweet potato veggie box',               ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['north_american']::text[],                                ARRAY['main']::text[], 'anglo — roasted root vegetable box'),
  ('Herb roasted potato chicken box',       ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY[]::text[],                          ARRAY['north_american']::text[],                                ARRAY['main']::text[], 'anglo — potato format, replaces a chicken-rice near-duplicate'),
  ('Corn succotash bean plate',             ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['new_american','north_american']::text[],                 ARRAY['main']::text[], 'anglo — corn + bean format'),
  ('Turkey lettuce cup box',                ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY[]::text[],                          ARRAY['north_american']::text[],                                ARRAY['main']::text[], 'anglo — no-grain hand-held format'),
  ('Oat berry morning box',                 ARRAY[]::text[],  ARRAY['vegetarian']::text[],                    ARRAY[]::text[],                          ARRAY['british','north_american']::text[],                      ARRAY['main']::text[], 'anglo — oat format, breakfast-for-lunch'),
  ('Khichdi thermos',                       ARRAY[]::text[],  ARRAY['vegetarian']::text[],                    ARRAY['south_asian']::text[],             ARRAY['south_asian']::text[],                                   ARRAY['main']::text[], 'south asian — RICE 1/8, iconic comfort one-pot'),
  ('Lemon rice lunch',                      ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY['south_asian']::text[],             ARRAY['south_asian','south_indian']::text[],                    ARRAY['main']::text[], 'south asian — RICE 2/8, iconic tiffin'),
  ('Chana masala bowl',                     ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY['south_asian']::text[],             ARRAY['south_asian','north_indian']::text[],                    ARRAY['main']::text[], 'south asian — chickpea legume bowl'),
  ('Aloo gobi potato plate',                ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY['south_asian']::text[],             ARRAY['south_asian','north_indian']::text[],                    ARRAY['main']::text[], 'south asian — potato format (was a rice plate)'),
  ('Rajma bean bowl',                       ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY['south_asian']::text[],             ARRAY['south_asian','north_indian']::text[],                    ARRAY['main']::text[], 'south asian — kidney bean legume bowl'),
  ('Millet upma tiffin',                    ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY['south_asian']::text[],             ARRAY['south_asian','south_indian']::text[],                    ARRAY['main']::text[], 'south asian — millet format (was a rice tiffin)'),
  ('Chickpea chaat box',                    ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY['south_asian']::text[],             ARRAY['south_asian']::text[],                                   ARRAY['main']::text[], 'south asian — cold legume format'),
  ('Tandoori chicken skewer plate',         ARRAY[]::text[],  ARRAY['halal']::text[],                         ARRAY['south_asian','halal']::text[],     ARRAY['south_asian','north_indian','pakistani']::text[],        ARRAY['main']::text[], 'south asian — potato format (was a rice plate)'),
  ('Palak lentil bowl',                     ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY['south_asian']::text[],             ARRAY['south_asian','north_indian']::text[],                    ARRAY['main']::text[], 'south asian — spinach + lentil (was spinach rice)'),
  ('Chicken fried rice',                    ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY[]::text[],                          ARRAY['east_asian','chinese']::text[],                          ARRAY['main']::text[], 'east asian — RICE 3/8, the canonical fried-rice entry'),
  ('Korean rice bowl',                      ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY[]::text[],                          ARRAY['east_asian','korean']::text[],                           ARRAY['main']::text[], 'east asian — RICE 4/8, bibimbap-style bowl'),
  ('Sweet corn veggie soup thermos',        ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['east_asian','chinese']::text[],                          ARRAY['main']::text[], 'east asian — soup format, no grain base'),
  ('Millet congee with chicken',            ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY[]::text[],                          ARRAY['east_asian','chinese']::text[],                          ARRAY['main']::text[], 'east asian — millet congee (was a rice congee)'),
  ('Korean potato veggie box',              ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['east_asian','korean']::text[],                           ARRAY['main']::text[], 'east asian — braised potato banchan format'),
  ('Taro veggie steam box',                 ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['east_asian','chinese']::text[],                          ARRAY['main']::text[], 'east asian — taro root format'),
  ('Asian greens chicken bowl',             ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY[]::text[],                          ARRAY['east_asian']::text[],                                    ARRAY['main']::text[], 'east asian — vegetable-forward, no grain base'),
  ('Lentil rice mujadara',                  ARRAY[]::text[],  ARRAY['vegetarian','vegan','halal']::text[],    ARRAY['halal']::text[],                   ARRAY['middle_eastern','levantine','lebanese']::text[],         ARRAY['main']::text[], 'middle eastern — RICE 5/8, iconic lentil-rice dish'),
  ('Chickpea potato plate',                 ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['middle_eastern','levantine']::text[],                    ARRAY['main']::text[], 'middle eastern — legume + potato (was a rice plate)'),
  ('Persian saffron lamb plate',            ARRAY[]::text[],  ARRAY['halal']::text[],                         ARRAY['halal']::text[],                   ARRAY['middle_eastern','persian']::text[],                      ARRAY['main']::text[], 'middle eastern — tahdig-style potato (was a rice dish)'),
  ('Grilled chicken kebab veggie plate',    ARRAY[]::text[],  ARRAY['halal']::text[],                         ARRAY['halal']::text[],                   ARRAY['middle_eastern','turkish']::text[],                      ARRAY['main']::text[], 'middle eastern — grill + vegetable (was a rice plate)'),
  ('Roasted veggie lentil plate',           ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['middle_eastern']::text[],                                ARRAY['main']::text[], 'middle eastern — legume base (was a rice plate)'),
  ('Lemon herb bean plate',                 ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['middle_eastern','lebanese']::text[],                     ARRAY['main']::text[], 'middle eastern — potato format (was a rice dish)'),
  ('Cuban black beans rice',                ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['latin_american','caribbean','cuban']::text[],            ARRAY['main']::text[], 'latin — RICE 6/8, iconic beans-rice pairing'),
  ('Mexican citrus chicken corn plate',     ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY[]::text[],                          ARRAY['latin_american','mexican']::text[],                      ARRAY['main']::text[], 'latin — corn format (was a rice dish)'),
  ('Veggie corn masa bowl',                 ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['latin_american','mexican']::text[],                      ARRAY['main']::text[], 'latin — masa format (was a burrito rice bowl; burrito wraps are wheat)'),
  ('Plantain veggie plate',                 ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['latin_american','caribbean']::text[],                    ARRAY['main']::text[], 'latin — plantain starch (was a rice plate)'),
  ('Caribbean chicken cassava plate',       ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY[]::text[],                          ARRAY['latin_american','caribbean','puerto_rican']::text[],     ARRAY['main']::text[], 'latin — cassava starch (was a chicken-rice near-duplicate)'),
  ('Black bean arepa box',                  ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['latin_american']::text[],                                ARRAY['main']::text[], 'latin — corn arepa hand-held format'),
  ('Jollof rice with chicken',              ARRAY[]::text[],  ARRAY['halal']::text[],                         ARRAY['halal']::text[],                   ARRAY['african','west_african','nigerian']::text[],             ARRAY['main']::text[], 'african — RICE 7/8, the defining West African rice dish'),
  ('Doro wat lentil plate',                 ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY['east_african']::text[],            ARRAY['african','east_african','ethiopian']::text[],            ARRAY['main']::text[], 'african — lentil base (was a rice plate)'),
  ('Senegalese chicken millet plate',       ARRAY[]::text[],  ARRAY['halal']::text[],                         ARRAY['halal']::text[],                   ARRAY['african','west_african','senegalese']::text[],           ARRAY['main']::text[], 'african — millet format (was a chicken-rice near-duplicate)'),
  ('Kenyan veggie sukuma plate',            ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY['east_african']::text[],            ARRAY['african','east_african','kenyan']::text[],               ARRAY['main']::text[], 'african — greens-forward (was a pilau rice dish)'),
  ('Somali chicken potato plate',           ARRAY[]::text[],  ARRAY['halal']::text[],                         ARRAY['east_african','halal']::text[],    ARRAY['african','east_african','somali']::text[],               ARRAY['main']::text[], 'african — potato format (was a chicken-rice near-duplicate)'),
  ('Teff veggie plate',                     ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY['east_african']::text[],            ARRAY['african','east_african','ethiopian']::text[],            ARRAY['main']::text[], 'african — teff grain format'),
  ('Spanish saffron veggie rice',           ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['mediterranean','spanish']::text[],                       ARRAY['main']::text[], 'mediterranean — RICE 8/8, paella-style'),
  ('Greek olive chickpea plate',            ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['mediterranean','greek']::text[],                         ARRAY['main']::text[], 'mediterranean — lemon potato format (was a rice dish)'),
  ('Italian veggie polenta',                ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['mediterranean','italian']::text[],                       ARRAY['main']::text[], 'mediterranean — polenta corn format (was a rice dish)'),
  ('Mediterranean chickpea bowl',           ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['mediterranean']::text[],                                 ARRAY['main']::text[], 'mediterranean — legume bowl (was a chicken rice bowl)'),
  ('Mediterranean veggie lentil plate',     ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['mediterranean']::text[],                                 ARRAY['main']::text[], 'mediterranean — lentil base (was a rice plate)'),
  ('Mixed grain veggie bowl',               ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['north_american','mediterranean']::text[],                ARRAY['main']::text[], 'global — mixed-grain bowl (broad appeal)'),
  ('Family-style turkey grain bowl',        ARRAY[]::text[],  ARRAY[]::text[],                                ARRAY[]::text[],                          ARRAY['north_american','south_asian']::text[],                  ARRAY['main']::text[], 'global — fusion family lunch (was a rice bowl)'),
  ('Rainbow veggie quinoa plate',           ARRAY[]::text[],  ARRAY['vegetarian','vegan']::text[],            ARRAY[]::text[],                          ARRAY['north_american','mediterranean','south_asian']::text[],  ARRAY['main']::text[], 'global — multi-color veggie plate (was a rice plate)');
