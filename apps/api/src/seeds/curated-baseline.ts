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
//
// This array is the TypeScript source of truth for git history. The
// companion migration 20260909000000_2_6_s2_curated_baseline_items.sql
// contains an INSERT block matching this content one-to-one. When editing
// this file, regenerate / hand-update the migration to match. Do NOT
// import this module at runtime — the DB is the authoritative source once
// the migration has run.
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
  // ---- Anglo (10) ---------------------------------------------------------
  {
    canonical_name: 'Grilled chicken with rice',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — protein + grain staple',
  },
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
    notes: 'anglo — grain-free protein bowl',
  },
  {
    canonical_name: 'Quinoa veggie bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['north_american', 'new_american'],
    applicable_slots: ['main'],
    notes: 'anglo — vegan grain bowl',
  },
  {
    canonical_name: 'Rice with black beans',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — protein-complete vegan plate',
  },
  {
    canonical_name: 'Apple grape lunch pack',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — fruit-forward lunch (light main)',
  },
  {
    canonical_name: 'Carrot stick veggie box',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — raw-veg lunch box',
  },
  {
    canonical_name: 'Banana oat snack box',
    allergen_flags: [],
    dietary_flags: ['vegetarian'],
    cultural_tags: [],
    cuisine_tags: ['british', 'north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — oat-fruit lunch (school-safe)',
  },
  {
    canonical_name: 'Mini chicken rice cups',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — portioned chicken-rice',
  },
  {
    canonical_name: 'Sweet potato veggie box',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['north_american'],
    applicable_slots: ['main'],
    notes: 'anglo — roasted veg lunch',
  },

  // ---- South Asian (10) ---------------------------------------------------
  {
    canonical_name: 'Dal chawal thermos',
    allergen_flags: [],
    dietary_flags: ['vegetarian'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'north_indian'],
    applicable_slots: ['main'],
    notes: 'south_asian — lentil + rice staple',
  },
  {
    canonical_name: 'Khichdi thermos',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian'],
    applicable_slots: ['main'],
    notes: 'south_asian — one-pot lentil-rice',
  },
  {
    canonical_name: 'Aloo gobi rice plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'north_indian'],
    applicable_slots: ['main'],
    notes: 'south_asian — potato-cauliflower curry plate',
  },
  {
    canonical_name: 'Chana masala bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'north_indian'],
    applicable_slots: ['main'],
    notes: 'south_asian — chickpea protein bowl',
  },
  {
    canonical_name: 'Lemon rice lunch',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'south_indian'],
    applicable_slots: ['main'],
    notes: 'south_asian — tempered south indian rice',
  },
  {
    canonical_name: 'Tomato rice tiffin',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'south_indian'],
    applicable_slots: ['main'],
    notes: 'south_asian — tomato-tempered rice',
  },
  {
    canonical_name: 'Sambar rice plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'south_indian'],
    applicable_slots: ['main'],
    notes: 'south_asian — tamarind-lentil stew with rice',
  },
  {
    canonical_name: 'Tandoori chicken rice plate',
    allergen_flags: [],
    dietary_flags: ['halal'],
    cultural_tags: ['south_asian', 'halal'],
    cuisine_tags: ['south_asian', 'north_indian', 'pakistani'],
    applicable_slots: ['main'],
    notes: 'south_asian — clay-oven chicken with rice',
  },
  {
    canonical_name: 'Vegetable rice tiffin',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian'],
    applicable_slots: ['main'],
    notes: 'south_asian — mixed vegetable rice',
  },
  {
    canonical_name: 'Spinach rice palak',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['south_asian'],
    cuisine_tags: ['south_asian', 'north_indian'],
    applicable_slots: ['main'],
    notes: 'south_asian — palak (spinach) rice',
  },

  // ---- East Asian (6) -----------------------------------------------------
  {
    canonical_name: 'Chicken fried rice',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['east_asian', 'chinese'],
    applicable_slots: ['main'],
    notes: 'east_asian — wok-style chicken rice',
  },
  {
    canonical_name: 'Veggie fried rice',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['east_asian', 'chinese'],
    applicable_slots: ['main'],
    notes: 'east_asian — vegan wok rice',
  },
  {
    canonical_name: 'Plain congee with chicken',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['east_asian', 'chinese'],
    applicable_slots: ['main'],
    notes: 'east_asian — porridge-style rice with chicken',
  },
  {
    canonical_name: 'Korean rice bowl',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['east_asian', 'korean'],
    applicable_slots: ['main'],
    notes: 'east_asian — bibimbap-style rice bowl (no gochujang assumed)',
  },
  {
    canonical_name: 'Steamed rice wrap dumplings',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['east_asian', 'chinese'],
    applicable_slots: ['main'],
    notes: 'east_asian — rice-paper dumplings (gluten-free wrapper assumed)',
  },
  {
    canonical_name: 'Asian veggie rice bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['east_asian'],
    applicable_slots: ['main'],
    notes: 'east_asian — generic vegan asian rice bowl',
  },

  // ---- Middle Eastern (6) ------------------------------------------------
  {
    canonical_name: 'Lemon herb chicken with rice',
    allergen_flags: [],
    dietary_flags: ['halal'],
    cultural_tags: ['halal'],
    cuisine_tags: ['middle_eastern', 'lebanese'],
    applicable_slots: ['main'],
    notes: 'middle_eastern — herb-marinated chicken',
  },
  {
    canonical_name: 'Chickpea rice plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['middle_eastern', 'levantine'],
    applicable_slots: ['main'],
    notes: 'middle_eastern — chickpea protein plate',
  },
  {
    canonical_name: 'Persian saffron chicken rice',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['middle_eastern', 'persian'],
    applicable_slots: ['main'],
    notes: 'middle_eastern — saffron-scented chicken rice',
  },
  {
    canonical_name: 'Lentil rice mujadara',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['middle_eastern', 'levantine', 'lebanese'],
    applicable_slots: ['main'],
    notes: 'middle_eastern — caramelized-onion lentil-rice',
  },
  {
    canonical_name: 'Roasted veggie rice plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['middle_eastern'],
    applicable_slots: ['main'],
    notes: 'middle_eastern — roasted vegetable plate',
  },
  {
    canonical_name: 'Grilled chicken kebab with rice',
    allergen_flags: [],
    dietary_flags: ['halal'],
    cultural_tags: ['halal'],
    cuisine_tags: ['middle_eastern', 'turkish'],
    applicable_slots: ['main'],
    notes: 'middle_eastern — skewered grilled chicken',
  },

  // ---- Latin American (5) ------------------------------------------------
  {
    canonical_name: 'Mexican citrus chicken rice',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['latin_american', 'mexican'],
    applicable_slots: ['main'],
    notes: 'latin_american — citrus-grilled chicken plate (avoid "pollo" token; matches "pollock" synonym)',
  },
  {
    canonical_name: 'Veggie burrito rice bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['latin_american', 'mexican'],
    applicable_slots: ['main'],
    notes: 'latin_american — deconstructed burrito over rice',
  },
  {
    canonical_name: 'Cuban black beans rice',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['latin_american', 'caribbean', 'cuban'],
    applicable_slots: ['main'],
    notes: 'latin_american — moros y cristianos staple (use plural "beans"; "bean" token matches "soybean" synonym)',
  },
  {
    canonical_name: 'Caribbean chicken rice',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['latin_american', 'caribbean', 'puerto_rican'],
    applicable_slots: ['main'],
    notes: 'latin_american — arroz con pollo style (avoid "pollo" token; matches "pollock" synonym)',
  },
  {
    canonical_name: 'Plantain rice plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['latin_american', 'caribbean'],
    applicable_slots: ['main'],
    notes: 'latin_american — sweet plantain side',
  },

  // ---- African (5) -------------------------------------------------------
  {
    canonical_name: 'Jollof rice with chicken',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['african', 'west_african', 'nigerian'],
    applicable_slots: ['main'],
    notes: 'african — west african tomato rice with chicken',
  },
  {
    canonical_name: 'Doro wat rice plate',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: ['east_african'],
    cuisine_tags: ['african', 'east_african', 'ethiopian'],
    applicable_slots: ['main'],
    notes: 'african — berbere-spiced chicken stew',
  },
  {
    canonical_name: 'Senegalese chicken rice',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['african', 'west_african', 'senegalese'],
    applicable_slots: ['main'],
    notes: 'african — thieboudienne-style (chicken substitution)',
  },
  {
    canonical_name: 'Veggie pilau rice',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: ['east_african'],
    cuisine_tags: ['african', 'east_african', 'kenyan'],
    applicable_slots: ['main'],
    notes: 'african — spiced east african rice',
  },
  {
    canonical_name: 'Somali chicken rice',
    allergen_flags: [],
    dietary_flags: ['halal'],
    cultural_tags: ['east_african', 'halal'],
    cuisine_tags: ['african', 'east_african', 'somali'],
    applicable_slots: ['main'],
    notes: 'african — somali bariis-style chicken rice',
  },

  // ---- Mediterranean (5) -------------------------------------------------
  {
    canonical_name: 'Mediterranean chicken rice bowl',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['mediterranean'],
    applicable_slots: ['main'],
    notes: 'mediterranean — herb-and-olive-oil chicken bowl',
  },
  {
    canonical_name: 'Greek chicken rice',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['mediterranean', 'greek'],
    applicable_slots: ['main'],
    notes: 'mediterranean — lemon-oregano chicken',
  },
  {
    canonical_name: 'Italian veggie rice',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['mediterranean', 'italian'],
    applicable_slots: ['main'],
    notes: 'mediterranean — italian-style veggie risotto (gluten-free)',
  },
  {
    canonical_name: 'Spanish saffron chicken rice',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['mediterranean', 'spanish'],
    applicable_slots: ['main'],
    notes: 'mediterranean — paella-style chicken (no seafood)',
  },
  {
    canonical_name: 'Mediterranean veggie rice plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['mediterranean'],
    applicable_slots: ['main'],
    notes: 'mediterranean — roasted vegetable plate',
  },

  // ---- Global (3) — multi-cuisine cross-cultural items -------------------
  {
    canonical_name: 'Mixed grain veggie bowl',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['north_american', 'mediterranean'],
    applicable_slots: ['main'],
    notes: 'global — cross-cultural vegan grain bowl',
  },
  {
    canonical_name: 'Family-style chicken rice bowl',
    allergen_flags: [],
    dietary_flags: [],
    cultural_tags: [],
    cuisine_tags: ['north_american', 'south_asian'],
    applicable_slots: ['main'],
    notes: 'global — fusion family lunch',
  },
  {
    canonical_name: 'Rainbow veggie rice plate',
    allergen_flags: [],
    dietary_flags: ['vegetarian', 'vegan'],
    cultural_tags: [],
    cuisine_tags: ['north_american', 'mediterranean', 'south_asian'],
    applicable_slots: ['main'],
    notes: 'global — multi-color veggie plate (broad appeal)',
  },
];
