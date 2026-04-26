import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  VoiceTokenRequestSchema,
  VoiceTokenResponse,
  ElevenLabsLlmRequestSchema,
  ElevenLabsPostCallWebhookPayload,
} from '@hivekitchen/contracts';
import { NotFoundError, UnauthorizedError } from '../../common/errors.js';
import { VoiceRepository } from './voice.repository.js';
import { VoiceService } from './voice.service.js';
import { OnboardingAgent } from '../../agents/onboarding.agent.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

// Constant-time comparison of the bearer header against the configured secret.
// Differing lengths short-circuit safely without leaking length via timing.
function bearerMatches(authHeader: string | undefined, secret: string): boolean {
  if (typeof authHeader !== 'string') return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const voiceRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new VoiceRepository(fastify.supabase);
  const agent = new OnboardingAgent(fastify.openai);
  const service = new VoiceService({
    repository,
    elevenlabs: fastify.elevenlabs,
    agent,
    agentId: fastify.env.ELEVENLABS_AGENT_ID,
    logger: fastify.log,
  });

  fastify.post(
    '/v1/voice/token',
    {
      schema: {
        body: VoiceTokenRequestSchema,
        response: { 200: VoiceTokenResponse },
      },
    },
    async (request) => {
      const { token, sessionId } = await service.createVoiceSession(
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
      return { token, sessionId };
    },
  );

  // POST /v1/voice/llm — ElevenLabs calls this per turn as the Custom LLM.
  // Skipped by JWT auth hook (SKIP_EXACT). Auth is the bearer secret check below.
  fastify.post(
    '/v1/voice/llm',
    { schema: { body: ElevenLabsLlmRequestSchema } },
    async (request, reply) => {
      if (!bearerMatches(request.headers.authorization, fastify.env.ELEVENLABS_CUSTOM_LLM_SECRET)) {
        throw new UnauthorizedError('Invalid bearer secret for /v1/voice/llm');
      }

      // Body has been validated by Fastify's Zod compiler against ElevenLabsLlmRequestSchema.
      const body = request.body as import('@hivekitchen/types').ElevenLabsLlmRequest;
      const conversationId = body.elevenlabs_extra_body.UUID;

      let text: string;
      try {
        text = await service.generateLlmResponse(conversationId, body.messages);
      } catch (err) {
        if (err instanceof NotFoundError) {
          throw err;
        }
        // Live voice session: surface a graceful spoken fallback rather than
        // returning a JSON 500 (which ElevenLabs cannot render via TTS).
        request.log.error(
          {
            err,
            module: 'voice',
            action: 'voice.llm_response_failed',
            conversation_id: conversationId,
          },
          'OnboardingAgent.respond failed — returning fallback SSE chunk',
        );
        text = "[softly] I'm having a little trouble — could you say that again?";
      }

      request.log.info(
        {
          module: 'voice',
          action: 'voice.llm_turn',
          conversation_id: conversationId,
          message_count: body.messages.length,
          response_chars: text.length,
        },
        'voice LLM turn served',
      );

      reply.hijack();

      const writeChunk = (data: object | string): boolean => {
        if (reply.raw.writableEnded || reply.raw.destroyed) return false;
        const payload = typeof data === 'string' ? data : `data: ${JSON.stringify(data)}\n\n`;
        try {
          return reply.raw.write(payload);
        } catch (err) {
          request.log.warn(
            { err, module: 'voice', action: 'voice.llm_sse_write_failed' },
            'voice LLM SSE write failed (client likely disconnected)',
          );
          return false;
        }
      };

      // If the client disconnects mid-stream, abandon further writes.
      let aborted = false;
      const onClose = (): void => {
        aborted = true;
      };
      request.raw.once('close', onClose);
      reply.raw.once('error', (err: Error) => {
        request.log.warn(
          { err, module: 'voice', action: 'voice.llm_sse_stream_error' },
          'voice LLM SSE stream error',
        );
        aborted = true;
      });

      reply.raw.writeHead(200, SSE_HEADERS);

      const chunkId = randomUUID();
      const chunk = {
        id: chunkId,
        object: 'chat.completion.chunk',
        choices: [{ delta: { content: text }, index: 0, finish_reason: null }],
      };
      const doneChunk = {
        id: chunkId,
        object: 'chat.completion.chunk',
        choices: [{ delta: {}, index: 0, finish_reason: 'stop' }],
      };

      if (!aborted) writeChunk(chunk);
      if (!aborted) writeChunk(doneChunk);
      if (!aborted) writeChunk('data: [DONE]\n\n');

      if (!reply.raw.writableEnded) {
        try {
          reply.raw.end();
        } catch (err) {
          request.log.warn(
            { err, module: 'voice', action: 'voice.llm_sse_end_failed' },
            'voice LLM SSE end failed',
          );
        }
      }
    },
  );

  // POST /v1/webhooks/elevenlabs — registered in its own scope so the
  // 'application/json' → string parser does NOT affect token or llm routes.
  await fastify.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_req, body, done) => done(null, body),
    );

    scope.post('/v1/webhooks/elevenlabs', {}, async (request, reply) => {
      const rawBody = request.body as string;
      const sig = request.headers['elevenlabs-signature'] as string | undefined;

      let parsed: unknown;
      try {
        parsed = await fastify.elevenlabs.webhooks.constructEvent(
          rawBody,
          sig ?? '',
          fastify.env.ELEVENLABS_WEBHOOK_SECRET,
        );
      } catch (err) {
        request.log.warn(
          {
            err,
            module: 'voice',
            action: 'webhook.hmac_rejected',
            has_signature: typeof sig === 'string' && sig.length > 0,
          },
          'ElevenLabs webhook signature/timestamp verification failed',
        );
        return reply.status(403).send({
          type: '/errors/forbidden',
          status: 403,
          title: 'Forbidden',
          instance: request.id,
        });
      }

      const result = ElevenLabsPostCallWebhookPayload.safeParse(parsed);
      if (!result.success) {
        // Schema mismatch on a HMAC-valid payload is data loss — log at error
        // so it surfaces in alerting rather than getting buried in warn noise.
        request.log.error(
          {
            module: 'voice',
            action: 'webhook.parse_failed',
            issues: result.error.issues,
          },
          'ElevenLabs webhook payload parse failed — dropping (HMAC was valid)',
        );
        return reply.status(200).send();
      }

      await service.processPostCallWebhook(result.data);
      return reply.status(200).send();
    });
  });
};

export const voiceRoutes = fp(voiceRoutesPlugin, { name: 'voice-routes' });
