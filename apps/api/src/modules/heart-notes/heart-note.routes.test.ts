import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { householdScopeHook } from '../../middleware/household-scope.hook.js';
import { isDomainError } from '../../common/errors.js';
import { heartNoteRoutes } from './heart-note.routes.js';
import type { HeartNoteRow } from './heart-note.repository.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const NOTE_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_HOUSEHOLD_ID = '55555555-5555-4555-8555-555555555555';
const JWT_SECRET = 'a'.repeat(32);

function sampleRow(overrides: Partial<HeartNoteRow> = {}): HeartNoteRow {
  return {
    id: NOTE_ID,
    household_id: HOUSEHOLD_ID,
    child_id: CHILD_ID,
    author_user_id: USER_ID,
    content: '',
    status: 'draft',
    scheduled_for: null,
    created_at: '2026-05-15T12:00:00.000Z',
    updated_at: '2026-05-15T12:00:00.000Z',
    ...overrides,
  };
}

interface MockOpts {
  insertResult?: HeartNoteRow;
  insertError?: unknown;
  findResult?: HeartNoteRow | null;
  findError?: unknown;
  patchResult?: HeartNoteRow | null;
  patchError?: unknown;
  // childExists: true = child belongs to the caller's household (default).
  // Set false to simulate a cross-household child_id rejection.
  childExists?: boolean;
}

function buildMockSupabase(opts: MockOpts) {
  const childExists = opts.childExists ?? true;
  return {
    from(table: string) {
      if (table === 'children') {
        // childBelongsToHousehold: SELECT id … .eq(id).eq(household_id).maybeSingle()
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: childExists ? { id: CHILD_ID } : null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'heart_notes') {
        return {
          insert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({
                data: opts.insertResult ?? null,
                error: opts.insertError ?? null,
              }),
            }),
          }),
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lt: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: opts.findResult ?? null,
                          error: opts.findError ?? null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: opts.patchResult ?? null,
                    error: opts.patchError ?? null,
                  }),
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

  await app.register(heartNoteRoutes);
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

describe('POST /v1/heart-notes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('201 with note payload on valid create', async () => {
    app = await buildTestApp(buildMockSupabase({ insertResult: sampleRow() }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/heart-notes',
      headers: { authorization: `Bearer ${token}` },
      payload: { child_id: CHILD_ID, content: 'hi' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { note: HeartNoteRow };
    expect(body.note.id).toBe(NOTE_ID);
    expect(body.note.status).toBe('draft');
  });

  it('404 when child_id does not belong to the caller household', async () => {
    app = await buildTestApp(buildMockSupabase({ insertResult: sampleRow(), childExists: false }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/heart-notes',
      headers: { authorization: `Bearer ${token}` },
      payload: { child_id: CHILD_ID, content: 'hi' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/not-found');
  });

  it('400 on invalid body (non-uuid child_id)', async () => {
    app = await buildTestApp(buildMockSupabase({ insertResult: sampleRow() }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/heart-notes',
      headers: { authorization: `Bearer ${token}` },
      payload: { child_id: 'not-a-uuid' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp(buildMockSupabase({ insertResult: sampleRow() }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/heart-notes',
      payload: { child_id: CHILD_ID },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/heart-notes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 { note } when draft exists', async () => {
    app = await buildTestApp(buildMockSupabase({ findResult: sampleRow({ content: 'saved' }) }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/heart-notes?child_id=${CHILD_ID}&date=2026-05-15`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { note: HeartNoteRow | null };
    expect(body.note?.content).toBe('saved');
  });

  it('200 { note: null } when no draft exists', async () => {
    app = await buildTestApp(buildMockSupabase({ findResult: null }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/heart-notes?child_id=${CHILD_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { note: HeartNoteRow | null };
    expect(body.note).toBeNull();
  });

  it('400 when child_id missing from query', async () => {
    app = await buildTestApp(buildMockSupabase({ findResult: null }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/heart-notes',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp(buildMockSupabase({ findResult: null }));

    const res = await app.inject({
      method: 'GET',
      url: `/v1/heart-notes?child_id=${CHILD_ID}`,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /v1/heart-notes/:id', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 with updated note on success', async () => {
    app = await buildTestApp(
      buildMockSupabase({ patchResult: sampleRow({ content: 'edited' }) }),
    );
    const token = signToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/heart-notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'edited' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { note: HeartNoteRow };
    expect(body.note.content).toBe('edited');
  });

  it('404 when note does not belong to caller household (repo returns null)', async () => {
    app = await buildTestApp(buildMockSupabase({ patchResult: null }));
    const token = signToken(app, { hh: OTHER_HOUSEHOLD_ID });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/heart-notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'edited' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/not-found');
  });

  it('400 on invalid id param (non-uuid)', async () => {
    app = await buildTestApp(buildMockSupabase({ patchResult: sampleRow() }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/heart-notes/not-a-uuid',
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'edited' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp(buildMockSupabase({ patchResult: sampleRow() }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/heart-notes/${NOTE_ID}`,
      payload: { content: 'edited' },
    });

    expect(res.statusCode).toBe(401);
  });
});
