import { Buffer } from 'node:buffer';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  LumiThreadTurnsResponseSchema,
  LumiTurnRequestSchema,
  LumiTurnResponseSchema,
  LumiVoiceClientMessageSchema,
  VoiceTalkSessionCreateSchema,
  VoiceTalkSessionResponseSchema,
} from '@hivekitchen/contracts';
import type { LumiTurnRequest } from '@hivekitchen/types';
import { ChildAllergensRepository } from '../children/child-allergens.repository.js';
import { ChildrenRepository } from '../children/children.repository.js';
import { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';
import { VoiceTranscriptRepository } from '../voice/voice-transcript.repository.js';
import { FamilyLanguageRepository } from '../family-language/family-language.repository.js';
import { LumiRepository } from './lumi.repository.js';
import { LumiService, type LumiVoiceWsState } from './lumi.service.js';

// JWT payload on the WS upgrade ?token= query param (browsers cannot set an
// Authorization header on a WebSocket upgrade — the path is in auth SKIP_EXACT).
interface AccessTokenPayload {
  sub: string;
  hh: string;
  role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
}

const ThreadTurnsParamsSchema = z.object({
  threadId: z.string().uuid(),
});

// Slice 5-S4 — optional gap-recovery cursor. Numeric-string only; BigInt() on
// the handler side rejects nothing the regex already passed.
const ThreadTurnsQuerySchema = z.object({
  from_seq: z.string().regex(/^\d+$/).optional(),
});

const TalkSessionParamsSchema = z.object({
  id: z.string().uuid(),
});

// Encapsulated routes plugin — registered with `{ prefix: '/v1/lumi' }` in app.ts.
// Not wrapped with fastify-plugin: fp() opts out of encapsulation, which would
// also drop the prefix scoping we depend on here.
export const lumiRoutes: FastifyPluginAsync = async (fastify) => {
  const repository = new LumiRepository(fastify.supabase);

  // Children names are envelope-encrypted; the KEK decrypts them in
  // ChildrenRepository.findByHouseholdId (null KEK = dev mode, no encryption).
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
  const familyLanguageRepository = new FamilyLanguageRepository(fastify.supabase);

  const service = new LumiService({
    repository,
    redis: fastify.redis,
    logger: fastify.log,
    elevenLabsApiKey: fastify.env.ELEVENLABS_API_KEY,
    voiceId: fastify.env.ELEVENLABS_VOICE_ID,
    openai: fastify.openai,
    childrenRepository,
    householdAllergensRepository,
    voiceTranscriptRepository,
    memoryService: fastify.memoryService, // 5-S7 — wired by memory-hook
    familyLanguageRepository, // 5-S10 — inline detection + snapshot ratchet
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

  // GET /v1/lumi/voice/ws — ambient Lumi voice transport (Story 5-S5b). Mirrors
  // the onboarding GET /v1/voice/ws: JWT via ?token=, talk session via
  // ?session_id=. The full path '/v1/lumi/voice/ws' is in the auth plugin's
  // SKIP_EXACT set (browsers cannot set Authorization on a WS upgrade).
  //
  // Flow: browser sends a `context` frame once, then streams WAV utterances as
  // binary frames. Per frame the server transcribes (Scribe), runs the LumiAgent
  // turn (submitTextTurn, modality 'voice' — persists thread_turns +
  // voice_transcript), and streams the reply back via TTS. Authoritative session
  // teardown stays the DELETE /voice/sessions/:id path; close here is best-effort.
  fastify.get('/voice/ws', { websocket: true }, (socket, request) => {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const sessionId = url.searchParams.get('session_id');

    if (typeof token !== 'string' || token.length === 0) {
      try { socket.close(4001, 'missing token'); } catch { /* noop */ }
      return;
    }
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      try { socket.close(4001, 'missing session_id'); } catch { /* noop */ }
      return;
    }

    let payload: AccessTokenPayload;
    try {
      payload = fastify.jwt.verify<AccessTokenPayload>(token);
    } catch {
      try { socket.close(4001, 'invalid token'); } catch { /* noop */ }
      return;
    }

    // P4 (5-S5b review): buffer messages that arrive before session validation
    // completes. The browser sends the `context` frame in its WS 'open' handler,
    // which fires before `session.ready` is received — i.e., before the async
    // `findTalkSession` await below resolves. Without this buffer, the context
    // frame is silently dropped and `state.contextSignal` stays null forever,
    // locking out all audio processing for the connection.
    let resolvedState: LumiVoiceWsState | null = null;
    const msgBuffer: Array<[unknown, boolean]> = [];

    function handleMessage(data: unknown, isBinary: boolean): void {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data as Buffer : Buffer.from(data as ArrayBuffer);
        void service.processVoiceUtterance(resolvedState!, buf, socket);
        return;
      }
      const text = Buffer.isBuffer(data) ? (data as Buffer).toString('utf8') : String(data);
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return; }
      const result = LumiVoiceClientMessageSchema.safeParse(parsed);
      if (!result.success) return;
      if (result.data.type === 'context') {
        resolvedState!.contextSignal = result.data.context_signal;
        return;
      }
      if (result.data.type === 'ping') {
        try { socket.send(JSON.stringify({ type: 'pong' })); } catch { /* noop */ }
      }
    }

    socket.on('message', (data, isBinary) => {
      if (resolvedState === null) { msgBuffer.push([data, isBinary]); return; }
      handleMessage(data, isBinary);
    });

    void (async () => {
      let session: Awaited<ReturnType<typeof repository.findTalkSession>>;
      try {
        session = await repository.findTalkSession(sessionId);
      } catch (err) {
        request.log.error(
          { err, module: 'lumi', action: 'lumi.voice.ws_open_failed', session_id: sessionId },
          'ambient voice WS session lookup failed',
        );
        try { socket.close(1011, 'internal error'); } catch { /* noop */ }
        return;
      }

      if (session === null || session.status !== 'active') {
        try { socket.close(4004, 'session not found'); } catch { /* noop */ }
        return;
      }
      if (session.user_id !== payload.sub) {
        try { socket.close(4001, 'auth failed'); } catch { /* noop */ }
        return;
      }

      resolvedState = {
        householdId: session.household_id,
        contextSignal: null,
        isProcessing: false,
        seq: 0,
      };

      // Drain any messages that arrived during session validation.
      for (const [data, isBinary] of msgBuffer) handleMessage(data, isBinary);
      msgBuffer.length = 0;

      socket.on('close', () => {
        // Best-effort only: the authoritative teardown is DELETE
        // /v1/lumi/voice/sessions/:id → closeTalkSession (do not double-close).
        request.log.debug(
          { module: 'lumi', action: 'lumi.voice.ws_closed', session_id: sessionId },
          'ambient voice WS closed',
        );
      });

      // Sent after state is ready so the client knows it can begin speaking.
      try { socket.send(JSON.stringify({ type: 'session.ready' })); } catch { /* noop */ }
    })();
  });
};
