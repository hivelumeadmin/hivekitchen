import { describe, it, expect } from 'vitest';
import {
  COMPOUND_SUSPECT_TOKENS,
  evaluate,
  isSuspectCompound,
  type AllergyRule,
} from './allergy-rules.engine.js';
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
  rule({ allergen: 'peanut' }),
  rule({ allergen: 'tree_nut' }),
  rule({ allergen: 'dairy' }),
  rule({ allergen: 'egg' }),
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
          allergen: 'peanut',
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
      expect(allergens).toEqual(['fish', 'peanut']);
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

  it('matching is case-insensitive ("Peanuts" in ingredient matches "peanut" rule)', () => {
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

  it('FALCPA "tree_nut" rule blocks "almonds" (synonym match)', () => {
    const items = [item({ ingredients: ['almonds'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts[0].allergen).toBe('tree_nut');
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
      expect(result.conflicts.some((c) => c.allergen === 'dairy')).toBe(true);
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

  it('FALCPA "peanut" rule blocks "groundnut paste" (synonym match)', () => {
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
    const items = Array.from({ length: 251 }, () => item({ ingredients: ['rice'] }));
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') expect(result.reason).toBe('plan_items_exceeds_max');
  });

  it('returns uncertain when an ingredients array exceeds the engine cap', () => {
    const items = [item({ ingredients: Array.from({ length: 81 }, () => 'rice') })];
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

  // Story 3.23 — bag-wide allergy invariant (FR113). The engine never reads
  // school_policies; `school_policies.slot_scope` governs which slot the
  // planner regenerates, NOT which slots the guardrail evaluates. A peanut in
  // the Snack slot is still blocked even when the school's "no peanut" policy
  // is scoped to Main only.
  it('blocks peanut in snack slot even when school policy scope is main-only', () => {
    const rules: AllergyRule[] = [
      ...FALCPA_BASELINE,
      rule({ allergen: 'peanut', child_id: CHILD_A, rule_type: 'parent_declared' }),
    ];
    const items = [
      item({ child_id: CHILD_A, day: 'monday', slot: 'snack', ingredients: ['peanut butter'] }),
    ];
    expect(evaluate(items, rules).verdict).toBe('blocked');
  });

  // -------------------- Story 3.24 — FALCPA synonym extensions --------------------

  it('FALCPA "fish" rule blocks "worcestershire" (3.24 synonym, anchovy-based)', () => {
    // Use the bare token rather than "worcestershire sauce" — the latter also
    // matches "soy" via the "sauce" token (engine is intentionally over-strict;
    // "soy sauce" is already a known synonym). The 3.24 addition is the
    // worcestershire → fish path specifically.
    const items = [item({ ingredients: ['worcestershire'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts.some((c) => c.allergen === 'fish')).toBe(true);
    }
  });

  it('FALCPA "sesame" rule blocks "za\'atar" (3.24 synonym)', () => {
    const items = [item({ ingredients: ["za'atar"] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts[0].allergen).toBe('sesame');
    }
  });

  it('FALCPA "sesame" rule blocks "zaatar" (3.24 synonym, unaccented)', () => {
    const items = [item({ ingredients: ['zaatar blend'] })];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('blocked');
  });

  // -------------------- Story 3.24 — compound detection --------------------

  it('isSuspectCompound returns true for "garam masala"', () => {
    expect(isSuspectCompound('garam masala')).toBe(true);
  });

  it('isSuspectCompound returns true for "ranch dressing"', () => {
    expect(isSuspectCompound('ranch dressing')).toBe(true);
  });

  it('isSuspectCompound returns true for "spice blend"', () => {
    expect(isSuspectCompound('spice blend')).toBe(true);
  });

  it('isSuspectCompound returns false for "blended" (false-positive guard on " blend" with leading space)', () => {
    expect(isSuspectCompound('blended smoothie')).toBe(false);
  });

  it('isSuspectCompound returns false for a plain ingredient like "chicken"', () => {
    expect(isSuspectCompound('chicken')).toBe(false);
  });

  it('COMPOUND_SUSPECT_TOKENS covers the documented set', () => {
    expect(COMPOUND_SUSPECT_TOKENS).toContain('masala');
    expect(COMPOUND_SUSPECT_TOKENS).toContain('curry paste');
    expect(COMPOUND_SUSPECT_TOKENS).toContain('chutney');
  });

  it('flags compound ingredient as uncertain when child has a parent_declared rule', () => {
    const rules: AllergyRule[] = [
      ...FALCPA_BASELINE,
      rule({ allergen: 'cilantro', child_id: CHILD_A, rule_type: 'parent_declared' }),
    ];
    const items = [
      item({ child_id: CHILD_A, day: 'tuesday', slot: 'main', ingredients: ['rice', 'garam masala', 'broccoli'] }),
    ];
    const result = evaluate(items, rules);
    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') {
      expect(result.reason).toBe('compound_ingredient_unverified');
      expect(result.flagged_items).toBeDefined();
      expect(result.flagged_items).toHaveLength(1);
      expect(result.flagged_items?.[0]).toEqual({
        child_id: CHILD_A,
        ingredient: 'garam masala',
        slot: 'main',
        day: 'tuesday',
      });
    }
  });

  it('FALCPA-only child sees compound ingredient as cleared (no parent_declared scope)', () => {
    const items = [
      item({ child_id: CHILD_A, ingredients: ['rice', 'garam masala'] }),
    ];
    const result = evaluate(items, FALCPA_BASELINE);
    expect(result.verdict).toBe('cleared');
  });

  it('blocked takes priority over compound: peanut + masala in same plan returns blocked', () => {
    const rules: AllergyRule[] = [
      ...FALCPA_BASELINE,
      rule({ allergen: 'cilantro', child_id: CHILD_A, rule_type: 'parent_declared' }),
    ];
    const items = [
      item({ child_id: CHILD_A, day: 'monday', slot: 'main', ingredients: ['crushed peanuts'] }),
      item({ child_id: CHILD_A, day: 'tuesday', slot: 'main', ingredients: ['garam masala'] }),
    ];
    const result = evaluate(items, rules);
    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      // Compound scan never runs because blocked short-circuits the cleared return.
      expect(result.conflicts.some((c) => c.allergen === 'peanut')).toBe(true);
    }
  });

  it('compound scan skips children without parent_declared rules even when parent_declared rule exists for another child', () => {
    const rules: AllergyRule[] = [
      ...FALCPA_BASELINE,
      rule({ allergen: 'cilantro', child_id: CHILD_A, rule_type: 'parent_declared' }),
    ];
    const items = [
      item({ child_id: CHILD_B, day: 'monday', slot: 'main', ingredients: ['garam masala'] }),
    ];
    const result = evaluate(items, rules);
    expect(result.verdict).toBe('cleared');
  });

  it('deduplicates identical compound flags across iterations', () => {
    const rules: AllergyRule[] = [
      ...FALCPA_BASELINE,
      rule({ allergen: 'cilantro', child_id: CHILD_A, rule_type: 'parent_declared' }),
      rule({ allergen: 'mango', child_id: CHILD_A, rule_type: 'parent_declared' }),
    ];
    const items = [
      item({ child_id: CHILD_A, day: 'monday', slot: 'main', ingredients: ['garam masala'] }),
    ];
    const result = evaluate(items, rules);
    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') {
      expect(result.flagged_items).toHaveLength(1);
    }
  });

  it('flags multiple compound ingredients in the same plan (one entry per slot)', () => {
    const rules: AllergyRule[] = [
      ...FALCPA_BASELINE,
      rule({ allergen: 'cilantro', child_id: CHILD_A, rule_type: 'parent_declared' }),
    ];
    const items = [
      item({ child_id: CHILD_A, day: 'monday', slot: 'main', ingredients: ['garam masala'] }),
      item({ child_id: CHILD_A, day: 'wednesday', slot: 'main', ingredients: ['ranch dressing'] }),
    ];
    const result = evaluate(items, rules);
    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') {
      expect(result.flagged_items).toHaveLength(2);
    }
  });
});

// pre-4-s0 — Canonical-key synonym expansion coverage.
//
// Story 2.6-s7 renamed the engine's FALCPA canonical keys from plural to
// singular (eggs→egg, tree_nuts→tree_nut). Onboarding chip keys and stored
// allergen rows were not updated, so synonym expansion broke for `egg` and
// `tree_nut`. This block locks in correct expansion for every canonical key
// and gives the two previously-broken keys an explicit regression guard.
describe('FALCPA synonym expansion — canonical key coverage', () => {
  function declareRule(allergen: string): AllergyRule {
    return {
      id: 'rule-pd',
      household_id: HOUSEHOLD_ID,
      child_id: null,
      rule_type: 'parent_declared',
      allergen,
    };
  }

  // For each canonical key, a known synonym must yield a `blocked` verdict.
  // Rules: one parent_declared rule for the canonical key, plus the FALCPA
  // baseline so the engine's "baseline missing" fail-closed branch is bypassed.
  const cases: ReadonlyArray<[string, string]> = [
    ['peanut', 'groundnut paste'],
    ['tree_nut', 'sliced almonds'],
    ['dairy', 'butter'],
    ['egg', 'mayonnaise'],
    ['wheat', 'semolina'],
    ['soy', 'edamame'],
    ['fish', 'worcestershire'],
    ['shellfish', 'calamari'],
    ['sesame', 'tahini'],
  ];

  for (const [canonicalKey, synonym] of cases) {
    it(`canonical "${canonicalKey}" rule blocks ingredient "${synonym}"`, () => {
      const rules = [...FALCPA_BASELINE, declareRule(canonicalKey)];
      const result = evaluate([item({ ingredients: [synonym] })], rules);
      expect(result.verdict).toBe('blocked');
      if (result.verdict === 'blocked') {
        expect(result.conflicts.some((c) => c.allergen === canonicalKey)).toBe(true);
      }
    });
  }

  // Regression guards — the two keys that 2.6-s7 left orphaned in the
  // onboarding chip set. A parent_declared 'egg' rule MUST detect 'albumin';
  // a 'tree_nut' rule MUST detect 'cashews'.
  it('previously-broken key: "egg" rule detects "albumin"', () => {
    const rules = [...FALCPA_BASELINE, declareRule('egg')];
    const result = evaluate([item({ ingredients: ['albumin'] })], rules);
    expect(result.verdict).toBe('blocked');
  });

  it('previously-broken key: "tree_nut" rule detects "cashews"', () => {
    const rules = [...FALCPA_BASELINE, declareRule('tree_nut')];
    const result = evaluate([item({ ingredients: ['cashews'] })], rules);
    expect(result.verdict).toBe('blocked');
  });

  // Backfill safety guards — assert that a STALE parent_declared rule does NOT
  // expand synonyms when there is no canonical falcpa rule for that allergen.
  //
  // The FALCPA_BASELINE (all 9 canonical falcpa rules) is intentionally EXCLUDED
  // from these tests so the parent_declared path is isolated. Including the
  // 'egg' falcpa baseline would cause it to expand to 'mayonnaise' via
  // FALCPA_SYNONYMS.egg — masking the exact gap the backfill closes.
  //
  // In production a child whose backfill row was skipped has ONLY the stale
  // parent_declared rule (the falcpa rule uses the canonical key from
  // allergen_tags and fires separately); this test captures that scenario.
  it('legacy key "eggs" parent_declared rule does NOT expand to mayonnaise (backfill safety guard)', () => {
    // One unrelated falcpa rule satisfies the engine's fail-closed baseline check.
    const rules = [rule({ allergen: 'peanut', rule_type: 'falcpa' }), declareRule('eggs')];
    const result = evaluate([item({ ingredients: ['mayonnaise'] })], rules);
    // targetsFor('eggs') === ['eggs']; 'mayonnaise'.includes('eggs') === false
    expect(result.verdict).toBe('cleared');
  });

  it('legacy key "tree-nuts" parent_declared rule does NOT expand to almonds (backfill safety guard)', () => {
    const rules = [rule({ allergen: 'peanut', rule_type: 'falcpa' }), declareRule('tree-nuts')];
    const result = evaluate([item({ ingredients: ['almonds'] })], rules);
    // targetsFor('tree-nuts') === ['tree-nuts']; no match for 'almonds'
    expect(result.verdict).toBe('cleared');
  });
});
