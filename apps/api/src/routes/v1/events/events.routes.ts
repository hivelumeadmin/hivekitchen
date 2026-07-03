// apps/api/src/routes/v1/events/events.routes.ts
import type { FastifyPluginAsync } from 'fastify';
import type Redis from 'ioredis';
import { z } from 'zod';
import type { SurfaceKind } from '@hivekitchen/types';
import { emitPresenceEvent, getPresenceKey } from '../../../modules/presence/presence.helpers.js';
import { SSE_STREAM_PREFIX, streamEntryToFrame } from '../../../plugins/sse-dispatcher.plugin.js';

interface StoredPresence {
  surface: SurfaceKind;
}

/**
 * GET /v1/events — SSE channel stub.
 *
 * Story 1.10: registers the route endpoint. The real SSE fan-out (Redis pub/sub,
 * per-(user_id, client_id) channel, Last-Event-ID replay from Redis event-log)
 * is Story 5.2 scope.
 *
 * This stub responds with a valid SSE stream that immediately sends a heartbeat
 * and holds the connection open. Useful for integration testing the client bridge.
 *
 * Architecture §3.3: one long-lived channel per (user_id, client_id-per-tab).
 * Architecture §5.1: SSE headers (no-cache, no-transform, no buffering).
 */

const EventsQuerystring = z.object({
  client_id: z.string().uuid(),
  token: z.string().min(1),
});

// Story 13-s2.5 — Last-Event-ID replay. Reads the household stream for entries
// strictly after `lastEventId` and writes each reconstructed frame in order.
// Extracted + exported so the ordered-replay + exclusive-range contract is
// unit-testable without the hijacked SSE response or a live Redis.
// Structurally the ioredis client's `xrange`, so the real `fastify.redis` is
// assignable without a cast while a `{ xrange: vi.fn() }` test stub still
// satisfies it. (A hand-narrowed single-signature type is not assignable from
// ioredis's overloaded `xrange` — its 4th positional arg can be a callback.)
type StreamReader = Pick<Redis, 'xrange'>;

export async function replayMissedEvents(
  redis: StreamReader,
  householdId: string,
  lastEventId: string,
  write: (frame: string) => void,
): Promise<void> {
  // Exclusive start `(id` → only entries strictly after the last seen id.
  // COUNT matches STREAM_MAXLEN so XRANGE is bounded even if the trim lags.
  const entries = await redis.xrange(`${SSE_STREAM_PREFIX}${householdId}`, `(${lastEventId}`, '+', 'COUNT', 200);
  for (const [id, fields] of entries) {
    write(streamEntryToFrame(id, fields));
  }
}

interface AccessTokenPayload {
  sub: string;
  hh: string;
  role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
}

export const eventsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/v1/events',
    { schema: { querystring: EventsQuerystring } },
    async (request, reply) => {
      const { client_id: clientId, token } = request.query as z.infer<typeof EventsQuerystring>;

      // EventSource cannot send Authorization headers — validate JWT from ?token=.
      let payload: AccessTokenPayload;
      try {
        payload = fastify.jwt.verify<AccessTokenPayload>(token);
      } catch {
        return reply.status(401).type('application/problem+json').send({
          type: '/errors/unauthorized',
          status: 401,
          title: 'Invalid or missing access token',
          instance: request.id,
        });
      }
      request.user = { id: payload.sub, household_id: payload.hh, role: payload.role };

      fastify.log.info(
        { module: 'events', action: 'sse.connect', clientId },
        'SSE client connected',
      );

      // Bypass Fastify's reply lifecycle — we drive reply.raw directly for
      // the long-lived stream. Without hijack, Fastify would attempt a second
      // serialization pass on a closed/streamed response.
      reply.hijack();

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });

      // Initial heartbeat — keeps the connection alive before real events land.
      reply.raw.write(':ping\n\n');

      // Story 12-S12 — register BEFORE replay so no live event is lost during
      // the XRANGE window. Duplicate delivery of an invalidation event is harmless
      // (React Query refetches are idempotent).
      fastify.sseDispatcher.register(payload.hh, reply.raw);

      // Story 13-s2.5 — Last-Event-ID replay. On reconnect, native EventSource
      // sends the id of the last frame it saw; replay everything after it from
      // the household stream so the gap is filled. Best-effort: a replay failure
      // (missing stream, Redis blip) falls through to live-only.
      const lastEventId = request.headers['last-event-id'];
      if (typeof lastEventId === 'string' && lastEventId.length > 0) {
        try {
          await replayMissedEvents(fastify.redis, payload.hh, lastEventId, (frame) => {
            if (!reply.raw.writableEnded) reply.raw.write(frame);
          });
        } catch (err) {
          fastify.log.warn(
            { err, module: 'events', clientId },
            'SSE Last-Event-ID replay failed — continuing live-only',
          );
        }
      }

      // An unhandled 'error' event on the raw stream crashes Node's EventEmitter.
      reply.raw.on('error', (err) => {
        fastify.log.warn({ err, module: 'events', clientId }, 'SSE stream error');
        fastify.sseDispatcher.unregister(payload.hh, reply.raw);
      });

      // Heartbeat every 20s (architecture §5.1 Cloudflare tolerance).
      // Story 5.2 will replace this loop with Redis pub/sub fan-out and
      // must respect the boolean returned by reply.raw.write (backpressure).
      const heartbeatInterval = setInterval(() => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(':ping\n\n');
        }
      }, 20_000);
      heartbeatInterval.unref?.();

      request.raw.on('close', () => {
        clearInterval(heartbeatInterval);
        fastify.sseDispatcher.unregister(payload.hh, reply.raw);
        // Story 5-S1 — clear presence for this user on disconnect so the
        // partner's tab clears immediately (rather than waiting for TTL).
        void (async () => {
          const key = getPresenceKey(payload.hh, payload.sub);
          const raw = await fastify.redis.get(key);
          if (!raw) return;
          const stored = JSON.parse(raw) as StoredPresence;
          await fastify.redis.del(key);
          const expiredAt = new Date(Date.now() - 1000).toISOString();
          emitPresenceEvent(fastify, payload.hh, payload.sub, stored.surface, expiredAt);
        })().catch((err) =>
          fastify.log.warn({ err }, 'events: presence clear on disconnect failed'),
        );
        fastify.log.info(
          { module: 'events', action: 'sse.disconnect', clientId },
          'SSE client disconnected',
        );
      });

      // Keep the handler alive — do not return until the client disconnects.
      await new Promise<void>((resolve) => {
        request.raw.on('close', resolve);
      });
    },
  );
};
