import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/health', async (request, reply) => {
    request.log.info({ module: 'health', action: 'health.check' }, 'health check');
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });
};
