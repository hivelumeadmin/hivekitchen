import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  LumiThreadTurnsResponseSchema,
  VoiceTalkSessionCreateSchema,
  VoiceTalkSessionResponseSchema,
} from '@hivekitchen/contracts';
import { LumiRepository } from './lumi.repository.js';
import { LumiService } from './lumi.service.js';

const ThreadTurnsParamsSchema = z.object({
  threadId: z.string().uuid(),
});

const TalkSessionParamsSchema = z.object({
  id: z.string().uuid(),
});

// Encapsulated routes plugin — registered with `{ prefix: '/v1/lumi' }` in app.ts.
// Not wrapped with fastify-plugin: fp() opts out of encapsulation, which would
// also drop the prefix scoping we depend on here.
export const lumiRoutes: FastifyPluginAsync = async (fastify) => {
  const repository = new LumiRepository(fastify.supabase);
  const service = new LumiService({
    repository,
    redis: fastify.redis,
    logger: fastify.log,
    elevenLabsApiKey: fastify.env.ELEVENLABS_API_KEY,
    voiceId: fastify.env.ELEVENLABS_VOICE_ID,
  });

  fastify.get(
    '/threads/:threadId/turns',
    {
      schema: {
        params: ThreadTurnsParamsSchema,
        response: { 200: LumiThreadTurnsResponseSchema },
      },
    },
    async (request) => {
      const { threadId } = request.params as z.infer<typeof ThreadTurnsParamsSchema>;
      const turns = await repository.getThreadTurns(threadId, request.user.household_id);
      return { thread_id: threadId, turns };
    },
  );

  fastify.post(
    '/voice/sessions',
    {
      schema: {
        body: VoiceTalkSessionCreateSchema,
        response: { 201: VoiceTalkSessionResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof VoiceTalkSessionCreateSchema>;
      const result = await service.createTalkSession({
        userId: request.user.id,
        householdId: request.user.household_id,
        userRole: request.user.role,
        contextSignal: body.context_signal,
      });
      request.auditContext = {
        event_type: 'voice.session_started',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: {
          talk_session_id: result.talk_session_id,
          surface: body.context_signal.surface,
        },
      };
      return reply.code(201).send(result);
    },
  );

  fastify.delete(
    '/voice/sessions/:id',
    {
      schema: {
        params: TalkSessionParamsSchema,
      },
    },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof TalkSessionParamsSchema>;
      await service.closeTalkSession({
        sessionId: id,
        userId: request.user.id,
        householdId: request.user.household_id,
      });
      request.auditContext = {
        event_type: 'voice.session_ended',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: { talk_session_id: id },
      };
      return reply.status(204).send();
    },
  );
};
