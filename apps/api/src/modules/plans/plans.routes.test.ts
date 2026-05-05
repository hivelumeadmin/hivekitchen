import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import {
  isDomainError,
  NotFoundError,
  SwapGuardrailBlockedError,
} from '../../common/errors.js';
import { plansRoutes } from './plans.routes.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_PLAN_ID = '33333333-3333-4333-8333-333333333333';
const SAMPLE_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const SAMPLE_CHILD_ID = '66666666-6666-4666-8666-666666666666';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';
const JWT_SECRET = 'a'.repeat(32);

const MOCK_ITEM = {
  id: SAMPLE_ITEM_ID,
  plan_id: SAMPLE_PLAN_ID,
  child_id: SAMPLE_CHILD_ID,
  day: 'monday' as const,
  slot: 'main',
  recipe_id: null,
  item_id: null,
  ingredients: ['hummus', 'crackers'],
  paused_at: null,
  created_at: '2026-05-04T00:00:00.000Z',
  updated_at: '2026-05-04T00:00:00.000Z',
};

function buildMockService(overrides: {
  swapItem?: ReturnType<typeof vi.fn>;
  pauseDay?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    swapItem: overrides.swapItem ?? vi.fn().mockResolvedValue(MOCK_ITEM),
    pauseDay: overrides.pauseDay ?? vi.fn().mockResolvedValue(undefined),
  };
}

async function buildTestApp(
  service = buildMockService(),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('env', { NODE_ENV: 'development', JWT_SECRET } as unknown as FastifyInstance['env']);
  app.decorate('plansService', service as unknown as FastifyInstance['plansService']);

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

  await app.register(plansRoutes);
  await app.ready();
  return app;
}

function signPrimary(app: FastifyInstance, householdId = SAMPLE_HOUSEHOLD_ID): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: householdId, role: 'primary_parent' });
}

function signSecondary(app: FastifyInstance): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'secondary_caregiver' });
}

// ---------------------------------------------------------------------------

describe('PATCH /v1/plans/:planId/items/:itemId', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/items/${SAMPLE_ITEM_ID}`,
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { ingredients: ['hummus'] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when role is ops (not a household member)', async () => {
    app = await buildTestApp();
    const token = app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'ops' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/items/${SAMPLE_ITEM_ID}`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { ingredients: ['hummus'] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when Idempotency-Key header is absent', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/items/${SAMPLE_ITEM_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ingredients: ['hummus'] },
    });
    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/validation');
  });

  it('returns 400 when Idempotency-Key is not a valid UUID', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/items/${SAMPLE_ITEM_ID}`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'not-a-uuid' },
      payload: { ingredients: ['hummus'] },
    });
    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/validation');
  });

  it('returns 400 when planId is not a valid UUID', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/not-a-uuid/items/${SAMPLE_ITEM_ID}`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { ingredients: ['hummus'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when ingredients array is empty', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/items/${SAMPLE_ITEM_ID}`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { ingredients: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when service throws NotFoundError', async () => {
    const service = buildMockService({
      swapItem: vi.fn().mockRejectedValue(new NotFoundError(`plan_item ${SAMPLE_ITEM_ID}`)),
    });
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/items/${SAMPLE_ITEM_ID}`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { ingredients: ['hummus'] },
    });
    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/not-found');
  });

  it('returns 422 when service throws SwapGuardrailBlockedError', async () => {
    const service = buildMockService({
      swapItem: vi.fn().mockRejectedValue(
        new SwapGuardrailBlockedError(SAMPLE_ITEM_ID, ['peanuts']),
      ),
    });
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/items/${SAMPLE_ITEM_ID}`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { ingredients: ['peanut butter', 'crackers'] },
    });
    expect(res.statusCode).toBe(422);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/swap-guardrail-blocked');
  });

  it('returns 200 with { item } on success (primary_parent)', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/items/${SAMPLE_ITEM_ID}`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { ingredients: ['hummus', 'crackers'] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { item: { id: string } };
    expect(body.item.id).toBe(SAMPLE_ITEM_ID);
  });

  it('returns 200 when called by secondary_caregiver', async () => {
    app = await buildTestApp();
    const token = signSecondary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/items/${SAMPLE_ITEM_ID}`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { ingredients: ['hummus'] },
    });
    expect(res.statusCode).toBe(200);
  });

  it('passes planId, itemId, householdId, input, and requestId to service.swapItem', async () => {
    const service = buildMockService();
    app = await buildTestApp(service);
    const token = signPrimary(app);
    await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/items/${SAMPLE_ITEM_ID}`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { ingredients: ['hummus'] },
    });
    expect(service.swapItem).toHaveBeenCalledWith({
      planId: SAMPLE_PLAN_ID,
      itemId: SAMPLE_ITEM_ID,
      householdId: SAMPLE_HOUSEHOLD_ID,
      input: { ingredients: ['hummus'] },
      requestId: IDEMPOTENCY_KEY,
    });
  });
});

// ---------------------------------------------------------------------------

describe('PATCH /v1/plans/:planId/days/:day/pause', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/days/monday/pause`,
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when role is ops (not a household member)', async () => {
    app = await buildTestApp();
    const token = app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'ops' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/days/monday/pause`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when Idempotency-Key header is absent', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/days/monday/pause`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/validation');
  });

  it('returns 400 when Idempotency-Key is not a valid UUID', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/days/monday/pause`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'bad-key' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/validation');
  });

  it('returns 400 when day is not a valid school day (sunday rejected)', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/days/sunday/pause`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when service throws NotFoundError', async () => {
    const service = buildMockService({
      pauseDay: vi.fn().mockRejectedValue(new NotFoundError(`plan ${SAMPLE_PLAN_ID}`)),
    });
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/days/monday/pause`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/not-found');
  });

  it('returns 204 on success with reason: sick', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/days/monday/pause`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { reason: 'sick' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns 204 when body is empty (reason is optional)', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/days/monday/pause`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns 204 when called by secondary_caregiver', async () => {
    app = await buildTestApp();
    const token = signSecondary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/days/wednesday/pause`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(204);
  });

  it('passes planId, day, householdId, and requestId to service.pauseDay', async () => {
    const service = buildMockService();
    app = await buildTestApp(service);
    const token = signPrimary(app);
    await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/days/wednesday/pause`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { reason: 'absent' },
    });
    expect(service.pauseDay).toHaveBeenCalledWith({
      planId: SAMPLE_PLAN_ID,
      day: 'wednesday',
      householdId: SAMPLE_HOUSEHOLD_ID,
      requestId: IDEMPOTENCY_KEY,
      // Story 3.12 Round 2: route forwards body.reason to the service so audit
      // metadata records it. Omitting the body falls back to reason: undefined.
      reason: 'absent',
    });
  });
});
