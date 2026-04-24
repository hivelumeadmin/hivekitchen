import fp from 'fastify-plugin';
import { Queue, Worker } from 'bullmq';
import type { Processor } from 'bullmq';

export const bullmqPlugin = fp(async (fastify) => {
  const connection = fastify.redis;

  const queues = new Map<string, Queue>();
  const workers = new Map<string, Worker>();

  fastify.decorate('bullmq', {
    getQueue: (name: string) => {
      let q = queues.get(name);
      if (!q) {
        q = new Queue(name, { connection });
        queues.set(name, q);
      }
      return q;
    },
    getWorker: (name: string, processor: Processor) => {
      let w = workers.get(name);
      if (!w) {
        w = new Worker(name, processor, { connection });
        workers.set(name, w);
      }
      return w;
    },
  });

  // Close workers BEFORE ioredis quits — workers need their connection alive to drain blocking commands.
  // Hook ordering: Fastify runs onClose hooks in reverse registration order, and bullmqPlugin is
  // registered after ioredisPlugin in app.ts, so this hook fires first.
  fastify.addHook('onClose', async () => {
    await Promise.all([...workers.values()].map((w) => w.close()));
    await Promise.all([...queues.values()].map((q) => q.close()));
  });
});
