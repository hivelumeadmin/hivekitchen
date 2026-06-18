import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import {
  isDomainError,
  NotFoundError,
  PlanAlreadyExistsError,
  SwapGuardrailBlockedError,
  TooManyRequestsError,
  ValidationError,
} from '../../common/errors.js';
import { plansRoutes } from './plans.routes.js';

// Story 3-DM-C1 Phase 9b part 4 step 3 — route-level integration tests for the
// tree-shape wire. Each route exercises 401/403/idempotency/validation rails +
// at least one happy path + the relevant error mapping (NotFound → 404,
// SwapGuardrailBlockedError → 422, ValidationError → 400). Mocks replace
// fastify.plansService / fastify.planDayContextService / fastify.variantProposalService.

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_PLAN_ID = '33333333-3333-4333-8333-333333333333';
const SAMPLE_WEEK_OF = '2026-05-04';
const SAMPLE_MAIN_ASSIGNMENT_ID = '44444444-4444-4444-8444-444444444444';
const SAMPLE_VARIATION_ID = '55555555-5555-4555-8555-555555555555';
const SAMPLE_SLOT_ID = '66666666-6666-4666-8666-666666666666';
const SAMPLE_CHILD_ID = '88888888-8888-4888-8888-888888888888';
const SAMPLE_RECIPE_ID = '99999999-9999-4999-8999-999999999999';
const SAMPLE_OVERRIDE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDEMPOTENCY_KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JWT_SECRET = 'a'.repeat(32);

const MOCK_PLAN_ROW_CANONICAL = {
  id: SAMPLE_PLAN_ID,
  household_id: SAMPLE_HOUSEHOLD_ID,
  week_of: '2026-05-04',
  revision: 1,
  state: null,
  state_set_at: null,
  state_message: null,
  generated_at: '2026-04-19T11:00:00.000Z',
  guardrail_cleared_at: '2026-04-19T11:00:01.000Z',
  guardrail_version: 'v1.0.0',
  prompt_version: 'v1.0.0',
  created_at: '2026-04-19T11:00:00.000Z',
  updated_at: '2026-04-19T11:00:01.000Z',
};

const MOCK_MAIN_ASSIGNMENT = {
  id: SAMPLE_MAIN_ASSIGNMENT_ID,
  plan_id: SAMPLE_PLAN_ID,
  sequence: 1,
  recipe_id: SAMPLE_RECIPE_ID,
  created_at: '2026-05-04T00:00:00.000Z',
  updated_at: '2026-05-04T00:00:00.000Z',
};

const MOCK_DAY = {
  id: '12121212-1212-4212-8212-121212121212',
  plan_id: SAMPLE_PLAN_ID,
  day: 'monday' as const,
  paused_at: null,
  paused_reason: null,
  paused_note: null,
  created_at: '2026-05-04T00:00:00.000Z',
  updated_at: '2026-05-04T00:00:00.000Z',
};

const MOCK_SLOT = {
  id: SAMPLE_SLOT_ID,
  plan_day_id: MOCK_DAY.id,
  slot_kind: 'snack' as const,
  main_assignment_id: null,
  recipe_id: SAMPLE_RECIPE_ID,
  extra_kind: null,
  paused_at: null,
  created_at: '2026-05-04T00:00:00.000Z',
  updated_at: '2026-05-04T00:00:00.000Z',
};

const MOCK_VARIATION = {
  id: SAMPLE_VARIATION_ID,
  plan_slot_id: SAMPLE_SLOT_ID,
  child_id: SAMPLE_CHILD_ID,
  portion_size: 'regular' as const,
  texture: 'normal' as const,
  spice_level: 'mild' as const,
  cutting_style: null,
  container: null,
  add_ons: [],
  removals: [],
  notes: null,
  paused_at: null,
  created_at: '2026-05-04T00:00:00.000Z',
  updated_at: '2026-05-04T00:00:00.000Z',
};

const MOCK_OVERRIDE = {
  id: SAMPLE_OVERRIDE_ID,
  plan_slot_id: SAMPLE_SLOT_ID,
  household_id: SAMPLE_HOUSEHOLD_ID,
  child_id: SAMPLE_CHILD_ID,
  context_type: 'field_trip' as const,
  override_date: '2026-06-03',
  is_lumi_proposed: false,
  confirmed_at: '2026-05-30T12:00:00.000Z',
  reverted_at: null,
  created_at: '2026-05-30T12:00:00.000Z',
  updated_at: '2026-05-30T12:00:00.000Z',
};

interface PlansServiceMocks {
  getPlanForWeekTree?: ReturnType<typeof vi.fn>;
  getPlanHistoryTree?: ReturnType<typeof vi.fn>;
  getHardFailStatus?: ReturnType<typeof vi.fn>;
  swapMain?: ReturnType<typeof vi.fn>;
  updateVariation?: ReturnType<typeof vi.fn>;
  swapSlotRecipe?: ReturnType<typeof vi.fn>;
  pauseDayTree?: ReturnType<typeof vi.fn>;
  pauseChildOnDayTree?: ReturnType<typeof vi.fn>;
  requestRegeneration?: ReturnType<typeof vi.fn>;
  requestOnDemandGeneration?: ReturnType<typeof vi.fn>;
  findById?: ReturnType<typeof vi.fn>;
}

function buildPlansService(overrides: PlansServiceMocks = {}) {
  return {
    getPlanForWeekTree:
      overrides.getPlanForWeekTree ??
      vi.fn().mockResolvedValue({
        plan: null,
        mainAssignments: [],
        days: [],
        slots: [],
        variations: [],
        isDraft: false,
        weekOf: '2026-05-04',
      }),
    getPlanHistoryTree:
      overrides.getPlanHistoryTree ??
      vi.fn().mockResolvedValue({
        plan: MOCK_PLAN_ROW_CANONICAL,
        mainAssignments: [MOCK_MAIN_ASSIGNMENT],
        days: [MOCK_DAY],
        slots: [MOCK_SLOT],
        variations: [MOCK_VARIATION],
        swapHistory: [],
        weekOf: '2026-05-04',
      }),
    getHardFailStatus:
      overrides.getHardFailStatus ?? vi.fn().mockResolvedValue(null),
    swapMain:
      overrides.swapMain ?? vi.fn().mockResolvedValue(MOCK_MAIN_ASSIGNMENT),
    updateVariation:
      overrides.updateVariation ?? vi.fn().mockResolvedValue(MOCK_VARIATION),
    swapSlotRecipe:
      overrides.swapSlotRecipe ?? vi.fn().mockResolvedValue(MOCK_SLOT),
    pauseDayTree:
      overrides.pauseDayTree ?? vi.fn().mockResolvedValue(MOCK_DAY),
    pauseChildOnDayTree:
      overrides.pauseChildOnDayTree ??
      vi.fn().mockResolvedValue({ pausedCount: 1 }),
    requestRegeneration:
      overrides.requestRegeneration ??
      vi.fn().mockResolvedValue({ jobId: 'noop', rateLimitRemaining: 5 }),
    requestOnDemandGeneration:
      overrides.requestOnDemandGeneration ??
      vi.fn().mockResolvedValue({
        jobId: 'gen-job',
        weekOf: '2026-06-15',
        plannedDays: ['thursday', 'friday'],
        basis: 'current_week_remaining',
      }),
    findById:
      overrides.findById ?? vi.fn().mockResolvedValue(MOCK_PLAN_ROW_CANONICAL),
  };
}

interface ThreadRepositoryMocks {
  findActiveThreadByHousehold?: ReturnType<typeof vi.fn>;
  createThread?: ReturnType<typeof vi.fn>;
  appendTurnNext?: ReturnType<typeof vi.fn>;
}

const MOCK_THREAD = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' };

function buildThreadRepository(overrides: ThreadRepositoryMocks = {}) {
  return {
    findActiveThreadByHousehold:
      overrides.findActiveThreadByHousehold ??
      vi.fn().mockResolvedValue(MOCK_THREAD),
    createThread:
      overrides.createThread ?? vi.fn().mockResolvedValue(MOCK_THREAD),
    appendTurnNext:
      overrides.appendTurnNext ?? vi.fn().mockResolvedValue({ id: 'turn-1', server_seq: 1 }),
  };
}

interface PlanDayContextServiceMocks {
  setOverride?: ReturnType<typeof vi.fn>;
  revertOverride?: ReturnType<typeof vi.fn>;
}

function buildPlanDayContextService(overrides: PlanDayContextServiceMocks = {}) {
  return {
    setOverride:
      overrides.setOverride ??
      vi
        .fn()
        .mockResolvedValue({ override: MOCK_OVERRIDE, regenTriggered: true }),
    revertOverride:
      overrides.revertOverride ?? vi.fn().mockResolvedValue(undefined),
  };
}

interface VariantProposalServiceMocks {
  findActiveByPlan?: ReturnType<typeof vi.fn>;
  confirmProposal?: ReturnType<typeof vi.fn>;
}

function buildVariantProposalService(
  overrides: VariantProposalServiceMocks = {},
) {
  return {
    findActiveByPlan:
      overrides.findActiveByPlan ?? vi.fn().mockResolvedValue([]),
    confirmProposal:
      overrides.confirmProposal ?? vi.fn().mockResolvedValue(undefined),
  };
}

async function buildTestApp(opts: {
  plansService?: ReturnType<typeof buildPlansService>;
  planDayContextService?: ReturnType<typeof buildPlanDayContextService>;
  variantProposalService?: ReturnType<typeof buildVariantProposalService>;
  threadRepository?: ReturnType<typeof buildThreadRepository>;
} = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('env', {
    NODE_ENV: 'development',
    JWT_SECRET,
  } as unknown as FastifyInstance['env']);
  app.decorate(
    'plansService',
    (opts.plansService ?? buildPlansService()) as unknown as FastifyInstance['plansService'],
  );
  app.decorate(
    'planDayContextService',
    (opts.planDayContextService ?? buildPlanDayContextService()) as unknown as FastifyInstance['planDayContextService'],
  );
  app.decorate(
    'variantProposalService',
    (opts.variantProposalService ?? buildVariantProposalService()) as unknown as FastifyInstance['variantProposalService'],
  );
  app.decorate(
    'threadRepository',
    (opts.threadRepository ?? buildThreadRepository()) as unknown as FastifyInstance['threadRepository'],
  );

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

function signPrimary(app: FastifyInstance): string {
  return app.jwt.sign({
    sub: SAMPLE_USER_ID,
    hh: SAMPLE_HOUSEHOLD_ID,
    role: 'primary_parent',
  });
}

function signSecondary(app: FastifyInstance): string {
  return app.jwt.sign({
    sub: SAMPLE_USER_ID,
    hh: SAMPLE_HOUSEHOLD_ID,
    role: 'secondary_caregiver',
  });
}

function signOps(app: FastifyInstance): string {
  return app.jwt.sign({
    sub: SAMPLE_USER_ID,
    hh: SAMPLE_HOUSEHOLD_ID,
    role: 'ops',
  });
}

function signGuest(app: FastifyInstance): string {
  return app.jwt.sign({
    sub: SAMPLE_USER_ID,
    hh: SAMPLE_HOUSEHOLD_ID,
    role: 'guest_author',
  });
}

// ---------------------------------------------------------------------------
// GET /v1/plans (tree-shape response)
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

  it('returns 403 when role is ops', async () => {
    app = await buildTestApp();
    const token = signOps(app);
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

  it('defaults week to "current" and serialises the draft (plan=null) shape with empty arrays', async () => {
    const plansService = buildPlansService();
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      plan: unknown;
      main_assignments: unknown[];
      days: unknown[];
      slots: unknown[];
      variations: unknown[];
      is_draft: boolean;
      week_of: string;
    };
    expect(body.plan).toBeNull();
    expect(body.main_assignments).toEqual([]);
    expect(body.days).toEqual([]);
    expect(body.slots).toEqual([]);
    expect(body.variations).toEqual([]);
    expect(body.is_draft).toBe(false);
    expect(body.week_of).toBe('2026-05-04');
    expect(plansService.getPlanForWeekTree).toHaveBeenCalledWith({
      householdId: SAMPLE_HOUSEHOLD_ID,
      week: 'current',
    });
  });

  it('passes week=next through and returns is_draft=true', async () => {
    const plansService = buildPlansService({
      getPlanForWeekTree: vi.fn().mockResolvedValue({
        plan: null,
        mainAssignments: [],
        days: [],
        slots: [],
        variations: [],
        isDraft: true,
        weekOf: '2026-05-11',
      }),
    });
    app = await buildTestApp({ plansService });
    const token = signSecondary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans?week=next',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      is_draft: boolean;
      week_of: string;
    };
    expect(body.is_draft).toBe(true);
    expect(body.week_of).toBe('2026-05-11');
  });

  it('serialises a populated tree response', async () => {
    const plansService = buildPlansService({
      getPlanForWeekTree: vi.fn().mockResolvedValue({
        plan: MOCK_PLAN_ROW_CANONICAL,
        mainAssignments: [MOCK_MAIN_ASSIGNMENT],
        days: [MOCK_DAY],
        slots: [MOCK_SLOT],
        variations: [MOCK_VARIATION],
        isDraft: false,
        weekOf: '2026-05-04',
      }),
    });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans?week=current',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      plan: { id: string };
      main_assignments: unknown[];
      days: unknown[];
      slots: unknown[];
      variations: unknown[];
    };
    expect(body.plan.id).toBe(SAMPLE_PLAN_ID);
    expect(body.main_assignments).toHaveLength(1);
    expect(body.days).toHaveLength(1);
    expect(body.slots).toHaveLength(1);
    expect(body.variations).toHaveLength(1);
  });

  it('omits hard_fail when getHardFailStatus returns null', async () => {
    const plansService = buildPlansService();
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect('hard_fail' in body).toBe(false);
    expect(plansService.getHardFailStatus).toHaveBeenCalledWith(
      SAMPLE_HOUSEHOLD_ID,
      '2026-05-04',
    );
  });

  it('returns hard_fail when plan is null, not draft, and audit exists', async () => {
    const plansService = buildPlansService({
      getHardFailStatus: vi.fn().mockResolvedValue({
        week_of: '2026-05-04',
        failed_at: '2026-05-25T08:00:00Z',
        flagged_items: [],
      }),
    });
    app = await buildTestApp({ plansService });
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

  it('does not check getHardFailStatus on the draft (next-week) path', async () => {
    const plansService = buildPlansService({
      getPlanForWeekTree: vi.fn().mockResolvedValue({
        plan: null,
        mainAssignments: [],
        days: [],
        slots: [],
        variations: [],
        isDraft: true,
        weekOf: '2026-05-11',
      }),
      getHardFailStatus: vi.fn().mockResolvedValue({
        week_of: '2026-05-11',
        failed_at: '2026-05-25T08:00:00Z',
        flagged_items: [],
      }),
    });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans?week=next',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(plansService.getHardFailStatus).not.toHaveBeenCalled();
  });

  it('surfaces flagged_items when hard-fail carries compound-uncertain items', async () => {
    const childA = '11111111-1111-4111-8111-111111111111';
    const flaggedItems = [
      {
        child_id: childA,
        ingredient: 'garam masala',
        slot: 'main',
        day: 'monday',
      },
    ];
    const plansService = buildPlansService({
      getHardFailStatus: vi.fn().mockResolvedValue({
        week_of: '2026-05-04',
        failed_at: '2026-05-25T08:00:00Z',
        flagged_items: flaggedItems,
      }),
    });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      flagged_items?: typeof flaggedItems;
    };
    expect(body.flagged_items).toEqual(flaggedItems);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/plans/generate (Story 3-S34 — on-demand composition)
// ---------------------------------------------------------------------------

describe('POST /v1/plans/generate', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/v1/plans/generate' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when role is ops', async () => {
    app = await buildTestApp();
    const token = signOps(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/plans/generate',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when role is guest_author', async () => {
    app = await buildTestApp();
    const token = signGuest(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/plans/generate',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when the Idempotency-Key header is missing', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/plans/generate',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 202 with the composition window and calls the service', async () => {
    const requestOnDemandGeneration = vi.fn().mockResolvedValue({
      jobId: 'gen-job-7',
      weekOf: '2026-06-15',
      plannedDays: ['thursday', 'friday'],
      basis: 'current_week_remaining',
    });
    const plansService = buildPlansService({ requestOnDemandGeneration });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/plans/generate',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      job_id: 'gen-job-7',
      week_of: '2026-06-15',
      planned_days: ['thursday', 'friday'],
      basis: 'current_week_remaining',
    });
    expect(requestOnDemandGeneration).toHaveBeenCalledWith({
      householdId: SAMPLE_HOUSEHOLD_ID,
      requestId: IDEMPOTENCY_KEY,
    });
  });

  it('allows secondary_caregiver', async () => {
    app = await buildTestApp();
    const token = signSecondary(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/plans/generate',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
    });
    expect(res.statusCode).toBe(202);
  });

  it('maps PlanAlreadyExistsError to 409', async () => {
    const requestOnDemandGeneration = vi
      .fn()
      .mockRejectedValue(new PlanAlreadyExistsError('2026-06-15'));
    const plansService = buildPlansService({ requestOnDemandGeneration });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/plans/generate',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
    });
    expect(res.statusCode).toBe(409);
  });

  it('maps TooManyRequestsError to 429', async () => {
    const requestOnDemandGeneration = vi
      .fn()
      .mockRejectedValue(new TooManyRequestsError(3600));
    const plansService = buildPlansService({ requestOnDemandGeneration });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/plans/generate',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
    });
    expect(res.statusCode).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/plans/:weekOf/history (tree-shape response)
// ---------------------------------------------------------------------------

describe('GET /v1/plans/:weekOf/history', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/plans/${SAMPLE_WEEK_OF}/history`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when role is ops', async () => {
    app = await buildTestApp();
    const token = signOps(app);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/plans/${SAMPLE_WEEK_OF}/history`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when weekOf is not a valid date', async () => {
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
    const plansService = buildPlansService({
      getPlanHistoryTree: vi
        .fn()
        .mockRejectedValue(new NotFoundError(`plan for week ${SAMPLE_WEEK_OF}`)),
    });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/plans/${SAMPLE_WEEK_OF}/history`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as { type: string }).type).toBe(
      '/errors/not-found',
    );
  });

  it('returns 200 with the tree, empty swap_history, and empty ratings', async () => {
    const plansService = buildPlansService();
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/plans/${SAMPLE_WEEK_OF}/history`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      plan: { id: string };
      main_assignments: unknown[];
      days: unknown[];
      slots: unknown[];
      variations: unknown[];
      swap_history: unknown[];
      ratings: Record<string, unknown>;
    };
    expect(body.plan.id).toBe(SAMPLE_PLAN_ID);
    expect(body.main_assignments).toHaveLength(1);
    expect(body.days).toHaveLength(1);
    expect(body.slots).toHaveLength(1);
    expect(body.variations).toHaveLength(1);
    expect(body.swap_history).toEqual([]);
    expect(body.ratings).toEqual({});
    expect(plansService.getPlanHistoryTree).toHaveBeenCalledWith({
      householdId: SAMPLE_HOUSEHOLD_ID,
      weekOf: SAMPLE_WEEK_OF,
    });
  });

  it('secondary_caregiver role is authorised', async () => {
    app = await buildTestApp();
    const token = signSecondary(app);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/plans/${SAMPLE_WEEK_OF}/history`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PATCH /v1/plans/:planId/main-assignments/:mainAssignmentId/recipe
// ---------------------------------------------------------------------------

describe('PATCH /v1/plans/:planId/main-assignments/:mainAssignmentId/recipe', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  const URL = `/v1/plans/${SAMPLE_PLAN_ID}/main-assignments/${SAMPLE_MAIN_ASSIGNMENT_ID}/recipe`;
  const VALID_BODY = { new_recipe_id: SAMPLE_RECIPE_ID };

  it('returns 401 without Authorization header', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when role is ops', async () => {
    app = await buildTestApp();
    const token = signOps(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when Idempotency-Key is absent', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when planId is not a valid UUID', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/not-a-uuid/main-assignments/${SAMPLE_MAIN_ASSIGNMENT_ID}/recipe`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when body is missing new_recipe_id', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when service throws NotFoundError', async () => {
    const plansService = buildPlansService({
      swapMain: vi.fn().mockRejectedValue(
        new NotFoundError(`main_assignment ${SAMPLE_MAIN_ASSIGNMENT_ID}`),
      ),
    });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 422 when guardrail blocks the swap', async () => {
    const plansService = buildPlansService({
      swapMain: vi
        .fn()
        .mockRejectedValue(
          new SwapGuardrailBlockedError(SAMPLE_MAIN_ASSIGNMENT_ID, ['peanut']),
        ),
    });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(422);
    expect((JSON.parse(res.body) as { type: string }).type).toBe(
      '/errors/swap-guardrail-blocked',
    );
  });

  it('returns 200 with { main_assignment } on success and passes args to service', async () => {
    const plansService = buildPlansService();
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { main_assignment: { id: string } };
    expect(body.main_assignment.id).toBe(SAMPLE_MAIN_ASSIGNMENT_ID);
    expect(plansService.swapMain).toHaveBeenCalledWith({
      planId: SAMPLE_PLAN_ID,
      mainAssignmentId: SAMPLE_MAIN_ASSIGNMENT_ID,
      householdId: SAMPLE_HOUSEHOLD_ID,
      requestId: IDEMPOTENCY_KEY,
      input: VALID_BODY,
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /v1/plans/:planId/variations/:variationId
// ---------------------------------------------------------------------------

describe('PATCH /v1/plans/:planId/variations/:variationId', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  const URL = `/v1/plans/${SAMPLE_PLAN_ID}/variations/${SAMPLE_VARIATION_ID}`;

  it('returns 401 without Authorization header', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { portion_size: 'large' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when Idempotency-Key is absent', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { portion_size: 'large' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when portion_size is invalid', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: { portion_size: 'enormous' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts an empty body (all fields optional → no-op patch)', async () => {
    const plansService = buildPlansService();
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(plansService.updateVariation).toHaveBeenCalledWith({
      planId: SAMPLE_PLAN_ID,
      variationId: SAMPLE_VARIATION_ID,
      householdId: SAMPLE_HOUSEHOLD_ID,
      requestId: IDEMPOTENCY_KEY,
      input: {},
    });
  });

  it('returns 422 when guardrail blocks the variation update', async () => {
    const plansService = buildPlansService({
      updateVariation: vi
        .fn()
        .mockRejectedValue(
          new SwapGuardrailBlockedError(SAMPLE_VARIATION_ID, ['peanut']),
        ),
    });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: { add_ons: ['peanut butter'] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 200 with { variation } and forwards the full patch body', async () => {
    const plansService = buildPlansService();
    app = await buildTestApp({ plansService });
    const token = signSecondary(app);
    const patch = {
      portion_size: 'large' as const,
      cutting_style: null,
      add_ons: ['cucumber slices'],
    };
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: patch,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { variation: { id: string } };
    expect(body.variation.id).toBe(SAMPLE_VARIATION_ID);
    expect(plansService.updateVariation).toHaveBeenCalledWith({
      planId: SAMPLE_PLAN_ID,
      variationId: SAMPLE_VARIATION_ID,
      householdId: SAMPLE_HOUSEHOLD_ID,
      requestId: IDEMPOTENCY_KEY,
      input: patch,
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /v1/plans/:planId/slots/:planSlotId/recipe
// ---------------------------------------------------------------------------

describe('PATCH /v1/plans/:planId/slots/:planSlotId/recipe', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  const URL = `/v1/plans/${SAMPLE_PLAN_ID}/slots/${SAMPLE_SLOT_ID}/recipe`;
  const VALID_BODY = { new_recipe_id: SAMPLE_RECIPE_ID };

  it('returns 401 without Authorization header', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when planSlotId is not a UUID', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/slots/not-a-uuid/recipe`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when service rejects main slot via ValidationError', async () => {
    const plansService = buildPlansService({
      swapSlotRecipe: vi
        .fn()
        .mockRejectedValue(
          new ValidationError(
            'main slots cannot be swapped here — use PATCH /v1/plans/:planId/main-assignments/:mainAssignmentId/recipe',
          ),
        ),
    });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 422 when guardrail blocks the swap', async () => {
    const plansService = buildPlansService({
      swapSlotRecipe: vi
        .fn()
        .mockRejectedValue(
          new SwapGuardrailBlockedError(SAMPLE_SLOT_ID, ['tree nut']),
        ),
    });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 200 with { slot } on success', async () => {
    const plansService = buildPlansService();
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { slot: { id: string } };
    expect(body.slot.id).toBe(SAMPLE_SLOT_ID);
    expect(plansService.swapSlotRecipe).toHaveBeenCalledWith({
      planId: SAMPLE_PLAN_ID,
      planSlotId: SAMPLE_SLOT_ID,
      householdId: SAMPLE_HOUSEHOLD_ID,
      requestId: IDEMPOTENCY_KEY,
      input: VALID_BODY,
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /v1/plans/:planId/days/:day/pause
// ---------------------------------------------------------------------------

describe('PATCH /v1/plans/:planId/days/:day/pause', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  const url = (day: string) => `/v1/plans/${SAMPLE_PLAN_ID}/days/${day}/pause`;

  it('returns 401 without Authorization header', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: url('monday'),
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { reason: 'sick_day' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when role is ops', async () => {
    app = await buildTestApp();
    const token = signOps(app);
    const res = await app.inject({
      method: 'PATCH',
      url: url('monday'),
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: { reason: 'sick_day' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when day is sunday (not a school day)', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: url('sunday'),
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: { reason: 'sick_day' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when reason is missing (now required by tree contract)', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: url('monday'),
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when reason is the legacy "sick" string (enum widened)', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: url('monday'),
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: { reason: 'sick' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when service throws NotFoundError', async () => {
    const plansService = buildPlansService({
      pauseDayTree: vi
        .fn()
        .mockRejectedValue(new NotFoundError(`plan ${SAMPLE_PLAN_ID}`)),
    });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: url('monday'),
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: { reason: 'sick_day' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 204 and passes input to service.pauseDayTree', async () => {
    const plansService = buildPlansService();
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: url('wednesday'),
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: { reason: 'sick_day', note: 'stomach bug' },
    });
    expect(res.statusCode).toBe(204);
    expect(plansService.pauseDayTree).toHaveBeenCalledWith({
      planId: SAMPLE_PLAN_ID,
      day: 'wednesday',
      householdId: SAMPLE_HOUSEHOLD_ID,
      requestId: IDEMPOTENCY_KEY,
      input: { reason: 'sick_day', note: 'stomach bug' },
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /v1/plans/:planId/days/:day/pause-child
// ---------------------------------------------------------------------------

describe('PATCH /v1/plans/:planId/days/:day/pause-child', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  const url = (day: string) =>
    `/v1/plans/${SAMPLE_PLAN_ID}/days/${day}/pause-child`;

  it('returns 401 without Authorization header', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: url('monday'),
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { child_id: SAMPLE_CHILD_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when child_id is missing', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: url('monday'),
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when child_id is not a UUID', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: url('monday'),
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: { child_id: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 204 and passes the child_id to service.pauseChildOnDayTree', async () => {
    const plansService = buildPlansService();
    app = await buildTestApp({ plansService });
    const token = signSecondary(app);
    const res = await app.inject({
      method: 'PATCH',
      url: url('thursday'),
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: { child_id: SAMPLE_CHILD_ID },
    });
    expect(res.statusCode).toBe(204);
    expect(plansService.pauseChildOnDayTree).toHaveBeenCalledWith({
      planId: SAMPLE_PLAN_ID,
      day: 'thursday',
      householdId: SAMPLE_HOUSEHOLD_ID,
      requestId: IDEMPOTENCY_KEY,
      input: { child_id: SAMPLE_CHILD_ID },
    });
  });
});

// ---------------------------------------------------------------------------
// POST /v1/plans/:planId/slots/:planSlotId/override
// ---------------------------------------------------------------------------

describe('POST /v1/plans/:planId/slots/:planSlotId/override', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  const URL = `/v1/plans/${SAMPLE_PLAN_ID}/slots/${SAMPLE_SLOT_ID}/override`;
  // Use a future date so the SetPlanDayContextInputSchema refine() accepts it.
  const FUTURE_DATE = '2099-01-15';
  const VALID_BODY = {
    context_type: 'field_trip' as const,
    override_date: FUTURE_DATE,
    child_id: SAMPLE_CHILD_ID,
    is_lumi_proposed: false,
  };

  it('returns 401 without Authorization header', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when Idempotency-Key is absent', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when planSlotId is not a UUID', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/plans/${SAMPLE_PLAN_ID}/slots/not-a-uuid/override`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 201 with { override, regen_triggered } and forwards planSlotId to setOverride', async () => {
    const planDayContextService = buildPlanDayContextService();
    app = await buildTestApp({ planDayContextService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      override: { id: string };
      regen_triggered: boolean;
    };
    expect(body.override.id).toBe(SAMPLE_OVERRIDE_ID);
    expect(body.regen_triggered).toBe(true);
    expect(planDayContextService.setOverride).toHaveBeenCalledWith({
      planId: SAMPLE_PLAN_ID,
      planSlotId: SAMPLE_SLOT_ID,
      householdId: SAMPLE_HOUSEHOLD_ID,
      input: VALID_BODY,
      requestId: IDEMPOTENCY_KEY,
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /v1/plans/:planId/slots/:planSlotId/override/:overrideId
// ---------------------------------------------------------------------------

describe('DELETE /v1/plans/:planId/slots/:planSlotId/override/:overrideId', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  const URL = `/v1/plans/${SAMPLE_PLAN_ID}/slots/${SAMPLE_SLOT_ID}/override/${SAMPLE_OVERRIDE_ID}`;

  it('returns 401 without Authorization header', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'DELETE',
      url: URL,
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when Idempotency-Key is absent', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'DELETE',
      url: URL,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when service throws NotFoundError', async () => {
    const planDayContextService = buildPlanDayContextService({
      revertOverride: vi
        .fn()
        .mockRejectedValue(new NotFoundError(`plan_day_context ${SAMPLE_OVERRIDE_ID}`)),
    });
    app = await buildTestApp({ planDayContextService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'DELETE',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 204 and forwards planSlotId to revertOverride', async () => {
    const planDayContextService = buildPlanDayContextService();
    app = await buildTestApp({ planDayContextService });
    const token = signSecondary(app);
    const res = await app.inject({
      method: 'DELETE',
      url: URL,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': IDEMPOTENCY_KEY,
      },
    });
    expect(res.statusCode).toBe(204);
    expect(planDayContextService.revertOverride).toHaveBeenCalledWith({
      planId: SAMPLE_PLAN_ID,
      planSlotId: SAMPLE_SLOT_ID,
      overrideId: SAMPLE_OVERRIDE_ID,
      householdId: SAMPLE_HOUSEHOLD_ID,
      requestId: IDEMPOTENCY_KEY,
    });
  });
});

// ---------------------------------------------------------------------------
// POST /v1/plans/:planId/swap-proposals (Slice 5-S12)
// ---------------------------------------------------------------------------

describe('POST /v1/plans/:planId/swap-proposals', () => {
  let app: FastifyInstance;
  const URL = `/v1/plans/${SAMPLE_PLAN_ID}/swap-proposals`;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 401 without an Authorization header', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      payload: { day: 'wednesday', content: 'something lighter' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when role is ops', async () => {
    app = await buildTestApp();
    const token = signOps(app);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { day: 'wednesday', content: 'something lighter' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when the Idempotency-Key header is missing', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { day: 'wednesday', content: 'something lighter' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when content is empty', async () => {
    app = await buildTestApp();
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { day: 'wednesday', content: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the plan does not belong to the household', async () => {
    const plansService = buildPlansService({
      findById: vi.fn().mockResolvedValue(null),
    });
    app = await buildTestApp({ plansService });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { day: 'wednesday', content: 'something lighter' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 201 with a proposal_id and appends a proposal turn to the family thread', async () => {
    const threadRepository = buildThreadRepository();
    app = await buildTestApp({ threadRepository });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { day: 'wednesday', content: 'something lighter, maybe a wrap' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { proposal_id: string };
    expect(body.proposal_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(threadRepository.appendTurnNext).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: MOCK_THREAD.id,
        role: 'user',
        modality: 'text',
        body: expect.objectContaining({
          type: 'proposal',
          proposal_id: body.proposal_id,
          day: 'wednesday',
          content: 'something lighter, maybe a wrap',
        }),
      }),
    );
  });

  it('creates a family thread when none is active', async () => {
    const threadRepository = buildThreadRepository({
      findActiveThreadByHousehold: vi.fn().mockResolvedValue(null),
    });
    app = await buildTestApp({ threadRepository });
    const token = signPrimary(app);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { day: 'wednesday', content: 'something lighter' },
    });
    expect(res.statusCode).toBe(201);
    expect(threadRepository.createThread).toHaveBeenCalledWith(
      SAMPLE_HOUSEHOLD_ID,
      'family',
      'text',
    );
  });
});
