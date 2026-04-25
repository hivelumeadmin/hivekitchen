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
});

export const eventsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/v1/events',
    { schema: { querystring: EventsQuerystring } },
    async (request, reply) => {
      const { client_id: clientId } = request.query as z.infer<typeof EventsQuerystring>;

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

      // An unhandled 'error' event on the raw stream crashes Node's EventEmitter.
      reply.raw.on('error', (err) => {
        fastify.log.warn({ err, module: 'events', clientId }, 'SSE stream error');
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
