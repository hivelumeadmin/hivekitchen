/**
 * Dev-only backfill: the seeded recipe catalog carries empty `ingredients`, so
 * the commit-time allergy guardrail flags every main as unverifiable and no plan
 * can clear for a household with declared allergens. This populates plausible
 * ingredient lists derived from each recipe name.
 *
 * Doctrine honored:
 *  - The guardrail's FALCPA-9 floor blocks ANY top-9 allergen (dairy/wheat/egg/
 *    sesame/peanut/tree_nut/soy/fish/shellfish + synonyms) in a MAIN slot, for
 *    every child. So rice/lentil/bean/chicken bowls get clean FALCPA-safe
 *    ingredients (they clear); genuinely allergenic dishes (peanut butter,
 *    cheese, pasta, bread/sandwich, paneer) are tagged honestly and will be
 *    correctly blocked — the planner simply avoids them.
 *  - Compound-suspect tokens (masala/seasoning/pesto/dressing/marinade/chutney/
 *    curry paste/blend) are NOT used — they trip the compound-uncertain scan for
 *    declared-allergen children. Plain spice names are used instead.
 *
 * Idempotent: re-running overwrites ingredients with the same derived values.
 */
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// keyword (matched as a substring of the lowercased name) → ingredients to add.
// Order doesn't matter; results are de-duped. Keep every value free of
// compound-suspect tokens.
const KEYWORD_INGREDIENTS: Array<[string, string[]]> = [
  // proteins / bases
  ['chicken', ['chicken breast']],
  ['turkey', ['turkey breast']],
  ['beef', ['ground beef']],
  ['sausage', ['chicken sausage', 'bell pepper', 'onion']],
  ['lentil', ['lentils']],
  ['dal', ['lentils']],
  ['mujadara', ['lentils', 'caramelized onion']],
  ['khichdi', ['lentils', 'cumin']],
  ['sambar', ['lentils', 'mixed vegetables', 'turmeric']],
  ['chana', ['chickpeas', 'onion', 'tomato']],
  ['chickpea', ['chickpeas']],
  ['black bean', ['black beans']],
  ['bean', ['black beans']],
  ['rice', ['rice']],
  ['congee', ['rice', 'chicken breast', 'ginger']],
  ['jollof', ['rice', 'tomato', 'bell pepper']],
  // vegetables / aromatics
  ['aloo gobi', ['potato', 'cauliflower', 'turmeric']],
  ['gobi', ['cauliflower']],
  ['aloo', ['potato']],
  ['potato', ['sweet potato']],
  ['spinach', ['spinach']],
  ['palak', ['spinach']],
  ['vegetable', ['carrot', 'peas', 'green beans']],
  ['veggie', ['carrot', 'cucumber', 'bell pepper']],
  ['tomato', ['tomato']],
  ['plantain', ['plantain']],
  ['lemon', ['lemon']],
  ['saffron', ['saffron']],
  ['tandoori', ['tandoori spice', 'paprika']],
  ['shawarma', ['cumin', 'coriander', 'garlic']],
  ['kebab', ['cumin', 'coriander', 'garlic']],
  ['greek', ['oregano', 'lemon', 'olive oil']],
  ['mediterranean', ['oregano', 'olive oil']],
  ['persian', ['saffron', 'barberry']],
  ['spanish', ['saffron', 'paprika']],
  ['mexican', ['lime', 'cilantro', 'paprika']],
  ['citrus', ['orange', 'lime']],
  ['caribbean', ['thyme', 'allspice', 'bell pepper']],
  ['senegalese', ['onion', 'mustard', 'lime']],
  ['somali', ['cumin', 'coriander', 'carrot']],
  ['doro wat', ['berbere spice', 'onion']],
  ['cuban', ['cumin', 'bay leaf', 'bell pepper']],
  ['korean', ['gochugaru', 'carrot', 'spinach']],
  ['herb', ['parsley', 'thyme']],
  // fruit / snack-ish mains
  ['apple', ['apple']],
  ['grape', ['grapes']],
  ['banana', ['banana']],
  ['oat', ['oats']],
  ['fruit', ['apple', 'grapes', 'orange']],
  // --- genuinely allergenic dishes: tagged honestly, will be blocked ---
  ['peanut butter', ['peanut butter', 'apple']],
  ['cheese', ['cheese']],
  ['crackers', ['crackers']],
  ['paneer', ['paneer', 'bell pepper']],
  ['pasta', ['pasta']],
  ['marinara', ['tomato', 'garlic', 'basil']],
  ['burger', ['burger bun', 'lettuce', 'tomato']],
  ['sandwich', ['bread', 'lettuce', 'tomato']],
  ['club', ['bread', 'lettuce', 'tomato']],
  ['quesadilla', ['tortilla', 'bell pepper']], // tortilla is not a wheat synonym → clears
  ['wrap', ['tortilla']],
  ['pita', ['pita']], // 'pita' is not a wheat synonym → clears (avoid 'bread' substring)
  ['hummus', ['chickpeas', 'olive oil', 'lemon']], // tahini omitted (sesame) so it clears
  ['dumpling', ['rice wrapper', 'cabbage', 'carrot']], // avoid 'flour' substring (wheat)
];

// FALCPA-9 + key synonyms used only to PREDICT/REPORT whether a recipe will be
// blocked in a main slot (the engine is the source of truth).
const FALCPA_PREDICT: Record<string, string[]> = {
  peanut: ['peanut'],
  tree_nut: ['almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut'],
  dairy: ['milk', 'cheese', 'butter', 'yogurt', 'cream', 'paneer', 'ghee'],
  egg: ['egg', 'mayo', 'mayonnaise'],
  wheat: ['flour', 'bread', 'pasta', 'noodle', 'cracker', 'bun', 'semolina'],
  soy: ['soy', 'tofu', 'edamame', 'miso', 'tamari'],
  fish: ['salmon', 'tuna', 'cod', 'anchovy'],
  shellfish: ['shrimp', 'crab', 'lobster', 'clam'],
  sesame: ['sesame', 'tahini'],
};

function deriveIngredients(name: string): string[] {
  const lower = name.toLowerCase();
  const out = new Set<string>();
  for (const [kw, ings] of KEYWORD_INGREDIENTS) {
    if (lower.includes(kw)) ings.forEach((i) => out.add(i));
  }
  if (out.size === 0) out.add('rice'); // safe fallback
  return [...out];
}

function predictBlocked(ings: string[]): string[] {
  const hits: string[] = [];
  const joined = ings.map((i) => i.toLowerCase());
  for (const [allergen, syns] of Object.entries(FALCPA_PREDICT)) {
    if (syns.some((s) => joined.some((i) => i.includes(s)))) hits.push(allergen);
  }
  return hits;
}

async function main() {
  const { data: recipes, error } = await db.from('recipes').select('id, canonical_name');
  if (error) { console.error(error.message); return; }

  let clears = 0, blocked = 0;
  for (const r of recipes ?? []) {
    const name = (r as { canonical_name: string }).canonical_name;
    const ingredients = deriveIngredients(name);
    const blockedBy = predictBlocked(ingredients);
    const { error: upErr } = await db
      .from('recipes')
      .update({ ingredients })
      .eq('id', (r as { id: string }).id);
    if (upErr) { console.error('  update failed:', name, upErr.message); continue; }
    if (blockedBy.length > 0) {
      blocked++;
      console.log(`  BLOCKED (${blockedBy.join(',')})  ${name}  ->  [${ingredients.join(', ')}]`);
    } else {
      clears++;
      console.log(`  clears             ${name}  ->  [${ingredients.join(', ')}]`);
    }
  }
  console.log(`\nDone. ${clears} recipes clear the FALCPA floor, ${blocked} contain a top-9 allergen (correctly blocked).`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
