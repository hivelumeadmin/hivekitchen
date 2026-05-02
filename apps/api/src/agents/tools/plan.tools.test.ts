import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import type { Redis } from 'ioredis';
import { createPlanComposeSpec } from './plan.tools.js';
import type { PlansService } from '../../modules/plans/plans.service.js';
import { NotImplementedError } from '../../common/errors.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const MEAL_ID = '22222222-2222-4222-8222-222222222222';

const VALID_INPUT = {
  household_id: HOUSEHOLD_ID,
  week_of: '2026-05-04',
  days: [{ day: 'monday' as const, meal: { id: MEAL_ID, name: 'Rice and lentils' } }],
  prompt_version: 'v1.0.0',
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

describe('createPlanComposeSpec', () => {
  it('declares name and maxLatencyMs', () => {
    const { redis } = buildRedis();
    const service = { compose: vi.fn() } as unknown as PlansService;
    const spec = createPlanComposeSpec(service, redis);
    expect(spec.name).toBe('plan.compose');
    expect(spec.maxLatencyMs).toBe(2000);
  });

  it('inputSchema rejects missing prompt_version', () => {
    const { redis } = buildRedis();
    const service = { compose: vi.fn() } as unknown as PlansService;
    const spec = createPlanComposeSpec(service, redis);
    const { prompt_version: _drop, ...rest } = VALID_INPUT;
    expect(spec.inputSchema.safeParse(rest).success).toBe(false);
  });

  it('fn propagates NotImplementedError and still records latency', async () => {
    const { redis, pipeline } = buildRedis();
    const service = {
      compose: vi.fn().mockRejectedValue(new NotImplementedError('plan.compose — Story 3.5')),
    } as unknown as PlansService;
    const spec = createPlanComposeSpec(service, redis);
    await expect(spec.fn(VALID_INPUT)).rejects.toBeInstanceOf(NotImplementedError);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed input via inputSchema.parse before calling service', async () => {
    const { redis } = buildRedis();
    const service = { compose: vi.fn() } as unknown as PlansService;
    const spec = createPlanComposeSpec(service, redis);
    await expect(spec.fn({})).rejects.toBeInstanceOf(ZodError);
    expect(service.compose).not.toHaveBeenCalled();
  });
});
