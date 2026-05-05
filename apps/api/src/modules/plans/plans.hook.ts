import fp from 'fastify-plugin';
import { Buffer } from 'node:buffer';
import type { FastifyPluginAsync } from 'fastify';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';
import { BriefStateRepository } from './brief-state.repository.js';
import { BriefStateComposer } from './brief-state.composer.js';
import { ChildrenRepository } from '../children/children.repository.js';
import { REGEN_QUEUE } from '../../jobs/plan-regeneration.job.js';

const plansHookPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error('plansHook requires supabase decorator — register supabasePlugin first');
  }
  if (!fastify.env) {
    throw new Error('plansHook requires env decorator — register env validator plugin first');
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
  // Story 3.10: composer needs children-with-allergens to emit cleared_allergies.
  // child.name is envelope-encrypted at rest; ChildrenRepository decrypts via KEK.
  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
  const childrenRepository = new ChildrenRepository(fastify.supabase, kek, fastify.log);
  const briefStateComposer = new BriefStateComposer({
    plansRepository: repository,
    briefStateRepository,
    childrenRepository,
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
    redis: fastify.redis,                              // Story 3.13
    regenQueue: fastify.bullmq.getQueue(REGEN_QUEUE),  // Story 3.13
  });
  fastify.decorate('plansService', plansService);
  fastify.decorate('briefStateComposer', briefStateComposer);
};

export const plansHook = fp(plansHookPlugin, { name: 'plans-hook' });
