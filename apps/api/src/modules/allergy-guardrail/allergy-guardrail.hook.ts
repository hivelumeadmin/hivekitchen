import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { AllergyGuardrailRepository } from './allergy-guardrail.repository.js';
import { AllergyGuardrailService } from './allergy-guardrail.service.js';

const allergyGuardrailHookPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new AllergyGuardrailRepository(fastify.supabase);
  const service = new AllergyGuardrailService(repository, fastify.auditService);
  fastify.decorate('allergyGuardrailService', service);
};

export const allergyGuardrailHook = fp(allergyGuardrailHookPlugin, {
  name: 'allergy-guardrail-hook',
});
