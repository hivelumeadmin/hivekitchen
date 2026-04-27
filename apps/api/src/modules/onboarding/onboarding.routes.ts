import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  TextOnboardingTurnRequestSchema,
  TextOnboardingTurnResponseSchema,
  TextOnboardingFinalizeResponseSchema,
} from '@hivekitchen/contracts';
import { ThreadRepository } from '../threads/thread.repository.js';
import { OnboardingAgent } from '../../agents/onboarding.agent.js';
import { OnboardingService } from './onboarding.service.js';

const onboardingRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const threads = new ThreadRepository(fastify.supabase);
  const agent = new OnboardingAgent(fastify.openai);
  const service = new OnboardingService({
    threads,
    agent,
    logger: fastify.log,
  });

  fastify.post(
    '/v1/onboarding/text/turn',
    {
      schema: {
        body: TextOnboardingTurnRequestSchema,
        response: { 200: TextOnboardingTurnResponseSchema },
      },
    },
    async (request) => {
      const body = request.body as { message: string };
      const result = await service.submitTextTurn({
        userId: request.user.id,
        householdId: request.user.household_id,
        message: body.message,
      });
      request.log.info(
        {
          module: 'onboarding',
          action: 'onboarding.text_turn',
          user_id: request.user.id,
          household_id: request.user.household_id,
          thread_id: result.thread_id,
          message_chars: body.message.length,
          response_chars: result.lumi_response.length,
          is_complete: result.is_complete,
        },
        'onboarding text turn served',
      );
      return result;
    },
  );

  fastify.post(
    '/v1/onboarding/text/finalize',
    {
      schema: {
        response: { 200: TextOnboardingFinalizeResponseSchema },
      },
    },
    async (request) => {
      const result = await service.finalizeTextOnboarding({
        userId: request.user.id,
        householdId: request.user.household_id,
      });
      return result;
    },
  );
};

export const onboardingRoutes = fp(onboardingRoutesPlugin, { name: 'onboarding-routes' });
