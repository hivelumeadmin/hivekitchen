import { Buffer } from 'node:buffer';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  LumiThreadTurnsResponseSchema,
  LumiTurnRequestSchema,
  LumiTurnResponseSchema,
  VoiceTalkSessionCreateSchema,
  VoiceTalkSessionResponseSchema,
} from '@hivekitchen/contracts';
import type { LumiTurnRequest } from '@hivekitchen/types';
import { ChildAllergensRepository } from '../children/child-allergens.repository.js';
import { ChildrenRepository } from '../children/children.repository.js';
import { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';
import { VoiceTranscriptRepository } from '../voice/voice-transcript.repository.js';
import { VoiceUsageRepository } from '../voice/voice-usage.repository.js';
import { FamilyLanguageRepository } from '../family-language/family-language.repository.js';
import { STANDARD_TIER_CAP_MS, VOICE_CAP_COPY, getWeekStart } from '../../common/voice-tier.js';
import { LumiRepository } from './lumi.repository.js';
import { LumiService } from './lumi.service.js';

const ThreadTurnsParamsSchema = z.object({
  threadId: z.string().uuid(),
});

// Slice 5-S4 — optional gap-recovery cursor.
const ThreadTurnsQuerySchema = z.object({
  from_seq: z.string().regex(/^\d+$/).optional(),
});

const TalkSessionParamsSchema = z.object({
  id: z.string().uuid(),
});

// 5-S16 — 429 cap response body.
const VoiceCapReachedResponseSchema = z.object({
  statusCode: z.literal(429),
  error: z.string(),
  message: z.string(),
  code: z.literal('voice_cap_reached'),
});

// Encapsulated routes plugin — registered with `{ prefix: '/v1/lumi' }` in app.ts.
export const lumiRoutes: FastifyPluginAsync = async (fastify) => {
  const repository = new LumiRepository(fastify.supabase);

  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;
  const childAllergensRepository = new ChildAllergensRepository(fastify.supabase, kek);
  const childrenRepository = new ChildrenRepository(
    fastify.supabase,
    kek,
    fastify.log,
    childAllergensRepository,
  );
  const householdAllergensRepository = new HouseholdAllergensRepository(fastify.supabase, kek);
  const voiceTranscriptRepository = new VoiceTranscriptRepository(fastify.supabase);
  const voiceUsageRepository = new VoiceUsageRepository(fastify.supabase);
  const familyLanguageRepository = new FamilyLanguageRepository(fastify.supabase);

  const service = new LumiService({
    repository,
    redis: fastify.redis,
    logger: fastify.log,
    openai: fastify.openai,
    childrenRepository,
    householdAllergensRepository,
    voiceTranscriptRepository,
    memoryService: fastify.memoryService,
    familyLanguageRepository,
  });

  fastify.get(
    '/threads/:threadId/turns',
    {
      schema: {
        params: ThreadTurnsParamsSchema,
        querystring: ThreadTurnsQuerySchema,
        response: { 200: LumiThreadTurnsResponseSchema },
      },
    },
    async (request) => {
      const { threadId } = request.params as z.infer<typeof ThreadTurnsParamsSchema>;
      const { from_seq } = request.query as z.infer<typeof ThreadTurnsQuerySchema>;
      const fromSeq = from_seq !== undefined ? BigInt(from_seq) : undefined;
      const turns = await repository.getThreadTurns(threadId, request.user.household_id, fromSeq);
      return { thread_id: threadId, turns };
    },
  );

  fastify.post(
    '/turns',
    {
      schema: {
        body: LumiTurnRequestSchema,
        response: { 201: LumiTurnResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as LumiTurnRequest;
      const result = await service.submitTextTurn({
        householdId: request.user.household_id,
        userId: request.user.id,
        message: body.message,
        contextSignal: body.context_signal,
        modality: body.modality,
      });
      return reply.code(201).send(result);
    },
  );

  fastify.post(
    '/voice/sessions',
    {
      schema: {
        body: VoiceTalkSessionCreateSchema,
        response: { 201: VoiceTalkSessionResponseSchema, 429: VoiceCapReachedResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof VoiceTalkSessionCreateSchema>;

      // 5-S16 — fast-path cap check at session creation.
      try {
        const consumed = await voiceUsageRepository.getWeeklyUsage(request.user.id, getWeekStart());
        if (consumed >= STANDARD_TIER_CAP_MS) {
          return reply.status(429).send({
            statusCode: 429,
            error: 'Too Many Requests',
            message: VOICE_CAP_COPY,
            code: 'voice_cap_reached',
          });
        }
      } catch (err) {
        request.log.warn(
          { err, module: 'lumi', action: 'lumi.voice.session_cap_check_failed' },
          'voice usage read at session creation failed — allowing session',
        );
      }

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
