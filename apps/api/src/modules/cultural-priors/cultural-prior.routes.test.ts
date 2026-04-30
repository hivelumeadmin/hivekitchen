import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { AuditWriteInput } from '../../audit/audit.types.js';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { culturalPriorRoutes } from './cultural-prior.routes.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HOUSEHOLD_ID = '33333333-3333-4333-8333-333333333333';
const SAMPLE_PRIOR_ID = '44444444-4444-4444-8444-444444444444';
const JWT_SECRET = 'a'.repeat(32);

interface PriorRow {
  id: string;
  household_id: string;
  key: string;
  label: string;
  tier: string;
  state: string;
  presence: number;
  confidence: number;
  opted_in_at: string | null;
  opted_out_at: string | null;
  last_signal_at: string;
  created_at: string;
  updated_at: string;
}

function buildPrior(overrides: Partial<PriorRow> = {}): PriorRow {
  return {
    id: SAMPLE_PRIOR_ID,
    household_id: SAMPLE_HOUSEHOLD_ID,
    key: 'south_asian',
    label: 'South Asian',
    tier: 'L1',
    state: 'detected',
    presence: 80,
    confidence: 90,
    opted_in_at: null,
    opted_out_at: null,
    last_signal_at: '2026-04-28T10:00:00.000Z',
    created_at: '2026-04-28T10:00:00.000Z',
    updated_at: '2026-04-28T10:00:00.000Z',
    ...overrides,
  };
}

interface MockState {
  priors: PriorRow[];
  // When true, the update().select().maybeSingle() returns null (state-mismatch no-op)
  // to simulate a TOCTOU concurrent write that moved the prior before our UPDATE ran.
  simulateToctouOnUpdate?: boolean;
}

// In-memory Supabase mock — only the `cultural_priors` table is accessed by
// these route tests. The agent (OpenAI) is exercised via tell_lumi_more; we
// stub the OpenAI client at the chat.completions.create boundary so no live
// network call ever fires.
function buildMockSupabase(state: MockState) {
  return {
    from(table: string) {
      if (table === 'cultural_priors') return culturalPriorsTable(state);
      // Any other table — including `threads` for tell_lumi_more's thread
      // lookup — surfaces as null so the service falls through gracefully.
      if (table === 'threads') return threadsNoopTable();
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function culturalPriorsTable(state: MockState) {
  return {
    select() {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: vi.fn().mockImplementation(async () => {
          const row = state.priors.find(
            (p) => p.id === filters.id && p.household_id === filters.household_id,
          );
          return { data: row ?? null, error: null };
        }),
        // listByHousehold path — chain ends without maybeSingle/single,
        // resolves directly with a data array via thenable.
        then(resolve: (val: { data: PriorRow[]; error: null }) => unknown) {
          const householdFilter = filters.household_id as string | undefined;
          const rows = householdFilter
            ? state.priors.filter((p) => p.household_id === householdFilter)
            : state.priors;
          return resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
    update(updates: Partial<PriorRow>) {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        select() {
          return {
            maybeSingle: vi.fn().mockImplementation(async () => {
              if (state.simulateToctouOnUpdate) {
                // Simulate: a concurrent write moved the prior before our UPDATE ran.
                // The WHERE state=existingState clause matched 0 rows → null (no error).
                return { data: null, error: null };
              }
              // Match on id + household_id + state to mirror the real transition() WHERE clause.
              const idx = state.priors.findIndex(
                (p) =>
                  p.id === filters.id &&
                  p.household_id === filters.household_id &&
                  p.state === filters.state,
              );
              if (idx === -1) {
                return { data: null, error: null };
              }
              const updated = { ...state.priors[idx]!, ...updates } as PriorRow;
              state.priors[idx] = updated;
              return { data: updated, error: null };
            }),
          };
        },
      };
      return chain;
    },
  };
}

function threadsNoopTable() {
  return {
    select() {
      const chain = {
        eq() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  };
}

function buildMockOpenAI() {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Tell me a bit more about that.' } }],
        }),
      },
    },
  };
}

interface BuildAppOpts {
  state: MockState;
  capturedAudit?: { value: AuditWriteInput | undefined };
}

async function buildTestApp(opts: BuildAppOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate(
    'supabase',
    buildMockSupabase(opts.state) as unknown as FastifyInstance['supabase'],
  );
  app.decorate('openai', buildMockOpenAI() as unknown as FastifyInstance['openai']);

  await app.register(jwt, { secret: JWT_SECRET, sign: { expiresIn: '15m' } });
  await app.register(authenticateHook);

  if (opts.capturedAudit) {
    app.addHook('onResponse', async (request) => {
      opts.capturedAudit!.value = request.auditContext;
    });
  }

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
    if (obj.cause instanceof ZodError) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        detail: obj.cause.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
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

  await app.register(culturalPriorRoutes);
  await app.ready();
  return app;
}

function signPrimaryParentToken(
  app: FastifyInstance,
  householdId = SAMPLE_HOUSEHOLD_ID,
): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: householdId, role: 'primary_parent' });
}

function signSecondaryCaregiverToken(app: FastifyInstance): string {
  return app.jwt.sign({
    sub: SAMPLE_USER_ID,
    hh: SAMPLE_HOUSEHOLD_ID,
    role: 'secondary_caregiver',
  });
}

describe('GET /v1/households/:id/cultural-priors', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 200 with priors for primary parent', async () => {
    const state: MockState = { priors: [buildPrior()] };
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { priors: Array<{ id: string; key: string }> };
    expect(body.priors).toHaveLength(1);
    expect(body.priors[0]!.key).toBe('south_asian');
  });

  it('returns 200 with priors for secondary caregiver (read access)', async () => {
    const state: MockState = { priors: [buildPrior()] };
    app = await buildTestApp({ state });
    const token = signSecondaryCaregiverToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 200 with empty priors array when household has none (silence-mode)', async () => {
    const state: MockState = { priors: [] };
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { priors: unknown[] };
    expect(body.priors).toEqual([]);
  });

  it('returns 403 on cross-household access', async () => {
    const state: MockState = { priors: [] };
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/cultural-priors`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /v1/households/:id/cultural-priors/:priorId', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('opt_in transitions detected → opt_in_confirmed and fires audit', async () => {
    const state: MockState = { priors: [buildPrior()] };
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'opt_in' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { prior: { state: string } };
    expect(body.prior.state).toBe('opt_in_confirmed');

    expect(captured.value).toBeDefined();
    expect(captured.value?.event_type).toBe('template.state_changed');
    expect(captured.value?.metadata).toMatchObject({
      prior_id: SAMPLE_PRIOR_ID,
      key: 'south_asian',
      from_state: 'detected',
      to_state: 'opt_in_confirmed',
    });
    // No PII / label text in audit metadata.
    const metaJson = JSON.stringify(captured.value?.metadata ?? {});
    expect(metaJson).not.toContain('South Asian');
  });

  it('forget transitions detected → forgotten and fires audit', async () => {
    const state: MockState = { priors: [buildPrior()] };
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'forget' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { prior: { state: string } };
    expect(body.prior.state).toBe('forgotten');

    expect(captured.value?.metadata).toMatchObject({
      from_state: 'detected',
      to_state: 'forgotten',
    });
  });

  it('tell_lumi_more keeps state at detected and returns lumi_response', async () => {
    const state: MockState = { priors: [buildPrior()] };
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'tell_lumi_more' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { prior: { state: string }; lumi_response: string };
    expect(body.prior.state).toBe('detected');
    expect(typeof body.lumi_response).toBe('string');
    expect(body.lumi_response.length).toBeGreaterThan(0);
    // No state change → no audit firing.
    expect(captured.value).toBeUndefined();
  });

  it('secondary_caregiver cannot ratify → 403', async () => {
    const state: MockState = { priors: [buildPrior()] };
    app = await buildTestApp({ state });
    const token = signSecondaryCaregiverToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'opt_in' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('cross-household primary_parent → 403', async () => {
    const state: MockState = { priors: [buildPrior()] };
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'opt_in' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('priorId not found → 404', async () => {
    const state: MockState = { priors: [] };
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'opt_in' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/not-found');
  });

  it('invalid action value → 400', async () => {
    const state: MockState = { priors: [buildPrior()] };
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'opt_out' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('unauthenticated → 401', async () => {
    const state: MockState = { priors: [buildPrior()] };
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      payload: { action: 'opt_in' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('idempotent opt_in on already-confirmed prior is a no-op (no audit re-fire)', async () => {
    const state: MockState = {
      priors: [buildPrior({ state: 'opt_in_confirmed', opted_in_at: '2026-04-28T10:00:00.000Z' })],
    };
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'opt_in' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { prior: { state: string } };
    expect(body.prior.state).toBe('opt_in_confirmed');
    // Idempotent path → no audit re-fire.
    expect(captured.value).toBeUndefined();
  });

  it('forget transitions opt_in_confirmed → forgotten and fires audit with correct from_state (AC10)', async () => {
    const state: MockState = {
      priors: [buildPrior({ state: 'opt_in_confirmed', opted_in_at: '2026-04-28T10:00:00.000Z' })],
    };
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'forget' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { prior: { state: string } };
    expect(body.prior.state).toBe('forgotten');
    expect(captured.value?.event_type).toBe('template.state_changed');
    expect(captured.value?.metadata).toMatchObject({
      prior_id: SAMPLE_PRIOR_ID,
      key: 'south_asian',
      from_state: 'opt_in_confirmed',
      to_state: 'forgotten',
    });
  });

  it('forget idempotent on already-forgotten prior is a no-op (no audit re-fire) (AC14)', async () => {
    const state: MockState = {
      priors: [buildPrior({ state: 'forgotten', opted_out_at: '2026-04-28T10:00:00.000Z' })],
    };
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'forget' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { prior: { state: string } };
    expect(body.prior.state).toBe('forgotten');
    expect(captured.value).toBeUndefined();
  });

  it('tell_lumi_more on non-detected prior returns 200 with no lumi_response (AC18 state guard)', async () => {
    const state: MockState = {
      priors: [buildPrior({ state: 'opt_in_confirmed', opted_in_at: '2026-04-28T10:00:00.000Z' })],
    };
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'tell_lumi_more' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { prior: { state: string }; lumi_response?: string };
    expect(body.prior.state).toBe('opt_in_confirmed');
    expect(body.lumi_response).toBeUndefined();
  });

  it('TOCTOU: concurrent write moved prior before UPDATE — returns re-fetched row, no audit (AC16)', async () => {
    const state: MockState = {
      priors: [buildPrior({ state: 'detected' })],
      simulateToctouOnUpdate: true,
    };
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${SAMPLE_PRIOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'opt_in' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { prior: { state: string } };
    // Re-fetched current state (still 'detected' in mock since update was a no-op).
    expect(body.prior.state).toBe('detected');
    // No audit fires when transition() returns null.
    expect(captured.value).toBeUndefined();
  });
});
