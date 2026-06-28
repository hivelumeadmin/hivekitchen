import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  VoiceSessionCreateSchema,
  VoiceSessionCreateResponseSchema,
  TtsTokenResponseSchema,
  SttTokenResponseSchema,
  VoiceTurnRequestSchema,
  VoiceTurnResponseSchema,
} from '@hivekitchen/contracts';
import { VoiceRepository } from './voice.repository.js';
import { VoiceService } from './voice.service.js';
import { OnboardingAgent } from '../../agents/onboarding.agent.js';
import { OpenAIAdapter } from '../../agents/providers/openai.adapter.js';
import { ThreadRepository } from '../threads/thread.repository.js';
import { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';

const SessionParamsSchema = z.object({
  id: z.string().uuid(),
});

const voiceRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new VoiceRepository(fastify.supabase);
  const agent = new OnboardingAgent(new OpenAIAdapter(fastify.openai));
  const threads = new ThreadRepository(fastify.supabase);
  const culturalPriorRepository = new CulturalPriorRepository(fastify.supabase);
  const culturalPriorService = new CulturalPriorService({
    repository: culturalPriorRepository,
    threads,
    agent,
    logger: fastify.log,
  });
  const service = new VoiceService({
    repository,
    agent,
    culturalPriorService,
    elevenLabsApiKey: fastify.env.ELEVENLABS_API_KEY,
    voiceId: fastify.env.ELEVENLABS_VOICE_ID,
    ttsModelId: fastify.env.ELEVENLABS_TTS_MODEL_ID,
    logger: fastify.log,
    memoryService: fastify.memoryService,
  });

  fastify.post(
    '/v1/voice/sessions',
    {
      schema: {
        body: VoiceSessionCreateSchema,
        response: { 200: VoiceSessionCreateResponseSchema },
      },
    },
    async (request) => {
      const { sessionId } = await service.createSession(
        request.user.id,
        request.user.household_id,
      );
      request.auditContext = {
        event_type: 'voice.session_started',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: { session_id: sessionId },
      };
      return { session_id: sessionId };
    },
  );

  fastify.delete(
    '/v1/voice/sessions/:id',
    { schema: { params: SessionParamsSchema } },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof SessionParamsSchema>;
      await service.deleteSession(id, request.user.id);
      request.auditContext = {
        event_type: 'voice.session_ended',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: { session_id: id },
      };
      return reply.status(204).send();
    },
  );

  // Browser-direct TTS via ElevenLabs single-use token (Slice 2-S20).
  // Returns a short-lived (15-min, single-use) token + voice/model IDs.
  // The browser opens the TTS WebSocket directly — audio never transits the API.
  fastify.post(
    '/v1/voice/tts/token',
    { schema: { response: { 200: TtsTokenResponseSchema } } },
    async (request) => {
      request.auditContext = {
        event_type: 'voice.tts_token_issued',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: {},
      };
      return service.issueTtsToken();
    },
  );

  // Browser-direct STT via ElevenLabs Scribe single-use token.
  // Browser connects to wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=<token>
  // and streams PCM directly. Audio never transits the HK API.
  fastify.post(
    '/v1/voice/stt/token',
    { schema: { response: { 200: SttTokenResponseSchema } } },
    async (request) => {
      request.auditContext = {
        event_type: 'voice.stt_token_issued',
        user_id: request.user.id,
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: {},
      };
      return service.issueSttToken();
    },
  );

  // REST onboarding voice turn. The browser transcribes via Scribe WS (using a
  // token from POST /v1/voice/stt/token), then posts the transcript here. The
  // agent reply is returned for the browser to speak via TTS WS (token from
  // POST /v1/voice/tts/token). When complete:true the session is auto-closed
  // and summary + cultural_priors_detected are included.
  fastify.post(
    '/v1/voice/turns',
    {
      schema: {
        body: VoiceTurnRequestSchema,
        response: { 200: VoiceTurnResponseSchema },
      },
    },
    async (request) => {
      const body = request.body as z.infer<typeof VoiceTurnRequestSchema>;
      return service.processTextTurn(
        body.session_id,
        request.user.id,
        body.transcript,
      );
    },
  );
};

export const voiceRoutes = fp(voiceRoutesPlugin, { name: 'voice-routes' });
