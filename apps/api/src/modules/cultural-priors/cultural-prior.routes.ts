import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  CulturalPriorListResponseSchema,
  RatifyCulturalPriorBodySchema,
  RatifyCulturalPriorResponseSchema,
} from '@hivekitchen/contracts';
import type { RatifyCulturalPriorBody } from '@hivekitchen/types';
import { authorize } from '../../middleware/authorize.hook.js';
import { ForbiddenError } from '../../common/errors.js';
import { OnboardingAgent } from '../../agents/onboarding.agent.js';
import { ThreadRepository } from '../threads/thread.repository.js';
import { CulturalPriorRepository } from './cultural-prior.repository.js';
import { CulturalPriorService } from './cultural-prior.service.js';

const culturalPriorRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new CulturalPriorRepository(fastify.supabase);
  const threads = new ThreadRepository(fastify.supabase);
  const agent = new OnboardingAgent(fastify.openai);
  const service = new CulturalPriorService({
    repository,
    threads,
    agent,
    logger: fastify.log,
  });

  const requirePrimaryParent = authorize(['primary_parent']);
  const requireMember = authorize(['primary_parent', 'secondary_caregiver']);

  fastify.get(
    '/v1/households/:id/cultural-priors',
    {
      preHandler: requireMember,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: CulturalPriorListResponseSchema },
      },
    },
    async (request) => {
      const { id: householdId } = request.params as { id: string };
      assertCallerInHousehold(request.user.household_id, householdId);
      const priors = await service.listByHousehold(householdId);
      return { priors };
    },
  );

  fastify.patch(
    '/v1/households/:id/cultural-priors/:priorId',
    {
      preHandler: requirePrimaryParent,
      schema: {
        params: z.object({ id: z.string().uuid(), priorId: z.string().uuid() }),
        body: RatifyCulturalPriorBodySchema,
        response: { 200: RatifyCulturalPriorResponseSchema },
      },
    },
    async (request) => {
      const { id: householdId, priorId } = request.params as {
        id: string;
        priorId: string;
      };
      assertCallerInHousehold(request.user.household_id, householdId);

      const body = request.body as RatifyCulturalPriorBody;
      const result = await service.ratify({
        householdId,
        priorId,
        action: body.action,
      });

      // Audit only fires on actual state transitions (opt_in / forget). The
      // tell_lumi_more action keeps state at 'detected' and is intentionally
      // not audited — there is no state change to record. Audit metadata is
      // PII-free: prior_id + key + state codes only (label is a system
      // constant, but kept out of metadata for consistency with story rule
      // 11).
      if (result.audit) {
        request.auditContext = {
          event_type: 'template.state_changed',
          user_id: request.user.id,
          household_id: householdId,
          correlation_id: request.id,
          request_id: request.id,
          metadata: {
            prior_id: result.audit.prior_id,
            key: result.audit.key,
            from_state: result.audit.from_state,
            to_state: result.audit.to_state,
          },
        };
      }

      return {
        prior: result.prior,
        ...(result.lumi_response !== undefined
          ? { lumi_response: result.lumi_response }
          : {}),
      };
    },
  );
};

function assertCallerInHousehold(callerHouseholdId: string, paramHouseholdId: string): void {
  if (callerHouseholdId !== paramHouseholdId) {
    throw new ForbiddenError('not a member of this household');
  }
}

export const culturalPriorRoutes = fp(culturalPriorRoutesPlugin, {
  name: 'cultural-prior-routes',
});
