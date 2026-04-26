import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { householdScopeHook } from '../../middleware/household-scope.hook.js';
import { isDomainError } from '../../common/errors.js';
import { inviteRoutes } from './invite.routes.js';
import type { InviteRow } from './invite.repository.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HOUSEHOLD_ID = '33333333-3333-4333-8333-333333333333';
const SAMPLE_INVITE_ID = '44444444-4444-4444-8444-444444444444';
const JWT_SECRET = 'a'.repeat(32);

interface MockOpts {
  insertInviteResult?: InviteRow;
  insertInviteError?: unknown;
  findInviteResult?: InviteRow | null;
  findInviteError?: unknown;
  updateAffectedRows?: number;
  updateError?: unknown;
}

function buildMockSupabase(opts: MockOpts) {
  const updateData = (opts.updateAffectedRows ?? 1) > 0 ? [{ id: SAMPLE_INVITE_ID }] : [];

  return {
    from(table: string) {
      if (table === 'invites') {
        return {
          insert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({
                data: opts.insertInviteResult ?? null,
                error: opts.insertInviteError ?? null,
              }),
            }),
          }),
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: opts.findInviteResult ?? null,
                error: opts.findInviteError ?? null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              is: () => ({
                is: () => ({
                  select: vi
                    .fn()
                    .mockResolvedValue({ data: updateData, error: opts.updateError ?? null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'audit_log') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

async function buildTestApp(supabaseMock: ReturnType<typeof buildMockSupabase>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', supabaseMock as unknown as FastifyInstance['supabase']);

  await app.register(cookie, { secret: env.JWT_SECRET });
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

  await app.register(inviteRoutes);
  await app.ready();
  return app;
}

function signAccessToken(
  app: FastifyInstance,
  overrides: Partial<{
    sub: string;
    hh: string;
    role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
  }> = {},
): string {
  return app.jwt.sign({
    sub: overrides.sub ?? SAMPLE_USER_ID,
    hh: overrides.hh ?? SAMPLE_HOUSEHOLD_ID,
    role: overrides.role ?? 'primary_parent',
  });
}

// Manually craft an HS256 JWT so we can set `exp` directly in the payload (the
// @fastify/jwt sign() path forbids combining payload.exp with the default
// expiresIn option set on the plugin registration).
function craftInviteJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function encodeInviteToken(rawJwt: string): string {
  return Buffer.from(rawJwt, 'utf8').toString('base64url');
}

function activeInviteRow(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: SAMPLE_INVITE_ID,
    household_id: SAMPLE_HOUSEHOLD_ID,
    role: 'secondary_caregiver',
    invited_by_user_id: SAMPLE_USER_ID,
    invited_email: null,
    expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    redeemed_at: null,
    revoked_at: null,
    ...overrides,
  };
}

describe('POST /v1/households/:id/invites', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path: returns 201 with invite_url path', async () => {
    const supabaseMock = buildMockSupabase({ insertInviteResult: activeInviteRow() });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/invites`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'secondary_caregiver', email: 'partner@example.com' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { invite_url: string };
    expect(body.invite_url.startsWith('/invite/')).toBe(true);
    expect(body.invite_url.length).toBeGreaterThan('/invite/'.length);
  });

  it('mismatched :id (not the user’s household) → 403', async () => {
    const supabaseMock = buildMockSupabase({ insertInviteResult: activeInviteRow() });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app); // hh = SAMPLE_HOUSEHOLD_ID

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/invites`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'secondary_caregiver' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/forbidden');
  });

  it('non-primary_parent role → 403 (authorize preHandler rejects)', async () => {
    const supabaseMock = buildMockSupabase({ insertInviteResult: activeInviteRow() });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app, { role: 'secondary_caregiver' });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/invites`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'secondary_caregiver' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/forbidden');
  });
});

describe('POST /v1/auth/invites/redeem', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('valid token → 200 with role + scope_target + household_id', async () => {
    const supabaseMock = buildMockSupabase({
      findInviteResult: activeInviteRow(),
      updateAffectedRows: 1,
    });
    app = await buildTestApp(supabaseMock);

    const futureExp = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;
    const rawJwt = craftInviteJwt({
      household_id: SAMPLE_HOUSEHOLD_ID,
      role: 'secondary_caregiver',
      invite_id: SAMPLE_INVITE_ID,
      jti: SAMPLE_INVITE_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: futureExp,
    });
    const token = encodeInviteToken(rawJwt);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/invites/redeem',
      payload: { token },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      role: string;
      scope_target: string;
      household_id: string;
    };
    expect(body.role).toBe('secondary_caregiver');
    expect(body.scope_target).toBe('/app/household/settings');
    expect(body.household_id).toBe(SAMPLE_HOUSEHOLD_ID);
  });

  it('expired JWT → 410 link-expired', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);

    const pastExp = Math.floor(Date.now() / 1000) - 60;
    const rawJwt = craftInviteJwt({
      household_id: SAMPLE_HOUSEHOLD_ID,
      role: 'secondary_caregiver',
      invite_id: SAMPLE_INVITE_ID,
      jti: SAMPLE_INVITE_ID,
      iat: pastExp - 10,
      exp: pastExp,
    });
    const token = encodeInviteToken(rawJwt);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/invites/redeem',
      payload: { token },
    });

    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/link-expired');
  });

  it('already-redeemed jti (concurrent race) → 410 link-expired', async () => {
    const supabaseMock = buildMockSupabase({
      findInviteResult: activeInviteRow(),
      updateAffectedRows: 0, // markRedeemed sees 0 rows updated → already-redeemed
    });
    app = await buildTestApp(supabaseMock);

    const futureExp = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;
    const rawJwt = craftInviteJwt({
      household_id: SAMPLE_HOUSEHOLD_ID,
      role: 'secondary_caregiver',
      invite_id: SAMPLE_INVITE_ID,
      jti: SAMPLE_INVITE_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: futureExp,
    });
    const token = encodeInviteToken(rawJwt);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/invites/redeem',
      payload: { token },
    });

    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/link-expired');
  });

  it('revoked invite → 410 link-expired', async () => {
    const supabaseMock = buildMockSupabase({
      findInviteResult: activeInviteRow({ revoked_at: new Date().toISOString() }),
    });
    app = await buildTestApp(supabaseMock);

    const futureExp = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;
    const rawJwt = craftInviteJwt({
      household_id: SAMPLE_HOUSEHOLD_ID,
      role: 'secondary_caregiver',
      invite_id: SAMPLE_INVITE_ID,
      jti: SAMPLE_INVITE_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: futureExp,
    });
    const token = encodeInviteToken(rawJwt);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/invites/redeem',
      payload: { token },
    });

    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/link-expired');
  });

  it('jti not in DB (row not found) → 410 link-expired', async () => {
    const supabaseMock = buildMockSupabase({ findInviteResult: null });
    app = await buildTestApp(supabaseMock);

    const futureExp = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;
    const rawJwt = craftInviteJwt({
      household_id: SAMPLE_HOUSEHOLD_ID,
      role: 'secondary_caregiver',
      invite_id: SAMPLE_INVITE_ID,
      jti: SAMPLE_INVITE_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: futureExp,
    });
    const token = encodeInviteToken(rawJwt);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/invites/redeem',
      payload: { token },
    });

    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/link-expired');
  });
});
