import type { GuardrailResult, PlanItemForGuardrail, Conflict } from '@hivekitchen/types';

export const GUARDRAIL_VERSION = '1.0.0' as const;

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

export type AllergyRule = {
  id: string;
  household_id: string | null;
  child_id: string | null;
  allergen: string;
  rule_type: 'falcpa' | 'parent_declared';
};

const TOKEN_SPLIT_RE = /[\s_\-,;.()/]+/;
const MIN_TOKEN_LEN = 3;

// Bidirectional case-insensitive substring match between an ingredient string and an
// allergen name. The token-level reverse check (allergen.includes(token)) handles the
// plural/singular mismatch (e.g., ingredient "peanut butter" → token "peanut" ⊂ allergen "peanuts").
// Tokens shorter than MIN_TOKEN_LEN are dropped to prevent absurd matches like the letter "a"
// substring-matching every long allergen. Matching is allergen-safe (over-strict) by design.
function ingredientMatchesAllergen(ingredient: string, allergen: string): boolean {
  const a = allergen.trim().toLowerCase();
  const i = ingredient.trim().toLowerCase();
  if (a.length === 0 || i.length === 0) return false;
  if (i.includes(a)) return true;
  if (a.includes(i)) return true;
  for (const tok of i.split(TOKEN_SPLIT_RE)) {
    if (tok.length >= MIN_TOKEN_LEN && a.includes(tok)) return true;
  }
  return false;
}

function ruleAppliesToChild(rule: AllergyRule, childId: string): boolean {
  return rule.child_id === null || rule.child_id === childId;
}

export function evaluate(planItems: PlanItemForGuardrail[], rules: AllergyRule[]): GuardrailResult {
  const conflicts: Conflict[] = [];
  for (const item of planItems) {
    for (const rule of rules) {
      if (!ruleAppliesToChild(rule, item.child_id)) continue;
      for (const ingredient of item.ingredients) {
        if (ingredientMatchesAllergen(ingredient, rule.allergen)) {
          conflicts.push({
            child_id: item.child_id,
            allergen: rule.allergen,
            ingredient,
            slot: item.slot,
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
