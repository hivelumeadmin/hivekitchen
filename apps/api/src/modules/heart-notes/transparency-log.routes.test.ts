import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { AllergyTransparencyLogSchema } from '@hivekitchen/contracts';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { householdScopeHook } from '../../middleware/household-scope.hook.js';
import { isDomainError } from '../../common/errors.js';
import { heartNoteRoutes } from './heart-note.routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const JWT_SECRET = 'a'.repeat(32);

type AuditRow = {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

function auditRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    event_type: 'allergy.guardrail_rejection',
    metadata: { conflicts: ['peanut'] },
    created_at: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

// Minimal supabase mock — only the audit_log select chain used by the
// transparency-log route is exercised. The chain terminates on .order().
function buildMockSupabase(rows: AuditRow[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return {
    from(table: string) {
      if (table === 'audit_log') return builder;
      throw new Error(`unexpected table ${table}`);
    },
  };
}

async function buildTestApp(rows: AuditRow[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', buildMockSupabase(rows) as unknown as FastifyInstance['supabase']);

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

const URL_PATH = '/v1/heart-notes/transparency-log';

describe('POST /v1/heart-notes/transparency-log', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 with a contract-shaped JSON log for a primary_parent', async () => {
    app = await buildTestApp([auditRow()]);
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: { format: 'json' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toBeUndefined();
    const body = JSON.parse(res.body) as unknown;
    expect(() => AllergyTransparencyLogSchema.parse(body)).not.toThrow();
    const parsed = AllergyTransparencyLogSchema.parse(body);
    expect(parsed.household_id).toBe(HOUSEHOLD_ID);
    expect(parsed.event_count).toBe(1);
  });

  it('200 with a PDF stream — application/pdf + attachment disposition + non-empty body', async () => {
    app = await buildTestApp([auditRow()]);
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: { format: 'pdf' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="allergy-log-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect(res.rawPayload.length).toBeGreaterThan(0);
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('401 without a bearer token', async () => {
    app = await buildTestApp([auditRow()]);

    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      payload: { format: 'json' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('403 for a guest_author', async () => {
    app = await buildTestApp([auditRow()]);
    const token = signToken(app, { role: 'guest_author' });

    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: { format: 'json' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('200 with events:[] (JSON) when the household has no allergy events', async () => {
    app = await buildTestApp([]);
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: { format: 'json' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { events: unknown[]; event_count: number };
    expect(body.events).toEqual([]);
    expect(body.event_count).toBe(0);
  });

  it('200 with a non-empty PDF (empty-state page) when the household has no allergy events', async () => {
    app = await buildTestApp([]);
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: { format: 'pdf' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('maps each event_type to its human-readable label', async () => {
    app = await buildTestApp([
      auditRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', event_type: 'allergy.guardrail_rejection', metadata: { conflicts: ['peanut', 'egg'] } }),
      auditRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', event_type: 'allergy.uncertainty', metadata: { flagged_items: ['curry paste'] } }),
      auditRow({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', event_type: 'allergy.check_overridden', metadata: { reason: 'confirmed safe' } }),
    ]);
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: { format: 'json' },
    });

    expect(res.statusCode).toBe(200);
    const parsed = AllergyTransparencyLogSchema.parse(JSON.parse(res.body));
    const byType = Object.fromEntries(parsed.events.map((e) => [e.event_type, e]));
    expect(byType['allergy.guardrail_rejection']?.label).toBe('Plan blocked due to allergen conflict');
    expect(byType['allergy.guardrail_rejection']?.detail).toBe('peanut, egg');
    expect(byType['allergy.uncertainty']?.label).toBe('Ingredient safety could not be confirmed');
    expect(byType['allergy.uncertainty']?.detail).toBe('curry paste');
    expect(byType['allergy.check_overridden']?.label).toBe('Parent overrode allergy safety check');
    expect(byType['allergy.check_overridden']?.detail).toBe('confirmed safe');
  });

  it('400 when format is missing', async () => {
    app = await buildTestApp([auditRow()]);
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('400 when format is an invalid value', async () => {
    app = await buildTestApp([auditRow()]);
    const token = signToken(app);

    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: { format: 'csv' },
    });

    expect(res.statusCode).toBe(400);
  });
});
