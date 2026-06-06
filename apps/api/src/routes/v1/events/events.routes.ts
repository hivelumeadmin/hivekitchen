// apps/api/src/routes/v1/events/events.routes.ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

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

      // Story 12-S12 — register this live connection so background workers (the
      // lumi-nudge job) can fan out events to every open tab for the household.
      fastify.sseDispatcher.register(payload.hh, reply.raw);

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
