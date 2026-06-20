import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { PlanItemForGuardrail } from '@hivekitchen/types';
import { AllergyGuardrailService } from './allergy-guardrail.service.js';
import type { AllergyGuardrailRepository } from './allergy-guardrail.repository.js';
import { AllergyGuardrailDecryptError } from './allergy-guardrail.repository.js';
import type { AllergyRule } from './allergy-rules.engine.js';
import type { AuditService } from '../../audit/audit.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_A = '22222222-2222-4222-8222-222222222222';
const CHILD_B = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function buildService(opts: { rules?: AllergyRule[]; decrypt?: boolean }) {
  const writeDecision = vi.fn().mockResolvedValue(undefined);
  const getRulesForHousehold = vi.fn(async () => {
    if (opts.decrypt) throw new AllergyGuardrailDecryptError(HOUSEHOLD_ID);
    return opts.rules ?? [];
  });
  const repo = { getRulesForHousehold, writeDecision } as unknown as AllergyGuardrailRepository;
  const audit = { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const service = new AllergyGuardrailService({ repository: repo, auditService: audit, logger: buildLogger() });
  return { service, writeDecision };
}

const falcpa = (a: string): AllergyRule => ({ id: a, household_id: null, child_id: null, allergen: a, rule_type: 'falcpa' });
const declared = (childId: string | null, a: string): AllergyRule => ({
  id: `d-${a}`, household_id: HOUSEHOLD_ID, child_id: childId, allergen: a, rule_type: 'parent_declared',
});
const item = (childId: string, ingredients: string[]): PlanItemForGuardrail => ({
  child_id: childId, day: 'monday', slot: 'main', ingredients,
});

describe('AllergyGuardrailService.clearOrRejectCommit (Story 3.S39)', () => {
  it('a real blocked conflict on a verifiable item wins over an unverifiable allergic slot', async () => {
    // CHILD_A: verifiable item with peanuts → engine returns blocked.
    // CHILD_B: also has declared peanut + an unverifiable recipe → would
    // generate an uncertain flag if the blocked short-circuit did not fire.
    // Without the short-circuit, result would be 'uncertain', not 'blocked'.
    const { service, writeDecision } = buildService({
      rules: [falcpa('peanut'), declared(CHILD_A, 'peanut'), declared(CHILD_B, 'peanut')],
    });

    const result = await service.clearOrRejectCommit({
      items: [item(CHILD_A, ['peanuts', 'rice'])],
      unverifiable: [{ child_id: CHILD_B, day: 'tuesday', slot: 'main', recipe_label: '(recipe ingredients unverified)' }],
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(result.verdict).toBe('blocked');
    expect(writeDecision).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'blocked' }));
  });

  it('flags an unverifiable slot only for a child with a declared allergen', async () => {
    // CHILD_A declared peanut; CHILD_B has none (FALCPA only).
    const { service } = buildService({ rules: [falcpa('peanut'), declared(CHILD_A, 'peanut')] });

    const result = await service.clearOrRejectCommit({
      items: [],
      unverifiable: [
        { child_id: CHILD_A, day: 'monday', slot: 'main', recipe_label: '(recipe ingredients unverified)' },
        { child_id: CHILD_B, day: 'monday', slot: 'main', recipe_label: '(recipe ingredients unverified)' },
      ],
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') {
      expect(result.reason).toBe('compound_ingredient_unverified');
      expect(result.flagged_items).toEqual([
        { child_id: CHILD_A, ingredient: '(recipe ingredients unverified)', slot: 'main', day: 'monday' },
      ]);
    }
  });

  it('clears when items are clean and no allergic child has an unverifiable recipe', async () => {
    const { service } = buildService({ rules: [falcpa('peanut'), declared(CHILD_B, 'peanut')] });

    const result = await service.clearOrRejectCommit({
      items: [item(CHILD_A, ['chicken', 'rice'])],
      // Only CHILD_A's recipe is unverifiable, but CHILD_A has no declared allergen.
      unverifiable: [{ child_id: CHILD_A, day: 'tuesday', slot: 'snack', recipe_label: 'x' }],
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(result.verdict).toBe('cleared');
  });

  it('merges engine compound flags with unverifiable flags', async () => {
    const { service } = buildService({ rules: [falcpa('peanut'), declared(CHILD_A, 'peanut')] });

    const result = await service.clearOrRejectCommit({
      // 'garam masala' is a compound suspect → engine flags it for CHILD_A.
      items: [item(CHILD_A, ['garam masala', 'rice'])],
      unverifiable: [{ child_id: CHILD_A, day: 'wednesday', slot: 'extra', recipe_label: '(recipe ingredients unverified)' }],
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') {
      expect(result.reason).toBe('compound_ingredient_unverified');
      const ingredients = (result.flagged_items ?? []).map((f) => f.ingredient);
      expect(ingredients).toContain('garam masala');
      expect(ingredients).toContain('(recipe ingredients unverified)');
    }
  });

  it('returns uncertain (decrypt failure) without flagging when allergen data cannot be read', async () => {
    const { service, writeDecision } = buildService({ decrypt: true });

    const result = await service.clearOrRejectCommit({
      items: [item(CHILD_A, ['chicken'])],
      unverifiable: [],
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(result.verdict).toBe('uncertain');
    if (result.verdict === 'uncertain') expect(result.reason).toBe('allergen_data_decrypt_failure');
    expect(writeDecision).toHaveBeenCalled();
  });

  // Story 3-S40 — snack-SKU slots are parent-attested; must NOT trigger the
  // fail-closed unverifiable path even when the child carries a declared allergen.
  it('clears when the only unverifiable slot is a snack-SKU slot (attested=true)', async () => {
    // CHILD_A has a declared peanut allergen. The snack slot is attested — it
    // should be exempted from the fail-closed guard entirely.
    const { service } = buildService({
      rules: [falcpa('peanut'), declared(CHILD_A, 'peanut')],
    });

    const result = await service.clearOrRejectCommit({
      items: [item(CHILD_A, ['chicken', 'rice'])],
      unverifiable: [
        {
          child_id: CHILD_A,
          day: 'monday',
          slot: 'snack',
          recipe_label: 'snack-sku (parent-attested)',
          attested: true,
        },
      ],
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(result.verdict).toBe('cleared');
  });

  it('does not exempt a non-attested unverifiable slot for an allergic child', async () => {
    const { service } = buildService({
      rules: [falcpa('peanut'), declared(CHILD_A, 'peanut')],
    });

    const result = await service.clearOrRejectCommit({
      items: [],
      unverifiable: [
        {
          child_id: CHILD_A,
          day: 'monday',
          slot: 'extra',
          recipe_label: '(recipe ingredients unverified)',
          // attested is absent (undefined) — normal fail-closed path
        },
      ],
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(result.verdict).toBe('uncertain');
  });
});
