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

// Story 13-s2.5 — Last-Event-ID replay. Every emit also appends to a per-
// household Redis Stream so a reconnecting EventSource can replay the events it
// missed during the gap (native `EventSource` sends `Last-Event-ID` on
// reconnect). MAXLEN ~ N caps the buffer; a TTL prunes idle households.
export const SSE_STREAM_PREFIX = 'sse:stream:household:';
const STREAM_MAXLEN = 200;
const STREAM_TTL_SECONDS = 3600; // 1h — reconnect windows are far shorter.

// Reconstruct an SSE frame (with its `id:`) from a Redis Stream entry. Exported
// for unit testing the replay path without a live Redis. Stream entries store
// the event name + data as flat [field, value, …] pairs.
export function streamEntryToFrame(id: string, fields: readonly string[]): string {
  const map: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    map[fields[i]!] = fields[i + 1]!;
  }
  return `id: ${id}\nevent: ${map.event ?? 'message'}\ndata: ${map.data ?? ''}\n\n`;
}

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
      // Public signature stays sync/fire-and-forget. Internally: append to the
      // household stream (for replay) to get a monotonic id, stamp the frame
      // with `id: <streamId>`, then publish it live. XADD `*` ids are monotonic
      // regardless of concurrent emits, so replay order is always correct even
      // if two live publishes race.
      void (async () => {
        const streamKey = `${SSE_STREAM_PREFIX}${householdId}`;
        let frameId: string | null = null;
        try {
          frameId = await fastify.redis.xadd(
            streamKey,
            'MAXLEN',
            '~',
            String(STREAM_MAXLEN),
            '*',
            'event',
            event,
            'data',
            data,
          );
        } catch (err) {
          fastify.log.error({ err, householdId }, 'sse-dispatcher: xadd failed — publishing without stream anchor');
        }
        // TTL refresh is best-effort; failure must not prevent live delivery.
        if (frameId !== null) {
          fastify.redis.expire(streamKey, STREAM_TTL_SECONDS).catch((err) =>
            fastify.log.warn({ err, householdId }, 'sse-dispatcher: expire failed'),
          );
        }
        // Only stamp `id:` when xadd returned a real id — an empty id: field resets
        // the browser's Last-Event-ID buffer, corrupting the replay cursor.
        const payload = frameId !== null
          ? `id: ${frameId}\nevent: ${event}\ndata: ${data}\n\n`
          : `event: ${event}\ndata: ${data}\n\n`;
        try {
          await fastify.redis.publish(`${CHANNEL_PREFIX}${householdId}`, payload);
        } catch (err) {
          fastify.log.error({ err, householdId }, 'sse-dispatcher: publish failed');
        }
      })();
    },
  } satisfies SseDispatcher);

  fastify.addHook('onClose', async () => {
    await subscriber.quit();
  });
};

export const sseDispatcherPlugin = fp(sseDispatcherFn, { name: 'sse-dispatcher' });
