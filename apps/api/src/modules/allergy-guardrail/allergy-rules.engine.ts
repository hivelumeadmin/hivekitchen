import type {
  Conflict,
  FlaggedCompoundItem,
  GuardrailResult,
  PlanItemForGuardrail,
} from '@hivekitchen/types';

// 1.1.0 → 1.2.0 (Story 3.S39): commit-time guardrail now evaluates each
// slot's full effective ingredient set (recipe.ingredients − removals + add_ons),
// not just parent-added add_ons. Bump distinguishes the audit trail pre/post
// base-ingredient evaluation.
// 1.2.0 → 1.3.0 (Story 3-s43): Phase-2 snack-SKU allergen check replaces the
// Phase-1 attested:true exemption — tagged SKUs are evaluated by set-membership.
// 1.3.0 → 1.3.1 (Story 3-s43 fix): snack-SKU slots (slot==='snack') are now
// evaluated against parent_declared rules ONLY, implementing the documented
// "set-membership against declared allergens" intent. Previously snack tags
// were run through the full engine, so the FALCPA-9 floor blocked every
// dairy/wheat/egg-tagged snack for every household regardless of declared
// allergies — making any plan with such a snack permanently un-composable.
// 1.3.1 → 1.4.0 (guardrail Option A): the FALCPA-9 floor no longer hard-blocks
// recipe (main/extra) slots either — ALL slots are now evaluated against
// parent_declared rules only. The floor had the same flaw for recipes that
// 1.3.1 fixed for snacks: it blocked every wheat/dairy/egg recipe for every
// household regardless of declared allergies, making normal lunches
// un-composable. FALCPA-9 is now detection vocabulary (synonym expansion) plus
// the baseline-presence sanity check below, NOT an independent block list.
// Hard safety is unchanged: declared allergens (household-wide + per-child)
// still block on every slot.
export const GUARDRAIL_VERSION = '1.4.0' as const;

// Canonical FALCPA keys match `allergen_tags.key` (rule_class='falcpa'). Slice 2.6-s7
// aligned engine keys with the vocabulary table so the repository can read seeds
// directly from `allergen_tags` without a translation layer.
export const FALCPA_TOP_9 = [
  'peanut',
  'tree_nut',
  'dairy',
  'egg',
  'wheat',
  'soy',
  'fish',
  'shellfish',
  'sesame',
] as const satisfies readonly string[];

// FALCPA category → known ingredient names (synonym/alias map). Without this expansion,
// substring matching against the canonical category name (e.g. 'tree_nut') misses real
// ingredient strings (e.g. 'almonds'). Each rule's allergen is matched against the rule
// allergen itself AND every synonym for that canonical category.
//
// The legacy plural-form strings ('peanuts', 'tree_nuts', 'milk', 'eggs') live in the
// synonym list so any free-text ingredient or rule that still carries the old form is
// caught alongside the canonical singular form.
//
// Editing rules: synonyms must be lowercase, single-word or hyphen/space-joined, and
// represent actual ingredient names parents would see on a school menu. Add liberally —
// false positives are acceptable; false negatives are not.
export const FALCPA_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  peanut: ['peanuts', 'groundnut', 'arachis', 'goober'],
  tree_nut: [
    'tree_nuts', 'tree nuts', 'tree-nut',
    'almond', 'almonds',
    'walnut', 'walnuts',
    'cashew', 'cashews',
    'pecan', 'pecans',
    'pistachio', 'pistachios',
    'hazelnut', 'hazelnuts',
    'filbert', 'filberts',
    'macadamia',
    'brazil nut', 'brazil-nut',
    'pine nut', 'pine-nut', 'pinenut',
    'chestnut', 'chestnuts',
  ],
  dairy: [
    'milk',
    'butter', 'cheese', 'yogurt', 'yoghurt', 'cream',
    'casein', 'caseinate', 'whey', 'lactose', 'ghee',
    'curd', 'paneer', 'kefir', 'buttermilk', 'half-and-half',
    'condensed milk', 'evaporated milk',
  ],
  egg: [
    'eggs', 'mayonnaise', 'mayo', 'meringue', 'custard',
    'albumin', 'albumen', 'ovalbumin', 'ovomucin', 'globulin',
    'hollandaise', 'aioli',
  ],
  wheat: [
    'flour', 'bread', 'pasta', 'noodle', 'noodles',
    'gluten', 'semolina', 'spelt', 'farina', 'couscous',
    'bulgur', 'durum', 'einkorn', 'farro', 'kamut',
    'cracker', 'crackers', 'biscuit', 'biscuits',
  ],
  soy: [
    'tofu', 'tempeh', 'edamame', 'miso', 'tamari',
    'natto', 'soybean', 'soya', 'lecithin', 'soy sauce',
    'shoyu',
  ],
  fish: [
    'salmon', 'tuna', 'cod', 'tilapia', 'trout',
    'bass', 'halibut', 'mackerel', 'anchovy', 'anchovies',
    'sardine', 'sardines', 'haddock', 'pollock', 'snapper',
    'sole', 'flounder', 'catfish', 'swordfish', 'mahi',
    'worcestershire',
  ],
  shellfish: [
    'shrimp', 'prawn', 'prawns', 'crab', 'lobster',
    'crawfish', 'crayfish', 'clam', 'clams', 'oyster', 'oysters',
    'scallop', 'scallops', 'mussel', 'mussels', 'squid',
    'octopus', 'calamari',
  ],
  sesame: [
    'tahini', 'gomashio', 'gomasio', 'benne', 'sesame oil', 'sesame seed', 'sesame seeds',
    "za'atar", 'zaatar',
  ],
};

// Compound/processed products where allergen content cannot be determined from
// the ingredient string alone. Each entry is a lowercase substring that signals
// a multi-ingredient processed product. Checked ONLY for items belonging to
// children with ≥1 parent_declared rule (FALCPA-only households are exempt).
// Story 3.24 — closes the compound-ingredient gap left open by 3.31 (which
// explicitly deferred per-ingredient allergen-confidence to this story).
export const COMPOUND_SUSPECT_TOKENS = [
  'masala',      // garam masala, biryani masala, tikka masala paste
  'seasoning',   // taco seasoning, Italian seasoning, fajita seasoning
  'pesto',       // pine nuts (tree_nut) + parmesan (dairy) — not in current synonyms
  'dressing',    // ranch (dairy+egg), caesar (egg+fish)
  'marinade',    // teriyaki marinade (soy+sesame), ginger soy marinade
  'chutney',     // processed condiment — content varies by recipe
  'curry paste', // tree nuts, fish sauce (shellfish), sesame oil — all possible
] as const;

// Exported for unit testing.
export function isSuspectCompound(ingredient: string): boolean {
  const lower = ingredient.trim().toLowerCase();
  if ((COMPOUND_SUSPECT_TOKENS as readonly string[]).some((token) => lower.includes(token))) {
    return true;
  }
  // 'blend' as a whole word — leading-space trick would false-positive on "fresh blended smoothie".
  return /\bblend\b/.test(lower);
}

export type AllergyRule = {
  id: string;
  household_id: string | null;
  child_id: string | null;
  allergen: string;
  rule_type: 'falcpa' | 'parent_declared';
};

const TOKEN_SPLIT_RE = /[\s_\-,;.()/]+/;
const MIN_TOKEN_LEN = 3;

// Hard caps: a latency guard against oversized payloads (the engine is
// O(items × rules × ingredients)). Sized for the commit-time effective-set
// walk (Story 3.S39), which emits one item per (child, day, slot) with the
// full recipe ingredient set: up to DAYS(6) × SLOTS(3) × VARIATIONS(12) = 216
// items, each up to recipe.ingredients(40) + add_ons(20) ingredients. Inputs
// beyond these limits return `'uncertain'` rather than risk the p99 budget.
const MAX_PLAN_ITEMS = 250;
const MAX_INGREDIENTS_PER_ITEM = 80;

function targetsFor(allergen: string): readonly string[] {
  const normalized = allergen.trim().toLowerCase();
  const synonyms = FALCPA_SYNONYMS[normalized] ?? [];
  return [normalized, ...synonyms];
}

// Two words are "equivalent" when identical or related by a simple singular/
// plural inflection (egg↔eggs, nut↔nuts). Deliberately NOT substring: "ground"
// and "groundnut" are NOT equivalent. Matching stays allergen-safe (over-strict)
// without the substring false positives a bare `includes` produces.
function wordEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  if (b === `${a}s` || b === `${a}es`) return true;
  if (a === `${b}s` || a === `${b}es`) return true;
  return false;
}

// Case-insensitive match between an ingredient string and an allergen/synonym
// target.
//   1. Forward substring — the ingredient literally spells the target
//      ("peanut butter" ⊃ "peanut", "whole wheat bread" ⊃ "wheat"). Primary path.
//   2. Reverse word match — the ingredient (or one of its tokens) is a WORD of
//      the target, modulo singular/plural ("mixed nuts" → "tree nuts" via the
//      "nuts" word; "egg" → "eggs"). This REPLACES a former loose
//      `target.includes(token)` test that false-matched a common word embedded
//      inside a compound synonym — e.g. "ground" (from "ground beef") inside the
//      peanut synonym "groundnut", wrongly flagging beef as peanut.
function ingredientMatchesTarget(ingredientLower: string, target: string): boolean {
  if (target.length === 0 || ingredientLower.length === 0) return false;
  if (ingredientLower.includes(target)) return true;
  const targetWords = target.split(TOKEN_SPLIT_RE);
  for (const tok of [ingredientLower, ...ingredientLower.split(TOKEN_SPLIT_RE)]) {
    if (tok.length < MIN_TOKEN_LEN) continue;
    for (const word of targetWords) {
      if (word.length >= MIN_TOKEN_LEN && wordEquivalent(tok, word)) return true;
    }
  }
  return false;
}

function ingredientMatchesAllergen(ingredient: string, allergen: string): boolean {
  const i = ingredient.trim().toLowerCase();
  for (const target of targetsFor(allergen)) {
    if (ingredientMatchesTarget(i, target)) return true;
  }
  return false;
}

function ruleAppliesToChild(rule: AllergyRule, childId: string): boolean {
  return rule.child_id === null || rule.child_id === childId;
}

function uncertain(reason: string): GuardrailResult {
  return { verdict: 'uncertain', conflicts: [], reason };
}

export function evaluate(
  planItems: PlanItemForGuardrail[],
  rules: AllergyRule[],
): GuardrailResult {
  // Fail-closed: empty inputs produce 'uncertain', not 'cleared'. A safety-critical gate
  // must never silently approve when given nothing to evaluate (prompt-injection bypass).
  if (planItems.length === 0) return uncertain('empty_plan_items');
  if (planItems.length > MAX_PLAN_ITEMS) return uncertain('plan_items_exceeds_max');
  for (const item of planItems) {
    if (item.ingredients.length === 0) return uncertain('empty_ingredients');
    if (item.ingredients.length > MAX_INGREDIENTS_PER_ITEM) {
      return uncertain('ingredients_exceeds_max');
    }
  }

  // Fail-closed: a rule set with no FALCPA baseline cannot enforce FR76/FR77. If the
  // repository returned zero rules, or only parent-declared rules without the seed,
  // refuse rather than approve.
  if (rules.length === 0) return uncertain('no_rules_loaded');
  if (!rules.some((r) => r.rule_type === 'falcpa')) return uncertain('falcpa_baseline_missing');

  const seen = new Set<string>();
  const conflicts: Conflict[] = [];

  for (const item of planItems) {
    for (const rule of rules) {
      if (!ruleAppliesToChild(rule, item.child_id)) continue;
      // Guardrail 1.4.0 (Option A) — hard blocks come ONLY from parent_declared
      // rules (household-wide or per-child), on EVERY slot. The FALCPA-9 floor
      // is NOT an independent block list: enforcing it blocked every
      // wheat/dairy/egg recipe for every household regardless of declared
      // allergies, making normal lunches un-composable (the same flaw fixed for
      // snacks in 1.3.1). The falcpa rules still satisfy the baseline-presence
      // sanity check above and feed synonym expansion via the declared rule's
      // canonical key. A family that declared peanut/soy can now eat pasta and
      // cheese; declared allergens still block on every slot.
      if (rule.rule_type !== 'parent_declared') continue;
      for (const ingredient of item.ingredients) {
        if (ingredientMatchesAllergen(ingredient, rule.allergen)) {
          const key = `${item.child_id}|${rule.allergen}|${ingredient}|${item.slot}|${item.day}`;
          if (seen.has(key)) continue;
          seen.add(key);
          conflicts.push({
            child_id: item.child_id,
            allergen: rule.allergen,
            ingredient,
            slot: item.slot,
            day: item.day,
          });
        }
      }
    }
  }

  if (conflicts.length > 0) {
    return { verdict: 'blocked', conflicts };
  }

  // Story 3.24 — compound suspect scan. Only fires when the main conflict loop
  // would otherwise return `cleared`. Only flags items for children with ≥1
  // `parent_declared` rule (FALCPA-only households do not benefit and would see
  // false positives). Compound matches are advisory: the engine reports them via
  // `uncertain('compound_ingredient_unverified')` and the swap path attempts
  // substitution before any user-facing surfacing.
  const compoundFlags: FlaggedCompoundItem[] = [];
  const compoundSeen = new Set<string>();
  for (const item of planItems) {
    const childHasParentDeclared = rules.some(
      (r) => ruleAppliesToChild(r, item.child_id) && r.rule_type === 'parent_declared',
    );
    if (!childHasParentDeclared) continue;
    for (const ingredient of item.ingredients) {
      if (!isSuspectCompound(ingredient)) continue;
      const key = `${item.child_id}|${ingredient}|${item.slot}|${item.day}`;
      if (compoundSeen.has(key)) continue;
      compoundSeen.add(key);
      compoundFlags.push({
        child_id: item.child_id,
        ingredient,
        slot: item.slot,
        day: item.day,
      });
    }
  }
  if (compoundFlags.length > 0) {
    return {
      verdict: 'uncertain',
      conflicts: [],
      reason: 'compound_ingredient_unverified',
      flagged_items: compoundFlags,
    };
  }

  return { verdict: 'cleared', conflicts: [] };
}

