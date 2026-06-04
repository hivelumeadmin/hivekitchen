import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { memoryRoutes } from './memory.routes.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_NODE_ID = '33333333-3333-4333-8333-333333333333';
const JWT_SECRET = 'a'.repeat(32);

async function buildTestApp(
  getProvenance: (nodeId: string, householdId: string) => Promise<unknown[] | null>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('env', { NODE_ENV: 'development' } as unknown as FastifyInstance['env']);

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
      void reply.status(400).send({ type: '/errors/validation', status: 400 });
      return;
    }
    const obj = err as { validation?: unknown; cause?: unknown };
    if (obj.cause instanceof ZodError) {
      void reply.status(400).send({ type: '/errors/validation', status: 400 });
      return;
    }
    if (Array.isArray(obj.validation) && obj.validation.length > 0) {
      void reply.status(400).send({ type: '/errors/validation', status: 400 });
      return;
    }
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  app.decorate('memoryService', {
    getProvenance: getProvenance as FastifyInstance['memoryService']['getProvenance'],
  } as unknown as FastifyInstance['memoryService']);

  await app.register(memoryRoutes);
  await app.ready();
  return app;
}

function signPrimary(app: FastifyInstance): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'primary_parent' });
}

function sampleProvenance() {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    memory_node_id: SAMPLE_NODE_ID,
    source_type: 'turn',
    source_ref: {},
    captured_at: '2026-04-30T00:00:00.000Z',
    captured_by: SAMPLE_USER_ID,
    confidence: 0.87,
    superseded_by: null,
  };
}

describe('GET /v1/memory/:nodeId/provenance', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 200 with an empty provenance array when the node exists but has no records', async () => {
    app = await buildTestApp(async () => []);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/memory/${SAMPLE_NODE_ID}/provenance`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ provenance: [] });
  });

  it('returns 200 with provenance records and passes householdId from the JWT', async () => {
    const prov = sampleProvenance();
    const getProvenance = vi.fn(async () => [prov]);
    app = await buildTestApp(getProvenance);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/memory/${SAMPLE_NODE_ID}/provenance`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ provenance: [prov] });
    expect(getProvenance).toHaveBeenCalledWith(SAMPLE_NODE_ID, SAMPLE_HOUSEHOLD_ID);
  });

  it('returns 404 when the node is not found or belongs to another household', async () => {
    app = await buildTestApp(async () => null);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/memory/${SAMPLE_NODE_ID}/provenance`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when no token is provided', async () => {
    app = await buildTestApp(async () => []);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/memory/${SAMPLE_NODE_ID}/provenance`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when nodeId is not a valid UUID', async () => {
    app = await buildTestApp(async () => []);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/memory/not-a-uuid/provenance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});
