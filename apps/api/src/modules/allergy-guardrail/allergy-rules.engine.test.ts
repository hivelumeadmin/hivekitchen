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
    ingredients: [],
    ...overrides,
  };
}

describe('allergy-rules.engine.evaluate', () => {
  it('returns cleared with empty conflicts when no ingredient matches any rule', () => {
    const rules = [rule({ allergen: 'peanuts' }), rule({ allergen: 'milk' })];
    const items = [item({ ingredients: ['rice', 'broccoli', 'olive oil'] })];

    const result = evaluate(items, rules);

    expect(result).toEqual({ verdict: 'cleared', conflicts: [] });
  });

  it('returns blocked when a FALCPA allergen name appears as a substring in an ingredient', () => {
    const rules = [rule({ allergen: 'peanuts' })];
    const items = [item({ ingredients: ['peanut butter'] })];

    const result = evaluate(items, rules);

    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts).toEqual([
        { child_id: CHILD_A, allergen: 'peanuts', ingredient: 'peanut butter', slot: 'main' },
      ]);
    }
  });

  it('returns blocked for a parent_declared rule match', () => {
    const rules = [rule({ allergen: 'cilantro', rule_type: 'parent_declared' })];
    const items = [item({ ingredients: ['fresh cilantro'] })];

    const result = evaluate(items, rules);

    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts[0].allergen).toBe('cilantro');
    }
  });

  it('collects all conflicts when multiple ingredients match (no short-circuit)', () => {
    const rules = [rule({ allergen: 'peanuts' }), rule({ allergen: 'milk' })];
    const items = [item({ ingredients: ['peanut butter', 'whole milk'] })];

    const result = evaluate(items, rules);

    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      expect(result.conflicts).toHaveLength(2);
      const allergens = result.conflicts.map((c) => c.allergen).sort();
      expect(allergens).toEqual(['milk', 'peanuts']);
    }
  });

  it('child-scoped rule does NOT block items for a different child', () => {
    const rules = [rule({ allergen: 'peanuts', child_id: CHILD_A })];
    const items = [item({ child_id: CHILD_B, ingredients: ['peanut butter'] })];

    const result = evaluate(items, rules);

    expect(result.verdict).toBe('cleared');
  });

  it('household-wide rule (child_id = null) blocks items for any child in the plan', () => {
    const rules = [rule({ allergen: 'peanuts', child_id: null })];
    const items = [
      item({ child_id: CHILD_A, ingredients: ['peanut butter'] }),
      item({ child_id: CHILD_B, ingredients: ['peanut sauce'] }),
    ];

    const result = evaluate(items, rules);

    expect(result.verdict).toBe('blocked');
    if (result.verdict === 'blocked') {
      const childIds = result.conflicts.map((c) => c.child_id).sort();
      expect(childIds).toEqual([CHILD_A, CHILD_B].sort());
    }
  });

  it('matching is case-insensitive ("Peanuts" in ingredient matches "peanuts" rule)', () => {
    const rules = [rule({ allergen: 'peanuts' })];
    const items = [item({ ingredients: ['Roasted Peanuts'] })];

    const result = evaluate(items, rules);

    expect(result.verdict).toBe('blocked');
  });

  it('does NOT match unrelated ingredients ("sunflower butter" must not match "peanuts")', () => {
    const rules = [rule({ allergen: 'peanuts' })];
    const items = [item({ ingredients: ['sunflower butter'] })];

    const result = evaluate(items, rules);

    expect(result).toEqual({ verdict: 'cleared', conflicts: [] });
  });
});
