import fp from 'fastify-plugin';
import Redis from 'ioredis';

export const ioredisPlugin = fp(async (fastify) => {
  // BullMQ shares this connection and requires maxRetriesPerRequest: null + enableReadyCheck: false
  // for blocking worker commands (BRPOPLPUSH etc.) — see bullmq.plugin.ts.
  const redis = new Redis(fastify.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  redis.on('error', (err) => {
    fastify.log.error({ err }, 'redis client error');
  });

  await redis.connect();

  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => {
    await redis.quit();
  });
});
