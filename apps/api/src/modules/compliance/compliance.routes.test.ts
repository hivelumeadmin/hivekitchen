import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { AuditWriteInput } from '../../audit/audit.types.js';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { complianceRoutes } from './compliance.routes.js';
import type { VpcConsentRow } from './compliance.repository.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CONSENT_ROW_ID = '33333333-3333-4333-8333-333333333333';
const JWT_SECRET = 'a'.repeat(32);

const EXISTING_CONSENT_ROW: VpcConsentRow = {
  id: CONSENT_ROW_ID,
  household_id: SAMPLE_HOUSEHOLD_ID,
  mechanism: 'soft_signed_declaration',
  signed_at: '2026-04-26T08:00:00.000Z',
  signed_by_user_id: SAMPLE_USER_ID,
  document_version: 'v1',
  created_at: '2026-04-26T08:00:00.000Z',
};

interface SupabaseMockOpts {
  existingConsent?: VpcConsentRow | null;
  insertError?: unknown;
  insertSpy?: (row: unknown) => void;
}

function buildMockSupabase(opts: SupabaseMockOpts = {}) {
  const existingConsent = opts.existingConsent ?? null;
  let insertedRow: VpcConsentRow | null = null;

  return {
    from(table: string) {
      if (table !== 'vpc_consents') {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        select: () => {
          // findConsent: select(cols).eq(hh).eq(mech).eq(version).maybeSingle()
          // Capture the eq() filters and only return existingConsent when all
          // three match the seeded row — guards against silent regression if
          // the query shape ever changes.
          const filters: Record<string, unknown> = {};
          const chain = {
            eq: (column: string, value: unknown) => {
              filters[column] = value;
              return chain;
            },
            maybeSingle: vi.fn().mockImplementation(async () => {
              if (existingConsent === null) return { data: null, error: null };
              const matches =
                filters.household_id === existingConsent.household_id &&
                filters.mechanism === existingConsent.mechanism &&
                filters.document_version === existingConsent.document_version;
              return { data: matches ? existingConsent : null, error: null };
            }),
          };
          return chain;
        },
        insert: (row: {
          household_id: string;
          mechanism: string;
          signed_by_user_id: string;
          document_version: string;
        }) => ({
          select: () => ({
            single: vi.fn().mockImplementation(async () => {
              if (opts.insertError) {
                return { data: null, error: opts.insertError };
              }
              opts.insertSpy?.(row);
              insertedRow = {
                id: CONSENT_ROW_ID,
                household_id: row.household_id,
                mechanism: row.mechanism,
                signed_at: '2026-04-27T12:00:00.000Z',
                signed_by_user_id: row.signed_by_user_id,
                document_version: row.document_version,
                created_at: '2026-04-27T12:00:00.000Z',
              };
              return { data: insertedRow, error: null };
            }),
          }),
        }),
      };
    },
  };
}

interface BuildAppOpts {
  supabase: ReturnType<typeof buildMockSupabase>;
  capturedAudit?: { value: AuditWriteInput | undefined };
}

async function buildTestApp(opts: BuildAppOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', opts.supabase as unknown as FastifyInstance['supabase']);

  await app.register(jwt, { secret: JWT_SECRET, sign: { expiresIn: '15m' } });
  await app.register(authenticateHook);

  if (opts.capturedAudit) {
    app.addHook('onResponse', async (request) => {
      opts.capturedAudit!.value = request.auditContext;
    });
  }

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
    const obj = err as { validation?: unknown; cause?: unknown };
    if (obj.cause instanceof ZodError) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        detail: obj.cause.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
        instance: request.id,
      });
      return;
    }
    if (Array.isArray(obj.validation) && obj.validation.length > 0) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        instance: request.id,
      });
      return;
    }
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  await app.register(complianceRoutes);
  await app.ready();
  return app;
}

function signPrimaryParentToken(app: FastifyInstance): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'primary_parent' });
}

function signSecondaryCaregiverToken(app: FastifyInstance): string {
  return app.jwt.sign({
    sub: SAMPLE_USER_ID,
    hh: SAMPLE_HOUSEHOLD_ID,
    role: 'secondary_caregiver',
  });
}

describe('GET /v1/compliance/consent-declaration', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path → 200 with document_version=v1 and non-empty content', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/compliance/consent-declaration',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { document_version: string; content: string };
    expect(body.document_version).toBe('v1');
    expect(body.content.length).toBeGreaterThan(0);
    expect(body.content).toContain('HiveKitchen Beta');
  });

  it('unauthenticated → 401', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/compliance/consent-declaration',
    });
    expect(res.statusCode).toBe(401);
  });

  it('secondary_caregiver JWT → 403', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const token = signSecondaryCaregiverToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/compliance/consent-declaration',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /v1/compliance/vpc-consent', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path → 200 with shaped response, audit context populated', async () => {
    const insertSpy = vi.fn();
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({
      supabase: buildMockSupabase({ existingConsent: null, insertSpy }),
      capturedAudit: captured,
    });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/vpc-consent',
      headers: { authorization: `Bearer ${token}` },
      payload: { document_version: 'v1' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      household_id: string;
      signed_at: string;
      mechanism: string;
      document_version: string;
    };
    expect(body.household_id).toBe(SAMPLE_HOUSEHOLD_ID);
    expect(body.mechanism).toBe('soft_signed_declaration');
    expect(body.document_version).toBe('v1');
    expect(typeof body.signed_at).toBe('string');

    expect(insertSpy).toHaveBeenCalledWith({
      household_id: SAMPLE_HOUSEHOLD_ID,
      mechanism: 'soft_signed_declaration',
      signed_by_user_id: SAMPLE_USER_ID,
      document_version: 'v1',
    });

    expect(captured.value).toBeDefined();
    expect(captured.value?.event_type).toBe('vpc.consented');
    expect(captured.value?.user_id).toBe(SAMPLE_USER_ID);
    expect(captured.value?.household_id).toBe(SAMPLE_HOUSEHOLD_ID);
    expect(captured.value?.correlation_id).toBe(SAMPLE_HOUSEHOLD_ID);
    expect(captured.value?.metadata).toEqual({
      mechanism: 'soft_signed_declaration',
      document_version: 'v1',
    });
  });

  it('duplicate consent → 409 conflict', async () => {
    app = await buildTestApp({
      supabase: buildMockSupabase({ existingConsent: EXISTING_CONSENT_ROW }),
    });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/vpc-consent',
      headers: { authorization: `Bearer ${token}` },
      payload: { document_version: 'v1' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { type: string; detail: string };
    expect(body.type).toBe('/errors/conflict');
    expect(body.detail).toBe(
      'consent already recorded for this household and document version',
    );
  });

  it('missing document_version → 400 validation error', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/vpc-consent',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("unknown document_version ('v99') → 400 validation error", async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/vpc-consent',
      headers: { authorization: `Bearer ${token}` },
      payload: { document_version: 'v99' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('unauthenticated → 401', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/vpc-consent',
      payload: { document_version: 'v1' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('secondary_caregiver JWT → 403', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const token = signSecondaryCaregiverToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/vpc-consent',
      headers: { authorization: `Bearer ${token}` },
      payload: { document_version: 'v1' },
    });

    expect(res.statusCode).toBe(403);
  });
});
