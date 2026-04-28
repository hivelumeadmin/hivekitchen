import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { AuditWriteInput } from '../../audit/audit.types.js';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError, ParentalNoticeRequiredError } from '../../common/errors.js';
import { complianceRoutes } from './compliance.routes.js';
import { ComplianceRepository } from './compliance.repository.js';
import { ComplianceService } from './compliance.service.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const JWT_SECRET = 'a'.repeat(32);

interface AckState {
  acknowledged_at: string | null;
  acknowledged_version: string | null;
}

interface SupabaseMockOpts {
  ackState?: AckState;
  rpcSpy?: (params: { p_user_id: string; p_document_version: string }) => void;
  rpcReturnsEmpty?: boolean;
}

function buildMockSupabase(opts: SupabaseMockOpts = {}) {
  const ackState: AckState = opts.ackState ?? {
    acknowledged_at: null,
    acknowledged_version: null,
  };

  return {
    from(table: string) {
      if (table === 'vpc_consents') {
        // Tests in this file don't exercise vpc_consents, but compliance.service
        // constructs the repository which references the table at module-load
        // time only — return a no-op shape.
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
          }),
        };
      }
      if (table !== 'users') {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        select: () => {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq: (column: string, value: unknown) => {
              filters[column] = value;
              return chain;
            },
            maybeSingle: vi.fn().mockImplementation(async () => {
              if (filters.id !== SAMPLE_USER_ID) return { data: null, error: null };
              return {
                data: {
                  parental_notice_acknowledged_at: ackState.acknowledged_at,
                  parental_notice_acknowledged_version: ackState.acknowledged_version,
                },
                error: null,
              };
            }),
          };
          return chain;
        },
      };
    },
    rpc(fnName: string, params: { p_user_id: string; p_document_version: string }) {
      if (fnName !== 'ack_parental_notice') {
        return Promise.resolve({ data: null, error: new Error(`unexpected rpc: ${fnName}`) });
      }
      if (opts.rpcReturnsEmpty) {
        return Promise.resolve({ data: [], error: null });
      }
      opts.rpcSpy?.(params);
      const isNew =
        ackState.acknowledged_at === null ||
        ackState.acknowledged_version !== params.p_document_version;
      const result = isNew
        ? {
            parental_notice_acknowledged_at: new Date().toISOString(),
            parental_notice_acknowledged_version: params.p_document_version,
            is_new_acknowledgment: true,
          }
        : {
            parental_notice_acknowledged_at: ackState.acknowledged_at!,
            parental_notice_acknowledged_version: ackState.acknowledged_version!,
            is_new_acknowledgment: false,
          };
      return Promise.resolve({ data: [result], error: null });
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
        instance: request.id,
      });
      return;
    }
    if (Array.isArray(obj.validation) && obj.validation.length > 0) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
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

describe('GET /v1/compliance/parental-notice', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path → 200 with v1 + non-empty content + six processors', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/compliance/parental-notice',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      document_version: string;
      content: string;
      processors: { name: string }[];
      data_categories: string[];
      retention: { category: string }[];
    };
    expect(body.document_version).toBe('v1');
    expect(body.content.length).toBeGreaterThan(0);
    expect(body.content).toContain('Before we collect data');
    expect(body.processors.map((p) => p.name).sort()).toEqual([
      'elevenlabs',
      'openai',
      'sendgrid',
      'stripe',
      'supabase',
      'twilio',
    ]);
    // AC13: content must name all six processors by their display name
    for (const displayName of ['Supabase', 'ElevenLabs', 'SendGrid', 'Twilio', 'Stripe', 'OpenAI']) {
      expect(body.content).toContain(displayName);
    }
    expect(body.data_categories.length).toBeGreaterThan(0);
    expect(body.retention.length).toBeGreaterThan(0);
  });

  it('unauthenticated → 401', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/compliance/parental-notice',
    });
    expect(res.statusCode).toBe(401);
  });

  it('secondary_caregiver JWT → 403', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const token = signSecondaryCaregiverToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/compliance/parental-notice',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /v1/compliance/parental-notice/acknowledge', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('first acknowledgment → 200, users row updated, audit context populated', async () => {
    const rpcSpy = vi.fn();
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({
      supabase: buildMockSupabase({ rpcSpy }),
      capturedAudit: captured,
    });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/parental-notice/acknowledge',
      headers: { authorization: `Bearer ${token}` },
      payload: { document_version: 'v1' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { acknowledged_at: string; document_version: string };
    expect(body.document_version).toBe('v1');
    expect(body.acknowledged_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const params = rpcSpy.mock.calls[0]![0] as { p_user_id: string; p_document_version: string };
    expect(params.p_document_version).toBe('v1');
    expect(params.p_user_id).toBe(SAMPLE_USER_ID);

    expect(captured.value).toBeDefined();
    expect(captured.value?.event_type).toBe('parental_notice.acknowledged');
    expect(captured.value?.user_id).toBe(SAMPLE_USER_ID);
    expect(captured.value?.household_id).toBe(SAMPLE_HOUSEHOLD_ID);
    expect(captured.value?.correlation_id).toBe(SAMPLE_HOUSEHOLD_ID);
    expect(captured.value?.request_id).toBeDefined();
    expect(captured.value?.metadata).toEqual({ document_version: 'v1' });
  });

  it('idempotent re-acknowledge → 200, NO audit context', async () => {
    const rpcSpy = vi.fn();
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({
      supabase: buildMockSupabase({
        ackState: {
          acknowledged_at: '2026-04-26T08:00:00.000Z',
          acknowledged_version: 'v1',
        },
        rpcSpy,
      }),
      capturedAudit: captured,
    });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/parental-notice/acknowledge',
      headers: { authorization: `Bearer ${token}` },
      payload: { document_version: 'v1' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { acknowledged_at: string; document_version: string };
    expect(body.acknowledged_at).toBe('2026-04-26T08:00:00.000Z');
    expect(body.document_version).toBe('v1');

    // RPC is always called; the DB conditional UPDATE returns is_new_acknowledgment=false
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(captured.value).toBeUndefined();
  });

  it('missing document_version → 400 validation error', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/parental-notice/acknowledge',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("unknown document_version ('v2') → 400 validation error", async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/parental-notice/acknowledge',
      headers: { authorization: `Bearer ${token}` },
      payload: { document_version: 'v2' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('RPC returns empty array (user not found) → 404', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase({ rpcReturnsEmpty: true }) });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/parental-notice/acknowledge',
      headers: { authorization: `Bearer ${token}` },
      payload: { document_version: 'v1' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('unauthenticated → 401', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/parental-notice/acknowledge',
      payload: { document_version: 'v1' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('secondary_caregiver JWT → 403', async () => {
    app = await buildTestApp({ supabase: buildMockSupabase() });
    const token = signSecondaryCaregiverToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/parental-notice/acknowledge',
      headers: { authorization: `Bearer ${token}` },
      payload: { document_version: 'v1' },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('ComplianceService.assertParentalNoticeAcknowledged', () => {
  function buildService(ackState: AckState | null) {
    const supabase = {
      from() {
        return {
          select: () => {
            const chain = {
              eq: () => chain,
              maybeSingle: async () =>
                ackState === null
                  ? { data: null, error: null }
                  : {
                      data: {
                        parental_notice_acknowledged_at: ackState.acknowledged_at,
                        parental_notice_acknowledged_version: ackState.acknowledged_version,
                      },
                      error: null,
                    },
            };
            return chain;
          },
        };
      },
    };
    const repository = new ComplianceRepository(
      supabase as unknown as FastifyInstance['supabase'],
    );
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
      child: () => logger,
      level: 'info',
      silent: false,
    } as unknown as ConstructorParameters<typeof ComplianceService>[1];
    return new ComplianceService(repository, logger);
  }

  it('throws ParentalNoticeRequiredError when user has not acknowledged', async () => {
    const service = buildService({ acknowledged_at: null, acknowledged_version: null });
    await expect(service.assertParentalNoticeAcknowledged(SAMPLE_USER_ID)).rejects.toBeInstanceOf(
      ParentalNoticeRequiredError,
    );
  });

  it('throws ParentalNoticeRequiredError when user record is missing', async () => {
    const service = buildService(null);
    await expect(service.assertParentalNoticeAcknowledged(SAMPLE_USER_ID)).rejects.toBeInstanceOf(
      ParentalNoticeRequiredError,
    );
  });

  it('resolves when user has acknowledged any version', async () => {
    const service = buildService({
      acknowledged_at: '2026-04-26T08:00:00.000Z',
      acknowledged_version: 'v1',
    });
    await expect(
      service.assertParentalNoticeAcknowledged(SAMPLE_USER_ID),
    ).resolves.toBeUndefined();
  });
});
