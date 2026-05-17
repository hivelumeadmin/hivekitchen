import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { householdScopeHook } from '../../middleware/household-scope.hook.js';
import { isDomainError } from '../../common/errors.js';
import { lunchLinkRoutes } from './lunch-link.routes.js';
import type { HeartNoteRow } from '../heart-notes/heart-note.repository.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const NOTE_ID = '44444444-4444-4444-8444-444444444444';
const DATE = '2026-05-17';
const JWT_SECRET = 'a'.repeat(32);

function sampleNoteRow(overrides: Partial<HeartNoteRow> = {}): HeartNoteRow {
  return {
    id: NOTE_ID,
    household_id: HOUSEHOLD_ID,
    child_id: CHILD_ID,
    author_user_id: USER_ID,
    content: 'A warm note.',
    status: 'draft',
    scheduled_for: null,
    created_at: '2026-05-17T12:00:00.000Z',
    updated_at: '2026-05-17T12:00:00.000Z',
    ...overrides,
  };
}

interface MockOpts {
  // childRow: { id, name } when the child belongs to the caller's household,
  // null to simulate cross-household / not-found.
  childRow?: { id: string; name: string } | null;
  // findResult: heart note for that (child, date) or null when no draft exists.
  findResult?: HeartNoteRow | null;
}

function buildMockSupabase(opts: MockOpts) {
  const childRow = opts.childRow === undefined ? { id: CHILD_ID, name: 'Layla' } : opts.childRow;
  return {
    from(table: string) {
      if (table === 'children') {
        // LunchLinkRepository.findChildName: SELECT id, name … .eq(id).eq(household_id).maybeSingle()
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

async function buildTestApp(
  supabaseMock: ReturnType<typeof buildMockSupabase>,
  nodeEnv: 'development' | 'staging' | 'production' | 'test' = 'development',
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: nodeEnv, JWT_SECRET };
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
    role: overrides.role ?? 'primary_parent',
  });
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
    const token = signToken(app);

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
    expect(body.date).toBe(DATE);
    expect(body.heartNote).toEqual({ body: 'hello', authorDisplayName: 'Parent' });
    expect(body.bag.name).toBe('Sandwich, apple & water');
  });

  it('200 with heartNote: null when child exists but no note for that date', async () => {
    app = await buildTestApp(buildMockSupabase({ findResult: null }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link-dev/${CHILD_ID}/${DATE}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      childName: string;
      heartNote: unknown;
    };
    expect(body.childName).toBe('Layla');
    expect(body.heartNote).toBeNull();
  });

  it('404 when childId is not in the caller household', async () => {
    app = await buildTestApp(buildMockSupabase({ childRow: null }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link-dev/${CHILD_ID}/${DATE}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/not-found');
  });

  it('404 when NODE_ENV is production', async () => {
    app = await buildTestApp(buildMockSupabase({}), 'production');
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link-dev/${CHILD_ID}/${DATE}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/not-found');
  });

  it('404 when NODE_ENV is staging', async () => {
    app = await buildTestApp(buildMockSupabase({}), 'staging');
    const token = signToken(app);

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

  it('400 when childId param is not a UUID', async () => {
    app = await buildTestApp(buildMockSupabase({}));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link-dev/not-a-uuid/${DATE}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it('400 when date param is not a valid date string', async () => {
    app = await buildTestApp(buildMockSupabase({}));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lunch-link-dev/${CHILD_ID}/not-a-date`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});
