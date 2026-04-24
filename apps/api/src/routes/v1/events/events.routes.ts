// apps/api/src/routes/v1/events/events.routes.ts
import type { FastifyPluginAsync } from 'fastify';

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
export const eventsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/events', async (request, reply) => {
    const clientId = (request.query as Record<string, string>)['client_id'] ?? 'unknown';

    fastify.log.info(
      { module: 'events', action: 'sse.connect', clientId },
      'SSE client connected',
    );

    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    // Initial heartbeat — keeps the connection alive before real events land.
    void reply.raw.write(':ping\n\n');

    // Heartbeat every 20s (architecture §5.1 Cloudflare tolerance).
    const heartbeatInterval = setInterval(() => {
      if (!reply.raw.writableEnded) {
        void reply.raw.write(':ping\n\n');
      }
    }, 20_000);

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
  });
};
