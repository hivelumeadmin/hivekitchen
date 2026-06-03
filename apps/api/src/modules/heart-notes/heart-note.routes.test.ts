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
import { heartNoteRoutes } from './heart-note.routes.js';
import type { HeartNoteRow } from './heart-note.repository.js';

function noop(plaintext: string): string {
  return encryptField(plaintext, null);
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const NOTE_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_HOUSEHOLD_ID = '55555555-5555-4555-8555-555555555555';
const JWT_SECRET = 'a'.repeat(32);

function sampleRow(overrides: Partial<HeartNoteRow> = {}): HeartNoteRow {
  // The repository now decrypts row.content on the way out — DB mocks must
  // return NOOP-encoded ciphertext so the routes' read paths can decrypt
  // back to plaintext. The override values below are pre-wrapped via noop().
  const base: HeartNoteRow = {
    id: NOTE_ID,
    household_id: HOUSEHOLD_ID,
    child_id: CHILD_ID,
    author_user_id: USER_ID,
    content: noop(''),
    status: 'draft',
    scheduled_for: null,
    // Slice 4-S6 — new nullable scheduling outcome columns.
    delivered_at: null,
    cancelled_at: null,
    created_at: '2026-05-15T12:00:00.000Z',
    updated_at: '2026-05-15T12:00:00.000Z',
  };
  const merged = { ...base, ...overrides };
  // If a test overrides content with a plaintext sentinel (no NOOP: prefix),
  // wrap it so the repository can decrypt successfully.
  if (overrides.content !== undefined && !merged.content.startsWith('NOOP:')) {
    merged.content = noop(overrides.content);
  }
  return merged;
}

interface MockOpts {
  insertResult?: HeartNoteRow;
  insertError?: unknown;
  // findResult — returned by findByChildAndDate / findForDelivery (3-eq chain
  // with order+limit), AND by findById (2-eq chain) when findByIdResult is
  // not supplied. Default is null.
  findResult?: HeartNoteRow | null;
  // findByIdResult — when set, this is what findById returns. Falls back to
  // findResult when undefined so existing tests keep working.
  findByIdResult?: HeartNoteRow | null;
  findError?: unknown;
  patchResult?: HeartNoteRow | null;
  patchError?: unknown;
  // listResult — returned by listByHousehold (no maybeSingle, awaited).
  listResult?: HeartNoteRow[];
  // countResult — returned by countAuthoredThisMonth (head:true, awaited).
  countResult?: number;
  // childExists: true = child belongs to the caller's household (default).
  // Set false to simulate a cross-household child_id rejection.
  childExists?: boolean;
}

function buildMockSupabase(opts: MockOpts) {
  const childExists = opts.childExists ?? true;
  return {
    from(table: string) {
      if (table === 'children') {
        return {
          select: () => buildChildrenChain(childExists),
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
          select: () => buildHeartNotesSelectChain(opts),
          update: () => buildHeartNotesUpdateChain(opts),
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

interface SelectChain {
  eq: (col: string, val: unknown) => SelectChain;
  neq: (col: string, val: unknown) => SelectChain;
  gte: (col: string, val: unknown) => SelectChain;
  lt: (col: string, val: unknown) => SelectChain;
  in: (col: string, vals: unknown[]) => SelectChain;
  order: (col: string, options: { ascending: boolean }) => SelectChain;
  limit: (n: number) => SelectChain;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  then: (resolve: (value: { data: unknown; count: number; error: unknown }) => void) => void;
}

// Flexible chain supporting:
//   .eq().eq().maybeSingle()                              (findById — 2 eq, no gte/lt)
//   .eq().eq().gte().lt().order().limit().maybeSingle()   (findByChildAndDate — 2 eq + gte/lt)
//   .eq().eq().eq().order().limit().maybeSingle()         (findForDelivery — 3 eq)
//   .eq().order().order().limit() (awaited)               (listByHousehold)
function buildHeartNotesSelectChain(opts: MockOpts): SelectChain {
  let gteCalled = false;
  const chain: SelectChain = {
    eq(_col: string, _val: unknown) {
      return chain;
    },
    neq(_col: string, _val: unknown) {
      return chain;
    },
    gte(_col: string, _val: unknown) {
      gteCalled = true;
      return chain;
    },
    lt(_col: string, _val: unknown) {
      return chain;
    },
    in(_col: string, _vals: unknown[]) {
      return chain;
    },
    order(_col: string, _options: { ascending: boolean }) {
      return chain;
    },
    limit(_n: number) {
      return chain;
    },
    maybeSingle: vi.fn().mockImplementation(async () => {
      // findByChildAndDate uses gte/lt (creation-date range); findById and
      // findForDelivery use only .eq() calls.
      // Default findByIdResult to patchResult so PATCH tests that only set
      // patchResult get a non-null pre-fetch result automatically.
      const isFindById = !gteCalled;
      const data = isFindById
        ? opts.findByIdResult !== undefined
          ? opts.findByIdResult
          : opts.patchResult !== undefined
            ? opts.patchResult
            : opts.findResult ?? null
        : opts.findResult ?? null;
      return { data, error: opts.findError ?? null };
    }),
    then(resolve: (value: { data: unknown; count: number; error: unknown }) => void) {
      // Awaited directly == listByHousehold (reads data) or
      // countAuthoredThisMonth (reads count, head:true).
      resolve({
        data: opts.listResult ?? [],
        count: opts.countResult ?? 0,
        error: opts.findError ?? null,
      });
    },
  };
  return chain;
}

interface UpdateChain {
  eq: (col: string, val: unknown) => UpdateChain;
  select: (cols: string) => {
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  };
}

function buildHeartNotesUpdateChain(opts: MockOpts): UpdateChain {
  const chain: UpdateChain = {
    eq(_col: string, _val: unknown) {
      return chain;
    },
    select(_cols: string) {
      return {
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.patchResult ?? null,
          error: opts.patchError ?? null,
        }),
      };
    },
  };
  return chain;
}

interface ChildrenChain {
  eq: (col: string, val: unknown) => ChildrenChain;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
}

function buildChildrenChain(childExists: boolean): ChildrenChain {
  const chain: ChildrenChain = {
    eq(_col: string, _val: unknown) {
      return chain;
    },
    maybeSingle: vi.fn().mockResolvedValue({
      data: childExists ? { id: CHILD_ID } : null,
      error: null,
    }),
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

  // Slice 4-S13 — guest_author monthly cap enforcement.
  it('201 — guest_author under cap (notesUsed=0) can compose', async () => {
    app = await buildTestApp(
      buildMockSupabase({ insertResult: sampleRow(), countResult: 0 }),
    );
    const token = signToken(app, { role: 'guest_author' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/heart-notes',
      headers: { authorization: `Bearer ${token}` },
      payload: { child_id: CHILD_ID, content: 'love you' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('422 GUEST_AUTHOR_CAP_REACHED — guest_author at cap (notesUsed=2), no schedule', async () => {
    app = await buildTestApp(
      buildMockSupabase({ insertResult: sampleRow(), countResult: 2 }),
    );
    const token = signToken(app, { role: 'guest_author' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/heart-notes',
      headers: { authorization: `Bearer ${token}` },
      payload: { child_id: CHILD_ID, content: 'one more' },
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/guest-author-cap-reached');
  });

  it('201 — guest_author at cap may still schedule for next month (cap bypass)', async () => {
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 10);
    app = await buildTestApp(
      buildMockSupabase({ insertResult: sampleRow({ scheduled_for: nextMonth }), countResult: 2 }),
    );
    const token = signToken(app, { role: 'guest_author' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/heart-notes',
      headers: { authorization: `Bearer ${token}` },
      payload: { child_id: CHILD_ID, content: '', scheduled_for: nextMonth },
    });

    expect(res.statusCode).toBe(201);
  });

  it('201 — primary_parent is never cap-checked (notesUsed irrelevant)', async () => {
    app = await buildTestApp(
      buildMockSupabase({ insertResult: sampleRow(), countResult: 99 }),
    );
    const token = signToken(app); // defaults to primary_parent

    const res = await app.inject({
      method: 'POST',
      url: '/v1/heart-notes',
      headers: { authorization: `Bearer ${token}` },
      payload: { child_id: CHILD_ID, content: 'unbounded' },
    });

    expect(res.statusCode).toBe(201);
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

  it('200 — transitions draft → scheduled when scheduled_for is set', async () => {
    const existing = sampleRow({ status: 'draft' });
    const updated = sampleRow({ status: 'scheduled', scheduled_for: '2026-05-30' });
    app = await buildTestApp(
      buildMockSupabase({ findByIdResult: existing, patchResult: updated }),
    );
    const token = signToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/heart-notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { scheduled_for: '2026-05-30' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { note: HeartNoteRow };
    expect(body.note.status).toBe('scheduled');
    expect(body.note.scheduled_for).toBe('2026-05-30');
  });

  it('409 — returns 409 when patching a delivered note', async () => {
    app = await buildTestApp(
      buildMockSupabase({
        findByIdResult: sampleRow({
          status: 'delivered',
          delivered_at: '2026-05-28T06:00:00.000Z',
        }),
      }),
    );
    const token = signToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/heart-notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'too late' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/conflict');
  });

  it('400 — rejects explicit status=delivered on the wire', async () => {
    app = await buildTestApp(buildMockSupabase({ patchResult: sampleRow() }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/heart-notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'delivered' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/heart-notes/history', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 — returns notes array for the caller household', async () => {
    const notes = [
      sampleRow({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'scheduled',
        scheduled_for: '2026-05-30',
        content: noop('one'),
      }),
      sampleRow({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'delivered',
        delivered_at: '2026-05-27T06:00:00.000Z',
        scheduled_for: '2026-05-27',
        content: noop('two'),
      }),
    ];
    app = await buildTestApp(buildMockSupabase({ listResult: notes }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/heart-notes/history',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { notes: HeartNoteRow[] };
    expect(body.notes).toHaveLength(2);
    expect(body.notes.map((n) => n.content).sort()).toEqual(['one', 'two']);
  });

  it('200 — empty array when household has no notes', async () => {
    app = await buildTestApp(buildMockSupabase({ listResult: [] }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/heart-notes/history',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { notes: HeartNoteRow[] };
    expect(body.notes).toEqual([]);
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp(buildMockSupabase({ listResult: [] }));

    const res = await app.inject({
      method: 'GET',
      url: '/v1/heart-notes/history',
    });

    expect(res.statusCode).toBe(401);
  });

  it('200 — ?status=scheduled passes through to the service filter', async () => {
    const notes = [
      sampleRow({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        status: 'scheduled',
        scheduled_for: '2026-05-30',
        content: noop('filtered'),
      }),
    ];
    app = await buildTestApp(buildMockSupabase({ listResult: notes }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/heart-notes/history?status=scheduled',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { notes: HeartNoteRow[] };
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0]?.status).toBe('scheduled');
  });

  it('400 — rejects unknown status enum value', async () => {
    app = await buildTestApp(buildMockSupabase({ listResult: [] }));
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/heart-notes/history?status=not-a-valid-status',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});
