import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { householdScopeHook } from '../../middleware/household-scope.hook.js';
import { isDomainError } from '../../common/errors.js';
import { childRequestRoutes } from './child-request.routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const JWT_SECRET = 'a'.repeat(32);

interface MockOpts {
  // findById result for child_lunch_requests (a single row, or null for 404).
  requestRow?: Record<string, unknown> | null;
  // findPendingByHousehold result.
  listRows?: unknown[];
}

type SupabaseResult = { data: unknown; error: unknown };

// Chainable proxy that branches per-table and per-path. Records which tables
// were accessed so tests can assert the food_preferences planner-signal write.
function buildSupabase(opts: MockOpts): { supabase: unknown; tables: string[] } {
  const tables: string[] = [];
  const requestRow =
    opts.requestRow === undefined
      ? { id: REQUEST_ID, household_id: HOUSEHOLD_ID, child_id: CHILD_ID, request_text: 'pizza', status: 'pending' }
      : opts.requestRow;
  const listRows = opts.listRows ?? [];

  function chainable(getResult: (path: string[]) => SupabaseResult): unknown {
    function makeProxy(path: string[]): unknown {
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_t, prop) {
          if (prop === 'maybeSingle' || prop === 'single') {
            return () => Promise.resolve(getResult(path));
          }
          if (prop === 'then') {
            return (onF: (v: SupabaseResult) => unknown, onR?: (e: unknown) => unknown) =>
              Promise.resolve(getResult(path)).then(onF, onR);
          }
          return (..._args: unknown[]) => makeProxy([...path, String(prop)]);
        },
      };
      return new Proxy({}, handler);
    }
    return makeProxy([]);
  }

  return {
    tables,
    supabase: {
      from(table: string) {
        tables.push(table);
        switch (table) {
          case 'child_lunch_requests':
            return chainable((path) => {
              if (path.includes('update')) {
                // resolve(): 1 row updated.
                return { data: [{ id: REQUEST_ID }], error: null };
              }
              if (path.includes('order')) {
                // findPendingByHousehold list.
                return { data: listRows, error: null };
              }
              // findById single row.
              return { data: requestRow, error: null };
            });
          case 'food_preferences':
            return chainable(() => ({
              data: { id: randomUUID(), created_at: '2026-06-03T12:00:00.000Z', updated_at: '2026-06-03T12:00:00.000Z' },
              error: null,
            }));
          default:
            throw new Error(`unexpected table ${table}`);
        }
      },
    },
  };
}

async function buildTestApp(supabaseMock: unknown): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'test', JWT_SECRET, ENVELOPE_ENCRYPTION_MASTER_KEY: undefined };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', supabaseMock as unknown as FastifyInstance['supabase']);

  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: '15m' } });
  await app.register(authenticateHook);
  await app.register(householdScopeHook);

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
        detail: 'invalid',
        instance: request.id,
      });
      return;
    }
    const validation = (err as { validation?: unknown }).validation;
    if (Array.isArray(validation) && validation.length > 0) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        detail: 'invalid',
        instance: request.id,
      });
      return;
    }
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  await app.register(childRequestRoutes);
  await app.ready();
  return app;
}

type Role = 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';

function signToken(app: FastifyInstance, role: Role = 'primary_parent'): string {
  return app.jwt.sign({ sub: USER_ID, hh: HOUSEHOLD_ID, role });
}

describe('GET /v1/child-requests', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('403 for guest_author (not in allowed roles)', async () => {
    app = await buildTestApp(buildSupabase({}).supabase);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/child-requests?status=pending',
      headers: { authorization: `Bearer ${signToken(app, 'guest_author')}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('401 without a bearer token', async () => {
    app = await buildTestApp(buildSupabase({}).supabase);
    const res = await app.inject({ method: 'GET', url: '/v1/child-requests' });
    expect(res.statusCode).toBe(401);
  });

  it('200 with pending requests for the household', async () => {
    app = await buildTestApp(
      buildSupabase({
        listRows: [
          {
            id: REQUEST_ID,
            child_id: CHILD_ID,
            request_text: 'pizza please',
            status: 'pending',
            created_at: '2026-06-03T12:00:00.000Z',
            children: { name: 'Layla' },
          },
        ],
      }).supabase,
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/child-requests?status=pending',
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { requests: Array<{ child_name: string; request_text: string }> };
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]?.child_name).toBe('Layla');
  });

  it('200 with empty requests when none pending', async () => {
    app = await buildTestApp(buildSupabase({ listRows: [] }).supabase);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/child-requests',
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ requests: [] });
  });
});

describe('POST /v1/child-requests/:id/approve', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 and writes a food_preferences planner signal', async () => {
    const mock = buildSupabase({});
    app = await buildTestApp(mock.supabase);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/child-requests/${REQUEST_ID}/approve`,
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    // The approval must mirror the request into food_preferences as a soft signal.
    expect(mock.tables).toContain('food_preferences');
  });

  it('404 when the id is not in the caller household', async () => {
    app = await buildTestApp(buildSupabase({ requestRow: null }).supabase);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/child-requests/${REQUEST_ID}/approve`,
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('409 when the request is already resolved', async () => {
    app = await buildTestApp(
      buildSupabase({
        requestRow: { id: REQUEST_ID, household_id: HOUSEHOLD_ID, child_id: CHILD_ID, request_text: 'pizza', status: 'approved' },
      }).supabase,
    );
    const res = await app.inject({
      method: 'POST',
      url: `/v1/child-requests/${REQUEST_ID}/approve`,
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('403 for guest_author', async () => {
    app = await buildTestApp(buildSupabase({}).supabase);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/child-requests/${REQUEST_ID}/approve`,
      headers: { authorization: `Bearer ${signToken(app, 'guest_author')}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /v1/child-requests/:id/decline', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 and does NOT write a food_preferences signal', async () => {
    const mock = buildSupabase({});
    app = await buildTestApp(mock.supabase);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/child-requests/${REQUEST_ID}/decline`,
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(mock.tables).not.toContain('food_preferences');
  });

  it('404 when the id is not in the caller household', async () => {
    app = await buildTestApp(buildSupabase({ requestRow: null }).supabase);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/child-requests/${REQUEST_ID}/decline`,
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
