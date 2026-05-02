import { describe, it, expect } from 'vitest';
import { evaluate, type AllergyRule } from './allergy-rules.engine.js';
import type { PlanItemForGuardrail } from '@hivekitchen/types';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_A = '22222222-2222-4222-8222-222222222222';
const CHILD_B = '33333333-3333-4333-8333-333333333333';

function rule(overrides: Partial<AllergyRule> & Pick<AllergyRule, 'allergen'>): AllergyRule {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    household_id: HOUSEHOLD_ID,
    child_id: null,
    rule_type: 'falcpa',
    ...overrides,
  };
}

function item(overrides: Partial<PlanItemForGuardrail> = {}): PlanItemForGuardrail {
  return {
    child_id: CHILD_A,
    day: 'monday',
    slot: 'main',
    ingredients: ['rice'],
    ...overrides,
  };
}

const FALCPA_BASELINE: AllergyRule[] = [
  rule({ allergen: 'peanuts' }),
  rule({ allergen: 'tree_nuts' }),
  rule({ allergen: 'milk' }),
  rule({ allergen: 'eggs' }),
  rule({ allergen: 'wheat' }),
  rule({ allergen: 'soy' }),
  rule({ allergen: 'fish' }),
  rule({ allergen: 'shellfish' }),
  rule({ allergen: 'sesame' }),
];

// Ingredients chosen to be free of any FALCPA-9 canonical name or synonym
// (engine matching is over-strict by design — many "obvious" non-allergens like
// 'olive oil' false-positive into 'sesame oil', 'butter' into 'milk', etc.).
const SAFE_INGREDIENTS = ['rice', 'broccoli', 'banana', 'tomato', 'carrot', 'spinach'];

describe('allergy-rules.engine.evaluate', () => {
  it('returns cleared with empty conflicts when no ingredient matches any rule', () => {
    const items = [item({ ingredients: SAFE_INGREDIENTS })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result).toEqual({ verdict: 'cleared', conflicts: [] });
  });

  it('returns blocked when a FALCPA allergen name appears as a substring in an ingredient', () => {
    const items = [item({ ingredients: ['crushed peanuts'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts).toEqual([
        {
          child_id: CHILD_A,
          allergen: 'peanuts',
          ingredient: 'crushed peanuts',
          slot: 'main',
          day: 'monday',
        },
      ]);
    }
  });

  it('returns blocked for a parent_declared rule match', () => {
    const rules = [
      ...FALCPA_BASELINE,
      rule({ allergen: 'cilantro', rule_type: 'parent_declared' }),
    ];
    const items = [item({ ingredients: ['fresh cilantro'] })];
    const result = evaluate(items, rules);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts[0].allergen).toBe('cilantro');
    }
  });

  it('collects all conflicts when multiple ingredients match (no short-circuit)', () => {
    // peanut sauce → peanuts only; salmon → fish only (no cross-category leakage).
    const items = [item({ ingredients: ['crushed peanuts', 'salmon'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts).toHaveLength(2);
      const allergens = result.conflicts.map((c) => c.allergen).sort();
      expect(allergens).toEqual(['fish', 'peanuts']);
    }
  });

  it('child-scoped rule does NOT block items for a different child', () => {
    // Use a non-FALCPA allergen so only the child-scoped rule could match.
    const rules = [
      ...FALCPA_BASELINE,
      rule({ allergen: 'cilantro', child_id: CHILD_A, rule_type: 'parent_declared' }),
    ];
    const items = [item({ child_id: CHILD_B, ingredients: ['fresh cilantro', ...SAFE_INGREDIENTS] })];
    const result = evaluate(items, rules);
    expect(result.verdict).toBe('cleared');
  });

  it('household-wide rule (child_id = null) blocks items for any child in the plan', () => {
    const items = [
      item({ child_id: CHILD_A, ingredients: ['crushed peanuts'] }),
      item({ child_id: CHILD_B, ingredients: ['peanut chunks'] }),
    ];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      const childIds = result.conflicts.map((c) => c.child_id).sort();
      expect(childIds).toEqual([CHILD_A, CHILD_B].sort());
    }
  });

  it('matching is case-insensitive ("Peanuts" in ingredient matches "peanuts" rule)', () => {
    const items = [item({ ingredients: ['Roasted Peanuts'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
  });

  it('over-strict false-positive guard: a non-FALCPA allergen does not match safe ingredients', () => {
    // Verifies the "no false-positive on truly unrelated ingredients" property for
    // a parent-declared allergen that has no FALCPA synonym overlap.
    const rules = [
      ...FALCPA_BASELINE,
      rule({ allergen: 'corn', rule_type: 'parent_declared' }),
    ];
    const items = [item({ ingredients: ['rice', 'broccoli', 'banana'] })];
    const result = evaluate(items, rules);
    expect(result).toEqual({ verdict: 'cleared', conflicts: [] });
  });

  // -------------------- D1: FALCPA synonym/alias matching (P15) --------------------

  it('FALCPA "tree_nuts" rule blocks "almonds" (synonym match)', () => {
    const items = [item({ ingredients: ['almonds'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts[0].allergen).toBe('tree_nuts');
      expect(result.conflicts[0].ingredient).toBe('almonds');
    }
  });

  it('FALCPA "fish" rule blocks "grilled salmon" (synonym match)', () => {
    const items = [item({ ingredients: ['grilled salmon'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts[0].allergen).toBe('fish');
    }
  });

  it('FALCPA "milk" rule blocks "cheddar cheese" (synonym match)', () => {
    const items = [item({ ingredients: ['cheddar cheese'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts.some((c) => c.allergen === 'milk')).toBe(true);
    }
  });

  it('FALCPA "wheat" rule blocks "pasta" (synonym match)', () => {
    const items = [item({ ingredients: ['pasta'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
  });

  it('FALCPA "eggs" rule blocks "mayonnaise" (synonym match)', () => {
    const items = [item({ ingredients: ['mayonnaise'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
  });

  it('FALCPA "soy" rule blocks "tofu" (synonym match)', () => {
    const items = [item({ ingredients: ['tofu'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
  });

  it('FALCPA "shellfish" rule blocks "shrimp" (synonym match)', () => {
    const items = [item({ ingredients: ['shrimp'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
  });

  it('FALCPA "sesame" rule blocks "tahini" (synonym match)', () => {
    const items = [item({ ingredients: ['tahini'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
  });

  it('FALCPA "peanuts" rule blocks "groundnut paste" (synonym match)', () => {
    const items = [item({ ingredients: ['groundnut paste'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
  });

  // -------------------- D4: Conflict.day field (P18) --------------------

  it('emits day on every conflict', () => {
    const items = [
      item({ day: 'monday', ingredients: ['crushed peanuts'] }),
      item({ day: 'wednesday', ingredients: ['crushed peanuts'] }),
    ];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      const days = result.conflicts.map((c) => c.day).sort();
      expect(days).toEqual(['monday', 'wednesday']);
    }
  });

  // -------------------- P14: dedup --------------------

  it('deduplicates identical conflicts when two parent_declared rules overlap', () => {
    // Two rules for the same non-FALCPA allergen (different rows from a hypothetical
    // duplicate-write upstream). Ingredient must not also match any FALCPA category.
    const rules = [
      ...FALCPA_BASELINE,
      rule({ allergen: 'cilantro', rule_type: 'parent_declared', id: 'rule-1-uuid' }),
      rule({ allergen: 'cilantro', rule_type: 'parent_declared', id: 'rule-2-uuid' }),
    ];
    const items = [item({ ingredients: ['cilantro'] })];
    const result = evaluate(items, rules);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].allergen).toBe('cilantro');
    }
  });

  // -------------------- D3 / P17: empty inputs → uncertain --------------------

  it('returns uncertain when planItems is empty', () => {
    const result = evaluate([], FALCPA_BASELINE);
    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') expect(result.reason).toBe('empty_plan_items');
  });

  it('returns uncertain when any plan item has empty ingredients', () => {
    const items = [item({ ingredients: [] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') expect(result.reason).toBe('empty_ingredients');
  });

  // -------------------- D2 / P2: fail-closed on missing rules --------------------

  it('returns uncertain when rules array is empty', () => {
    const items = [item({ ingredients: ['rice'] })];
    const result = evaluate(items, []);
    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') expect(result.reason).toBe('no_rules_loaded');
  });

  it('returns uncertain when FALCPA baseline is missing (only parent_declared rules)', () => {
    const rules = [rule({ allergen: 'cilantro', rule_type: 'parent_declared' })];
    const items = [item({ ingredients: ['rice'] })];
    const result = evaluate(items, rules);
    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') expect(result.reason).toBe('falcpa_baseline_missing');
  });

  // -------------------- P9: input size guard --------------------

  it('returns uncertain when planItems exceeds the engine cap', () => {
    const items = Array.from({ length: 51 }, () => item({ ingredients: ['rice'] }));
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') expect(result.reason).toBe('plan_items_exceeds_max');
  });

  it('returns uncertain when an ingredients array exceeds the engine cap', () => {
    const items = [item({ ingredients: Array.from({ length: 21 }, () => 'rice') })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') expect(result.reason).toBe('ingredients_exceeds_max');
  });

  // -------------------- P12: whitespace + Unicode --------------------

  it('handles leading/trailing whitespace in ingredient strings', () => {
    const items = [item({ ingredients: ['  peanut sauce  '] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
  });

  it('handles parent-declared allergen in non-Latin script (Japanese)', () => {
    const rules = [
      ...FALCPA_BASELINE,
      rule({ allergen: 'ピーナッツ', rule_type: 'parent_declared' }),
    ];
    const items = [item({ ingredients: ['ピーナッツバター'] })];
    const result = evaluate(items, rules);
    expect(result.verdict).toBe('blocked');
  });
});
