import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import type { Redis } from 'ioredis';
import { createMemoryRecallSpec } from './memory.tools.js';
import type { MemoryService } from '../../modules/memory/memory.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';

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

function buildService(nodes = [
  {
    node_id: NODE_ID,
    node_type: 'preference' as const,
    facet: 'avoids spicy',
    prose_text: 'Child avoids spicy food.',
    subject_child_id: null,
    confidence: 1.0,
  },
]) {
  return {
    recall: vi.fn().mockResolvedValue({ nodes }),
  } as unknown as MemoryService;
}

describe('createMemoryRecallSpec', () => {
  it('declares name "memory.recall" and maxLatencyMs 200', () => {
    const { redis } = buildRedis();
    const spec = createMemoryRecallSpec(buildService(), redis);
    expect(spec.name).toBe('memory.recall');
    expect(spec.maxLatencyMs).toBe(200);
  });

  it('inputSchema rejects non-uuid household_id', () => {
    const { redis } = buildRedis();
    const spec = createMemoryRecallSpec(buildService(), redis);
    expect(spec.inputSchema.safeParse({ household_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('inputSchema applies limit default of 20 when omitted', () => {
    const { redis } = buildRedis();
    const spec = createMemoryRecallSpec(buildService(), redis);
    const r = spec.inputSchema.safeParse({ household_id: HOUSEHOLD_ID });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as { limit: number }).limit).toBe(20);
  });

  it('fn calls memoryService.recall with parsed input and returns nodes', async () => {
    const { redis } = buildRedis();
    const service = buildService();
    const spec = createMemoryRecallSpec(service, redis);
    const result = await spec.fn({ household_id: HOUSEHOLD_ID, facets: ['preference'], limit: 5 });
    expect(service.recall).toHaveBeenCalledWith(
      expect.objectContaining({ household_id: HOUSEHOLD_ID, facets: ['preference'], limit: 5 }),
    );
    expect(result).toEqual({
      nodes: [
        {
          node_id: NODE_ID,
          node_type: 'preference',
          facet: 'avoids spicy',
          prose_text: 'Child avoids spicy food.',
          subject_child_id: null,
          confidence: 1.0,
        },
      ],
    });
  });

  it('fn rejects malformed input before calling service', async () => {
    const { redis } = buildRedis();
    const service = buildService();
    const spec = createMemoryRecallSpec(service, redis);
    await expect(spec.fn({})).rejects.toBeInstanceOf(ZodError);
    expect(service.recall).not.toHaveBeenCalled();
  });

  it('records tool latency in finally even when service throws', async () => {
    const { redis, pipeline } = buildRedis();
    const service = {
      recall: vi.fn().mockRejectedValue(new Error('db-down')),
    } as unknown as MemoryService;
    const spec = createMemoryRecallSpec(service, redis);
    await expect(spec.fn({ household_id: HOUSEHOLD_ID })).rejects.toThrow('db-down');
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('records tool latency on the success path too', async () => {
    const { redis, pipeline } = buildRedis();
    const spec = createMemoryRecallSpec(buildService(), redis);
    await spec.fn({ household_id: HOUSEHOLD_ID });
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });
});
