import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { DomainOrchestrator } from './orchestrator.js';
import { OpenAIAdapter } from './providers/openai.adapter.js';
import { AnthropicAdapter } from './providers/anthropic.adapter.js';

const orchestratorHookPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.openai) {
    throw new Error('orchestratorHook requires openai decorator — register openaiPlugin first');
  }
  if (!fastify.memoryService) {
    throw new Error('orchestratorHook requires memoryService decorator — register memoryHook first');
  }
  if (!fastify.allergyGuardrailService) {
    throw new Error(
      'orchestratorHook requires allergyGuardrailService decorator — register allergyGuardrailHook first',
    );
  }
  if (!fastify.auditService) {
    throw new Error('orchestratorHook requires auditService decorator — register auditHook first');
  }

  const openaiAdapter = new OpenAIAdapter(fastify.openai);
  const anthropicAdapter = new AnthropicAdapter();
  const orchestrator = new DomainOrchestrator(
    [openaiAdapter, anthropicAdapter],
    {
      memory: fastify.memoryService,
      allergyGuardrail: fastify.allergyGuardrailService,
    },
    fastify.auditService,
    fastify.log,
  );
  fastify.decorate('orchestrator', orchestrator);
  fastify.addHook('onClose', () => { orchestrator.dispose(); });
};

export const orchestratorHook = fp(orchestratorHookPlugin, { name: 'orchestrator-hook' });
