import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { GuestAuthorCapResponseSchema } from '@hivekitchen/contracts';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { householdScopeHook } from '../../middleware/household-scope.hook.js';
import { isDomainError } from '../../common/errors.js';
import { guestAuthorRoutes } from './guest-author.routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const JWT_SECRET = 'a'.repeat(32);

interface MockOpts {
  // undefined → default child; null → no child in household (404 path).
  child?: { id: string; name: string } | null;
  displayName?: string | null;
  notesCount?: number;
}

function buildMockSupabase(opts: MockOpts) {
  const child = opts.child === undefined ? { id: CHILD_ID, name: 'Ayaan' } : opts.child;
  return {
    from(table: string) {
      if (table === 'children') {
        return { select: () => childrenChain(child) };
      }
      if (table === 'users') {
        return { select: () => usersChain(opts.displayName ?? null) };
      }
      if (table === 'heart_notes') {
        return { select: () => heartNotesCountChain(opts.notesCount ?? 0) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

// children: .eq().order().limit().maybeSingle()
function childrenChain(child: { id: string; name: string } | null) {
  const chain = {
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: vi.fn().mockResolvedValue({ data: child, error: null }),
  };
  return chain;
}

// users: .eq().maybeSingle()
function usersChain(displayName: string | null) {
  const chain = {
    eq: () => chain,
    maybeSingle: vi.fn().mockResolvedValue({
      data: displayName === null ? null : { display_name: displayName },
      error: null,
    }),
  };
  return chain;
}

// heart_notes count: .eq().eq().neq().gte().lt() awaited (head:true)
function heartNotesCountChain(count: number) {
  const chain = {
    eq: () => chain,
    neq: () => chain,
    gte: () => chain,
    lt: () => chain,
    then: (resolve: (value: { data: null; count: number; error: null }) => void) =>
      resolve({ data: null, count, error: null }),
  };
  return chain;
}

async function buildTestApp(
  supabaseMock: ReturnType<typeof buildMockSupabase>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET };
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
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  await app.register(guestAuthorRoutes);
  await app.ready();
  return app;
}

type Role = 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';

function signToken(
  app: FastifyInstance,
  overrides: Partial<{ sub: string; hh: string; role: Role }> = {},
): string {
  return app.jwt.sign({
    sub: overrides.sub ?? USER_ID,
    hh: overrides.hh ?? HOUSEHOLD_ID,
    role: overrides.role ?? 'guest_author',
  });
}

describe('GET /v1/guest-author/cap', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp(buildMockSupabase({}));

    const res = await app.inject({ method: 'GET', url: '/v1/guest-author/cap' });

    expect(res.statusCode).toBe(401);
  });

  it('403 for a primary_parent (guest_author-only route)', async () => {
    app = await buildTestApp(buildMockSupabase({}));
    const token = signToken(app, { role: 'primary_parent' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/guest-author/cap',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('404 when the household has no children', async () => {
    app = await buildTestApp(buildMockSupabase({ child: null }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/guest-author/cap',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/not-found');
  });

  it('200 with a valid GuestAuthorCapResponse shape', async () => {
    app = await buildTestApp(
      buildMockSupabase({ displayName: 'Nani Ayaan', notesCount: 1 }),
    );
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/guest-author/cap',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const parsed = GuestAuthorCapResponseSchema.parse(JSON.parse(res.body));
    expect(parsed.child_id).toBe(CHILD_ID);
    expect(parsed.child_name).toBe('Ayaan');
    expect(parsed.cap).toBe(2);
  });

  it('notes_used reflects the count from the repository', async () => {
    app = await buildTestApp(buildMockSupabase({ notesCount: 2 }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/guest-author/cap',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(res.body) as { notes_used: number };
    expect(body.notes_used).toBe(2);
  });

  it('grandparent_term detects "Nani" from display_name "Nani Ayaan" (case preserved)', async () => {
    app = await buildTestApp(buildMockSupabase({ displayName: 'Nani Ayaan' }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/guest-author/cap',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(res.body) as { grandparent_term: string | null };
    expect(body.grandparent_term).toBe('Nani');
  });

  it('grandparent_term is null for a non-family display_name', async () => {
    app = await buildTestApp(buildMockSupabase({ displayName: 'Mary Smith' }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/guest-author/cap',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(res.body) as { grandparent_term: string | null };
    expect(body.grandparent_term).toBeNull();
  });

  it('next_month_opens is always a weekday (Mon–Fri)', async () => {
    app = await buildTestApp(buildMockSupabase({}));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/guest-author/cap',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(res.body) as { next_month_opens: string };
    const dow = new Date(`${body.next_month_opens}T00:00:00Z`).getUTCDay();
    expect(dow).toBeGreaterThanOrEqual(1);
    expect(dow).toBeLessThanOrEqual(5);
  });
});
