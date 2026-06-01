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

const SAMPLE_WEEK_ID = '77777777-7777-4777-8777-777777777777';

const MOCK_PLAN_ROW = {
  id: SAMPLE_PLAN_ID,
  household_id: SAMPLE_HOUSEHOLD_ID,
  week_id: SAMPLE_WEEK_ID,
  week_of: '2026-04-21',
  revision: 1,
  generated_at: '2026-04-19T11:00:00.000Z',
  guardrail_cleared_at: '2026-04-19T11:00:01.000Z',
  guardrail_version: 'v1.0.0',
  prompt_version: 'v1.0.0',
  created_at: '2026-04-19T11:00:00.000Z',
  updated_at: '2026-04-19T11:00:01.000Z',
};

function buildMockService(overrides: {
  swapItem?: ReturnType<typeof vi.fn>;
  pauseDay?: ReturnType<typeof vi.fn>;
  getPlanForWeek?: ReturnType<typeof vi.fn>;
  getPlanHistory?: ReturnType<typeof vi.fn>;
  requestRegeneration?: ReturnType<typeof vi.fn>;
  getHardFailStatus?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    swapItem: overrides.swapItem ?? vi.fn().mockResolvedValue(MOCK_ITEM),
    pauseDay: overrides.pauseDay ?? vi.fn().mockResolvedValue(undefined),
    // Story 3.14 — default returns the not-yet-generated draft shape.
    getPlanForWeek:
      overrides.getPlanForWeek ??
      vi.fn().mockResolvedValue({
        plan: null,
        planItems: [],
        isDraft: false,
        weekOf: '2026-05-04',
      }),
    // Story 3.15 — default returns a populated history for a past plan.
    getPlanHistory:
      overrides.getPlanHistory ??
      vi.fn().mockResolvedValue({
        plan: MOCK_PLAN_ROW,
        planItems: [MOCK_ITEM],
        swapHistory: [],
        weekOf: '2026-04-21',
      }),
    requestRegeneration:
      overrides.requestRegeneration ??
      vi.fn().mockResolvedValue({ jobId: 'noop', rateLimitRemaining: 5 }),
    // Story 3.25 / 3.26 — default returns null (no hard fail). Tests that
    // exercise the reworking-state surface override this with the
    // { week_of, failed_at } payload.
    getHardFailStatus:
      overrides.getHardFailStatus ?? vi.fn().mockResolvedValue(null),
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
        new SwapGuardrailBlockedError(SAMPLE_ITEM_ID, ['peanut']),
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

// ---------------------------------------------------------------------------
// Story 3.14 — GET /v1/plans?week=current|next
// ---------------------------------------------------------------------------

describe('GET /v1/plans', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/v1/plans' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when role is ops (not a household member)', async () => {
    app = await buildTestApp();
    const token = app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'ops' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an unknown week selector with 400', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans?week=previous',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('defaults week to "current" when omitted and serializes the response', async () => {
    const service = buildMockService();
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      plan: unknown;
      plan_items: unknown[];
      is_draft: boolean;
      week_of: string | null;
    };
    expect(body.plan).toBeNull();
    expect(body.plan_items).toEqual([]);
    expect(body.is_draft).toBe(false);
    expect(body.week_of).toBe('2026-05-04');
    expect(service.getPlanForWeek).toHaveBeenCalledWith({
      householdId: SAMPLE_HOUSEHOLD_ID,
      week: 'current',
    });
  });

  it('passes week=next through to the service and returns is_draft true', async () => {
    const service = buildMockService({
      getPlanForWeek: vi.fn().mockResolvedValue({
        plan: null,
        planItems: [],
        isDraft: true,
        weekOf: '2026-05-11',
      }),
    });
    app = await buildTestApp(service);
    const token = signSecondary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans?week=next',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { is_draft: boolean; week_of: string };
    expect(body.is_draft).toBe(true);
    expect(body.week_of).toBe('2026-05-11');
    expect(service.getPlanForWeek).toHaveBeenCalledWith({
      householdId: SAMPLE_HOUSEHOLD_ID,
      week: 'next',
    });
  });

  it('serializes a populated plan + items response', async () => {
    const planRow = {
      id: SAMPLE_PLAN_ID,
      household_id: SAMPLE_HOUSEHOLD_ID,
      week_id: '00000000-0000-4000-8000-000000000099',
      week_of: '2026-05-04',
      revision: 1,
      generated_at: '2026-05-02T11:00:00.000Z',
      guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
      guardrail_version: 'v1.0.0',
      prompt_version: 'v1.0.0',
      created_at: '2026-05-02T11:00:00.000Z',
      updated_at: '2026-05-02T11:00:01.000Z',
    };
    const service = buildMockService({
      getPlanForWeek: vi.fn().mockResolvedValue({
        plan: planRow,
        planItems: [MOCK_ITEM],
        isDraft: false,
        weekOf: '2026-05-04',
      }),
    });
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans?week=current',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { plan: { id: string }; plan_items: unknown[] };
    expect(body.plan?.id).toBe(SAMPLE_PLAN_ID);
    expect(body.plan_items).toHaveLength(1);
  });

  // Story 3.25 / 3.26 — hard_fail surface
  it('omits hard_fail entirely when getHardFailStatus returns null', async () => {
    const service = buildMockService();
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect('hard_fail' in body).toBe(false);
    expect(service.getHardFailStatus).toHaveBeenCalledWith(
      SAMPLE_HOUSEHOLD_ID,
      '2026-05-04',
    );
  });

  it('returns hard_fail: { week_of, failed_at } when plan is null, not draft, and audit exists', async () => {
    const service = buildMockService({
      getHardFailStatus: vi
        .fn()
        .mockResolvedValue({ week_of: '2026-05-04', failed_at: '2026-05-25T08:00:00Z', flagged_items: [] }),
    });
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      hard_fail?: { week_of: string; failed_at: string };
    };
    expect(body.hard_fail).toEqual({
      week_of: '2026-05-04',
      failed_at: '2026-05-25T08:00:00Z',
    });
  });

  it('does not check getHardFailStatus on the draft (next week) path', async () => {
    const service = buildMockService({
      getPlanForWeek: vi.fn().mockResolvedValue({
        plan: null,
        planItems: [],
        isDraft: true,
        weekOf: '2026-05-11',
      }),
      getHardFailStatus: vi
        .fn()
        .mockResolvedValue({ week_of: '2026-05-11', failed_at: '2026-05-25T08:00:00Z', flagged_items: [] }),
    });
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans?week=next',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(service.getHardFailStatus).not.toHaveBeenCalled();
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect('hard_fail' in body).toBe(false);
  });

  it('does not check getHardFailStatus when plan is present', async () => {
    const planRow = {
      id: SAMPLE_PLAN_ID,
      household_id: SAMPLE_HOUSEHOLD_ID,
      week_id: '00000000-0000-4000-8000-000000000099',
      week_of: '2026-05-04',
      revision: 1,
      generated_at: '2026-05-02T11:00:00.000Z',
      guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
      guardrail_version: 'v1.0.0',
      prompt_version: 'v1.0.0',
      created_at: '2026-05-02T11:00:00.000Z',
      updated_at: '2026-05-02T11:00:01.000Z',
    };
    const service = buildMockService({
      getPlanForWeek: vi.fn().mockResolvedValue({
        plan: planRow,
        planItems: [MOCK_ITEM],
        isDraft: false,
        weekOf: '2026-05-04',
      }),
    });
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(service.getHardFailStatus).not.toHaveBeenCalled();
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect('hard_fail' in body).toBe(false);
  });

  // Story pre-4-s3 — flagged_items surface for AllergyUncertaintyBanner
  it('returns flagged_items when hard-fail carries compound-uncertain items (AC1)', async () => {
    const childA = '11111111-1111-4111-8111-111111111111';
    const childB = '22222222-2222-4222-8222-222222222222';
    const flaggedItems = [
      { child_id: childA, ingredient: 'garam masala', slot: 'main', day: 'monday' },
      { child_id: childB, ingredient: 'ranch dressing', slot: 'main', day: 'tuesday' },
    ];
    const service = buildMockService({
      getHardFailStatus: vi.fn().mockResolvedValue({
        week_of: '2026-05-04',
        failed_at: '2026-05-25T08:00:00Z',
        flagged_items: flaggedItems,
      }),
    });
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      hard_fail?: { week_of: string; failed_at: string };
      flagged_items?: Array<{ child_id: string; ingredient: string; slot: string; day: string }>;
    };
    expect(body.flagged_items).toEqual(flaggedItems);
    expect(body.hard_fail).toEqual({ week_of: '2026-05-04', failed_at: '2026-05-25T08:00:00Z' });
  });

  it('omits flagged_items when hard-fail has no compound-uncertain items (blocked-only) (AC2)', async () => {
    const service = buildMockService({
      getHardFailStatus: vi.fn().mockResolvedValue({
        week_of: '2026-05-04',
        failed_at: '2026-05-25T08:00:00Z',
        flagged_items: [],
      }),
    });
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect('flagged_items' in body).toBe(false);
    expect('hard_fail' in body).toBe(true);
  });

  it('omits flagged_items when there is no plan failure (AC3)', async () => {
    const service = buildMockService();
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect('flagged_items' in body).toBe(false);
    expect('hard_fail' in body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Story 3.15 — GET /v1/plans/:weekId/history
// ---------------------------------------------------------------------------

describe('GET /v1/plans/:weekId/history', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/plans/${SAMPLE_WEEK_ID}/history`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when role is ops (not a household member)', async () => {
    app = await buildTestApp();
    const token = app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'ops' });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/plans/${SAMPLE_WEEK_ID}/history`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when weekId is not a valid UUID', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans/not-a-uuid/history',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when service throws NotFoundError', async () => {
    const service = buildMockService({
      getPlanHistory: vi.fn().mockRejectedValue(new NotFoundError(`plan for week ${SAMPLE_WEEK_ID}`)),
    });
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/plans/${SAMPLE_WEEK_ID}/history`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/not-found');
  });

  it('returns 200 with plan, plan_items, swap_history, and ratings for a valid past week', async () => {
    const service = buildMockService();
    app = await buildTestApp(service);
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/plans/${SAMPLE_WEEK_ID}/history`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      plan: { id: string };
      plan_items: unknown[];
      swap_history: unknown[];
      ratings: Record<string, unknown>;
    };
    expect(body.plan.id).toBe(SAMPLE_PLAN_ID);
    expect(body.plan_items).toHaveLength(1);
    expect(body.swap_history).toEqual([]);
    expect(body.ratings).toEqual({});
    expect(service.getPlanHistory).toHaveBeenCalledWith({
      householdId: SAMPLE_HOUSEHOLD_ID,
      weekId: SAMPLE_WEEK_ID,
    });
  });

  it('secondary_caregiver role is authorised to read history', async () => {
    app = await buildTestApp();
    const token = signSecondary(app);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/plans/${SAMPLE_WEEK_ID}/history`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
