import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { onboardingRoutes } from './onboarding.routes.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const ACTIVE_THREAD_ID = '33333333-3333-4333-8333-333333333333';
const CLOSED_THREAD_ID = '44444444-4444-4444-8444-444444444444';
const TURN_ID = '55555555-5555-4555-8555-555555555555';
const JWT_SECRET = 'a'.repeat(32);

const ACTIVE_THREAD_ROW = {
  id: ACTIVE_THREAD_ID,
  household_id: SAMPLE_HOUSEHOLD_ID,
  type: 'onboarding',
  status: 'active',
  created_at: new Date().toISOString(),
};

const CLOSED_THREAD_WITH_SUMMARY_ROW = {
  id: CLOSED_THREAD_ID,
  household_id: SAMPLE_HOUSEHOLD_ID,
  type: 'onboarding',
  status: 'closed',
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

interface SupabaseMockOpts {
  // findActiveThreadByHousehold result
  activeThread?: typeof ACTIVE_THREAD_ROW | null;
  // findClosedThreadByHousehold result
  closedThread?: typeof CLOSED_THREAD_WITH_SUMMARY_ROW | null;
  // listTurns result for the active thread
  activeTurns?: Array<{
    id: string;
    thread_id: string;
    server_seq: number;
    role: 'user' | 'lumi' | 'system';
    body: { type: string; content?: string; event?: string; payload?: unknown };
    modality: 'text' | 'voice';
    created_at: string;
  }>;
  // listTurns result for the closed thread (used for AC9 gate)
  closedTurns?: Array<{
    id: string;
    thread_id: string;
    server_seq: number;
    role: 'user' | 'lumi' | 'system';
    body: { type: string; content?: string; event?: string; payload?: unknown };
    modality: 'text' | 'voice';
    created_at: string;
  }>;
  // last server_seq currently in the active thread; getNextSeq returns this+1
  maxSeq?: number | null;
  // optional spies (so tests can assert side effects). Typed as plain
  // function signatures because `ReturnType<typeof vi.fn>` resolves to
  // `Mock<Procedure | Constructable>` under newer vitest typings, and the
  // union is not directly callable in strict TS.
  appendTurnSpy?: (row: unknown) => void;
  closeThreadSpy?: (updates: unknown) => void;
  createThreadSpy?: (row: unknown) => void;
}

function buildMockSupabase(opts: SupabaseMockOpts = {}) {
  const activeThread = opts.activeThread === undefined ? null : opts.activeThread;
  const closedThread = opts.closedThread === undefined ? null : opts.closedThread;
  const activeTurns = opts.activeTurns ?? [];
  const closedTurns = opts.closedTurns ?? [];
  // Track the running max seq so back-to-back getNextSeq calls advance.
  let runningMaxSeq: number | null = opts.maxSeq ?? null;

  // Threads-table query state — `from('threads')` chains diverge based on
  // which method is being called. We disambiguate via the chained .eq() args.
  return {
    from(table: string) {
      if (table === 'threads') {
        return {
          insert: (row: { household_id: string; type: string }) => ({
            select: () => ({
              single: vi.fn().mockImplementation(async () => {
                opts.createThreadSpy?.(row);
                return {
                  data: {
                    id: ACTIVE_THREAD_ID,
                    household_id: row.household_id,
                    type: row.type,
                    status: 'active',
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                };
              }),
            }),
          }),
          update: (updates: { status?: string }) => ({
            // closeThread chains .update().eq('id', X).eq('status', 'active')
            // — two .eq() calls before the awaited result.
            eq: () => ({
              eq: () => {
                opts.closeThreadSpy?.(updates);
                return Promise.resolve({ error: null });
              },
            }),
          }),
          select: () => {
            // The chain is: select().eq(hh).eq(type).eq(status).order().limit().maybeSingle()
            // OR select().eq(id).maybeSingle()
            // We track which status was filtered (active vs closed) by the third .eq() call.
            let statusFilter: string | null = null;
            const chain = {
              eq: (column: string, value: string) => {
                if (column === 'status') statusFilter = value;
                return chain;
              },
              order: () => chain,
              limit: () => chain,
              maybeSingle: vi.fn().mockImplementation(async () => {
                if (statusFilter === 'active') {
                  return { data: activeThread, error: null };
                }
                if (statusFilter === 'closed') {
                  return { data: closedThread, error: null };
                }
                // findThreadById path — return whichever matches; not exercised here
                return { data: activeThread ?? closedThread, error: null };
              }),
            };
            return chain;
          },
        };
      }
      if (table === 'thread_turns') {
        return {
          insert: (row: {
            thread_id: string;
            server_seq: number;
            role: string;
            body: object;
            modality: string;
          }) => ({
            select: () => ({
              single: vi.fn().mockImplementation(async () => {
                opts.appendTurnSpy?.(row);
                // Advance the running max so the next getNextSeq sees this row.
                runningMaxSeq = row.server_seq;
                return {
                  data: {
                    id: TURN_ID,
                    thread_id: row.thread_id,
                    server_seq: row.server_seq,
                    role: row.role,
                    body: row.body,
                    modality: row.modality,
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                };
              }),
            }),
          }),
          select: (cols: string) => {
            // listTurns: select(TURN_COLUMNS).eq('thread_id', X).order('server_seq', { asc:true })
            // getNextSeq: select('server_seq').eq('thread_id', X).order('server_seq', { asc:false }).limit(1).maybeSingle()
            const isListTurns = cols !== 'server_seq';
            let threadFilter: string | null = null;
            const chain = {
              eq: (_column: string, value: string) => {
                threadFilter = value;
                return chain;
              },
              order: () => chain,
              limit: () => chain,
              maybeSingle: vi.fn().mockImplementation(async () => {
                // getNextSeq path
                if (runningMaxSeq === null) return { data: null, error: null };
                return { data: { server_seq: runningMaxSeq }, error: null };
              }),
              // Native Supabase query: when chain ends without maybeSingle/single,
              // it resolves directly with data array (listTurns).
              then(resolve: (val: { data: unknown; error: null }) => unknown) {
                if (!isListTurns) return resolve({ data: null, error: null });
                const turns = threadFilter === ACTIVE_THREAD_ID ? activeTurns : closedTurns;
                return resolve({ data: turns, error: null });
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

interface OpenAIMockOpts {
  respondText?: string;
  respondError?: unknown;
  isCompleteVerdict?: 'yes' | 'no';
  isCompleteError?: unknown;
  extractSummaryResult?: {
    cultural_templates?: string[];
    palate_notes?: string[];
    allergens_mentioned?: string[];
  };
  extractSummaryError?: unknown;
}

function buildMockOpenAI(opts: OpenAIMockOpts = {}) {
  const create = vi.fn().mockImplementation(async (req: { messages: Array<{ content: string }> }) => {
    // Heuristic: classify which agent method called us based on the system prompt.
    const sys = req.messages[0]?.content ?? '';
    if (sys.includes('Reply with exactly one word')) {
      if (opts.isCompleteError) throw opts.isCompleteError;
      return { choices: [{ message: { content: opts.isCompleteVerdict ?? 'no' } }] };
    }
    if (sys.includes('Extract structured onboarding data')) {
      if (opts.extractSummaryError) throw opts.extractSummaryError;
      return {
        choices: [
          {
            message: {
              content: JSON.stringify(
                opts.extractSummaryResult ?? {
                  cultural_templates: [],
                  palate_notes: [],
                  allergens_mentioned: [],
                },
              ),
            },
          },
        ],
      };
    }
    // respond() path
    if (opts.respondError) throw opts.respondError;
    return {
      choices: [
        { message: { content: opts.respondText ?? 'What did your grandmother cook?' } },
      ],
    };
  });
  return { chat: { completions: { create } } };
}

async function buildTestApp(opts: {
  supabase: ReturnType<typeof buildMockSupabase>;
  openai: ReturnType<typeof buildMockOpenAI>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = {
    NODE_ENV: 'development' as const,
    JWT_SECRET,
  };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', opts.supabase as unknown as FastifyInstance['supabase']);
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
    const obj = err as { validation?: unknown; cause?: unknown };
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

  await app.register(onboardingRoutes);
  await app.ready();
  return app;
}

function signAccessToken(app: FastifyInstance): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'primary_parent' });
}

describe('POST /v1/onboarding/text/turn', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('first turn → 200, creates thread, persists user and lumi turns, is_complete=false', async () => {
    const appendSpy = vi.fn();
    const createThreadSpy = vi.fn();
    app = await buildTestApp({
      supabase: buildMockSupabase({
        activeThread: null,
        closedThread: null,
        activeTurns: [],
        maxSeq: null,
        appendTurnSpy: appendSpy,
        createThreadSpy,
      }),
      openai: buildMockOpenAI({ respondText: 'What did your grandmother cook?' }),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/turn',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'I want to talk about my family.' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      thread_id: string;
      lumi_response: string;
      is_complete: boolean;
    };
    expect(body.thread_id).toBe(ACTIVE_THREAD_ID);
    expect(body.lumi_response).toContain('grandmother');
    expect(body.is_complete).toBe(false);
    expect(createThreadSpy).toHaveBeenCalledWith({
      household_id: SAMPLE_HOUSEHOLD_ID,
      type: 'onboarding',
    });
    // Two appendTurn calls — user (modality text), lumi (modality text)
    expect(appendSpy).toHaveBeenCalledTimes(2);
    expect(appendSpy.mock.calls[0]?.[0]).toMatchObject({ role: 'user', modality: 'text' });
    expect(appendSpy.mock.calls[1]?.[0]).toMatchObject({ role: 'lumi', modality: 'text' });
  });

  it('subsequent turn → reuses existing active thread, server_seq increments', async () => {
    const appendSpy = vi.fn();
    const createThreadSpy = vi.fn();
    app = await buildTestApp({
      supabase: buildMockSupabase({
        activeThread: ACTIVE_THREAD_ROW,
        closedThread: null,
        activeTurns: [
          {
            id: 'a',
            thread_id: ACTIVE_THREAD_ID,
            server_seq: 1,
            role: 'user',
            body: { type: 'message', content: 'hello' },
            modality: 'text',
            created_at: new Date().toISOString(),
          },
          {
            id: 'b',
            thread_id: ACTIVE_THREAD_ID,
            server_seq: 2,
            role: 'lumi',
            body: { type: 'message', content: 'What did your grandmother cook?' },
            modality: 'text',
            created_at: new Date().toISOString(),
          },
        ],
        maxSeq: 2,
        appendTurnSpy: appendSpy,
        createThreadSpy,
      }),
      openai: buildMockOpenAI({ respondText: "What's a Friday in your house?" }),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/turn',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'My grandmother made dal every Sunday.' },
    });

    expect(res.statusCode).toBe(200);
    expect(createThreadSpy).not.toHaveBeenCalled();
    expect(appendSpy.mock.calls[0]?.[0]).toMatchObject({ server_seq: 3, role: 'user' });
    expect(appendSpy.mock.calls[1]?.[0]).toMatchObject({ server_seq: 4, role: 'lumi' });
  });

  it('whitespace-only message → 400 validation error', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase(),
      openai: buildMockOpenAI(),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/turn',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: '   ' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('message > 4000 chars → 400 validation error', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase(),
      openai: buildMockOpenAI(),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/turn',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'a'.repeat(4001) },
    });

    expect(res.statusCode).toBe(400);
  });

  it('unauthenticated → 401', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase(),
      openai: buildMockOpenAI(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/turn',
      payload: { message: 'hello' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('OpenAI failure → 502, user turn persisted, no lumi turn persisted', async () => {
    const appendSpy = vi.fn();
    app = await buildTestApp({
      supabase: buildMockSupabase({
        activeThread: null,
        closedThread: null,
        maxSeq: null,
        appendTurnSpy: appendSpy,
      }),
      openai: buildMockOpenAI({ respondError: new Error('OpenAI 500') }),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/turn',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'hi' },
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/upstream');
    // User turn persisted, but no lumi turn
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy.mock.calls[0]?.[0]).toMatchObject({ role: 'user' });
  });

  it('household has closed onboarding with summary → 409 (already complete)', async () => {
    const appendSpy = vi.fn();
    app = await buildTestApp({
      supabase: buildMockSupabase({
        activeThread: null,
        closedThread: CLOSED_THREAD_WITH_SUMMARY_ROW,
        closedTurns: [
          {
            id: 'sys',
            thread_id: CLOSED_THREAD_ID,
            server_seq: 9,
            role: 'system',
            body: { type: 'system_event', event: 'onboarding.summary', payload: {} },
            modality: 'text',
            created_at: new Date().toISOString(),
          },
        ],
        appendTurnSpy: appendSpy,
      }),
      openai: buildMockOpenAI(),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/turn',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'hello' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { type: string; detail: string };
    expect(body.type).toBe('/errors/conflict');
    expect(body.detail).toContain('already complete');
    expect(appendSpy).not.toHaveBeenCalled();
  });
});

describe('POST /v1/onboarding/text/finalize', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  function makeReadyTurns(count = 6) {
    return Array.from({ length: count }).map((_, i) => ({
      id: `t${i}`,
      thread_id: ACTIVE_THREAD_ID,
      server_seq: i + 1,
      role: (i % 2 === 0 ? 'user' : 'lumi') as 'user' | 'lumi',
      body: { type: 'message', content: `turn-${i}` } as { type: 'message'; content: string },
      modality: 'text' as const,
      created_at: new Date().toISOString(),
    }));
  }

  it('happy path → 200, summary returned, system_event appended, thread closed', async () => {
    const appendSpy = vi.fn();
    const closeSpy = vi.fn();
    app = await buildTestApp({
      supabase: buildMockSupabase({
        activeThread: ACTIVE_THREAD_ROW,
        closedThread: null,
        activeTurns: makeReadyTurns(),
        maxSeq: 6,
        appendTurnSpy: appendSpy,
        closeThreadSpy: closeSpy,
      }),
      openai: buildMockOpenAI({
        isCompleteVerdict: 'yes',
        extractSummaryResult: {
          cultural_templates: ['South Asian'],
          palate_notes: ['comfort food on Fridays'],
          allergens_mentioned: ['nuts'],
        },
      }),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/finalize',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      thread_id: string;
      summary: { cultural_templates: string[]; allergens_mentioned: string[] };
    };
    expect(body.thread_id).toBe(ACTIVE_THREAD_ID);
    expect(body.summary.cultural_templates).toEqual(['South Asian']);
    expect(body.summary.allergens_mentioned).toEqual(['nuts']);
    // The system_event turn should have been appended
    expect(appendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'system',
        modality: 'text',
        body: expect.objectContaining({ type: 'system_event', event: 'onboarding.summary' }),
      }),
    );
    expect(closeSpy).toHaveBeenCalled();
  });

  it('no active thread → 409', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ activeThread: null, closedThread: null }),
      openai: buildMockOpenAI(),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/finalize',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
  });

  it('active thread with too few turns → 409 (not yet ready)', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({
        activeThread: ACTIVE_THREAD_ROW,
        activeTurns: makeReadyTurns(2),
        maxSeq: 2,
      }),
      openai: buildMockOpenAI({ isCompleteVerdict: 'no' }),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/finalize',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
  });

  it('active thread, summary not confirmed → 409', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({
        activeThread: ACTIVE_THREAD_ROW,
        activeTurns: makeReadyTurns(8),
        maxSeq: 8,
      }),
      openai: buildMockOpenAI({ isCompleteVerdict: 'no' }),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/finalize',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
  });

  it('extractSummary fails → 200 with empty summary, thread still closed', async () => {
    const appendSpy = vi.fn();
    const closeSpy = vi.fn();
    app = await buildTestApp({
      supabase: buildMockSupabase({
        activeThread: ACTIVE_THREAD_ROW,
        activeTurns: makeReadyTurns(),
        maxSeq: 6,
        appendTurnSpy: appendSpy,
        closeThreadSpy: closeSpy,
      }),
      openai: buildMockOpenAI({
        isCompleteVerdict: 'yes',
        extractSummaryError: new Error('OpenAI 503'),
      }),
    });
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/finalize',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      summary: { cultural_templates: string[]; allergens_mentioned: string[] };
    };
    expect(body.summary).toEqual({
      cultural_templates: [],
      palate_notes: [],
      allergens_mentioned: [],
    });
    expect(appendSpy).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('unauthenticated → 401', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase(),
      openai: buildMockOpenAI(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/onboarding/text/finalize',
    });

    expect(res.statusCode).toBe(401);
  });
});
