import fp from 'fastify-plugin';
import Redis from 'ioredis';
import type { FastifyPluginAsync } from 'fastify';
import type { ServerResponse } from 'node:http';

// Story 12-S12 — in-process SSE fan-out. The dispatcher keeps a registry of live
// `GET /v1/events` connections keyed by household so a background worker (the
// lumi-nudge job) can push an event to every open tab for a household without a
// request context.
//
// Story 5-S1 — upgraded to Redis pub/sub so delivery is multi-process-ready.
// `emit` now PUBLISHes on `sse:household:{householdId}`; a dedicated subscriber
// client fans the message out to this node's local connections. Callers of
// `emit` are unchanged — the method stays sync/fire-and-forget.
export interface SseDispatcher {
  register(householdId: string, res: ServerResponse): void;
  unregister(householdId: string, res: ServerResponse): void;
  emit(householdId: string, event: string, data: string): void;
}

declare module 'fastify' {
  interface FastifyInstance {
    sseDispatcher: SseDispatcher;
  }
}

const CHANNEL_PREFIX = 'sse:household:';

const sseDispatcherFn: FastifyPluginAsync = async (fastify) => {
  const connections = new Map<string, Set<ServerResponse>>();

  // A connection in subscriber mode cannot issue regular commands (ioredis
  // constraint), so the subscriber is a SEPARATE client from `fastify.redis`
  // (which still serves PUBLISH/SET/GET/etc.).
  const subscriber = new Redis(fastify.env.REDIS_URL, { lazyConnect: true });
  await subscriber.connect();

  subscriber.on('message', (channel, rawPayload) => {
    const householdId = channel.replace(CHANNEL_PREFIX, '');
    const set = connections.get(householdId);
    if (!set) return;
    for (const res of set) {
      if (res.writableEnded) {
        set.delete(res);
        continue;
      }
      try {
        res.write(rawPayload);
      } catch {
        set.delete(res);
      }
    }
    if (set.size === 0) connections.delete(householdId);
  });

  fastify.decorate('sseDispatcher', {
    register(householdId, res) {
      const isNew = !connections.has(householdId);
      if (isNew) connections.set(householdId, new Set());
      connections.get(householdId)!.add(res);
      if (isNew) {
        subscriber
          .subscribe(`${CHANNEL_PREFIX}${householdId}`)
          .catch((err) =>
            fastify.log.warn({ err, householdId }, 'sse-dispatcher: subscribe failed'),
          );
      }
    },
    unregister(householdId, res) {
      const set = connections.get(householdId);
      if (!set) return;
      set.delete(res);
      if (set.size === 0) {
        connections.delete(householdId);
        subscriber
          .unsubscribe(`${CHANNEL_PREFIX}${householdId}`)
          .catch((err) =>
            fastify.log.warn({ err, householdId }, 'sse-dispatcher: unsubscribe failed'),
          );
      }
    },
    emit(householdId, event, data) {
      const payload = `event: ${event}\ndata: ${data}\n\n`;
      fastify.redis
        .publish(`${CHANNEL_PREFIX}${householdId}`, payload)
        .catch((err) => fastify.log.error({ err, householdId }, 'sse-dispatcher: publish failed'));
    },
  } satisfies SseDispatcher);

  fastify.addHook('onClose', async () => {
    await subscriber.quit();
  });
};

export const sseDispatcherPlugin = fp(sseDispatcherFn, { name: 'sse-dispatcher' });
