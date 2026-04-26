import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { householdScopeHook } from '../../middleware/household-scope.hook.js';
import { isDomainError } from '../../common/errors.js';
import { userRoutes } from './user.routes.js';
import type { UserProfileRow } from './user.repository.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const JWT_SECRET = 'a'.repeat(32);
const WEB_BASE_URL = 'http://localhost:5173';

interface MockOpts {
  findUserResult?: UserProfileRow | null;
  findUserError?: unknown;
  updateUserResult?: UserProfileRow;
  updateUserError?: unknown;
  adminGetUserIdentities?: Array<{ provider: string }> | null;
  adminUpdateUserError?: { code?: string; message?: string } | null;
  resetPasswordError?: unknown;
}

interface AuthAdminMock {
  getUserById: ReturnType<typeof vi.fn>;
  updateUserById: ReturnType<typeof vi.fn>;
}

interface AuthMock {
  admin: AuthAdminMock;
  resetPasswordForEmail: ReturnType<typeof vi.fn>;
}

interface SupabaseMock {
  from(table: string): unknown;
  auth: AuthMock;
  _updateProfileSpy: ReturnType<typeof vi.fn>;
}

function defaultUserRow(overrides: Partial<UserProfileRow> = {}): UserProfileRow {
  return {
    id: SAMPLE_USER_ID,
    email: 'parent@example.com',
    display_name: 'Sample Parent',
    preferred_language: 'en',
    role: 'primary_parent',
    ...overrides,
  };
}

function buildMockSupabase(opts: MockOpts): SupabaseMock {
  const findUserResult = opts.findUserResult === undefined ? defaultUserRow() : opts.findUserResult;
  const updateUserResult = opts.updateUserResult ?? defaultUserRow();
  const identities = opts.adminGetUserIdentities ?? [{ provider: 'email' }];
  const updateError = opts.adminUpdateUserError === undefined ? null : opts.adminUpdateUserError;

  const updateProfileSpy = vi.fn().mockResolvedValue({
    data: opts.updateUserError ? null : updateUserResult,
    error: opts.updateUserError ?? null,
  });

  return {
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: findUserResult,
                error: opts.findUserError ?? null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: updateProfileSpy,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { id: SAMPLE_USER_ID, identities } },
          error: null,
        }),
        updateUserById: vi.fn().mockResolvedValue({ error: updateError }),
      },
      resetPasswordForEmail: vi.fn().mockImplementation(async () => {
        if (opts.resetPasswordError) throw opts.resetPasswordError;
        return { data: {}, error: null };
      }),
    },
    _updateProfileSpy: updateProfileSpy,
  };
}

async function buildTestApp(supabaseMock: SupabaseMock): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET, WEB_BASE_URL };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', supabaseMock as unknown as FastifyInstance['supabase']);

  await app.register(jwt, { secret: JWT_SECRET, sign: { expiresIn: '15m' } });
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

  await app.register(userRoutes);
  await app.ready();
  return app;
}

function signAccessToken(app: FastifyInstance): string {
  return app.jwt.sign({
    sub: SAMPLE_USER_ID,
    hh: SAMPLE_HOUSEHOLD_ID,
    role: 'primary_parent',
  });
}

describe('GET /v1/users/me', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('authenticated → 200 with auth_providers including email', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      id: string;
      email: string;
      auth_providers: string[];
      role: string;
    };
    expect(body.id).toBe(SAMPLE_USER_ID);
    expect(body.email).toBe('parent@example.com');
    expect(body.role).toBe('primary_parent');
    expect(body.auth_providers).toEqual(['email']);
  });

  it('unauthenticated → 401', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({ method: 'GET', url: '/v1/users/me' });

    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /v1/users/me', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('updates display_name → 200 with updated field', async () => {
    const supabaseMock = buildMockSupabase({
      updateUserResult: defaultUserRow({ display_name: 'New Name' }),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { display_name: 'New Name' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { display_name: string };
    expect(body.display_name).toBe('New Name');
    expect(supabaseMock.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('updates email (success) → 200, supabase admin updateUserById called', async () => {
    const supabaseMock = buildMockSupabase({
      updateUserResult: defaultUserRow({ email: 'new@example.com' }),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'new@example.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(supabaseMock.auth.admin.updateUserById).toHaveBeenCalledWith(SAMPLE_USER_ID, {
      email: 'new@example.com',
    });
    const body = JSON.parse(res.body) as { email: string };
    expect(body.email).toBe('new@example.com');
  });

  it('duplicate email → 409 ConflictError, DB update not attempted', async () => {
    const supabaseMock = buildMockSupabase({
      adminUpdateUserError: { code: 'email_exists', message: 'A user with this email address has already been registered' },
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'taken@example.com' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/conflict');
    expect(supabaseMock._updateProfileSpy).not.toHaveBeenCalled();
  });

  it('empty body (no fields) → 400 ValidationError', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });

  it('DB write fails after auth email update → 500 and compensating rollback attempted', async () => {
    const supabaseMock = buildMockSupabase({
      updateUserError: new Error('DB connection lost'),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'new@example.com' },
    });

    expect(res.statusCode).toBe(500);
    // First call: update to new email; second call: rollback to original email
    expect(supabaseMock.auth.admin.updateUserById).toHaveBeenCalledTimes(2);
    expect(supabaseMock.auth.admin.updateUserById).toHaveBeenNthCalledWith(2, SAMPLE_USER_ID, {
      email: 'parent@example.com',
    });
  });
});

describe('POST /v1/auth/password-reset', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('valid email → 204', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset',
      payload: { email: 'parent@example.com' },
    });

    expect(res.statusCode).toBe(204);
    expect(supabaseMock.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'parent@example.com',
      { redirectTo: `${WEB_BASE_URL}/auth/reset-password` },
    );
  });

  it('invalid email format → 400', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset',
      payload: { email: 'not-an-email' },
    });

    expect(res.statusCode).toBe(400);
    expect(supabaseMock.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
