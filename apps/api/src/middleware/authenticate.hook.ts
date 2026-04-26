import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from '../common/errors.js';

const SKIP_PREFIXES = ['/v1/internal/', '/v1/webhooks/', '/v1/auth/'];
const SKIP_EXACT = new Set(['/v1/voice/llm']);

interface AccessTokenPayload {
  sub: string;
  hh: string;
  role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
}

const authenticateHookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    const url = request.url.split('?')[0] ?? '';
    if (SKIP_EXACT.has(url)) return;
    if (SKIP_PREFIXES.some((prefix) => url.startsWith(prefix))) return;

    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Invalid or missing access token');
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) {
      throw new UnauthorizedError('Invalid or missing access token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = fastify.jwt.verify<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedError('Invalid or missing access token');
    }

    request.user = { id: payload.sub, household_id: payload.hh, role: payload.role };
  });
};

export const authenticateHook = fp(authenticateHookPlugin, { name: 'authenticate-hook' });
