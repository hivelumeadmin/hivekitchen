import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { voiceRoutes } from './voice.routes.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_THREAD_ID = '33333333-3333-4333-8333-333333333333';
const SAMPLE_SESSION_ID = '44444444-4444-4444-8444-444444444444';
const JWT_SECRET = 'a'.repeat(32);
const VOICE_ID = 'voice_test_xyz';

const SAMPLE_THREAD_ROW = {
  id: SAMPLE_THREAD_ID,
  household_id: SAMPLE_HOUSEHOLD_ID,
  type: 'onboarding',
  status: 'active',
  modality: 'voice',
  created_at: new Date().toISOString(),
};

const SAMPLE_SESSION_ROW = {
  id: SAMPLE_SESSION_ID,
  user_id: SAMPLE_USER_ID,
  household_id: SAMPLE_HOUSEHOLD_ID,
  thread_id: SAMPLE_THREAD_ID,
  elevenlabs_conversation_id: null,
  status: 'active',
  started_at: new Date().toISOString(),
  ended_at: null,
};

function buildMockSupabase(opts: {
  activeSessionForHousehold?: unknown;
}) {
  const activeSession = opts.activeSessionForHousehold ?? null;
  return {
    from(table: string) {
      if (table === 'threads') {
        return {
          insert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({ data: SAMPLE_THREAD_ROW, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }),
        };
      }
      if (table === 'voice_sessions') {
        return {
          insert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({ data: SAMPLE_SESSION_ROW, error: null }),
            }),
          }),
          select: () => ({
            eq: vi.fn().mockImplementation((col: string) => {
              if (col === 'id') {
                // findVoiceSession — not exercised by current POST /sessions tests
                return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
              }
              // findActiveSessionForHousehold: .eq('household_id').eq('status').limit(1).maybeSingle()
              return {
                eq: () => ({
                  limit: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: activeSession, error: null }),
                  }),
                }),
              };
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
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function buildMockOpenAI() {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'hello' } }],
        }),
      },
    },
  };
}

async function buildTestApp(opts: {
  supabase: ReturnType<typeof buildMockSupabase>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = {
    NODE_ENV: 'development' as const,
    JWT_SECRET,
    ELEVENLABS_API_KEY: 'test-key',
    ELEVENLABS_VOICE_ID: VOICE_ID,
  };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', opts.supabase as unknown as FastifyInstance['supabase']);
  app.decorate('elevenlabs', {} as unknown as FastifyInstance['elevenlabs']);
  app.decorate('openai', buildMockOpenAI() as unknown as FastifyInstance['openai']);

  await app.register(jwt, { secret: JWT_SECRET, sign: { expiresIn: '15m' } });
  await app.register(authenticateHook);
  await app.register(websocket);

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
    const obj = err as { cause?: unknown; validation?: unknown };
    if (obj.cause instanceof ZodError) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        instance: request.id,
      });
      return;
    }
    if (Array.isArray(obj.validation) && obj.validation.length > 0) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
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

describe('POST /v1/voice/sessions', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path → 200 with session_id (UUID)', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase({}) });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context: 'onboarding' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { session_id: string };
    expect(body.session_id).toBe(SAMPLE_SESSION_ID);
  });

  it('unauthenticated → 401', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase({}) });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/sessions',
      payload: { context: 'onboarding' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('existing active session for household → 409', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ activeSessionForHousehold: SAMPLE_SESSION_ROW }),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context: 'onboarding' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/conflict');
  });

  it('rejects unknown context → 400', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase({}) });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context: 'evening' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('Removed voice endpoints (Story 2.6b — replaced by HK-owned WS)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('POST /v1/voice/token → 404', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase({}) });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/token',
      headers: { authorization: `Bearer ${token}` },
      payload: { context: 'onboarding' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('POST /v1/voice/llm → 404', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase({}) });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/voice/llm',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });

  it('POST /v1/webhooks/elevenlabs → 404', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase({}) });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/elevenlabs',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(res.statusCode).toBe(404);
  });
});
