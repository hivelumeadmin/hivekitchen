import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import type { Redis } from 'ioredis';
import { createPantryReadSpec } from './pantry.tools.js';
import type { PantryService } from '../../modules/pantry/pantry.service.js';
import { NotImplementedError } from '../../common/errors.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

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

describe('createPantryReadSpec', () => {
  it('declares name and maxLatencyMs', () => {
    const { redis } = buildRedis();
    const service = { read: vi.fn() } as unknown as PantryService;
    const spec = createPantryReadSpec(service, redis);
    expect(spec.name).toBe('pantry.read');
    expect(spec.maxLatencyMs).toBe(80);
  });

  it('inputSchema rejects non-uuid household_id', () => {
    const { redis } = buildRedis();
    const service = { read: vi.fn() } as unknown as PantryService;
    const spec = createPantryReadSpec(service, redis);
    expect(spec.inputSchema.safeParse({ household_id: 'nope' }).success).toBe(false);
  });

  it('fn calls pantryService.read with parsed input and re-parses output', async () => {
    const { redis } = buildRedis();
    const service = {
      read: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as PantryService;
    const spec = createPantryReadSpec(service, redis);
    const result = await spec.fn({ household_id: HOUSEHOLD_ID });
    expect(result).toEqual({ items: [] });
    expect(service.read).toHaveBeenCalledWith(expect.objectContaining({ household_id: HOUSEHOLD_ID }));
  });

  it('records tool latency in finally even when service throws NotImplementedError', async () => {
    const { redis, pipeline } = buildRedis();
    const service = {
      read: vi.fn().mockRejectedValue(new NotImplementedError('pantry.read — not yet')),
    } as unknown as PantryService;
    const spec = createPantryReadSpec(service, redis);
    await expect(spec.fn({ household_id: HOUSEHOLD_ID })).rejects.toBeInstanceOf(
      NotImplementedError,
    );
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed input via inputSchema.parse before calling service', async () => {
    const { redis } = buildRedis();
    const service = { read: vi.fn() } as unknown as PantryService;
    const spec = createPantryReadSpec(service, redis);
    await expect(spec.fn({})).rejects.toBeInstanceOf(ZodError);
    expect(service.read).not.toHaveBeenCalled();
  });
});
