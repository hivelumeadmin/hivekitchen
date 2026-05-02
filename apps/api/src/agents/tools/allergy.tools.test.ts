import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import { createAllergyCheckSpec, MANIFESTED_TOOL_NAMES } from './allergy.tools.js';
import type { AllergyGuardrailService } from '../../modules/allergy-guardrail/allergy-guardrail.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';

const VALID_INPUT = {
  household_id: HOUSEHOLD_ID,
  plan_items: [
    { child_id: CHILD_ID, day: 'monday', slot: 'main', ingredients: ['rice'] },
  ],
};

function buildService(verdict: 'cleared' | 'blocked' | 'uncertain' = 'cleared') {
  const cleared = { verdict: 'cleared' as const, conflicts: [] };
  const blocked = {
    verdict: 'blocked' as const,
    conflicts: [
      {
        child_id: CHILD_ID,
        allergen: 'peanuts',
        ingredient: 'peanut butter',
        slot: 'main',
        day: 'monday',
      },
    ],
  };
  const uncertain = { verdict: 'uncertain' as const, conflicts: [], reason: 'no_rules_loaded' };
  const result = verdict === 'blocked' ? blocked : verdict === 'uncertain' ? uncertain : cleared;
  return {
    evaluate: vi.fn().mockResolvedValue(result),
    clearOrReject: vi.fn(),
  } as unknown as AllergyGuardrailService;
}

describe('createAllergyCheckSpec', () => {
  it('returns ToolSpec with name "allergy.check"', () => {
    const spec = createAllergyCheckSpec(buildService());
    expect(spec.name).toBe('allergy.check');
  });

  it('declares maxLatencyMs === 150', () => {
    const spec = createAllergyCheckSpec(buildService());
    expect(spec.maxLatencyMs).toBe(150);
  });

  it('inputSchema accepts a valid AllergyCheckInput shape', () => {
    const spec = createAllergyCheckSpec(buildService());
    const result = spec.inputSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it('inputSchema.safeParse({}) fails with ZodError', () => {
    const spec = createAllergyCheckSpec(buildService());
    const result = spec.inputSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
    }
  });

  it('declares MANIFESTED_TOOL_NAMES = ["allergy.check"]', () => {
    expect(MANIFESTED_TOOL_NAMES).toEqual(['allergy.check']);
  });

  it('fn invokes service.evaluate with (plan_items, household_id)', async () => {
    const service = buildService('cleared');
    const spec = createAllergyCheckSpec(service);
    await spec.fn(VALID_INPUT);
    expect(service.evaluate).toHaveBeenCalledTimes(1);
    expect(service.evaluate).toHaveBeenCalledWith(VALID_INPUT.plan_items, VALID_INPUT.household_id);
  });

  it('fn returns the cleared verdict shape from the service', async () => {
    const spec = createAllergyCheckSpec(buildService('cleared'));
    const result = await spec.fn(VALID_INPUT);
    expect(result).toEqual({ verdict: 'cleared', conflicts: [] });
  });

  it('fn returns the blocked verdict shape from the service', async () => {
    const spec = createAllergyCheckSpec(buildService('blocked'));
    const result = await spec.fn(VALID_INPUT);
    expect(result).toMatchObject({ verdict: 'blocked' });
  });

  it('fn returns the uncertain verdict shape from the service', async () => {
    const spec = createAllergyCheckSpec(buildService('uncertain'));
    const result = await spec.fn(VALID_INPUT);
    expect(result).toMatchObject({ verdict: 'uncertain', reason: 'no_rules_loaded' });
  });

  it('fn rejects malformed input via inputSchema.parse before calling service', async () => {
    const service = buildService('cleared');
    const spec = createAllergyCheckSpec(service);
    await expect(spec.fn({})).rejects.toBeInstanceOf(ZodError);
    expect(service.evaluate).not.toHaveBeenCalled();
  });
});
