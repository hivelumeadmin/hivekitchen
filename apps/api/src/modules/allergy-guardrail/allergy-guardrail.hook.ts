import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { AllergyGuardrailRepository } from './allergy-guardrail.repository.js';
import { AllergyGuardrailService } from './allergy-guardrail.service.js';

const allergyGuardrailHookPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error('allergyGuardrailHook requires supabase decorator — register supabasePlugin first');
  }
  if (!fastify.auditService) {
    throw new Error('allergyGuardrailHook requires auditService decorator — register auditHook first');
  }

  const repository = new AllergyGuardrailRepository(fastify.supabase);
  const service = new AllergyGuardrailService({
    repository,
    auditService: fastify.auditService,
    logger: fastify.log,
  });
  fastify.decorate('allergyGuardrailService', service);
};

export const allergyGuardrailHook = fp(allergyGuardrailHookPlugin, {
  name: 'allergy-guardrail-hook',
});
