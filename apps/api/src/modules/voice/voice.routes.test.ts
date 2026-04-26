import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { voiceRoutes } from './voice.routes.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_THREAD_ID = '33333333-3333-4333-8333-333333333333';
const SAMPLE_SESSION_ID = '44444444-4444-4444-8444-444444444444';
const SAMPLE_CONVERSATION_ID = 'conv_test_abc123';
const JWT_SECRET = 'a'.repeat(32);
const CUSTOM_LLM_SECRET = 'x'.repeat(32);
const WEBHOOK_SECRET = 'w'.repeat(32);
const AGENT_ID = 'agent_test_xyz';

const SAMPLE_THREAD_ROW = {
  id: SAMPLE_THREAD_ID,
  household_id: SAMPLE_HOUSEHOLD_ID,
  type: 'onboarding',
  status: 'active',
  created_at: new Date().toISOString(),
};

const SAMPLE_SESSION_ROW = {
  id: SAMPLE_SESSION_ID,
  user_id: SAMPLE_USER_ID,
  household_id: SAMPLE_HOUSEHOLD_ID,
  thread_id: SAMPLE_THREAD_ID,
  elevenlabs_conversation_id: SAMPLE_CONVERSATION_ID,
  status: 'active',
  started_at: new Date().toISOString(),
  ended_at: null,
};

const TIMED_OUT_SESSION_ROW = {
  ...SAMPLE_SESSION_ROW,
  started_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
};

function buildMockSupabase(opts: {
  sessionLookupResult?: unknown;
  sessionLookupError?: unknown;
  createThreadError?: unknown;
  createSessionError?: unknown;
}) {
  const sessionLookupResult = opts.sessionLookupResult ?? null;

  return {
    from(table: string) {
      if (table === 'threads') {
        return {
          insert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({
                data: opts.createThreadError ? null : SAMPLE_THREAD_ROW,
                error: opts.createThreadError ?? null,
              }),
            }),
          }),
        };
      }
      if (table === 'voice_sessions') {
        return {
          insert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({
                data: opts.createSessionError ? null : SAMPLE_SESSION_ROW,
                error: opts.createSessionError ?? null,
              }),
            }),
          }),
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: sessionLookupResult,
                error: opts.sessionLookupError ?? null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: vi.fn().mockResolvedValue({
                  data: { ...SAMPLE_SESSION_ROW, status: 'closed', ended_at: new Date().toISOString() },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'thread_turns') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function buildMockElevenLabs(opts: {
  getSignedUrlResult?: unknown;
  getSignedUrlError?: unknown;
  constructEventResult?: unknown;
  constructEventError?: unknown;
}) {
  return {
    conversationalAi: {
      conversations: {
        getSignedUrl: opts.getSignedUrlError
          ? vi.fn().mockRejectedValue(opts.getSignedUrlError)
          : vi.fn().mockResolvedValue(
              opts.getSignedUrlResult ?? {
                signedUrl: 'https://api.elevenlabs.io/v1/convai/conversation?token=signed',
                conversationId: SAMPLE_CONVERSATION_ID,
              },
            ),
      },
    },
    webhooks: {
      constructEvent: opts.constructEventError
        ? vi.fn().mockRejectedValue(opts.constructEventError)
        : vi.fn().mockResolvedValue(
            opts.constructEventResult ?? {
              type: 'post_call_transcription',
              event_timestamp: 1717171717,
              data: {
                agent_id: AGENT_ID,
                conversation_id: SAMPLE_CONVERSATION_ID,
                status: 'done',
                transcript: [
                  { role: 'agent', message: '[warmly] What did your grandmother cook?', time_in_call_secs: 1 },
                  { role: 'user', message: 'She made dal and rice every Sunday.' },
                ],
              },
            },
          ),
    },
  };
}

function buildMockOpenAI(responseText = '[warmly] That sounds like a wonderful family tradition.') {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseText } }],
        }),
      },
    },
  };
}

async function buildTestApp(opts: {
  supabase: ReturnType<typeof buildMockSupabase>;
  elevenlabs: ReturnType<typeof buildMockElevenLabs>;
  openai: ReturnType<typeof buildMockOpenAI>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = {
    NODE_ENV: 'development' as const,
    JWT_SECRET,
    ELEVENLABS_AGENT_ID: AGENT_ID,
    ELEVENLABS_CUSTOM_LLM_SECRET: CUSTOM_LLM_SECRET,
    ELEVENLABS_WEBHOOK_SECRET: WEBHOOK_SECRET,
  };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', opts.supabase as unknown as FastifyInstance['supabase']);
  app.decorate('elevenlabs', opts.elevenlabs as unknown as FastifyInstance['elevenlabs']);
  app.decorate('openai', opts.openai as unknown as FastifyInstance['openai']);

  await app.register(jwt, { secret: JWT_SECRET, sign: { expiresIn: '15m' } });
  await app.register(authenticateHook);

  app.setErrorHandler((err, request, reply) => {
    if (isDomainError(err)) {
      void reply.status(err.status).type('application/problem+json').send({
        type: err.type,
        status: err.status,
        title: err.title,
        detail: err.detail,
        instance: request.id,
      });
      return;
    }
    if (err instanceof ZodError) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        detail: err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
        instance: request.id,
      });
      return;
    }
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  await app.register(voiceRoutes);
  await app.ready();
  return app;
}

function signAccessToken(app: FastifyInstance): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'primary_parent' });
}

const VALID_LLM_BODY = {
  messages: [
    { role: 'system', content: 'You are Lumi.' },
    { role: 'user', content: 'What did your grandmother cook?' },
  ],
  model: 'gpt-4o',
  stream: true,
  elevenlabs_extra_body: { UUID: SAMPLE_CONVERSATION_ID },
};

const VALID_WEBHOOK_PAYLOAD = {
  type: 'post_call_transcription',
  event_timestamp: 1717171717,
  data: {
    agent_id: AGENT_ID,
    conversation_id: SAMPLE_CONVERSATION_ID,
    status: 'done',
    transcript: [
      { role: 'agent', message: 'What did your grandmother cook?' },
      { role: 'user', message: 'She made dal and rice.' },
    ],
  },
};

describe('POST /v1/voice/token', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path → 200 with token (signed URL) and sessionId', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({}),
      elevenlabs: buildMockElevenLabs({}),
      openai: buildMockOpenAI(),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/token',
      headers: { authorization: `Bearer ${token}` },
      payload: { context: 'onboarding' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { token: string; sessionId: string };
    expect(typeof body.token).toBe('string');
    expect(body.token.startsWith('https://')).toBe(true);
    expect(body.sessionId).toBe(SAMPLE_SESSION_ID);
  });

  it('unauthenticated → 401', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({}),
      elevenlabs: buildMockElevenLabs({}),
      openai: buildMockOpenAI(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/token',
      payload: { context: 'onboarding' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('ElevenLabs unavailable → 502', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({}),
      elevenlabs: buildMockElevenLabs({ getSignedUrlError: new Error('network timeout') }),
      openai: buildMockOpenAI(),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/token',
      headers: { authorization: `Bearer ${token}` },
      payload: { context: 'onboarding' },
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/upstream');
  });
});

describe('POST /v1/voice/llm', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('valid bearer + known conversation → 200 text/event-stream with data chunks and [DONE]', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ sessionLookupResult: SAMPLE_SESSION_ROW }),
      elevenlabs: buildMockElevenLabs({}),
      openai: buildMockOpenAI('[warmly] That sounds lovely.'),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/llm',
      headers: { authorization: `Bearer ${CUSTOM_LLM_SECRET}` },
      payload: VALID_LLM_BODY,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('data: ');
    expect(res.body).toContain('data: [DONE]');
  });

  it('wrong bearer secret → 401', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ sessionLookupResult: SAMPLE_SESSION_ROW }),
      elevenlabs: buildMockElevenLabs({}),
      openai: buildMockOpenAI(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/llm',
      headers: { authorization: 'Bearer wrong-secret' },
      payload: VALID_LLM_BODY,
    });

    expect(res.statusCode).toBe(401);
  });

  it('missing Authorization header → 401', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({}),
      elevenlabs: buildMockElevenLabs({}),
      openai: buildMockOpenAI(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/llm',
      payload: VALID_LLM_BODY,
    });

    expect(res.statusCode).toBe(401);
  });

  it('unknown conversation_id → 404', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ sessionLookupResult: null }),
      elevenlabs: buildMockElevenLabs({}),
      openai: buildMockOpenAI(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/llm',
      headers: { authorization: `Bearer ${CUSTOM_LLM_SECRET}` },
      payload: VALID_LLM_BODY,
    });

    expect(res.statusCode).toBe(404);
  });

  it('timed-out session → 200 SSE with closing phrase', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ sessionLookupResult: TIMED_OUT_SESSION_ROW }),
      elevenlabs: buildMockElevenLabs({}),
      openai: buildMockOpenAI(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/llm',
      headers: { authorization: `Bearer ${CUSTOM_LLM_SECRET}` },
      payload: VALID_LLM_BODY,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain("That's everything I needed");
    expect(res.body).toContain('data: [DONE]');
  });
});

describe('POST /v1/webhooks/elevenlabs', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('valid HMAC + post_call_transcription → 200 empty body', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ sessionLookupResult: SAMPLE_SESSION_ROW }),
      elevenlabs: buildMockElevenLabs({ constructEventResult: VALID_WEBHOOK_PAYLOAD }),
      openai: buildMockOpenAI(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/elevenlabs',
      headers: {
        'content-type': 'application/json',
        'elevenlabs-signature': 't=1717171717,v0=mock_valid_sig',
      },
      payload: JSON.stringify(VALID_WEBHOOK_PAYLOAD),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });

  it('invalid HMAC signature → 403', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({}),
      elevenlabs: buildMockElevenLabs({ constructEventError: new Error('Invalid signature') }),
      openai: buildMockOpenAI(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/elevenlabs',
      headers: {
        'content-type': 'application/json',
        'elevenlabs-signature': 't=1717171717,v0=bad_sig',
      },
      payload: JSON.stringify(VALID_WEBHOOK_PAYLOAD),
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/forbidden');
  });

  it('unknown conversation_id → 200 (log and ignore — do not 404 on webhooks)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ sessionLookupResult: null }),
      elevenlabs: buildMockElevenLabs({ constructEventResult: VALID_WEBHOOK_PAYLOAD }),
      openai: buildMockOpenAI(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/elevenlabs',
      headers: {
        'content-type': 'application/json',
        'elevenlabs-signature': 't=1717171717,v0=mock_valid_sig',
      },
      payload: JSON.stringify(VALID_WEBHOOK_PAYLOAD),
    });

    expect(res.statusCode).toBe(200);
  });
});
