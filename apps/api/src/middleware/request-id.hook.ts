import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const requestIdHook: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onSend', async (request, reply) => {
    void reply.header('X-Request-Id', String(request.id));
  });
};

export const requestIdPlugin = fp(requestIdHook, { name: 'request-id' });
