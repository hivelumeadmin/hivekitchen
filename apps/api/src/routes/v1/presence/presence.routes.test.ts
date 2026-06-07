import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../../middleware/authenticate.hook.js';
import { householdScopeHook } from '../../../middleware/household-scope.hook.js';
import { isDomainError } from '../../../common/errors.js';
import { presenceRoutes } from './presence.routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const PARTNER_ID = '33333333-3333-4333-8333-333333333333';
const JWT_SECRET = 'a'.repeat(32);

// In-memory Redis fake covering the commands the presence routes use.
function buildRedis(seed: Record<string, string> = {}): {
  store: Map<string, string>;
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    store,
    set: vi.fn((key: string, value: string, ..._rest: unknown[]) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    keys: vi.fn((pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      return Promise.resolve([...store.keys()].filter((k) => k.startsWith(prefix)));
    }),
    del: vi.fn((key: string) => {
      const existed = store.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
  };
}

// Minimal supabase chainable for UserRepository.findUserById → maybeSingle().
function buildSupabase(displayName: string | null = 'Priya'): unknown {
  const result = {
    data: { id: USER_ID, display_name: displayName },
    error: null,
  };
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => Promise.resolve(result);
        }
        return () => proxy;
      },
    },
  );
  return { from: () => proxy };
}

async function buildTestApp(opts: {
  redis: ReturnType<typeof buildRedis>;
  supabase?: unknown;
  emit?: ReturnType<typeof vi.fn>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'test', JWT_SECRET };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('redis', opts.redis as unknown as FastifyInstance['redis']);
  app.decorate('supabase', (opts.supabase ?? buildSupabase()) as unknown as FastifyInstance['supabase']);
  app.decorate('sseDispatcher', {
    register: vi.fn(),
    unregister: vi.fn(),
    emit: opts.emit ?? vi.fn(),
  } as unknown as FastifyInstance['sseDispatcher']);

  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: '15m' } });
  await app.register(authenticateHook);
  await app.register(householdScopeHook);

  app.setErrorHandler((err, request, reply) => {
    if (isDomainError(err)) {
      void reply.status(err.status).type('application/problem+json').send({
        type: err.type,
        status: err.status,
        title: err.title,
        instance: request.id,
      });
      return;
    }
    const validation = (err as { validation?: unknown }).validation;
    if (err instanceof ZodError || (Array.isArray(validation) && validation.length > 0)) {
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

  await app.register(presenceRoutes);
  await app.ready();
  return app;
}

function signToken(app: FastifyInstance): string {
  return app.jwt.sign({ sub: USER_ID, hh: HOUSEHOLD_ID, role: 'primary_parent' });
}

function partnerValue(): string {
  return JSON.stringify({
    display_name: 'Priya',
    surface: 'brief',
    expires_at: '2026-06-06T12:00:00.000Z',
  });
}

describe('GET /v1/presence', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns an empty partners array when no household members are present', async () => {
    app = await buildTestApp({ redis: buildRedis() });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/presence',
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ partners: [] });
  });

  it('returns partners for the household excluding the requester', async () => {
    app = await buildTestApp({
      redis: buildRedis({
        [`presence:${HOUSEHOLD_ID}:${PARTNER_ID}`]: partnerValue(),
        [`presence:${HOUSEHOLD_ID}:${USER_ID}`]: partnerValue(),
      }),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/presence',
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { partners: Array<{ user_id: string }> };
    expect(body.partners).toHaveLength(1);
    expect(body.partners[0]?.user_id).toBe(PARTNER_ID);
  });

  it('401 when unauthenticated', async () => {
    app = await buildTestApp({ redis: buildRedis() });
    const res = await app.inject({ method: 'GET', url: '/v1/presence' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/presence/heartbeat', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 with partners array and writes the Redis key with a 60s TTL', async () => {
    const redis = buildRedis();
    app = await buildTestApp({ redis });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/presence/heartbeat',
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { surface: 'brief' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ partners: [] });
    expect(redis.set).toHaveBeenCalledWith(
      `presence:${HOUSEHOLD_ID}:${USER_ID}`,
      expect.any(String),
      'EX',
      60,
    );
  });

  it('400 when the body has an invalid surface', async () => {
    app = await buildTestApp({ redis: buildRedis() });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/presence/heartbeat',
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { surface: 'dashboard' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('401 when unauthenticated', async () => {
    app = await buildTestApp({ redis: buildRedis() });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/presence/heartbeat',
      payload: { surface: 'brief' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('emits a presence SSE event to the household', async () => {
    const emit = vi.fn();
    app = await buildTestApp({ redis: buildRedis(), emit });
    await app.inject({
      method: 'POST',
      url: '/v1/presence/heartbeat',
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { surface: 'brief' },
    });
    expect(emit).toHaveBeenCalledWith(HOUSEHOLD_ID, 'message', expect.any(String));
  });
});

describe('DELETE /v1/presence', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('204, deletes the Redis key, and emits an expired presence event', async () => {
    const emit = vi.fn();
    const redis = buildRedis({ [`presence:${HOUSEHOLD_ID}:${USER_ID}`]: partnerValue() });
    app = await buildTestApp({ redis, emit });
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/presence',
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(204);
    expect(redis.store.has(`presence:${HOUSEHOLD_ID}:${USER_ID}`)).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
    const [, , data] = emit.mock.calls[0]!;
    const event = JSON.parse(data as string) as { expires_at: string };
    expect(new Date(event.expires_at).getTime()).toBeLessThan(Date.now());
  });

  it('204 and is a no-op when no presence key exists', async () => {
    const emit = vi.fn();
    app = await buildTestApp({ redis: buildRedis(), emit });
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/presence',
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(204);
    expect(emit).not.toHaveBeenCalled();
  });
});
