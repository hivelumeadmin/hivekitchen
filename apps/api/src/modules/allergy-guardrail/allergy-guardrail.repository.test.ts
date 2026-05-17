import { describe, it, expect, vi } from 'vitest';
import { AllergyGuardrailRepository } from './allergy-guardrail.repository.js';
import { encryptField } from '../../lib/envelope-encryption.js';
import { evaluate, type AllergyRule } from './allergy-rules.engine.js';
import type { PlanItemForGuardrail } from '@hivekitchen/types';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CHILD_ID = '33333333-3333-4333-8333-333333333333';

const FALCPA_SEED: Array<Omit<AllergyRule, 'id'>> = [
  { household_id: null, child_id: null, allergen: 'peanuts', rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'tree_nuts', rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'milk', rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'eggs', rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'wheat', rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'soy', rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'fish', rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'shellfish', rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'sesame', rule_type: 'falcpa' },
];

interface MockOpts {
  /** Decrypted (plain) array; tests pass plain string[] and the mock encrypts via NOOP. */
  householdAllergens?: string[] | null;
  /** Mapping of child_id → declared_allergens array (plain). */
  childAllergens?: Array<{ id: string; allergens: string[] | null }>;
}

function buildMockSupabase(opts: MockOpts) {
  // Use the NOOP cipher branch (dek=null + encryptField) so the encrypted
  // text we hand back from .from('households') / .from('children') decodes
  // cleanly inside the repository without a real DEK setup.
  const householdRow =
    opts.householdAllergens === undefined
      ? { declared_allergens: null }
      : opts.householdAllergens === null
        ? { declared_allergens: null }
        : { declared_allergens: encryptField(opts.householdAllergens, null) };

  const childRows = (opts.childAllergens ?? []).map((c) => ({
    id: c.id,
    declared_allergens:
      c.allergens === null ? null : encryptField(c.allergens, null),
  }));

  return {
    from(table: string) {
      if (table === 'allergy_rules') {
        return {
          select: () => ({
            is: () => Promise.resolve({ data: FALCPA_SEED, error: null }),
          }),
        };
      }
      if (table === 'households') {
        // The repository also reads the household row for the DEK from another
        // codepath — but with NOOP-encrypted fixtures, getHouseholdDek can
        // return null and decryptField still works.
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: householdRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'children') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: childRows, error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function makeRepo(opts: MockOpts): AllergyGuardrailRepository {
  // KEK null → all decrypts use the NOOP path (matches the encryptField
  // calls in the mock).
  return new AllergyGuardrailRepository(
    buildMockSupabase(opts) as unknown as Parameters<
      typeof AllergyGuardrailRepository.prototype.getRulesForHousehold
    > extends never
      ? never
      : ConstructorParameters<typeof AllergyGuardrailRepository>[0],
    null,
  );
}

describe('AllergyGuardrailRepository.getRulesForHousehold', () => {
  it('returns FALCPA seed alone when nothing is declared anywhere', async () => {
    const repo = makeRepo({
      householdAllergens: null,
      childAllergens: [{ id: CHILD_ID, allergens: null }],
    });
    const rules = await repo.getRulesForHousehold(HOUSEHOLD_ID);
    expect(rules).toHaveLength(FALCPA_SEED.length);
    expect(rules.every((r) => r.rule_type === 'falcpa')).toBe(true);
  });

  it('adds household-scoped synthetic rules from households.declared_allergens', async () => {
    const repo = makeRepo({
      householdAllergens: ['pork', 'shellfish'],
      childAllergens: [],
    });
    const rules = await repo.getRulesForHousehold(HOUSEHOLD_ID);
    const synthetic = rules.filter((r) => r.rule_type === 'parent_declared');
    expect(synthetic).toHaveLength(2);
    expect(synthetic.every((r) => r.child_id === null)).toBe(true);
    expect(synthetic.map((r) => r.allergen).sort()).toEqual(['pork', 'shellfish']);
  });

  it('adds child-scoped synthetic rules from children.declared_allergens', async () => {
    const repo = makeRepo({
      householdAllergens: null,
      childAllergens: [
        { id: CHILD_ID, allergens: ['peanut'] },
        { id: OTHER_CHILD_ID, allergens: ['celery'] },
      ],
    });
    const rules = await repo.getRulesForHousehold(HOUSEHOLD_ID);
    const synthetic = rules.filter((r) => r.rule_type === 'parent_declared');
    expect(synthetic).toHaveLength(2);
    const byChild = Object.fromEntries(
      synthetic.map((r) => [r.child_id, r.allergen]),
    );
    expect(byChild[CHILD_ID]).toBe('peanut');
    expect(byChild[OTHER_CHILD_ID]).toBe('celery');
  });

  it('unions household + child allergens with FALCPA', async () => {
    const repo = makeRepo({
      householdAllergens: ['pork'],
      childAllergens: [{ id: CHILD_ID, allergens: ['celery'] }],
    });
    const rules = await repo.getRulesForHousehold(HOUSEHOLD_ID);
    expect(rules.length).toBe(FALCPA_SEED.length + 2);
    expect(rules.filter((r) => r.rule_type === 'parent_declared')).toHaveLength(2);
  });

  it('AC6 — non-FALCPA household-declared allergen blocks a matching plan item', async () => {
    // The safety-gap regression test: celery is NOT in FALCPA, so before
    // this slice it would have been recorded but not enforced. After the
    // rewrite, the household-declared rule appears in the rule set and
    // the engine blocks.
    const repo = makeRepo({
      householdAllergens: ['celery'],
      childAllergens: [],
    });
    const rules = await repo.getRulesForHousehold(HOUSEHOLD_ID);

    const items: PlanItemForGuardrail[] = [
      {
        child_id: CHILD_ID,
        day: 'tuesday',
        slot: 'main',
        ingredients: ['celery'],
      },
    ];
    const verdict = evaluate(items, rules as AllergyRule[]);

    expect(verdict.verdict).toBe('blocked');
    if (verdict.verdict === 'blocked') {
      expect(verdict.conflicts).toEqual([
        {
          child_id: CHILD_ID,
          allergen: 'celery',
          ingredient: 'celery',
          slot: 'main',
          day: 'tuesday',
        },
      ]);
    }

    // Substring match: declared allergen 'celery' also blocks 'celery root sticks'.
    const itemsSubstring: PlanItemForGuardrail[] = [
      { child_id: CHILD_ID, day: 'wednesday', slot: 'snack', ingredients: ['celery root sticks'] },
    ];
    const verdictSubstring = evaluate(itemsSubstring, rules as AllergyRule[]);
    expect(verdictSubstring.verdict).toBe('blocked');
    if (verdictSubstring.verdict === 'blocked') {
      expect(verdictSubstring.conflicts[0]?.allergen).toBe('celery');
      expect(verdictSubstring.conflicts[0]?.ingredient).toBe('celery root sticks');
    }
  });

  it('per-child non-FALCPA allergen blocks only for the matching child', async () => {
    const repo = makeRepo({
      householdAllergens: null,
      childAllergens: [
        { id: CHILD_ID, allergens: ['celery'] },
        { id: OTHER_CHILD_ID, allergens: null },
      ],
    });
    const rules = await repo.getRulesForHousehold(HOUSEHOLD_ID);

    // Celery for CHILD_ID — blocked.
    const matching: PlanItemForGuardrail[] = [
      { child_id: CHILD_ID, day: 'monday', slot: 'main', ingredients: ['celery'] },
    ];
    expect(evaluate(matching, rules as AllergyRule[]).verdict).toBe('blocked');

    // Celery for OTHER_CHILD_ID — cleared (rule only scopes to CHILD_ID).
    const otherChild: PlanItemForGuardrail[] = [
      {
        child_id: OTHER_CHILD_ID,
        day: 'monday',
        slot: 'main',
        ingredients: ['celery'],
      },
    ];
    expect(evaluate(otherChild, rules as AllergyRule[]).verdict).toBe('cleared');
  });

  it('rejects malformed household id', async () => {
    const repo = makeRepo({});
    await expect(repo.getRulesForHousehold('not-a-uuid')).rejects.toThrow();
  });
});

// makeRepo's constructor parameter type is wide; importing vi only for vi.fn
// usage in other files is unnecessary here. This sentinel keeps the imports
// from being marked unused if the test file is trimmed later.
void vi;
