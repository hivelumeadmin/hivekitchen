import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authRoutes } from './auth.routes.js';
import { isDomainError } from '../../common/errors.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_REFRESH_ID = '33333333-3333-4333-8333-333333333333';

interface SupabaseAuthMock {
  signInWithPassword: ReturnType<typeof vi.fn>;
  exchangeCodeForSession: ReturnType<typeof vi.fn>;
  getUser?: ReturnType<typeof vi.fn>;
  admin?: {
    signOut?: ReturnType<typeof vi.fn>;
    updateUserById?: ReturnType<typeof vi.fn>;
  };
}

function buildMockSupabase(opts: {
  auth: SupabaseAuthMock;
  rpcResult: unknown;
  rpcError?: unknown;
  selectResult: unknown;
  selectError?: unknown;
  insertResult?: unknown;
  insertError?: unknown;
  updateError?: unknown;
  refreshTokenLookupResult?: unknown;
  refreshTokenLookupError?: unknown;
}) {
  const updateResult = { data: null, error: opts.updateError ?? null };
  // consumeRefreshToken now uses .select('id') and expects an array of updated rows.
  const consumeSelectResult = { data: [{ id: 'consumed' }], error: opts.updateError ?? null };

  // Chain-aware result for `update().eq().is()`:
  //   - awaitable directly (revokeAllByFamilyId path: expects { data: null, error })
  //   - `.select().maybeSingle()` (markRefreshTokenRevoked path)
  //   - `.select()` awaitable as array (consumeRefreshToken path)
  const buildUpdateChain = () => {
    const selectThenable = Object.assign(Promise.resolve(consumeSelectResult), {
      maybeSingle: vi.fn().mockResolvedValue(updateResult),
    });
    const thenable: PromiseLike<typeof updateResult> & {
      select: () => typeof selectThenable;
    } = {
      then(resolve, reject) {
        return Promise.resolve(updateResult).then(resolve, reject);
      },
      select() {
        return selectThenable;
      },
    };
    return thenable;
  };

  // Chain for `select().eq().is().gt().maybeSingle()` — used by findRefreshTokenByHash.
  const buildLookupChain = () => ({
    is: () => ({
      gt: () => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.refreshTokenLookupResult ?? null,
          error: opts.refreshTokenLookupError ?? null,
        }),
      }),
    }),
  });

  return {
    auth: {
      signInWithPassword: opts.auth.signInWithPassword,
      exchangeCodeForSession: opts.auth.exchangeCodeForSession,
      getUser: opts.auth.getUser ?? vi.fn(),
      admin: {
        signOut: opts.auth.admin?.signOut ?? vi.fn().mockResolvedValue({ error: null }),
        updateUserById:
          opts.auth.admin?.updateUserById ?? vi.fn().mockResolvedValue({ error: null }),
      },
    },
    from(table: string) {
      if (table === 'users') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: opts.selectResult, error: opts.selectError ?? null }),
                };
              },
            };
          },
        };
      }
      if (table === 'refresh_tokens') {
        return {
          insert() {
            return {
              select() {
                return {
                  single: vi
                    .fn()
                    .mockResolvedValue({
                      data: opts.insertResult ?? { id: SAMPLE_REFRESH_ID },
                      error: opts.insertError ?? null,
                    }),
                };
              },
            };
          },
          select() {
            return {
              eq: () => buildLookupChain(),
            };
          },
          update() {
            return {
              eq() {
                return {
                  is: () => buildUpdateChain(),
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: vi.fn().mockResolvedValue({ data: opts.rpcResult, error: opts.rpcError ?? null }),
  };
}

async function buildTestApp(supabaseMock: ReturnType<typeof buildMockSupabase>): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    genReqId: () => randomUUID(),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET: 'a'.repeat(32) };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', supabaseMock as unknown as FastifyInstance['supabase']);

  await app.register(cookie, { secret: env.JWT_SECRET });
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: '15m' } });

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
    const zodIssues = extractZodIssues(err);
    if (zodIssues !== null) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        detail: zodIssues,
        instance: request.id,
      });
      return;
    }
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  await app.register(authRoutes);
  await app.ready();
  return app;
}

function extractZodIssues(err: unknown): string | null {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  }
  const obj = err as { cause?: unknown; validation?: unknown };
  if (obj.cause instanceof ZodError) {
    return obj.cause.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  }
  if (Array.isArray(obj.validation) && obj.validation.length > 0) {
    return (obj.validation as Array<{ message?: string }>).map((v) => v.message ?? 'invalid').join('; ');
  }
  return null;
}

describe('POST /v1/auth/login', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path: returns 200 + access_token + Set-Cookie with required attributes', async () => {
    const supabaseMock = buildMockSupabase({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            user: { id: SAMPLE_USER_ID, email: 'parent@example.com', user_metadata: { full_name: 'Parent' } },
          },
          error: null,
        }),
        exchangeCodeForSession: vi.fn(),
      },
      selectResult: {
        id: SAMPLE_USER_ID,
        email: 'parent@example.com',
        display_name: 'Parent',
        current_household_id: SAMPLE_HOUSEHOLD_ID,
        role: 'primary_parent',
      },
      rpcResult: null,
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'parent@example.com', password: 'verylongpassword' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { access_token: string; user: { id: string }; is_first_login: boolean };
    expect(typeof body.access_token).toBe('string');
    expect(body.user.id).toBe(SAMPLE_USER_ID);
    expect(body.is_first_login).toBe(false);

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] ?? '' : (setCookie ?? '');
    expect(cookieStr).toMatch(/refresh_token=[A-Za-z0-9_-]{43};/);
    expect(cookieStr).toMatch(/Max-Age=2592000/);
    expect(cookieStr).toMatch(/Path=\/v1\/auth\/refresh[;,\s]/);
    expect(cookieStr).toMatch(/HttpOnly/);
    expect(cookieStr).toMatch(/SameSite=Lax/);
  });

  it('schema-invalid (short password) → 400 Problem+JSON', async () => {
    const supabaseMock = buildMockSupabase({
      auth: { signInWithPassword: vi.fn(), exchangeCodeForSession: vi.fn() },
      selectResult: null,
      rpcResult: null,
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'parent@example.com', password: 'short' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });

  it('Supabase rejects → 401 Problem+JSON unauthorized', async () => {
    const supabaseMock = buildMockSupabase({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } }),
        exchangeCodeForSession: vi.fn(),
      },
      selectResult: null,
      rpcResult: null,
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'parent@example.com', password: 'wrongpassword12' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/unauthorized');
  });
});

describe('POST /v1/auth/callback', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path: 200 + cookie set', async () => {
    const supabaseMock = buildMockSupabase({
      auth: {
        signInWithPassword: vi.fn(),
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: { user: { id: SAMPLE_USER_ID, email: 'parent@example.com', user_metadata: {} } },
          error: null,
        }),
      },
      selectResult: {
        id: SAMPLE_USER_ID,
        email: 'parent@example.com',
        display_name: null,
        current_household_id: SAMPLE_HOUSEHOLD_ID,
        role: 'primary_parent',
      },
      rpcResult: null,
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/callback',
      payload: { provider: 'google', code: 'oauth-code' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { user: { id: string } };
    expect(body.user.id).toBe(SAMPLE_USER_ID);
  });

  it('bad code → 401', async () => {
    const supabaseMock = buildMockSupabase({
      auth: {
        signInWithPassword: vi.fn(),
        exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'bad' } }),
      },
      selectResult: null,
      rpcResult: null,
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/callback',
      payload: { provider: 'google', code: 'bad' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/auth/refresh', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path: rotates token, returns 200 + access_token + new Set-Cookie', async () => {
    const supabaseMock = buildMockSupabase({
      auth: { signInWithPassword: vi.fn(), exchangeCodeForSession: vi.fn() },
      selectResult: {
        id: SAMPLE_USER_ID,
        email: 'parent@example.com',
        display_name: 'Parent',
        current_household_id: SAMPLE_HOUSEHOLD_ID,
        role: 'primary_parent',
      },
      rpcResult: null,
      refreshTokenLookupResult: {
        id: 'old-rt',
        user_id: SAMPLE_USER_ID,
        family_id: 'fam-1',
        replaced_by: null,
      },
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: 'plaintext-old-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { access_token: string; expires_in: number };
    expect(typeof body.access_token).toBe('string');
    expect(body.access_token.length).toBeGreaterThan(0);
    expect(body.expires_in).toBe(15 * 60);

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] ?? '' : (setCookie ?? '');
    expect(cookieStr).toMatch(/refresh_token=[A-Za-z0-9_-]{43};/);
    expect(cookieStr).toMatch(/Path=\/v1\/auth\/refresh[;,\s]/);
    expect(cookieStr).toMatch(/HttpOnly/);
  });

  it('missing refresh cookie → 401 unauthorized', async () => {
    const supabaseMock = buildMockSupabase({
      auth: { signInWithPassword: vi.fn(), exchangeCodeForSession: vi.fn() },
      selectResult: null,
      rpcResult: null,
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({ method: 'POST', url: '/v1/auth/refresh' });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/unauthorized');
  });

  it('reused token (replaced_by set) → 401 + signOut called', async () => {
    const adminSignOut = vi.fn().mockResolvedValue({ error: null });
    const supabaseMock = buildMockSupabase({
      auth: {
        signInWithPassword: vi.fn(),
        exchangeCodeForSession: vi.fn(),
        admin: { signOut: adminSignOut },
      },
      selectResult: null,
      rpcResult: null,
      refreshTokenLookupResult: {
        id: 'reused-rt',
        user_id: SAMPLE_USER_ID,
        family_id: 'fam-1',
        replaced_by: 'replacement-rt',
      },
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: 'plaintext-reused' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/unauthorized');
    expect(adminSignOut).toHaveBeenCalledWith(SAMPLE_USER_ID, 'global');
  });
});

describe('POST /v1/auth/logout', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 204 + clears the refresh cookie', async () => {
    const supabaseMock = buildMockSupabase({
      auth: { signInWithPassword: vi.fn(), exchangeCodeForSession: vi.fn() },
      selectResult: null,
      rpcResult: null,
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      cookies: { refresh_token: 'some-plaintext-token' },
    });

    expect(res.statusCode).toBe(204);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] ?? '' : (setCookie ?? '');
    expect(cookieStr).toMatch(/refresh_token=;/);
    expect(cookieStr).toMatch(/Max-Age=0/);
  });
});

describe('POST /v1/auth/password-reset-complete', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path: 200 + session body + cookie set + password updated', async () => {
    const updateUserById = vi.fn().mockResolvedValue({ error: null });
    const supabaseMock = buildMockSupabase({
      auth: {
        signInWithPassword: vi.fn(),
        exchangeCodeForSession: vi.fn(),
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: SAMPLE_USER_ID, email: 'parent@example.com', user_metadata: { full_name: 'Parent' } },
          },
          error: null,
        }),
        admin: { updateUserById },
      },
      selectResult: {
        id: SAMPLE_USER_ID,
        email: 'parent@example.com',
        display_name: 'Parent',
        current_household_id: SAMPLE_HOUSEHOLD_ID,
        role: 'primary_parent',
      },
      rpcResult: null,
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset-complete',
      payload: { token: 'recovery-token-hash', password: 'a-strong-password-12' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { access_token: string; user: { id: string }; is_first_login: boolean };
    expect(typeof body.access_token).toBe('string');
    expect(body.user.id).toBe(SAMPLE_USER_ID);
    expect(updateUserById).toHaveBeenCalledWith(SAMPLE_USER_ID, { password: 'a-strong-password-12' });

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] ?? '' : (setCookie ?? '');
    expect(cookieStr).toMatch(/refresh_token=[A-Za-z0-9_-]{43};/);
    expect(cookieStr).toMatch(/Path=\/v1\/auth\/refresh[;,\s]/);
    expect(cookieStr).toMatch(/HttpOnly/);
  });

  it('expired/invalid token (Supabase returns error) → 410 LinkExpiredError', async () => {
    const updateUserById = vi.fn();
    const supabaseMock = buildMockSupabase({
      auth: {
        signInWithPassword: vi.fn(),
        exchangeCodeForSession: vi.fn(),
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'Token expired or invalid' },
        }),
        admin: { updateUserById },
      },
      selectResult: null,
      rpcResult: null,
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset-complete',
      payload: { token: 'expired-token', password: 'a-strong-password-12' },
    });

    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/link-expired');
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('password shorter than 12 chars → 400 validation', async () => {
    const supabaseMock = buildMockSupabase({
      auth: {
        signInWithPassword: vi.fn(),
        exchangeCodeForSession: vi.fn(),
      },
      selectResult: null,
      rpcResult: null,
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset-complete',
      payload: { token: 'recovery-token-hash', password: 'short' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });

  it('missing token field → 400 validation', async () => {
    const supabaseMock = buildMockSupabase({
      auth: {
        signInWithPassword: vi.fn(),
        exchangeCodeForSession: vi.fn(),
      },
      selectResult: null,
      rpcResult: null,
    });
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset-complete',
      payload: { password: 'a-strong-password-12' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });
});
