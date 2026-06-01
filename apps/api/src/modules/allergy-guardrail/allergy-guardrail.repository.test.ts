import { describe, it, expect, vi } from 'vitest';
import { AllergyGuardrailRepository } from './allergy-guardrail.repository.js';
import { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';
import { encryptField } from '../../lib/envelope-encryption.js';
import { evaluate, type AllergyRule } from './allergy-rules.engine.js';
import type { PlanItemForGuardrail } from '@hivekitchen/types';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CHILD_ID = '33333333-3333-4333-8333-333333333333';

const FALCPA_SEED: Array<Omit<AllergyRule, 'id'>> = [
  { household_id: null, child_id: null, allergen: 'peanut',    rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'tree_nut',  rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'dairy',     rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'egg',       rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'wheat',     rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'soy',       rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'fish',      rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'shellfish', rule_type: 'falcpa' },
  { household_id: null, child_id: null, allergen: 'sesame',    rule_type: 'falcpa' },
];

interface MockOpts {
  /** Decrypted (plain) array; tests pass plain string[] and the mock encrypts via NOOP. */
  householdAllergens?: string[] | null;
  /** Per-child structured allergens — slice 2.6-s8 read source. */
  childAllergens?: Array<{ id: string; allergens: string[] | null }>;
  /** Override allergen_tags rows returned by the mock. Defaults to full FALCPA_SEED. */
  allergenTagKeys?: string[];
  /** Force ChildAllergensRepository.findByHousehold to throw — exercises the
   *  fail-closed AllergyGuardrailDecryptError path. */
  childAllergensThrows?: boolean;
}

function buildMockSupabase(opts: MockOpts) {
  // Use the NOOP cipher branch (dek=null + encryptField) so the encrypted
  // text we hand back from .from('household_allergens') decodes cleanly
  // inside the repository without a real DEK setup.

  // Story 3-DM-B2 — household_allergens is the single source. NOOP encrypt
  // each plaintext allergen; child_id=NULL rows represent household-wide
  // rules, child_id=non-NULL represent per-child medical attribution.
  const householdAllergenRows: Array<{
    household_id: string;
    child_id: string | null;
    allergen: string;
    source: string;
  }> = [];
  for (const a of opts.householdAllergens ?? []) {
    householdAllergenRows.push({
      household_id: HOUSEHOLD_ID,
      child_id: null,
      allergen: encryptField(a, null),
      source: 'parent_edited',
    });
  }
  for (const c of opts.childAllergens ?? []) {
    if (c.allergens === null) continue;
    for (const a of c.allergens) {
      householdAllergenRows.push({
        household_id: HOUSEHOLD_ID,
        child_id: c.id,
        allergen: encryptField(a, null),
        source: 'child_medical',
      });
    }
  }

  return {
    from(table: string) {
      if (table === 'allergen_tags') {
        const tagData = (opts.allergenTagKeys ?? FALCPA_SEED.map((r) => r.allergen)).map((key) => ({ key }));
        return {
          select: () => ({
            eq: (col1: string, val1: string) => ({
              eq: (col2: string, val2: boolean) => {
                if (col1 !== 'rule_class' || val1 !== 'falcpa')
                  throw new Error(`allergen_tags: unexpected filter ${col1}=${val1}`);
                if (col2 !== 'is_active' || val2 !== true)
                  throw new Error(`allergen_tags: unexpected filter ${col2}=${String(val2)}`);
                return Promise.resolve({ data: tagData, error: null });
              },
            }),
          }),
        };
      }
      if (table === 'household_allergens') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: householdAllergenRows, error: null }),
          }),
        };
      }
      if (table === 'households') {
        // getHouseholdDek path still reads encrypted_dek when KEK is non-null.
        // KEK is null in these tests so the dek fetch is short-circuited and
        // this branch is not reached, but supplying a stub keeps any future
        // codepath safe.
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
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
  const client = buildMockSupabase(opts) as unknown as ConstructorParameters<
    typeof AllergyGuardrailRepository
  >[0];

  if (opts.childAllergensThrows === true) {
    // Story 3-DM-B2 — fail-closed path now triggers when the consolidated
    // household_allergens read throws. Injecting a stub repo lets us
    // simulate a decrypt failure without corrupting the mock supabase wiring.
    const stub = {
      findByHouseholdId: vi.fn().mockRejectedValue(new Error('decrypt failed')),
    } as unknown as HouseholdAllergensRepository;
    return new AllergyGuardrailRepository(client, null, stub);
  }

  return new AllergyGuardrailRepository(client, null);
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

  it('peanut-key synonym expansion blocks "peanut butter"', async () => {
    const repo = makeRepo({ householdAllergens: null, childAllergens: [] });
    const rules = await repo.getRulesForHousehold(HOUSEHOLD_ID);
    const items: PlanItemForGuardrail[] = [
      { child_id: CHILD_ID, day: 'monday', slot: 'main', ingredients: ['peanut butter'] },
    ];
    const verdict = evaluate(items, rules as AllergyRule[]);
    expect(verdict.verdict).toBe('blocked');
  });

  it('dairy-key synonym expansion blocks "skim milk"', async () => {
    const repo = makeRepo({ householdAllergens: null, childAllergens: [] });
    const rules = await repo.getRulesForHousehold(HOUSEHOLD_ID);
    const items: PlanItemForGuardrail[] = [
      { child_id: CHILD_ID, day: 'tuesday', slot: 'main', ingredients: ['skim milk'] },
    ];
    const verdict = evaluate(items, rules as AllergyRule[]);
    expect(verdict.verdict).toBe('blocked');
  });

  it('rejects malformed household id', async () => {
    const repo = makeRepo({});
    await expect(repo.getRulesForHousehold('not-a-uuid')).rejects.toThrow();
  });

  // Slice 2.6-s8 — per-child reads come from child_allergens; legacy
  // children.declared_allergens column is no longer consulted.
  it('child_allergens decrypt failure → AllergyGuardrailDecryptError (fail-closed)', async () => {
    const repo = makeRepo({
      householdAllergens: null,
      childAllergens: [{ id: CHILD_ID, allergens: ['celery'] }],
      childAllergensThrows: true,
    });
    await expect(repo.getRulesForHousehold(HOUSEHOLD_ID)).rejects.toThrow(
      /allergen data decrypt failed/,
    );
  });

  it('only loads tags returned by is_active=true filter (deactivated tags excluded)', async () => {
    // Simulate one tag administratively deactivated by omitting it from mock data.
    const repo = makeRepo({
      allergenTagKeys: FALCPA_SEED.filter((r) => r.allergen !== 'peanut').map((r) => r.allergen),
      householdAllergens: null,
      childAllergens: [],
    });
    const rules = await repo.getRulesForHousehold(HOUSEHOLD_ID);
    const falcpa = rules.filter((r) => r.rule_type === 'falcpa');
    expect(falcpa).toHaveLength(FALCPA_SEED.length - 1);
    expect(falcpa.some((r) => r.allergen === 'peanut')).toBe(false);
  });
});

// makeRepo's constructor parameter type is wide; importing vi only for vi.fn
// usage in other files is unnecessary here. This sentinel keeps the imports
// from being marked unused if the test file is trimmed later.
void vi;
