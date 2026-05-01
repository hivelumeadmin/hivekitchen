import { describe, it, expect, vi } from 'vitest';
import { createAllergyCheckSpec, MANIFESTED_TOOL_NAMES } from './allergy.tools.js';
import type { AllergyGuardrailService } from '../../modules/allergy-guardrail/allergy-guardrail.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';

function buildService(): AllergyGuardrailService {
  return {
    evaluate: vi.fn().mockResolvedValue({ verdict: 'cleared', conflicts: [] }),
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
    const result = spec.inputSchema.safeParse({
      household_id: HOUSEHOLD_ID,
      plan_items: [
        { child_id: CHILD_ID, day: 'monday', slot: 'main', ingredients: ['rice'] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('inputSchema.parse({}) throws ZodError', () => {
    const spec = createAllergyCheckSpec(buildService());
    expect(() => spec.inputSchema.parse({})).toThrow();
  });

  it('declares MANIFESTED_TOOL_NAMES = ["allergy.check"]', () => {
    expect(MANIFESTED_TOOL_NAMES).toEqual(['allergy.check']);
  });
});
