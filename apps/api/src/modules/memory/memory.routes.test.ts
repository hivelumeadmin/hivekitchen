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
  editProse?: (
    nodeId: string,
    householdId: string,
    userId: string,
    proseText: string,
    reason: 'parent_edit',
  ) => Promise<unknown | null>,
  softForget?: (
    nodeId: string,
    householdId: string,
    userId: string,
    reason: string | null,
  ) => Promise<unknown | null>,
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
    editProse: (editProse ??
      (async () => null)) as FastifyInstance['memoryService']['editProse'],
    softForget: (softForget ??
      (async () => null)) as FastifyInstance['memoryService']['softForget'],
  } as unknown as FastifyInstance['memoryService']);

  // Story 13-s2.5 — the edit/forget routes now emit SSE invalidations.
  app.decorate('sseDispatcher', {
    emit: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
  } as unknown as FastifyInstance['sseDispatcher']);

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

function sampleNode(overrides: Record<string, unknown> = {}) {
  return {
    id: SAMPLE_NODE_ID,
    household_id: SAMPLE_HOUSEHOLD_ID,
    node_type: 'preference',
    facet: 'avoids spicy',
    subject_child_id: null,
    prose_text: 'Layla avoids spicy peppers.',
    soft_forget_at: null,
    forget_reason: null,
    hard_forgotten: false,
    created_at: '2026-04-30T00:00:00.000Z',
    updated_at: '2026-04-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('PATCH /v1/memory/:nodeId', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 200 with the updated node and passes args through from the JWT + body', async () => {
    const updated = sampleNode({ prose_text: 'corrected text' });
    const editProse = vi.fn(async () => updated);
    app = await buildTestApp(async () => [], editProse);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/memory/${SAMPLE_NODE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { prose_text: 'corrected text', reason: 'parent_edit' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ node: updated });
    expect(editProse).toHaveBeenCalledWith(
      SAMPLE_NODE_ID,
      SAMPLE_HOUSEHOLD_ID,
      SAMPLE_USER_ID,
      'corrected text',
      'parent_edit',
    );
  });

  it('returns 404 when editProse returns null (missing or cross-household)', async () => {
    app = await buildTestApp(async () => [], async () => null);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/memory/${SAMPLE_NODE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { prose_text: 'x', reason: 'parent_edit' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when no token is provided', async () => {
    app = await buildTestApp(async () => [], async () => sampleNode());

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/memory/${SAMPLE_NODE_ID}`,
      payload: { prose_text: 'x', reason: 'parent_edit' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when nodeId is not a valid UUID', async () => {
    app = await buildTestApp(async () => [], async () => sampleNode());
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/memory/not-a-uuid',
      headers: { authorization: `Bearer ${token}` },
      payload: { prose_text: 'x', reason: 'parent_edit' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when prose_text is empty', async () => {
    app = await buildTestApp(async () => [], async () => sampleNode());
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/memory/${SAMPLE_NODE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { prose_text: '', reason: 'parent_edit' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when reason is not parent_edit', async () => {
    app = await buildTestApp(async () => [], async () => sampleNode());
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/memory/${SAMPLE_NODE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { prose_text: 'x', reason: 'other' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when prose_text exceeds 2000 characters', async () => {
    app = await buildTestApp(async () => [], async () => sampleNode());
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/memory/${SAMPLE_NODE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { prose_text: 'x'.repeat(2001), reason: 'parent_edit' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /v1/memory/:nodeId/forget', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 200 with the forgotten node and passes (nodeId, householdId, userId, null) for an empty body', async () => {
    const forgotten = sampleNode({ soft_forget_at: '2026-06-05T00:00:00.000Z', forget_reason: null });
    const softForget = vi.fn(async () => forgotten);
    app = await buildTestApp(async () => [], undefined, softForget);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/memory/${SAMPLE_NODE_ID}/forget`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ node: forgotten });
    expect(softForget).toHaveBeenCalledWith(SAMPLE_NODE_ID, SAMPLE_HOUSEHOLD_ID, SAMPLE_USER_ID, null);
  });

  it('passes the reason through when the body carries one', async () => {
    const forgotten = sampleNode({
      soft_forget_at: '2026-06-05T00:00:00.000Z',
      forget_reason: 'some reason',
    });
    const softForget = vi.fn(async () => forgotten);
    app = await buildTestApp(async () => [], undefined, softForget);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/memory/${SAMPLE_NODE_ID}/forget`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'some reason' },
    });

    expect(res.statusCode).toBe(200);
    expect(softForget).toHaveBeenCalledWith(
      SAMPLE_NODE_ID,
      SAMPLE_HOUSEHOLD_ID,
      SAMPLE_USER_ID,
      'some reason',
    );
  });

  it('returns 404 when softForget returns null (missing, cross-household, or already forgotten)', async () => {
    app = await buildTestApp(async () => [], undefined, async () => null);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/memory/${SAMPLE_NODE_ID}/forget`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when no token is provided', async () => {
    app = await buildTestApp(async () => [], undefined, async () => sampleNode());

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/memory/${SAMPLE_NODE_ID}/forget`,
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when nodeId is not a valid UUID', async () => {
    app = await buildTestApp(async () => [], undefined, async () => sampleNode());
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/memory/not-a-uuid/forget',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when reason exceeds 500 characters', async () => {
    app = await buildTestApp(async () => [], undefined, async () => sampleNode());
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/memory/${SAMPLE_NODE_ID}/forget`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'x'.repeat(501) },
    });

    expect(res.statusCode).toBe(400);
  });
});
