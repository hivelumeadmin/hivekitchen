import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import type { Redis } from 'ioredis';
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

function buildRedis() {
  const pipeline = {
    zadd: vi.fn().mockReturnThis(),
    zremrangebyscore: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };
  return {
    redis: { pipeline: vi.fn().mockReturnValue(pipeline) } as unknown as Redis,
    pipeline,
  };
}

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
    const { redis } = buildRedis();
    const spec = createAllergyCheckSpec(buildService(), redis);
    expect(spec.name).toBe('allergy.check');
  });

  it('declares maxLatencyMs === 150', () => {
    const { redis } = buildRedis();
    const spec = createAllergyCheckSpec(buildService(), redis);
    expect(spec.maxLatencyMs).toBe(150);
  });

  it('inputSchema accepts a valid AllergyCheckInput shape', () => {
    const { redis } = buildRedis();
    const spec = createAllergyCheckSpec(buildService(), redis);
    const result = spec.inputSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it('inputSchema.safeParse({}) fails with ZodError', () => {
    const { redis } = buildRedis();
    const spec = createAllergyCheckSpec(buildService(), redis);
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
    const { redis } = buildRedis();
    const service = buildService('cleared');
    const spec = createAllergyCheckSpec(service, redis);
    await spec.fn(VALID_INPUT);
    expect(service.evaluate).toHaveBeenCalledTimes(1);
    expect(service.evaluate).toHaveBeenCalledWith(VALID_INPUT.plan_items, VALID_INPUT.household_id);
  });

  it('fn returns the cleared verdict shape from the service', async () => {
    const { redis } = buildRedis();
    const spec = createAllergyCheckSpec(buildService('cleared'), redis);
    const result = await spec.fn(VALID_INPUT);
    expect(result).toEqual({ verdict: 'cleared', conflicts: [] });
  });

  it('fn returns the blocked verdict shape from the service', async () => {
    const { redis } = buildRedis();
    const spec = createAllergyCheckSpec(buildService('blocked'), redis);
    const result = await spec.fn(VALID_INPUT);
    expect(result).toMatchObject({ verdict: 'blocked' });
  });

  it('fn returns the uncertain verdict shape from the service', async () => {
    const { redis } = buildRedis();
    const spec = createAllergyCheckSpec(buildService('uncertain'), redis);
    const result = await spec.fn(VALID_INPUT);
    expect(result).toMatchObject({ verdict: 'uncertain', reason: 'no_rules_loaded' });
  });

  it('fn rejects malformed input via inputSchema.parse before calling service', async () => {
    const { redis } = buildRedis();
    const service = buildService('cleared');
    const spec = createAllergyCheckSpec(service, redis);
    await expect(spec.fn({})).rejects.toBeInstanceOf(ZodError);
    expect(service.evaluate).not.toHaveBeenCalled();
  });

  it('records tool latency in finally even when service.evaluate throws', async () => {
    const { redis, pipeline } = buildRedis();
    const service = {
      evaluate: vi.fn().mockRejectedValue(new Error('engine-down')),
      clearOrReject: vi.fn(),
    } as unknown as AllergyGuardrailService;
    const spec = createAllergyCheckSpec(service, redis);
    await expect(spec.fn(VALID_INPUT)).rejects.toThrow('engine-down');
    expect(pipeline.zadd).toHaveBeenCalledTimes(1);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('records tool latency on the success path too', async () => {
    const { redis, pipeline } = buildRedis();
    const spec = createAllergyCheckSpec(buildService('cleared'), redis);
    await spec.fn(VALID_INPUT);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });
});
