import type { Redis } from 'ioredis';

const KEY_PREFIX = 'tool:latency:hist:';
const WINDOW_MS = 60 * 60 * 1000;
const TTL_SECONDS = Math.ceil(WINDOW_MS / 1000) + 60;

export async function recordToolLatency(
  redis: Redis,
  toolName: string,
  latencyMs: number,
): Promise<void> {
  const key = `${KEY_PREFIX}${toolName}`;
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  await redis
    .pipeline()
    .zadd(key, now, `${latencyMs}:${now}`)
    .zremrangebyscore(key, '-inf', cutoff)
    .expire(key, TTL_SECONDS)
    .exec();
}
