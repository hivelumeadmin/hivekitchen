import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { createCulturalLookupSpec } from './cultural.tools.js';
import type { CulturalPriorService } from '../../modules/cultural-priors/cultural-prior.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PRIOR_ID = '22222222-2222-4222-8222-222222222222';

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

describe('createCulturalLookupSpec', () => {
  it('declares name and maxLatencyMs', () => {
    const { redis } = buildRedis();
    const service = { listByHousehold: vi.fn().mockResolvedValue([]) } as unknown as CulturalPriorService;
    const spec = createCulturalLookupSpec(service, redis);
    expect(spec.name).toBe('cultural.lookup');
    expect(spec.maxLatencyMs).toBe(80);
  });

  it('maps listByHousehold result to CulturalLookupOutputSchema shape', async () => {
    const { redis } = buildRedis();
    const service = {
      listByHousehold: vi.fn().mockResolvedValue([
        {
          id: PRIOR_ID,
          household_id: HOUSEHOLD_ID,
          key: 'south_asian',
          label: 'South Asian',
          tier: 'L1',
          state: 'opt_in_confirmed',
          presence: 80,
          confidence: 90,
          opted_in_at: '2026-04-28T10:00:00.000Z',
          opted_out_at: null,
          last_signal_at: '2026-04-28T10:00:00.000Z',
          created_at: '2026-04-28T10:00:00.000Z',
          updated_at: '2026-04-28T10:00:00.000Z',
        },
      ]),
    } as unknown as CulturalPriorService;
    const spec = createCulturalLookupSpec(service, redis);
    const result = await spec.fn({ household_id: HOUSEHOLD_ID });
    expect(result).toEqual({
      priors: [
        {
          id: PRIOR_ID,
          key: 'south_asian',
          label: 'South Asian',
          state: 'opt_in_confirmed',
          tier: 'L1',
        },
      ],
    });
  });

  it('filters out non-confirmed states — detected/forgotten priors are excluded', async () => {
    const { redis } = buildRedis();
    const service = {
      listByHousehold: vi.fn().mockResolvedValue([
        { id: PRIOR_ID, household_id: HOUSEHOLD_ID, key: 'south_asian', label: 'South Asian', tier: 'L1', state: 'opt_in_confirmed', presence: 80, confidence: 90, opted_in_at: null, opted_out_at: null, last_signal_at: null, created_at: '2026-04-28T10:00:00.000Z', updated_at: '2026-04-28T10:00:00.000Z' },
        { id: '33333333-3333-4333-8333-333333333333', household_id: HOUSEHOLD_ID, key: 'halal', label: 'Halal', tier: 'L1', state: 'detected', presence: 40, confidence: 50, opted_in_at: null, opted_out_at: null, last_signal_at: null, created_at: '2026-04-28T10:00:00.000Z', updated_at: '2026-04-28T10:00:00.000Z' },
        { id: '44444444-4444-4444-8444-444444444444', household_id: HOUSEHOLD_ID, key: 'kosher', label: 'Kosher', tier: 'L1', state: 'forgotten', presence: 10, confidence: 10, opted_in_at: null, opted_out_at: null, last_signal_at: null, created_at: '2026-04-28T10:00:00.000Z', updated_at: '2026-04-28T10:00:00.000Z' },
      ]),
    } as unknown as CulturalPriorService;
    const spec = createCulturalLookupSpec(service, redis);
    const result = (await spec.fn({ household_id: HOUSEHOLD_ID })) as { priors: unknown[] };
    expect(result.priors).toHaveLength(1);
    expect((result.priors[0] as { key: string }).key).toBe('south_asian');
  });

  it('records tool latency in finally even when service throws', async () => {
    const { redis, pipeline } = buildRedis();
    const service = {
      listByHousehold: vi.fn().mockRejectedValue(new Error('db-down')),
    } as unknown as CulturalPriorService;
    const spec = createCulturalLookupSpec(service, redis);
    await expect(spec.fn({ household_id: HOUSEHOLD_ID })).rejects.toThrow('db-down');
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });
});
