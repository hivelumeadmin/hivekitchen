import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';

const plansHookPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error('plansHook requires supabase decorator — register supabasePlugin first');
  }
  if (!fastify.allergyGuardrailService) {
    throw new Error(
      'plansHook requires allergyGuardrailService decorator — register allergyGuardrailHook first',
    );
  }
  if (!fastify.auditService) {
    throw new Error('plansHook requires auditService decorator — register auditHook first');
  }

  const repository = new PlansRepository(fastify.supabase);
  const plansService = new PlansService({
    repository,
    allergyGuardrail: fastify.allergyGuardrailService,
    auditService: fastify.auditService,
    logger: fastify.log,
  });
  fastify.decorate('plansService', plansService);
};

export const plansHook = fp(plansHookPlugin, { name: 'plans-hook' });
