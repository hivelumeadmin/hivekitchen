import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { FamilyLanguageTerm } from '@hivekitchen/types';
import type { AuditWriteInput } from '../../audit/audit.types.js';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { familyLanguageRoutes } from './family-language.routes.js';
import { buildFamilyLanguageDouble, type TermRow } from './family-language.test-double.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HOUSEHOLD_ID = '33333333-3333-4333-8333-333333333333';
const JWT_SECRET = 'a'.repeat(32);

interface MockState {
  terms: TermRow[];
}

// Story 15-s6 — the repository reads `family_language_terms` rows and mutates
// them through the two SECURITY DEFINER functions, so the route tests drive the
// shared in-memory double instead of stubbing a `households` JSONB column.
// `state.terms` is rebound to the double's live table so assertions still read
// post-request storage.
function buildMockSupabase(state: MockState) {
  const double = buildFamilyLanguageDouble(state.terms);
  state.terms = double.rows();
  return double.client;
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
        instance: request.id,
      });
      return;
    }
    const obj = err as { validation?: unknown; cause?: unknown };
    if (obj.cause instanceof ZodError || (Array.isArray(obj.validation) && obj.validation.length > 0)) {
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

  await app.register(familyLanguageRoutes);
  await app.ready();
  return app;
}

function signToken(
  app: FastifyInstance,
  role: 'primary_parent' | 'secondary_caregiver' = 'primary_parent',
  householdId = SAMPLE_HOUSEHOLD_ID,
): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: householdId, role });
}

function candidate(): TermRow {
  return {
    household_id: SAMPLE_HOUSEHOLD_ID,
    term: 'Nani',
    maps_to: 'grandmother',
    usage_count: 2,
    state: 'candidate',
    first_seen_at: '2026-06-08T10:00:00.000Z',
    ratified_at: null,
  };
}

describe('POST /v1/households/:id/family-language/ratify', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('opt_in returns 200 and sets a PII-safe audit context (no term)', async () => {
    const state: MockState = { terms: [candidate()] };
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language/ratify`,
      headers: { authorization: `Bearer ${token}` },
      payload: { term: 'Nani', action: 'opt_in' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { term: { state: string } };
    expect(body.term.state).toBe('active');

    expect(captured.value?.event_type).toBe('template.state_changed');
    expect(captured.value?.metadata).toMatchObject({
      maps_to: 'grandmother',
      from_state: 'candidate',
      to_state: 'active',
    });
    // The family-language word itself must never appear in audit metadata (PII).
    expect(JSON.stringify(captured.value?.metadata ?? {})).not.toContain('Nani');
  });

  it('forget on an active term is a no-op and fires no audit (forward-only)', async () => {
    const state: MockState = {
      terms: [{ ...candidate(), state: 'active', ratified_at: '2026-06-08T10:05:00.000Z' }],
    };
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language/ratify`,
      headers: { authorization: `Bearer ${token}` },
      payload: { term: 'Nani', action: 'forget' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { term: { state: string } };
    expect(body.term.state).toBe('active');
    expect(captured.value).toBeUndefined();
  });

  it('tell_lumi_more returns a lumi_response and fires no audit', async () => {
    const state: MockState = { terms: [candidate()] };
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language/ratify`,
      headers: { authorization: `Bearer ${token}` },
      payload: { term: 'Nani', action: 'tell_lumi_more' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { term: { state: string }; lumi_response: string };
    expect(body.term.state).toBe('candidate');
    expect(body.lumi_response.length).toBeGreaterThan(0);
    expect(captured.value).toBeUndefined();
  });

  it('secondary_caregiver cannot ratify → 403', async () => {
    const state: MockState = { terms: [candidate()] };
    app = await buildTestApp({ state });
    const token = signToken(app, 'secondary_caregiver');

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language/ratify`,
      headers: { authorization: `Bearer ${token}` },
      payload: { term: 'Nani', action: 'opt_in' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('cross-household primary_parent → 403', async () => {
    const state: MockState = { terms: [candidate()] };
    app = await buildTestApp({ state });
    const token = signToken(app, 'primary_parent', SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/family-language/ratify`,
      headers: { authorization: `Bearer ${token}` },
      payload: { term: 'Nani', action: 'opt_in' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('unknown term returns 404 (graceful, not a 500)', async () => {
    const state: MockState = { terms: [] };
    app = await buildTestApp({ state });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language/ratify`,
      headers: { authorization: `Bearer ${token}` },
      payload: { term: 'Lola', action: 'opt_in' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('invalid action value → 400', async () => {
    const state: MockState = { terms: [candidate()] };
    app = await buildTestApp({ state });
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language/ratify`,
      headers: { authorization: `Bearer ${token}` },
      payload: { term: 'Nani', action: 'opt_out' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('unauthenticated → 401', async () => {
    const state: MockState = { terms: [candidate()] };
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language/ratify`,
      payload: { term: 'Nani', action: 'opt_in' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// Review patch (5-S10): the web reads terms to suppress already-resolved
// ratification cards on re-hydration.
describe('GET /v1/households/:id/family-language', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns the household terms (200)', async () => {
    const state: MockState = {
      terms: [{ ...candidate(), state: 'active', ratified_at: '2026-06-08T10:05:00.000Z' }],
    };
    app = await buildTestApp({ state });
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { terms: FamilyLanguageTerm[] };
    expect(body.terms).toHaveLength(1);
    expect(body.terms[0]).toMatchObject({ term: 'Nani', state: 'active' });
  });

  it('secondary_caregiver may read (200)', async () => {
    const state: MockState = { terms: [] };
    app = await buildTestApp({ state });
    const token = signToken(app, 'secondary_caregiver');

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { terms: FamilyLanguageTerm[] };
    expect(body.terms).toEqual([]);
  });

  it('cross-household → 403', async () => {
    const state: MockState = { terms: [candidate()] };
    app = await buildTestApp({ state });
    const token = signToken(app, 'primary_parent', SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/family-language`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const state: MockState = { terms: [] };
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language`,
    });

    expect(res.statusCode).toBe(401);
  });
});
