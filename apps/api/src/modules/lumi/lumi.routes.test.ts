import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { lumiRoutes } from './lumi.routes.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HOUSEHOLD_ID = '33333333-3333-4333-8333-333333333333';
const SAMPLE_THREAD_ID = '44444444-4444-4444-8444-444444444444';
const NEW_THREAD_ID = '55555555-5555-4555-8555-555555555555';
const SAMPLE_TALK_SESSION_ID = '66666666-6666-4666-8666-666666666666';
const JWT_SECRET = 'a'.repeat(32);
const ELEVENLABS_API_KEY = 'el-test-key';
const VOICE_ID = 'lumi-voice-id';

interface TurnFixture {
  id: string;
  thread_id: string;
  server_seq: number;
  role: 'user' | 'lumi' | 'system';
  body: { type: 'message'; content: string };
  modality: 'text' | 'voice';
  created_at: string;
}

function buildTurn(seq: number, content: string): TurnFixture {
  return {
    id: `00000000-0000-4000-8000-${seq.toString().padStart(12, '0')}`,
    thread_id: SAMPLE_THREAD_ID,
    server_seq: seq,
    role: seq % 2 === 0 ? 'lumi' : 'user',
    body: { type: 'message', content },
    modality: 'text',
    created_at: '2026-04-30T00:00:00.000Z',
  };
}

interface ThreadRowFixture {
  id: string;
  household_id: string;
  type: string;
  status: string;
  modality: string;
  created_at: string;
}

interface TalkSessionRowFixture {
  id: string;
  user_id: string;
  household_id: string;
  thread_id: string;
  status: 'active' | 'closed' | 'timed_out' | 'disconnected';
  started_at: string;
  ended_at: string | null;
}

interface SupabaseMockOpts {
  // GET /threads/:id/turns fixtures
  threadOwnershipRow?: { id: string; household_id: string } | null;
  turnsDescending?: TurnFixture[];

  // POST /voice/sessions fixtures
  householdTier?: 'standard' | 'premium' | null;
  activeAmbientThread?: ThreadRowFixture | null;
  insertedAmbientThread?: ThreadRowFixture;
  insertedTalkSession?: TalkSessionRowFixture;
  insertAmbientThreadError?: { code: string; message: string };

  // DELETE /voice/sessions/:id fixtures
  talkSessionLookup?: TalkSessionRowFixture | null;

  // Spies
  capturedAmbientThreadInsert?: (row: Record<string, unknown>) => void;
  capturedTalkSessionInsert?: (row: Record<string, unknown>) => void;
  capturedTalkSessionUpdate?: (row: Record<string, unknown>) => void;
}

function buildMockSupabase(opts: SupabaseMockOpts) {
  const turnsDescending = opts.turnsDescending ?? [];
  let threadInsertCount = 0;

  return {
    from(table: string) {
      if (table === 'thread_turns') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: vi.fn().mockResolvedValue({ data: turnsDescending, error: null }),
              }),
            }),
          }),
        };
      }

      if (table === 'households') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: opts.householdTier === undefined || opts.householdTier === null
                  ? null
                  : { tier: opts.householdTier },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'threads') {
        return {
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            opts.capturedAmbientThreadInsert?.(row);
            threadInsertCount += 1;
            const error = opts.insertAmbientThreadError ?? null;
            const data = error
              ? null
              : (opts.insertedAmbientThread ?? {
                  id: NEW_THREAD_ID,
                  household_id: row.household_id as string,
                  type: row.type as string,
                  status: 'active',
                  modality: row.modality as string,
                  created_at: '2026-04-30T00:00:00.000Z',
                });
            return {
              select: () => ({
                single: vi.fn().mockResolvedValue({ data, error }),
              }),
            };
          }),
          select: () => ({
            // Branch on the first .eq() column to distinguish query shapes:
            //   col='id'           → GET turns ownership check  → .maybeSingle()
            //   col='household_id' → findActiveAmbientThread    → .eq.eq.order.limit.maybeSingle()
            eq: vi.fn().mockImplementation((column: string) => {
              if (column === 'id') {
                return {
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: opts.threadOwnershipRow ?? null,
                    error: null,
                  }),
                };
              }
              return {
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: opts.activeAmbientThread ?? null,
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              };
            }),
          }),
        };
      }

      if (table === 'voice_sessions') {
        return {
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            opts.capturedTalkSessionInsert?.(row);
            const data = opts.insertedTalkSession ?? {
              id: SAMPLE_TALK_SESSION_ID,
              user_id: row.user_id as string,
              household_id: row.household_id as string,
              thread_id: row.thread_id as string,
              status: 'active' as const,
              started_at: '2026-04-30T00:00:00.000Z',
              ended_at: null,
            };
            return {
              select: () => ({
                single: vi.fn().mockResolvedValue({ data, error: null }),
              }),
            };
          }),
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: opts.talkSessionLookup ?? null,
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            opts.capturedTalkSessionUpdate?.(row);
            const p = Promise.resolve({ error: null as null });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chain: any = {
              eq: vi.fn().mockImplementation(() => chain),
              then: p.then.bind(p),
              catch: p.catch.bind(p),
            };
            return chain;
          }),
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
    // Test introspection helper
    _threadInsertCount: () => threadInsertCount,
  };
}

interface RedisMock {
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
}

function buildMockRedis(): RedisMock {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
}

async function buildTestApp(opts: {
  supabase: ReturnType<typeof buildMockSupabase>;
  redis?: RedisMock;
}): Promise<FastifyInstance & { _redis: RedisMock }> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = {
    NODE_ENV: 'development' as const,
    JWT_SECRET,
    ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID: VOICE_ID,
  };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', opts.supabase as unknown as FastifyInstance['supabase']);
  const redis = opts.redis ?? buildMockRedis();
  app.decorate('redis', redis as unknown as FastifyInstance['redis']);

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

  await app.register(lumiRoutes, { prefix: '/v1/lumi' });
  await app.ready();
  const decorated = app as unknown as FastifyInstance & { _redis: RedisMock };
  decorated._redis = redis;
  return decorated;
}

function signToken(
  app: FastifyInstance,
  householdId = SAMPLE_HOUSEHOLD_ID,
  userId = SAMPLE_USER_ID,
  role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops' = 'primary_parent',
): string {
  return app.jwt.sign({ sub: userId, hh: householdId, role });
}

// Helper: install a fetch mock on globalThis. Returns the `fetch` spy.
function mockFetch(impl: (url: string) => Promise<Response>): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((input: string | URL) => impl(String(input)));
  globalThis.fetch = spy as unknown as typeof globalThis.fetch;
  return spy;
}

function ok(json: unknown): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(status: number): Response {
  return new Response('boom', { status });
}

const VALID_CONTEXT_SIGNAL_PLANNING = {
  surface: 'planning' as const,
};
const VALID_CONTEXT_SIGNAL_ONBOARDING = {
  surface: 'onboarding' as const,
};

describe('GET /v1/lumi/threads/:threadId/turns', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 with thread_id + turns when JWT household owns the thread', async () => {
    const turnsDescending = [buildTurn(3, 'three'), buildTurn(2, 'two'), buildTurn(1, 'one')];
    app = await buildTestApp({
      supabase: buildMockSupabase({
        threadOwnershipRow: { id: SAMPLE_THREAD_ID, household_id: SAMPLE_HOUSEHOLD_ID },
        turnsDescending,
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lumi/threads/${SAMPLE_THREAD_ID}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { thread_id: string; turns: TurnFixture[] };
    expect(body.thread_id).toBe(SAMPLE_THREAD_ID);
    expect(body.turns).toHaveLength(3);
  });

  it('returns turns in ascending server_seq order even though the DB query is descending', async () => {
    const turnsDescending = [buildTurn(3, 'three'), buildTurn(2, 'two'), buildTurn(1, 'one')];
    app = await buildTestApp({
      supabase: buildMockSupabase({
        threadOwnershipRow: { id: SAMPLE_THREAD_ID, household_id: SAMPLE_HOUSEHOLD_ID },
        turnsDescending,
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lumi/threads/${SAMPLE_THREAD_ID}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { turns: TurnFixture[] };
    const seqs = body.turns.map((t) => t.server_seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('cross-household access → 403', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({
        threadOwnershipRow: { id: SAMPLE_THREAD_ID, household_id: OTHER_HOUSEHOLD_ID },
      }),
    });
    const token = signToken(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lumi/threads/${SAMPLE_THREAD_ID}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/forbidden');
  });

  it('non-existent thread → 403 (no existence leak)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ threadOwnershipRow: null }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lumi/threads/${SAMPLE_THREAD_ID}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/forbidden');
  });

  it('thread with fewer than 20 turns returns all of them', async () => {
    const turnsDescending = [buildTurn(2, 'two'), buildTurn(1, 'one')];
    app = await buildTestApp({
      supabase: buildMockSupabase({
        threadOwnershipRow: { id: SAMPLE_THREAD_ID, household_id: SAMPLE_HOUSEHOLD_ID },
        turnsDescending,
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lumi/threads/${SAMPLE_THREAD_ID}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { turns: TurnFixture[] };
    expect(body.turns).toHaveLength(2);
  });

  it('thread with more than 20 turns — JS layer caps to 20 most recent, ascending', async () => {
    // 21 rows descending (seq 50..30); .slice(0, 20) keeps 50..31, .reverse() → 31..50
    const turnsDescending = Array.from({ length: 21 }, (_, i) =>
      buildTurn(50 - i, `t${50 - i}`),
    );
    app = await buildTestApp({
      supabase: buildMockSupabase({
        threadOwnershipRow: { id: SAMPLE_THREAD_ID, household_id: SAMPLE_HOUSEHOLD_ID },
        turnsDescending,
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lumi/threads/${SAMPLE_THREAD_ID}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { turns: TurnFixture[] };
    expect(body.turns).toHaveLength(20);
    expect(body.turns[0].server_seq).toBe(31);
    expect(body.turns[19].server_seq).toBe(50);
  });

  it('unauthenticated request → 401', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({
        threadOwnershipRow: { id: SAMPLE_THREAD_ID, household_id: SAMPLE_HOUSEHOLD_ID },
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lumi/threads/${SAMPLE_THREAD_ID}/turns`,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/lumi/voice/sessions', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    if (app) await app.close();
    globalThis.fetch = realFetch;
  });

  it('happy path — Premium parent: creates session, returns token pair, sets Redis sentinel', async () => {
    const fetchSpy = mockFetch(async () =>
      ok({ signed_url: `https://api.elevenlabs.io/wss/${randomUUID()}` }),
    );
    const insertedThreadCapture: Record<string, unknown>[] = [];
    const insertedSessionCapture: Record<string, unknown>[] = [];

    app = await buildTestApp({
      supabase: buildMockSupabase({
        householdTier: 'premium',
        activeAmbientThread: null,
        capturedAmbientThreadInsert: (row) => insertedThreadCapture.push(row),
        capturedTalkSessionInsert: (row) => insertedSessionCapture.push(row),
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      talk_session_id: string;
      stt_token: string;
      tts_token: string;
      voice_id: string;
    };
    expect(body.talk_session_id).toBe(SAMPLE_TALK_SESSION_ID);
    expect(body.voice_id).toBe(VOICE_ID);
    expect(body.stt_token.length).toBeGreaterThan(0);
    expect(body.tts_token.length).toBeGreaterThan(0);
    // Two ElevenLabs calls (STT + TTS) per AC #1
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(insertedSessionCapture).toHaveLength(1);
    expect(insertedSessionCapture[0]).toMatchObject({
      user_id: SAMPLE_USER_ID,
      household_id: SAMPLE_HOUSEHOLD_ID,
      thread_id: NEW_THREAD_ID,
    });
    expect(app._redis.set).toHaveBeenCalledWith(
      `lumi:voice:session:${SAMPLE_TALK_SESSION_ID}:active`,
      '1',
      'EX',
      20,
    );
  });

  it('lazy thread creation — no existing thread → new ambient thread inserted with type=surface', async () => {
    mockFetch(async () => ok({ signed_url: 'wss://x' }));
    const insertedThreadCapture: Record<string, unknown>[] = [];

    app = await buildTestApp({
      supabase: buildMockSupabase({
        householdTier: 'premium',
        activeAmbientThread: null,
        capturedAmbientThreadInsert: (row) => insertedThreadCapture.push(row),
      }),
    });
    const token = signToken(app);

    await app.inject({
      method: 'POST',
      url: '/v1/lumi/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(insertedThreadCapture).toHaveLength(1);
    expect(insertedThreadCapture[0]).toMatchObject({
      household_id: SAMPLE_HOUSEHOLD_ID,
      type: 'planning',
    });
  });

  it('existing thread reuse — no new thread inserted when one is already active', async () => {
    mockFetch(async () => ok({ signed_url: 'wss://x' }));
    const insertedThreadCapture: Record<string, unknown>[] = [];
    const insertedSessionCapture: Record<string, unknown>[] = [];

    app = await buildTestApp({
      supabase: buildMockSupabase({
        householdTier: 'premium',
        activeAmbientThread: {
          id: SAMPLE_THREAD_ID,
          household_id: SAMPLE_HOUSEHOLD_ID,
          type: 'planning',
          status: 'active',
          modality: 'voice',
          created_at: '2026-04-30T00:00:00.000Z',
        },
        capturedAmbientThreadInsert: (row) => insertedThreadCapture.push(row),
        capturedTalkSessionInsert: (row) => insertedSessionCapture.push(row),
      }),
    });
    const token = signToken(app);

    await app.inject({
      method: 'POST',
      url: '/v1/lumi/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(insertedThreadCapture).toHaveLength(0);
    expect(insertedSessionCapture[0]).toMatchObject({ thread_id: SAMPLE_THREAD_ID });
  });

  it('Standard-tier household → 403', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ householdTier: 'standard' }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/forbidden');
  });

  it('onboarding surface rejected — must use POST /v1/voice/sessions instead → 400', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ householdTier: 'premium' }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context_signal: VALID_CONTEXT_SIGNAL_ONBOARDING },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });

  it('secondary_caregiver → 403 (POST restricted to primary_parent)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ householdTier: 'premium' }),
    });
    const token = signToken(app, SAMPLE_HOUSEHOLD_ID, SAMPLE_USER_ID, 'secondary_caregiver');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/forbidden');
  });

  it('ElevenLabs STT credential issuance fails → 502, no session row written', async () => {
    let call = 0;
    mockFetch(async () => {
      call += 1;
      return call === 1 ? fail(500) : ok({ signed_url: 'wss://tts' });
    });
    const sessionInserts: Record<string, unknown>[] = [];

    app = await buildTestApp({
      supabase: buildMockSupabase({
        householdTier: 'premium',
        activeAmbientThread: null,
        capturedTalkSessionInsert: (row) => sessionInserts.push(row),
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(502);
    expect(sessionInserts).toHaveLength(0);
  });

  it('ElevenLabs TTS credential issuance fails after STT succeeds → 502, no session row', async () => {
    let call = 0;
    mockFetch(async () => {
      call += 1;
      return call === 1 ? ok({ signed_url: 'wss://stt' }) : fail(503);
    });
    const sessionInserts: Record<string, unknown>[] = [];

    app = await buildTestApp({
      supabase: buildMockSupabase({
        householdTier: 'premium',
        activeAmbientThread: null,
        capturedTalkSessionInsert: (row) => sessionInserts.push(row),
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(502);
    expect(sessionInserts).toHaveLength(0);
  });

  it('unauthenticated POST → 401', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ householdTier: 'premium' }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/voice/sessions',
      payload: { context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /v1/lumi/voice/sessions/:id', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path — owner closes own session', async () => {
    const updates: Record<string, unknown>[] = [];
    app = await buildTestApp({
      supabase: buildMockSupabase({
        talkSessionLookup: {
          id: SAMPLE_TALK_SESSION_ID,
          user_id: SAMPLE_USER_ID,
          household_id: SAMPLE_HOUSEHOLD_ID,
          thread_id: SAMPLE_THREAD_ID,
          status: 'active',
          started_at: '2026-04-30T00:00:00.000Z',
          ended_at: null,
        },
        capturedTalkSessionUpdate: (row) => updates.push(row),
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/lumi/voice/sessions/${SAMPLE_TALK_SESSION_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: 'closed' });
    expect(app._redis.del).toHaveBeenCalledWith(
      `lumi:voice:session:${SAMPLE_TALK_SESSION_ID}:active`,
    );
  });

  it('cross-user DELETE → 403 (no update written)', async () => {
    const updates: Record<string, unknown>[] = [];
    app = await buildTestApp({
      supabase: buildMockSupabase({
        talkSessionLookup: {
          id: SAMPLE_TALK_SESSION_ID,
          user_id: OTHER_USER_ID, // different user owns the session
          household_id: SAMPLE_HOUSEHOLD_ID,
          thread_id: SAMPLE_THREAD_ID,
          status: 'active',
          started_at: '2026-04-30T00:00:00.000Z',
          ended_at: null,
        },
        capturedTalkSessionUpdate: (row) => updates.push(row),
      }),
    });
    const token = signToken(app, SAMPLE_HOUSEHOLD_ID, SAMPLE_USER_ID);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/lumi/voice/sessions/${SAMPLE_TALK_SESSION_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it('non-existent session → 403 (no existence leak)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ talkSessionLookup: null }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/lumi/voice/sessions/${SAMPLE_TALK_SESSION_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('cross-household DELETE → 403 (session belongs to different household)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({
        talkSessionLookup: {
          id: SAMPLE_TALK_SESSION_ID,
          user_id: SAMPLE_USER_ID,
          household_id: OTHER_HOUSEHOLD_ID, // session belongs to a different household
          thread_id: SAMPLE_THREAD_ID,
          status: 'active',
          started_at: '2026-04-30T00:00:00.000Z',
          ended_at: null,
        },
      }),
    });
    const token = signToken(app, SAMPLE_HOUSEHOLD_ID, SAMPLE_USER_ID);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/lumi/voice/sessions/${SAMPLE_TALK_SESSION_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated DELETE → 401', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({}),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/lumi/voice/sessions/${SAMPLE_TALK_SESSION_ID}`,
    });

    expect(res.statusCode).toBe(401);
  });
});
