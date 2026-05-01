import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  VoiceSessionCreateSchema,
  VoiceSessionCreateResponseSchema,
  WsClientMessageSchema,
} from '@hivekitchen/contracts';
import { VoiceRepository } from './voice.repository.js';
import { VoiceService, WsAuthFailedError, WsSessionNotFoundError } from './voice.service.js';
import { OnboardingAgent } from '../../agents/onboarding.agent.js';
import { ThreadRepository } from '../threads/thread.repository.js';
import { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';

interface AccessTokenPayload {
  sub: string;
  hh: string;
  role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
}

const voiceRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new VoiceRepository(fastify.supabase);
  const agent = new OnboardingAgent(fastify.openai);
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

  // GET /v1/voice/ws — WebSocket upgrade. JWT passed as ?token= query param
  // (browsers cannot set Authorization on WS upgrades). The route is
  // present in SKIP_EXACT so the global auth hook does not 401 the upgrade.
  // TODO(security): configure pino's req serializer in app.ts to redact ?token=
  // from access logs so the bearer credential is not written to log storage.
  fastify.get('/v1/voice/ws', { websocket: true }, (socket, request) => {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const sessionId = url.searchParams.get('session_id');

    if (typeof token !== 'string' || token.length === 0) {
      try {
        socket.close(4001, 'missing token');
      } catch {
        /* noop */
      }
      return;
    }
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      try {
        socket.close(4001, 'missing session_id');
      } catch {
        /* noop */
      }
      return;
    }

    let payload: AccessTokenPayload;
    try {
      payload = fastify.jwt.verify<AccessTokenPayload>(token);
    } catch {
      try {
        socket.close(4001, 'invalid token');
      } catch {
        /* noop */
      }
      return;
    }
    request.log.debug(
      { module: 'voice', action: 'ws.auth_attempt', user_id: payload.sub },
      'voice WS JWT validated',
    );

    void (async () => {
      try {
        await service.openWsSession(sessionId, payload.sub, socket);
      } catch (err) {
        if (err instanceof WsAuthFailedError) {
          try {
            socket.close(4001, 'auth failed');
          } catch {
            /* noop */
          }
          return;
        }
        if (err instanceof WsSessionNotFoundError) {
          try {
            socket.close(4004, 'session not found');
          } catch {
            /* noop */
          }
          return;
        }
        request.log.error(
          { err, module: 'voice', action: 'voice.ws_open_failed', session_id: sessionId },
          'WebSocket session open failed',
        );
        try {
          socket.close(1011, 'internal error');
        } catch {
          /* noop */
        }
        return;
      }

      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          void service.processAudioChunk(sessionId, buf, socket);
          return;
        }
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return;
        }
        const result = WsClientMessageSchema.safeParse(parsed);
        if (!result.success) return;
        if (result.data.type === 'ping') {
          try {
            socket.send(JSON.stringify({ type: 'pong' }));
          } catch {
            /* noop */
          }
        }
      });

      socket.on('close', () => {
        void service.onWsClose(sessionId);
      });

      // Send session.ready after all listeners are registered.
      try {
        socket.send(JSON.stringify({ type: 'session.ready' }));
      } catch {
        /* noop */
      }
    })();
  });
};

export const voiceRoutes = fp(voiceRoutesPlugin, { name: 'voice-routes' });
