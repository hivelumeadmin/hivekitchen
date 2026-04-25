import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { recordToolLatency } from './tool-latency.histogram.js';

describe('recordToolLatency', () => {
  const mockPipeline = {
    zadd: vi.fn().mockReturnThis(),
    zremrangebyscore: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };

  const mockRedis = {
    pipeline: vi.fn().mockReturnValue(mockPipeline),
  } as unknown as Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockRedis.pipeline).mockReturnValue(mockPipeline as never);
  });

  it('writes to correct Redis key with score=now and encoded member', async () => {
    const before = Date.now();
    await recordToolLatency(mockRedis, 'allergy.check', 42);
    const after = Date.now();

    expect(vi.mocked(mockPipeline.zadd)).toHaveBeenCalledOnce();
    const [key, score, member] = vi.mocked(mockPipeline.zadd).mock.calls[0] as unknown as [
      string,
      number,
      string,
    ];
    expect(key).toBe('tool:latency:hist:allergy.check');
    expect(score).toBeGreaterThanOrEqual(before);
    expect(score).toBeLessThanOrEqual(after);
    expect(member).toMatch(/^42:\d+$/);
  });

  it('trims entries older than 1h window', async () => {
    const before = Date.now();
    await recordToolLatency(mockRedis, 'memory.recall', 100);
    const after = Date.now();

    expect(vi.mocked(mockPipeline.zremrangebyscore)).toHaveBeenCalledOnce();
    const [key, min, max] = vi.mocked(mockPipeline.zremrangebyscore).mock.calls[0] as unknown as [
      string,
      string,
      number,
    ];
    expect(key).toBe('tool:latency:hist:memory.recall');
    expect(min).toBe('-inf');
    const cutoff = Number(max);
    expect(cutoff).toBeGreaterThanOrEqual(before - 60 * 60 * 1000);
    expect(cutoff).toBeLessThanOrEqual(after - 60 * 60 * 1000);
  });

  it('sets TTL to 3660s (1h + 60s buffer)', async () => {
    await recordToolLatency(mockRedis, 'recipe.search', 300);
    expect(vi.mocked(mockPipeline.expire)).toHaveBeenCalledWith(
      'tool:latency:hist:recipe.search',
      3660,
    );
  });
});
