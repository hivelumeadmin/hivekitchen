import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { householdScopeHook } from '../../middleware/household-scope.hook.js';
import { isDomainError } from '../../common/errors.js';
import { encryptField } from '../../lib/envelope-encryption.js';
import { lunchLinkRoutes } from './lunch-link.routes.js';
import { signToken as signLunchToken } from './lunch-link.service.js';
import type { LunchLinkSessionRow } from './lunch-link.repository.js';
import type { HeartNoteRow } from '../heart-notes/heart-note.repository.js';

function noop(plaintext: string): string {
  return encryptField(plaintext, null);
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const NOTE_ID = '44444444-4444-4444-8444-444444444444';
const NONCE = '77777777-7777-4777-8777-777777777777';
const DATE = '2026-05-17';
const HMAC_KEY = 'a'.repeat(64);
const JWT_SECRET = 'a'.repeat(32);
const WEB_BASE_URL = 'http://localhost:5173';

function sampleNoteRow(overrides: Partial<HeartNoteRow> = {}): HeartNoteRow {
  // DB mocks must return NOOP-encoded ciphertext — the route's read paths
  // decrypt before returning. Pass plaintext in overrides.content; this
  // wrapper applies the NOOP encoding if not already prefixed.
  const base: HeartNoteRow = {
    id: NOTE_ID,
    household_id: HOUSEHOLD_ID,
    child_id: CHILD_ID,
    author_user_id: USER_ID,
    content: noop('A warm note.'),
    status: 'draft',
    scheduled_for: null,
    delivered_at: null,
    cancelled_at: null,
    created_at: '2026-05-17T12:00:00.000Z',
    updated_at: '2026-05-17T12:00:00.000Z',
  };
  const merged = { ...base, ...overrides };
  if (overrides.content !== undefined && !merged.content.startsWith('NOOP:')) {
    merged.content = noop(overrides.content);
  }
  return merged;
}

function sampleSessionRow(overrides: Partial<LunchLinkSessionRow> = {}): LunchLinkSessionRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    child_id: CHILD_ID,
    household_id: HOUSEHOLD_ID,
    date: DATE,
    nonce: NONCE,
    exp: '2099-01-01T00:00:00.000Z',
    first_opened_at: null,
    rating: null,
    rating_submitted_at: null,
    reopened_after_exp_count: 0,
    suppressed_at: null,
    created_at: '2026-05-17T12:00:00.000Z',
    updated_at: '2026-05-17T12:00:00.000Z',
    ...overrides,
  };
}

interface MockOpts {
  childRow?: { id: string; name: string } | null;
  findResult?: HeartNoteRow | null;
}

function buildMockSupabase(opts: MockOpts) {
  const childRow = opts.childRow === undefined ? { id: CHILD_ID, name: 'Layla' } : opts.childRow;
  return {
    from(table: string) {
      if (table === 'children') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: childRow,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'heart_notes') {
        // findByChildAndDate queries a created_at day window:
        // select → eq → eq → gte → lt → order → limit → maybeSingle
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lt: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: opts.findResult ?? null,
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

type SupabaseResult = { data: unknown; error: unknown };

interface S3MockOpts {
  // children rows are returned identically for both findChildName (2-eq) and
  // findChildPublic (1-eq) — each test exercises only one flow.
  childRow?: { id?: string; name?: string; household_id?: string } | null;
  household?: { timezone: string } | null;
  hmacKeyRead?: { hmac_key: string } | null;
  hmacKeyUpsert?: { hmac_key: string } | null;
  session?: LunchLinkSessionRow | null;
  upsertedSession?: LunchLinkSessionRow | null;
  noteRow?: HeartNoteRow | null;
  // Slice 4-S12 — child_preferences rows for the FlavorPassport endpoint, with
  // embedded recipes(canonical_name, cuisine_tags, recipe_steps(...)).
  childPreferences?: unknown[];
  // Slice 4-S15 — child_lunch_requests insert result for the submit endpoint.
  childRequestInsert?: SupabaseResult;
}

/**
 * Chainable Supabase mock: every method on a table chain returns the same
 * proxy; terminators (.maybeSingle, .single, await) resolve to the configured
 * value. Per-table responses can branch on the method path (e.g. lunch_link_keys
 * distinguishes select from upsert).
 */
function buildS3MockSupabase(opts: S3MockOpts) {
  function chainable(getResult: (path: string[]) => SupabaseResult) {
    function makeProxy(path: string[]): unknown {
      const target: Record<string, unknown> = {};
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_, prop) {
          if (prop === 'maybeSingle' || prop === 'single') {
            return () => Promise.resolve(getResult(path));
          }
          if (prop === 'then') {
            return (
              onFulfilled: (v: SupabaseResult) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) =>
              Promise.resolve(getResult(path)).then(
                onFulfilled,
                onRejected,
              );
          }
          return (..._args: unknown[]) => makeProxy([...path, String(prop)]);
        },
      };
      return new Proxy(target, handler);
    }
    return makeProxy([]);
  }

  return {
    from(table: string) {
      switch (table) {
        case 'children':
          return chainable(() => ({
            data:
              opts.childRow === undefined
                ? { id: CHILD_ID, name: 'Layla', household_id: HOUSEHOLD_ID }
                : opts.childRow,
            error: null,
          }));
        case 'households':
          return chainable(() => ({
            data: opts.household === undefined ? { timezone: 'UTC' } : opts.household,
            error: null,
          }));
        case 'lunch_link_keys':
          return chainable((path) => {
            // findOrCreateHmacKey upsert path: ['upsert', 'select']
            if (path.includes('upsert')) {
              return {
                data:
                  opts.hmacKeyUpsert === undefined
                    ? { hmac_key: HMAC_KEY }
                    : opts.hmacKeyUpsert,
                error: null,
              };
            }
            return {
              data:
                opts.hmacKeyRead === undefined ? { hmac_key: HMAC_KEY } : opts.hmacKeyRead,
              error: null,
            };
          });
        case 'lunch_link_sessions':
          return chainable((path) => {
            if (path.includes('upsert')) {
              return {
                data:
                  opts.upsertedSession === undefined ? sampleSessionRow() : opts.upsertedSession,
                error: null,
              };
            }
            if (path.includes('update')) {
              return { data: null, error: null };
            }
            return {
              data: opts.session === undefined ? sampleSessionRow() : opts.session,
              error: null,
            };
          });
        case 'heart_notes':
          return chainable(() => ({
            data: opts.noteRow === undefined ? null : opts.noteRow,
            error: null,
          }));
        case 'child_preferences':
          return chainable(() => ({
            data: opts.childPreferences ?? [],
            error: null,
          }));
        case 'child_lunch_requests':
          return chainable(() =>
            opts.childRequestInsert === undefined
              ? { data: { id: '99999999-9999-4999-8999-999999999999' }, error: null }
              : opts.childRequestInsert,
          );
        case 'threads':
          // No active planning thread → the best-effort Lumi-turn injection is
          // a no-op (it logs at warn and returns).
          return chainable(() => ({ data: null, error: null }));
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
    rpc(_name: string, _args: unknown) {
      return Promise.resolve({ data: null, error: null });
    },
  };
}

async function buildTestApp(
  supabaseMock: unknown,
  nodeEnv: 'development' | 'staging' | 'production' | 'test' = 'development',
  capturedAudit?: { value: unknown },
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    genReqId: () => randomUUID(),
    routerOptions: { maxParamLength: 1024 },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: nodeEnv, JWT_SECRET, WEB_BASE_URL };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', supabaseMock as unknown as FastifyInstance['supabase']);
  // Slice 4-S4: stub briefStateComposer for the rate route's fire-and-forget refresh.
  app.decorate('briefStateComposer', {
    refreshTree: vi.fn().mockResolvedValue(undefined),
  } as unknown as FastifyInstance['briefStateComposer']);
  // Story 13-s2.5 — the child request-a-lunch route now emits child_request.received.
  app.decorate('sseDispatcher', {
    emit: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
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

  await app.register(lunchLinkRoutes);
  if (capturedAudit) {
    app.addHook('onResponse', async (request) => {
      capturedAudit.value = (request as unknown as { auditContext?: unknown }).auditContext;
    });
  }
  await app.ready();
  return app;
}

type Role = 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';

function signAuthToken(
  app: FastifyInstance,
  overrides: Partial<{ sub: string; hh: string; role: Role }> = {},
): string {
  return app.jwt.sign({
    sub: overrides.sub ?? USER_ID,
    hh: overrides.hh ?? HOUSEHOLD_ID,
    role: overrides.role ?? 'primary_parent',
  });
}

function forgeLunchToken(opts?: {
  exp?: string;
  child_id?: string;
  date?: string;
  hmacKey?: string;
}): string {
  return signLunchToken(
    {
      child_id: opts?.child_id ?? CHILD_ID,
      date: opts?.date ?? DATE,
      nonce: NONCE,
      exp: opts?.exp ?? '2099-01-01T00:00:00.000Z',
    },
    opts?.hmacKey ?? HMAC_KEY,
  );
}

describe('GET /v1/lunch-link-dev/:childId/:date', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 with full payload when child + note exist', async () => {
    app = await buildTestApp(
      buildMockSupabase({ findResult: sampleNoteRow({ content: 'hello' }) }),
    );
    const token = signAuthToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link-dev/${CHILD_ID}/${DATE}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      childName: string;
      date: string;
      heartNote: { body: string; authorDisplayName: string } | null;
      bag: { name: string; sub: string; safetyNote: string };
    };
    expect(body.childName).toBe('Layla');
    expect(body.heartNote).toEqual({ body: 'hello', authorDisplayName: 'Parent' });
  });

  it('404 when childId is not in the caller household', async () => {
    app = await buildTestApp(buildMockSupabase({ childRow: null }));
    const token = signAuthToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link-dev/${CHILD_ID}/${DATE}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 when NODE_ENV is production', async () => {
    app = await buildTestApp(buildMockSupabase({}), 'production');
    const token = signAuthToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link-dev/${CHILD_ID}/${DATE}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp(buildMockSupabase({}));

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link-dev/${CHILD_ID}/${DATE}`,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/lunch-link/generate', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('201 with a URL prefixed by WEB_BASE_URL/lunch/', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));
    const token = signAuthToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lunch-link/generate',
      headers: { authorization: `Bearer ${token}` },
      payload: { child_id: CHILD_ID, date: DATE },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { url: string };
    expect(body.url.startsWith(`${WEB_BASE_URL}/lunch/`)).toBe(true);
  });

  it('401 when no auth token provided', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lunch-link/generate',
      payload: { child_id: CHILD_ID, date: DATE },
    });

    expect(res.statusCode).toBe(401);
  });

  it('404 when child_id is not in the caller household', async () => {
    app = await buildTestApp(buildS3MockSupabase({ childRow: null }));
    const token = signAuthToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lunch-link/generate',
      headers: { authorization: `Bearer ${token}` },
      payload: { child_id: CHILD_ID, date: DATE },
    });

    expect(res.statusCode).toBe(404);
  });

  it('400 when child_id is not a UUID', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));
    const token = signAuthToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lunch-link/generate',
      headers: { authorization: `Bearer ${token}` },
      payload: { child_id: 'not-a-uuid', date: DATE },
    });

    expect(res.statusCode).toBe(400);
  });

  it('400 when date is missing', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));
    const token = signAuthToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lunch-link/generate',
      headers: { authorization: `Bearer ${token}` },
      payload: { child_id: CHILD_ID },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/lunch-link/:token (public)', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 with payload for a valid unexpired token, no auth header required', async () => {
    app = await buildTestApp(
      buildS3MockSupabase({ noteRow: sampleNoteRow({ content: 'hi' }) }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken()}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      childName: string;
      heartNote: { body: string; authorDisplayName: string } | null;
      expired: boolean;
    };
    expect(body.childName).toBe('Layla');
    expect(body.heartNote).toEqual({ body: 'hi', authorDisplayName: 'Parent' });
    expect(body.expired).toBe(false);
  });

  it('200 with heartNote: null when no note exists', async () => {
    app = await buildTestApp(buildS3MockSupabase({ noteRow: null }));

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken()}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { heartNote: unknown };
    expect(body.heartNote).toBeNull();
  });

  it('410 with last_state_snapshot when token is expired', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken({ exp: '2000-01-01T00:00:00.000Z' })}`,
    });

    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body) as {
      expired: boolean;
      last_state_snapshot: { rating: string | null; bag: { name: string } };
    };
    expect(body.expired).toBe(true);
    expect(body.last_state_snapshot.bag.name).toBeDefined();
  });

  it('410 snapshot includes rating when the session has a rating', async () => {
    app = await buildTestApp(
      buildS3MockSupabase({ session: sampleSessionRow({ rating: 'loved' }) }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken({ exp: '2000-01-01T00:00:00.000Z' })}`,
    });

    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body) as {
      last_state_snapshot: { rating: string | null };
    };
    expect(body.last_state_snapshot.rating).toBe('loved');
  });

  it('404 for a malformed token', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'GET',
      url: '/v1/lunch-link/garbage-no-dot',
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 for a token signed with the wrong HMAC key', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken({ hmacKey: 'b'.repeat(64) })}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 for a suppressed session', async () => {
    app = await buildTestApp(
      buildS3MockSupabase({
        session: sampleSessionRow({ suppressed_at: '2026-05-17T08:00:00.000Z' }),
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken()}`,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /v1/lunch-link/:token/rate (public)', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('204 for valid unexpired token with rating:loved (no auth header required)', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/rate`,
      payload: { rating: 'loved' },
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('204 for rating:ok', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/rate`,
      payload: { rating: 'ok' },
    });

    expect(res.statusCode).toBe(204);
  });

  it('204 for rating:not-really', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/rate`,
      payload: { rating: 'not-really' },
    });

    expect(res.statusCode).toBe(204);
  });

  it('404 for malformed token', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lunch-link/garbage-no-dot/rate',
      payload: { rating: 'loved' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 for valid-format but wrong-HMAC token', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken({ hmacKey: 'b'.repeat(64) })}/rate`,
      payload: { rating: 'loved' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 for expired token (past exp)', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken({ exp: '2000-01-01T00:00:00.000Z' })}/rate`,
      payload: { rating: 'loved' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 for suppressed session', async () => {
    app = await buildTestApp(
      buildS3MockSupabase({
        session: sampleSessionRow({ suppressed_at: '2026-05-17T08:00:00.000Z' }),
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/rate`,
      payload: { rating: 'loved' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 for invalid rating value (not in enum) — oracle prevention, never 400', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/rate`,
      payload: { rating: 'thumbs-up' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('does not require an Authorization header (no 401)', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/rate`,
      payload: { rating: 'loved' },
    });

    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it('writes audit event lunch_link.rated on success', async () => {
    const capturedAudit: { value: unknown } = { value: undefined };
    app = await buildTestApp(buildS3MockSupabase({}), 'development', capturedAudit);
    await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/rate`,
      payload: { rating: 'loved' },
    });
    expect(capturedAudit.value).toMatchObject({
      event_type: 'lunch_link.rated',
      household_id: HOUSEHOLD_ID,
      metadata: expect.objectContaining({ child_id: CHILD_ID, date: DATE, rating: 'loved' }),
    });
  });
});

describe('GET /v1/lunch-link/:token/passport (public)', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  function passportRow(overrides: Record<string, unknown> = {}) {
    return {
      recipe_id: '66666666-6666-4666-8666-666666666666',
      slot_kind: 'main',
      signal_type: 'loved',
      signal_date: '2026-05-10',
      recipes: { canonical_name: 'Tikka wrap', cuisine_tags: ['indian'], recipe_steps: [] },
      ...overrides,
    };
  }

  it('200 with a valid passport shape for a valid unexpired token', async () => {
    app = await buildTestApp(
      buildS3MockSupabase({ childPreferences: [passportRow()] }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken()}/passport`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      child_id: string;
      state: string;
      stamps: Array<{ recipe_name: string; signal_type: string }>;
    };
    expect(body.child_id).toBe(CHILD_ID);
    expect(body.state).toBe('developing');
    expect(body.stamps).toHaveLength(1);
    expect(body.stamps[0]?.recipe_name).toBe('Tikka wrap');
  });

  it('orders loved stamps before ok stamps (childFirst)', async () => {
    app = await buildTestApp(
      buildS3MockSupabase({
        childPreferences: [
          passportRow({
            recipe_id: '11111111-aaaa-4aaa-8aaa-111111111111',
            signal_type: 'ok',
            signal_date: '2026-05-20',
          }),
          passportRow({
            recipe_id: '22222222-aaaa-4aaa-8aaa-222222222222',
            signal_type: 'loved',
            signal_date: '2026-05-01',
          }),
        ],
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken()}/passport`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { stamps: Array<{ signal_type: string }> };
    expect(body.stamps.map((s) => s.signal_type)).toEqual(['loved', 'ok']);
  });

  it('does not require an Authorization header (no 401)', async () => {
    app = await buildTestApp(buildS3MockSupabase({ childPreferences: [] }));

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken()}/passport`,
    });

    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it('404 for a malformed token', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'GET',
      url: '/v1/lunch-link/garbage-no-dot/passport',
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 for a token signed with the wrong HMAC key', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken({ hmacKey: 'b'.repeat(64) })}/passport`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 for an expired token — no expiry detail leaked (oracle prevention)', async () => {
    app = await buildTestApp(buildS3MockSupabase({ childPreferences: [passportRow()] }));

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken({ exp: '2000-01-01T00:00:00.000Z' })}/passport`,
    });

    // Identical to invalid/suppressed — never 410, never an expiry message.
    expect(res.statusCode).toBe(404);
  });

  it('404 for a suppressed session', async () => {
    app = await buildTestApp(
      buildS3MockSupabase({
        session: sampleSessionRow({ suppressed_at: '2026-05-17T08:00:00.000Z' }),
        childPreferences: [passportRow()],
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken()}/passport`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('emits no audit context — passport reads are not link opens', async () => {
    const capturedAudit: { value: unknown } = { value: undefined };
    app = await buildTestApp(
      buildS3MockSupabase({ childPreferences: [passportRow()] }),
      'development',
      capturedAudit,
    );

    await app.inject({
      method: 'GET',
      url: `/v1/lunch-link/${forgeLunchToken()}/passport`,
    });

    expect(capturedAudit.value).toBeUndefined();
  });

  it('fires briefStateComposer.refreshTree with the Monday of the token date', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));
    const composer = (app as unknown as { briefStateComposer: { refreshTree: ReturnType<typeof vi.fn> } })
      .briefStateComposer;

    const res = await app.inject({
      method: 'POST',
      // DATE is 2026-05-17 (Sunday) → Monday of that week is 2026-05-11
      url: `/v1/lunch-link/${forgeLunchToken()}/rate`,
      payload: { rating: 'loved' },
    });

    expect(res.statusCode).toBe(204);
    expect(composer.refreshTree).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      '2026-05-11',
      expect.any(String),
    );
  });
});

describe('POST /v1/lunch-link/:token/child-request (public)', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('201 with { id } for a valid token + valid body', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/child-request`,
      payload: { request_text: 'I want pizza on Friday!' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string };
    expect(body.id).toBe('99999999-9999-4999-8999-999999999999');
    // Story 13-s2.5 — pushes child_request.received so the parent's Brief refetches.
    expect(vi.mocked(app.sseDispatcher.emit)).toHaveBeenCalledWith(
      expect.any(String),
      'message',
      expect.stringContaining('"type":"child_request.received"'),
    );
  });

  it('does not require an Authorization header (auth-exclusion regex covers it)', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/child-request`,
      payload: { request_text: 'hello' },
    });

    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it('404 for an invalid (malformed) token — oracle prevention', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/lunch-link/garbage-no-dot/child-request',
      payload: { request_text: 'hello' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 for a token signed with the wrong HMAC key', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken({ hmacKey: 'b'.repeat(64) })}/child-request`,
      payload: { request_text: 'hello' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('404 for an expired token — no expiry detail leaked', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken({ exp: '2000-01-01T00:00:00.000Z' })}/child-request`,
      payload: { request_text: 'hello' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('409 when a request already exists for the session (UNIQUE on session_id)', async () => {
    app = await buildTestApp(
      buildS3MockSupabase({
        childRequestInsert: { data: null, error: { code: '23505', message: 'duplicate key' } },
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/child-request`,
      payload: { request_text: 'second request' },
    });

    expect(res.statusCode).toBe(409);
  });

  // The slice doc says 422 for over-length text, but this codebase returns 400
  // for ALL Zod body-validation failures (ValidationError.status=400; app.ts maps
  // ZodError → 400). 422 is reserved for semantic domain errors (guardrail, cap).
  it('400 when request_text exceeds 200 chars (schema body validation)', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/child-request`,
      payload: { request_text: 'x'.repeat(201) },
    });

    expect(res.statusCode).toBe(400);
  });

  it('400 when request_text is empty', async () => {
    app = await buildTestApp(buildS3MockSupabase({}));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/child-request`,
      payload: { request_text: '' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('404 for a suppressed session (suppressed_at set) — oracle prevention', async () => {
    app = await buildTestApp(
      buildS3MockSupabase({
        session: sampleSessionRow({ suppressed_at: '2026-05-17T08:00:00.000Z' }),
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lunch-link/${forgeLunchToken()}/child-request`,
      payload: { request_text: 'hello' },
    });

    expect(res.statusCode).toBe(404);
  });
});
