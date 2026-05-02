import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';
import { BriefStateRepository } from './brief-state.repository.js';
import { BriefStateComposer } from './brief-state.composer.js';

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
  if (fastify.hasDecorator('briefStateComposer')) {
    throw new Error(
      'briefStateComposer already decorated — check plugin registration order',
    );
  }

  const repository = new PlansRepository(fastify.supabase);
  const briefStateRepository = new BriefStateRepository(fastify.supabase);
  const briefStateComposer = new BriefStateComposer({
    plansRepository: repository,
    briefStateRepository,
    auditService: fastify.auditService,
    logger: fastify.log,
  });
  const plansService = new PlansService({
    repository,
    briefStateRepository,
    briefStateComposer,
    allergyGuardrail: fastify.allergyGuardrailService,
    auditService: fastify.auditService,
    logger: fastify.log,
  });
  fastify.decorate('plansService', plansService);
  fastify.decorate('briefStateComposer', briefStateComposer);
};

export const plansHook = fp(plansHookPlugin, { name: 'plans-hook' });
