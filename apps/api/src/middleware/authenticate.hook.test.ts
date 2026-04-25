import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { authenticateHook } from './authenticate.hook.js';
import { isDomainError } from '../common/errors.js';

const SAMPLE_USER_ID = '11111111-1111-1111-1111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-2222-2222-222222222222';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  const env = { NODE_ENV: 'development' as const, JWT_SECRET: 'a'.repeat(32) };
  app.decorate('env', env as unknown as FastifyInstance['env']);

  await app.register(cookie);
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: '15m' } });
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
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  app.get('/v1/protected', async (request) => {
    return { user: request.user };
  });

  app.get('/v1/auth/login', async () => {
    return { ok: true };
  });

  app.get('/v1/internal/health', async () => {
    return { ok: true };
  });

  await app.ready();
  return app;
}

describe('authenticateHook', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('valid JWT → 200 + request.user populated correctly', async () => {
    app = await buildTestApp();
    const token = app.jwt.sign({
      sub: SAMPLE_USER_ID,
      hh: SAMPLE_HOUSEHOLD_ID,
      role: 'primary_parent',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      user: { id: string; household_id: string; role: string };
    };
    expect(body.user).toEqual({
      id: SAMPLE_USER_ID,
      household_id: SAMPLE_HOUSEHOLD_ID,
      role: 'primary_parent',
    });
  });

  it('missing Authorization header → 401', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/v1/protected' });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/unauthorized');
  });

  it('malformed token → 401', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/unauthorized');
  });

  it('skip-list route (auth path) → 200 without auth header', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/v1/auth/login' });
    expect(res.statusCode).toBe(200);
  });

  it('skip-list route (internal path) → 200 without auth header', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/v1/internal/health' });
    expect(res.statusCode).toBe(200);
  });
});
