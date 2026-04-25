import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from '../common/errors.js';

const householdScopeHookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    if (!request.user) return;
    if (typeof request.user.household_id !== 'string' || request.user.household_id.length === 0) {
      throw new UnauthorizedError('Household claim missing from token');
    }
  });
};

export const householdScopeHook = fp(householdScopeHookPlugin, { name: 'household-scope-hook' });
