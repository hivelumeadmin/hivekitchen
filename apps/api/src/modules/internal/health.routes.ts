import type { FastifyPluginAsync } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../../common/errors.js';

interface OpsTokenPayload {
  sub: string;
  hh: string;
  role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
}

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/health', async (request, reply) => {
    request.log.info({ module: 'health', action: 'health.check' }, 'health check');
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // /v1/internal/ is skipped by the global authenticate hook so k8s liveness
  // probes can hit /v1/health without a token. This endpoint leaks LLM
  // operational state (active vendor + circuit status), so we re-verify the
  // JWT inline and require the `ops` role.
  fastify.get(
    '/v1/internal/health/llm-providers',
    {
      preHandler: async (request) => {
        const header = request.headers.authorization;
        if (header === undefined || !header.startsWith('Bearer ')) {
          throw new UnauthorizedError('Invalid or missing access token');
        }
        const token = header.slice('Bearer '.length).trim();
        if (token.length === 0) {
          throw new UnauthorizedError('Invalid or missing access token');
        }
        let payload: OpsTokenPayload;
        try {
          payload = fastify.jwt.verify<OpsTokenPayload>(token);
        } catch {
          throw new UnauthorizedError('Invalid or missing access token');
        }
        if (payload.role !== 'ops') {
          throw new ForbiddenError('Role not permitted for this resource');
        }
        request.user = { id: payload.sub, household_id: payload.hh, role: payload.role };
      },
    },
    async (_request, reply) => {
      return reply.send(fastify.orchestrator.getProviderStatus());
    },
  );
};
