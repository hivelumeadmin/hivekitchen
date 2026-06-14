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
const MOCKED_LUMI_REPLY = 'Mocked Lumi reply.';

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
  // 5-S16 — current-week voice_usage.ms_consumed for the cap pre-check.
  voiceUsageMsConsumed?: number | null;
  activeAmbientThread?: ThreadRowFixture | null;
  insertedAmbientThread?: ThreadRowFixture;
  insertedTalkSession?: TalkSessionRowFixture;
  insertAmbientThreadError?: { code: string; message: string };

  // DELETE /voice/sessions/:id fixtures
  talkSessionLookup?: TalkSessionRowFixture | null;

  // Spies
  capturedGte?: (val: string) => void;
  capturedAmbientThreadInsert?: (row: Record<string, unknown>) => void;
  capturedTalkSessionInsert?: (row: Record<string, unknown>) => void;
  capturedTalkSessionUpdate?: (row: Record<string, unknown>) => void;
  capturedTurnInsert?: (row: Record<string, unknown>) => void;
}

function buildMockSupabase(opts: SupabaseMockOpts) {
  const turnsDescending = opts.turnsDescending ?? [];
  let threadInsertCount = 0;
  // POST /turns: server_seq is API-assigned, so getNextSeq reads max(server_seq)
  // from previously-inserted turns this request. Track them in-closure.
  const insertedTurns: TurnFixture[] = [];

  return {
    from(table: string) {
      if (table === 'thread_turns') {
        return {
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            opts.capturedTurnInsert?.(row);
            const turnRow: TurnFixture = {
              id: `00000000-0000-4000-8000-${String(insertedTurns.length + 1).padStart(12, '0')}`,
              thread_id: row.thread_id as string,
              server_seq: row.server_seq as number,
              role: row.role as TurnFixture['role'],
              body: row.body as TurnFixture['body'],
              modality: row.modality as TurnFixture['modality'],
              created_at: '2026-04-30T00:00:00.000Z',
            };
            insertedTurns.push(turnRow);
            return {
              select: () => ({
                single: vi.fn().mockResolvedValue({ data: turnRow, error: null }),
              }),
            };
          }),
          // Branch on the selected column to distinguish the two read shapes:
          //   'server_seq' → getNextSeq → .eq.order.limit.maybeSingle()
          //   TURN_COLUMNS → getThreadTurns → .eq.order.limit() (awaited)
          select: (columns: string) => {
            if (columns === 'server_seq') {
              return {
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: vi.fn().mockImplementation(() => {
                        const max = insertedTurns.reduce(
                          (m, t) => (t.server_seq > m ? t.server_seq : m),
                          0,
                        );
                        return Promise.resolve({
                          data: max > 0 ? { server_seq: max } : null,
                          error: null,
                        });
                      }),
                    }),
                  }),
                }),
              };
            }
            // TURN_COLUMNS read supports two shapes:
            //   default:  .eq().order().limit()      (awaited at limit, descending)
            //   from_seq: .eq().gte().order()        (awaited at order, ascending)
            let fromSeqVal: number | undefined;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chain: any = {
              eq: () => chain,
              gte: (_col: string, val: string) => {
                fromSeqVal = Number(val);
                opts.capturedGte?.(val);
                return chain;
              },
              order: () => chain,
              limit: vi.fn().mockResolvedValue({ data: turnsDescending, error: null }),
              then: (resolve: (v: { data: TurnFixture[]; error: null }) => unknown) => {
                const rows =
                  fromSeqVal === undefined
                    ? turnsDescending
                    : turnsDescending
                        .filter((t) => t.server_seq >= fromSeqVal!)
                        .slice()
                        .sort((a, b) => a.server_seq - b.server_seq);
                return resolve({ data: rows, error: null });
              },
            };
            return chain;
          },
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

      // Story 12-S9 — POST /turns assembles a household snapshot, reading
      // children + household_allergens. Both return empty here (the snapshot
      // path is exercised in lumi.service.test.ts); the routes only need them
      // to not throw "unexpected table".
      if (table === 'children') {
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }

      if (table === 'household_allergens') {
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }

      if (table === 'voice_usage') {
        // 5-S16 — getWeeklyUsage: .select('ms_consumed').eq().eq().maybeSingle()
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data:
                    opts.voiceUsageMsConsumed === undefined || opts.voiceUsageMsConsumed === null
                      ? null
                      : { ms_consumed: opts.voiceUsageMsConsumed },
                  error: null,
                }),
              }),
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

  // Story 12-S9 — POST /turns now dispatches the real LumiAgent, which calls
  // fastify.openai. Decorate a fake client so no network call is made; the
  // canned content is what the Lumi turn body should carry.
  const openai = {
    chat: {
      completions: {
        create: vi
          .fn()
          .mockResolvedValue({ choices: [{ message: { content: MOCKED_LUMI_REPLY } }] }),
      },
    },
  };
  app.decorate('openai', openai as unknown as FastifyInstance['openai']);

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

  // Slice 5-S4 — from_seq gap-recovery query param.
  it('from_seq=2 → returns only turns with server_seq ≥ 2, ascending, no cap', async () => {
    const turnsDescending = [buildTurn(3, 'three'), buildTurn(2, 'two'), buildTurn(1, 'one')];
    const gteValues: string[] = [];
    app = await buildTestApp({
      supabase: buildMockSupabase({
        threadOwnershipRow: { id: SAMPLE_THREAD_ID, household_id: SAMPLE_HOUSEHOLD_ID },
        turnsDescending,
        capturedGte: (val) => gteValues.push(val),
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lumi/threads/${SAMPLE_THREAD_ID}/turns?from_seq=2`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { turns: TurnFixture[] };
    expect(body.turns.map((t) => t.server_seq)).toEqual([2, 3]);
    // bigint passed to supabase-js as a string, not a JS bigint.
    expect(gteValues).toEqual(['2']);
  });

  it('from_seq=99 → empty array when no turns have that seq', async () => {
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
      url: `/v1/lumi/threads/${SAMPLE_THREAD_ID}/turns?from_seq=99`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { turns: TurnFixture[] };
    expect(body.turns).toEqual([]);
  });

  it('from_seq=abc → 400 (Zod regex rejects non-numeric)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({
        threadOwnershipRow: { id: SAMPLE_THREAD_ID, household_id: SAMPLE_HOUSEHOLD_ID },
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lumi/threads/${SAMPLE_THREAD_ID}/turns?from_seq=abc`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });

  it('from_seq with cross-household thread → 403 (ownership check still applies)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({
        threadOwnershipRow: { id: SAMPLE_THREAD_ID, household_id: OTHER_HOUSEHOLD_ID },
      }),
    });
    const token = signToken(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lumi/threads/${SAMPLE_THREAD_ID}/turns?from_seq=1`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /v1/lumi/turns', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('201 with { thread_id, user_turn, lumi_turn } — lazy-creates the ambient thread', async () => {
    const threadInserts: Record<string, unknown>[] = [];
    app = await buildTestApp({
      supabase: buildMockSupabase({
        activeAmbientThread: null,
        capturedAmbientThreadInsert: (row) => threadInserts.push(row),
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/turns',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'What did Maya have yesterday?', context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      thread_id: string;
      user_turn: TurnFixture;
      lumi_turn: TurnFixture;
    };
    expect(body.thread_id).toBe(NEW_THREAD_ID);
    expect(body.user_turn.role).toBe('user');
    expect(body.user_turn.body).toEqual({ type: 'message', content: 'What did Maya have yesterday?' });
    expect(body.lumi_turn.role).toBe('lumi');
    // API-assigned monotonic seq: user first, lumi second.
    expect(body.user_turn.server_seq).toBe(1);
    expect(body.lumi_turn.server_seq).toBe(2);
    // Lazy-created exactly one thread of type=surface, modality=text.
    expect(threadInserts).toHaveLength(1);
    expect(threadInserts[0]).toMatchObject({ household_id: SAMPLE_HOUSEHOLD_ID, type: 'planning', modality: 'text' });
  });

  it('the Lumi turn body content is the agent reply from OpenAI (12-S9 real dispatch)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ activeAmbientThread: null }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/turns',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'anything at all', context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { lumi_turn: TurnFixture };
    expect(body.lumi_turn.body).toEqual({ type: 'message', content: MOCKED_LUMI_REPLY });
  });

  it('reuses an existing ambient thread — no new thread inserted', async () => {
    const threadInserts: Record<string, unknown>[] = [];
    app = await buildTestApp({
      supabase: buildMockSupabase({
        activeAmbientThread: {
          id: SAMPLE_THREAD_ID,
          household_id: SAMPLE_HOUSEHOLD_ID,
          type: 'planning',
          status: 'active',
          modality: 'voice',
          created_at: '2026-04-30T00:00:00.000Z',
        },
        // 12-S9: reusing a thread now triggers getThreadTurns (history fetch),
        // which runs an ownership check against the threads table.
        threadOwnershipRow: { id: SAMPLE_THREAD_ID, household_id: SAMPLE_HOUSEHOLD_ID },
        capturedAmbientThreadInsert: (row) => threadInserts.push(row),
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/turns',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'hello again', context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { thread_id: string };
    expect(body.thread_id).toBe(SAMPLE_THREAD_ID);
    expect(threadInserts).toHaveLength(0);
  });

  it('onboarding surface → 400 (must use the dedicated onboarding route)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ activeAmbientThread: null }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/turns',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'hi', context_signal: VALID_CONTEXT_SIGNAL_ONBOARDING },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });

  it('whitespace-only message → 400 (rejected by the contract trim+min)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ activeAmbientThread: null }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/turns',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: '   ', context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });

  it('empty message → 400', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ activeAmbientThread: null }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/turns',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: '', context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(400);
  });

  it('unauthenticated POST → 401', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ activeAmbientThread: null }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/turns',
      payload: { message: 'hi', context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(401);
  });

  // 5-S16 AC6/AC11 — text turns must never be affected by the voice cap.
  it('201 even when weekly voice usage is at the cap (AC6 — text turns unaffected)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({
        activeAmbientThread: null,
        voiceUsageMsConsumed: 600_000, // exactly at the cap
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/turns',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'What should I pack?', context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(201);
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

  // Story 5-S5b — no ElevenLabs credential pre-mint any more. The response is
  // just { talk_session_id }; the browser opens HiveKitchen's own
  // /v1/lumi/voice/ws with its JWT + this id.
  it('happy path — Premium parent: creates session (no token mint), sets Redis sentinel', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    const insertedSessionCapture: Record<string, unknown>[] = [];

    app = await buildTestApp({
      supabase: buildMockSupabase({
        householdTier: 'premium',
        activeAmbientThread: null,
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
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toEqual({ talk_session_id: SAMPLE_TALK_SESSION_ID });
    // No ElevenLabs credential call happens at session creation any more.
    expect(fetchSpy).not.toHaveBeenCalled();
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

  // 5-S16 — standard-tier weekly voice cap pre-check.
  it('429 when the user is at or over the weekly voice cap', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({
        householdTier: 'premium',
        activeAmbientThread: null,
        voiceUsageMsConsumed: 600_000, // exactly at the cap
      }),
    });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lumi/voice/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context_signal: VALID_CONTEXT_SIGNAL_PLANNING },
    });

    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body) as { code: string; message: string };
    expect(body.code).toBe('voice_cap_reached');
    expect(body.message).toBe("You've used this week's voice time. Text still works.");
  });

  it('201 when weekly usage is under the cap', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({
        householdTier: 'premium',
        activeAmbientThread: null,
        voiceUsageMsConsumed: 300_000, // under the cap
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
