// Slice 2.6-s2 — global curated baseline items (Stage 0 catalog safety net).
//
// AUTHORING RULES (broad-safe seed invariant per AC3):
//   1. allergen_flags MUST be empty — every Stage 0 household receives these
//      before allergens are declared, so items must be safe for an unknown
//      household. Items containing any FALCPA_TOP_9 allergen
//      (peanut, tree_nut, dairy, egg, wheat, soy, fish, shellfish, sesame)
//      or pork are omitted from this list entirely.
//   2. canonical_name MUST NOT contain a FALCPA synonym substring. The
//      AllergyGuardrailService is invoked at materialization time as a
//      belt-and-suspenders check; substring matching against
//      FALCPA_SYNONYMS (see allergy-rules.engine.ts) will block any item
//      whose name token overlaps a synonym (e.g. 'milk', 'bread', 'noodle',
//      'tuna', 'crab', 'tahini', 'mayo', 'pasta', 'cracker', 'curd',
//      'paneer', 'ghee').
//      NOTE the substring rule bans some otherwise-safe grains: "buckwheat"
//      contains 'wheat' and "couscous" is itself a wheat synonym. Use millet,
//      teff, sorghum, quinoa, oat, polenta or masa instead.
//   3. Avoid the literal word "and" in canonical_name — the engine's token
//      reverse-check matches 'and' against the dairy synonym 'half-and-half'
//      and would block the item. Use commas, "with", or compound noun forms.
//   4. cuisine_tags MUST be valid keys from the cuisine_tags vocabulary
//      table (20260820000100_create_vocabulary_tables.sql). cultural_tags
//      MUST be valid keys from cultural_tags. dietary_flags from
//      dietary_tags. Validation is enforced at materialization time only
//      indirectly (these tags flow through to recipes.* columns whose
//      service-layer validation runs on the M5 path; for Stage 0 we trust
//      the curator's hand-tagging here).
//   5. applicable_slots is always ['main'] for Stage 0 — snack/extra slots
//      are SKU-driven (story 3.20), not recipe-driven.
//   6. STARCH DIVERSITY — rice-based items are capped at 8 of 50. This mirrors
//      the ≤4-of-50 hard cap the Stage 1 LLM prompt has always enforced
//      (catalog-seed.prompt.ts), which this file was never updated to match.
//      The original roster ran 39/50 rice: rule 1 bans wheat, so bread, pasta,
//      noodles and wraps are unavailable, and the first pass leaned on rice as
//      the only obvious safe starch. It is not the only one — potato, sweet
//      potato, corn, polenta, masa, quinoa, millet, teff, oat, plantain,
//      cassava, taro and legume-forward bowls are all FALCPA-clear.
//      ALSO NO NEAR-DUPLICATES: two items sharing a protein AND a starch are
//      one dish wearing two cuisine adjectives. "Greek chicken rice" plus
//      "Caribbean chicken rice" is the exact pattern that made a parent's
//      chip list read as fifteen versions of the same lunch. Vary the format,
//      not the adjective.
//
// This array is the TypeScript source of truth for git history. The
// companion migration 20260909000000_2_6_s2_curated_baseline_items.sql
// contains an INSERT block matching this content one-to-one. When editing
// this file, regenerate / hand-update the migration to match. Do NOT
// import this module at runtime — the DB is the authoritative source once
// the migration has run. Re-seeds ship as NEW migrations; the original is
// already applied and must not be edited in place.
//
// Cuisine coverage minimums (AC3):
//   anglo            ≥ 8   (north_american / british / new_american)
//   south_asian      ≥ 8
//   east_asian       ≥ 6
//   middle_eastern   ≥ 6
//   latin_american   ≥ 5
//   african          ≥ 5
//   mediterranean    ≥ 5
//   global           ≥ 3   (multi-cuisine cross-cultural items)

export interface CuratedBaselineItem {
  canonical_name: string;
  allergen_flags: string[];
  dietary_flags: string[];
  cultural_tags: string[];
  cuisine_tags: string[];
  applicable_slots: Array<'main' | 'snack' | 'extra'>;
  notes: string | null;
}

export const CURATED_BASELINE: readonly CuratedBaselineItem[] = [
  // ---- Anglo (8) ----------------------------------------------------------
  {
    canonical_name: 'Roast turkey lunch box',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['north_american', 'british'],
    applicable_slots: ['main'],
    notes: 'anglo — cold-protein lunch box',
  },
  {
    canonical_name: 'Beef sweet potato bowl',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — protein + root vegetable',
  },
  {
    canonical_name: 'Quinoa veggie bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['north_american', 'new_american'],
    applicable_slots: ['main'],
    notes: 'anglo — quinoa grain bowl',
  },
  {
    canonical_name: 'Sweet potato veggie box',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — roasted root vegetable box',
  },
  {
    canonical_name: 'Herb roasted potato chicken box',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — potato format, replaces a chicken-rice near-duplicate',
  },
  {
    canonical_name: 'Corn succotash bean plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['new_american', 'north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — corn + bean format',
  },
  {
    canonical_name: 'Turkey lettuce cup box',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — no-grain hand-held format',
  },
  {
    canonical_name: 'Oat berry morning box',
    allergen_flags: [],
    dietary_flags: ['vegetarian'],
    cultural_tags: [],
    cuisine_tags: ['british', 'north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — oat format, breakfast-for-lunch',
  },

  // ---- South Asian (9) ----------------------------------------------------
  {
    canonical_name: 'Khichdi thermos',
    allergen_flags: [],
    dietary_flags: ['vegetarian'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian'],
    applicable_slots: ['main'],
    notes: 'south asian — RICE 1/8, iconic comfort one-pot',
  },
  {
    canonical_name: 'Lemon rice lunch',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'south_indian'],
    applicable_slots: ['main'],
    notes: 'south asian — RICE 2/8, iconic tiffin',
  },
  {
    canonical_name: 'Chana masala bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'north_indian'],
    applicable_slots: ['main'],
    notes: 'south asian — chickpea legume bowl',
  },
  {
    canonical_name: 'Aloo gobi potato plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'north_indian'],
    applicable_slots: ['main'],
    notes: 'south asian — potato format (was a rice plate)',
  },
  {
    canonical_name: 'Rajma bean bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'north_indian'],
    applicable_slots: ['main'],
    notes: 'south asian — kidney bean legume bowl',
  },
  {
    canonical_name: 'Millet upma tiffin',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'south_indian'],
    applicable_slots: ['main'],
    notes: 'south asian — millet format (was a rice tiffin)',
  },
  {
    canonical_name: 'Chickpea chaat box',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian'],
    applicable_slots: ['main'],
    notes: 'south asian — cold legume format',
  },
  {
    canonical_name: 'Tandoori chicken skewer plate',
    allergen_flags: [],
    dietary_flags: ['halal'],
    cultural_tags: ['south_asian', 'halal'],
    cuisine_tags: ['south_asian', 'north_indian', 'pakistani'],
    applicable_slots: ['main'],
    notes: 'south asian — potato format (was a rice plate)',
  },
  {
    canonical_name: 'Palak lentil bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'north_indian'],
    applicable_slots: ['main'],
    notes: 'south asian — spinach + lentil (was spinach rice)',
  },

  // ---- East Asian (7) -----------------------------------------------------
  {
    canonical_name: 'Chicken fried rice',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['east_asian', 'chinese'],
    applicable_slots: ['main'],
    notes: 'east asian — RICE 3/8, the canonical fried-rice entry',
  },
  {
    canonical_name: 'Korean rice bowl',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['east_asian', 'korean'],
    applicable_slots: ['main'],
    notes: 'east asian — RICE 4/8, bibimbap-style bowl',
  },
  {
    canonical_name: 'Sweet corn veggie soup thermos',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['east_asian', 'chinese'],
    applicable_slots: ['main'],
    notes: 'east asian — soup format, no grain base',
  },
  {
    canonical_name: 'Millet congee with chicken',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['east_asian', 'chinese'],
    applicable_slots: ['main'],
    notes: 'east asian — millet congee (was a rice congee)',
  },
  {
    canonical_name: 'Korean potato veggie box',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['east_asian', 'korean'],
    applicable_slots: ['main'],
    notes: 'east asian — braised potato banchan format',
  },
  {
    canonical_name: 'Taro veggie steam box',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['east_asian', 'chinese'],
    applicable_slots: ['main'],
    notes: 'east asian — taro root format',
  },
  {
    canonical_name: 'Asian greens chicken bowl',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['east_asian'],
    applicable_slots: ['main'],
    notes: 'east asian — vegetable-forward, no grain base',
  },

  // ---- Middle Eastern (6) -------------------------------------------------
  {
    canonical_name: 'Lentil rice mujadara',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan', 'halal'],
    cultural_tags: ['halal'],
    cuisine_tags: ['middle_eastern', 'levantine', 'lebanese'],
    applicable_slots: ['main'],
    notes: 'middle eastern — RICE 5/8, iconic lentil-rice dish',
  },
  {
    canonical_name: 'Chickpea potato plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['middle_eastern', 'levantine'],
    applicable_slots: ['main'],
    notes: 'middle eastern — legume + potato (was a rice plate)',
  },
  {
    canonical_name: 'Persian saffron lamb plate',
    allergen_flags: [],
    dietary_flags: ['halal'],
    cultural_tags: ['halal'],
    cuisine_tags: ['middle_eastern', 'persian'],
    applicable_slots: ['main'],
    notes: 'middle eastern — tahdig-style potato (was a rice dish)',
  },
  {
    canonical_name: 'Grilled chicken kebab veggie plate',
    allergen_flags: [],
    dietary_flags: ['halal'],
    cultural_tags: ['halal'],
    cuisine_tags: ['middle_eastern', 'turkish'],
    applicable_slots: ['main'],
    notes: 'middle eastern — grill + vegetable (was a rice plate)',
  },
  {
    canonical_name: 'Roasted veggie lentil plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['middle_eastern'],
    applicable_slots: ['main'],
    notes: 'middle eastern — legume base (was a rice plate)',
  },
  {
    canonical_name: 'Lemon herb bean plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['middle_eastern', 'lebanese'],
    applicable_slots: ['main'],
    notes: 'middle eastern — potato format (was a rice dish)',
  },

  // ---- Latin American (6) -------------------------------------------------
  {
    canonical_name: 'Cuban black beans rice',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['latin_american', 'caribbean', 'cuban'],
    applicable_slots: ['main'],
    notes: 'latin — RICE 6/8, iconic beans-rice pairing',
  },
  {
    canonical_name: 'Mexican citrus chicken corn plate',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['latin_american', 'mexican'],
    applicable_slots: ['main'],
    notes: 'latin — corn format (was a rice dish)',
  },
  {
    canonical_name: 'Veggie corn masa bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['latin_american', 'mexican'],
    applicable_slots: ['main'],
    notes: 'latin — masa format (was a burrito rice bowl; burrito wraps are wheat)',
  },
  {
    canonical_name: 'Plantain veggie plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['latin_american', 'caribbean'],
    applicable_slots: ['main'],
    notes: 'latin — plantain starch (was a rice plate)',
  },
  {
    canonical_name: 'Caribbean chicken cassava plate',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['latin_american', 'caribbean', 'puerto_rican'],
    applicable_slots: ['main'],
    notes: 'latin — cassava starch (was a chicken-rice near-duplicate)',
  },
  {
    canonical_name: 'Black bean arepa box',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['latin_american'],
    applicable_slots: ['main'],
    notes: 'latin — corn arepa hand-held format',
  },

  // ---- African (6) --------------------------------------------------------
  {
    canonical_name: 'Jollof rice with chicken',
    allergen_flags: [],
    dietary_flags: ['halal'],
    cultural_tags: ['halal'],
    cuisine_tags: ['african', 'west_african', 'nigerian'],
    applicable_slots: ['main'],
    notes: 'african — RICE 7/8, the defining West African rice dish',
  },
  {
    canonical_name: 'Doro wat lentil plate',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: ['east_african'],
    cuisine_tags: ['african', 'east_african', 'ethiopian'],
    applicable_slots: ['main'],
    notes: 'african — lentil base (was a rice plate)',
  },
  {
    canonical_name: 'Senegalese chicken millet plate',
    allergen_flags: [],
    dietary_flags: ['halal'],
    cultural_tags: ['halal'],
    cuisine_tags: ['african', 'west_african', 'senegalese'],
    applicable_slots: ['main'],
    notes: 'african — millet format (was a chicken-rice near-duplicate)',
  },
  {
    canonical_name: 'Kenyan veggie sukuma plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['east_african'],
    cuisine_tags: ['african', 'east_african', 'kenyan'],
    applicable_slots: ['main'],
    notes: 'african — greens-forward (was a pilau rice dish)',
  },
  {
    canonical_name: 'Somali chicken potato plate',
    allergen_flags: [],
    dietary_flags: ['halal'],
    cultural_tags: ['east_african', 'halal'],
    cuisine_tags: ['african', 'east_african', 'somali'],
    applicable_slots: ['main'],
    notes: 'african — potato format (was a chicken-rice near-duplicate)',
  },
  {
    canonical_name: 'Teff veggie plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['east_african'],
    cuisine_tags: ['african', 'east_african', 'ethiopian'],
    applicable_slots: ['main'],
    notes: 'african — teff grain format',
  },

  // ---- Mediterranean (5) --------------------------------------------------
  {
    canonical_name: 'Spanish saffron veggie rice',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['mediterranean', 'spanish'],
    applicable_slots: ['main'],
    notes: 'mediterranean — RICE 8/8, paella-style',
  },
  {
    canonical_name: 'Greek olive chickpea plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['mediterranean', 'greek'],
    applicable_slots: ['main'],
    notes: 'mediterranean — lemon potato format (was a rice dish)',
  },
  {
    canonical_name: 'Italian veggie polenta',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['mediterranean', 'italian'],
    applicable_slots: ['main'],
    notes: 'mediterranean — polenta corn format (was a rice dish)',
  },
  {
    canonical_name: 'Mediterranean chickpea bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['mediterranean'],
    applicable_slots: ['main'],
    notes: 'mediterranean — legume bowl (was a chicken rice bowl)',
  },
  {
    canonical_name: 'Mediterranean veggie lentil plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['mediterranean'],
    applicable_slots: ['main'],
    notes: 'mediterranean — lentil base (was a rice plate)',
  },

  // ---- Global / cross-cultural (3) ----------------------------------------
  {
    canonical_name: 'Mixed grain veggie bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['north_american', 'mediterranean'],
    applicable_slots: ['main'],
    notes: 'global — mixed-grain bowl (broad appeal)',
  },
  {
    canonical_name: 'Family-style turkey grain bowl',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['north_american', 'south_asian'],
    applicable_slots: ['main'],
    notes: 'global — fusion family lunch (was a rice bowl)',
  },
  {
    canonical_name: 'Rainbow veggie quinoa plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['north_american', 'mediterranean', 'south_asian'],
    applicable_slots: ['main'],
    notes: 'global — multi-color veggie plate (was a rice plate)',
  },
];
