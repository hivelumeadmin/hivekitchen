import type { GuardrailResult, PlanItemForGuardrail, Conflict } from '@hivekitchen/types';

export const GUARDRAIL_VERSION = '1.1.0' as const;

export const FALCPA_TOP_9 = [
  'peanuts',
  'tree_nuts',
  'milk',
  'eggs',
  'wheat',
  'soy',
  'fish',
  'shellfish',
  'sesame',
] as const satisfies readonly string[];

// FALCPA category → known ingredient names (synonym/alias map). Without this expansion,
// substring matching against the canonical category name (e.g. 'tree_nuts') misses real
// ingredient strings (e.g. 'almonds'). Each rule's allergen is matched against the rule
// allergen itself AND every synonym for that canonical category.
//
// Editing rules: synonyms must be lowercase, single-word or hyphen/space-joined, and
// represent actual ingredient names parents would see on a school menu. Add liberally —
// false positives are acceptable; false negatives are not.
export const FALCPA_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  peanuts: ['peanut', 'groundnut', 'arachis', 'goober'],
  tree_nuts: [
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
  milk: [
    'butter', 'cheese', 'yogurt', 'yoghurt', 'cream',
    'casein', 'caseinate', 'whey', 'lactose', 'ghee',
    'curd', 'paneer', 'kefir', 'buttermilk', 'half-and-half',
    'condensed milk', 'evaporated milk',
  ],
  eggs: [
    'egg', 'mayonnaise', 'mayo', 'meringue', 'custard',
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
  ],
  shellfish: [
    'shrimp', 'prawn', 'prawns', 'crab', 'lobster',
    'crawfish', 'crayfish', 'clam', 'clams', 'oyster', 'oysters',
    'scallop', 'scallops', 'mussel', 'mussels', 'squid',
    'octopus', 'calamari',
  ],
  sesame: [
    'tahini', 'gomashio', 'gomasio', 'benne', 'sesame oil', 'sesame seed', 'sesame seeds',
  ],
};

export type AllergyRule = {
  id: string;
  household_id: string | null;
  child_id: string | null;
  allergen: string;
  rule_type: 'falcpa' | 'parent_declared';
};

const TOKEN_SPLIT_RE = /[\s_\-,;.()/]+/;
const MIN_TOKEN_LEN = 3;

// Hard caps: belt-and-braces with the contract `.max()` bounds. Engine refuses to
// evaluate inputs that exceed these limits (returns `'uncertain'`) — protects the
// p99 latency budget (maxLatencyMs: 150) from oversized agent payloads.
const MAX_PLAN_ITEMS = 50;
const MAX_INGREDIENTS_PER_ITEM = 20;

function targetsFor(allergen: string): readonly string[] {
  const normalized = allergen.trim().toLowerCase();
  const synonyms = FALCPA_SYNONYMS[normalized] ?? [];
  return [normalized, ...synonyms];
}

// Bidirectional case-insensitive substring match between an ingredient string and an
// allergen / synonym target. The token-level reverse check (target.includes(token)) handles
// the plural/singular mismatch (e.g., ingredient "peanut butter" → token "peanut" ⊂ target
// "peanuts"). Tokens shorter than MIN_TOKEN_LEN are dropped to prevent absurd matches.
// Matching is allergen-safe (over-strict) by design.
function ingredientMatchesTarget(ingredientLower: string, target: string): boolean {
  if (target.length === 0 || ingredientLower.length === 0) return false;
  if (ingredientLower.includes(target)) return true;
  if (target.includes(ingredientLower)) return true;
  for (const tok of ingredientLower.split(TOKEN_SPLIT_RE)) {
    if (tok.length >= MIN_TOKEN_LEN && target.includes(tok)) return true;
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
  return { verdict: 'cleared', conflicts: [] };
}
