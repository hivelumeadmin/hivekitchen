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
  // 2-S19: every getMyProfile / updateMy* response goes through deriveIsOnboarded
  // → repository.hasChildren(household_id). Default 1 (household is onboarded).
  childrenCount?: number;
  // 2-S26: when ack is null or children=0, deriveOnboardingFlags falls
  // through to repository.hasActiveOnboardingThread → threads + thread_turns.
  // Defaults: no active thread, treat household as fully not-started (in_progress=false).
  activeOnboardingThreadId?: string | null;
  inProgressSummaryTurnCount?: number;
  // 5-S15: voice_transcripts reads for GET /v1/users/me/voice-transcripts.
  voiceTranscripts?: Array<{
    id: string;
    transcript: string;
    retention_until: string;
    created_at: string;
  }>;
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
  _updateArgCaptor: ReturnType<typeof vi.fn>;
  _deleteTranscriptsSpy: ReturnType<typeof vi.fn>;
}

function defaultUserRow(overrides: Partial<UserProfileRow> = {}): UserProfileRow {
  return {
    id: SAMPLE_USER_ID,
    email: 'parent@example.com',
    display_name: 'Sample Parent',
    preferred_language: 'en',
    role: 'primary_parent',
    notification_prefs: {},
    cultural_language: 'default',
    parental_notice_acknowledged_at: null,
    parental_notice_acknowledged_version: null,
    caption_only_mode: false,
    voice_retention_mode: 'standard',
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
  const updateArgCaptor = vi.fn();
  const deleteTranscriptsSpy = vi.fn().mockResolvedValue({ error: null });

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
          update: (data: unknown) => {
            updateArgCaptor(data);
            return {
              eq: () => ({
                select: () => ({
                  single: updateProfileSpy,
                }),
              }),
            };
          },
        };
      }
      if (table === 'voice_transcripts') {
        // 5-S15: findByUserId (select→eq→order→limit) + deleteByUserId (delete→eq).
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: vi
                  .fn()
                  .mockResolvedValue({ data: opts.voiceTranscripts ?? [], error: null }),
              }),
            }),
          }),
          delete: () => ({
            eq: deleteTranscriptsSpy,
          }),
        };
      }
      if (table === 'children') {
        // 2-S19: deriveIsOnboarded → repository.hasChildren probe.
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: null,
              count: opts.childrenCount ?? 1,
            }),
          }),
        };
      }
      if (table === 'threads') {
        // 2-S26: hasActiveOnboardingThread → select('id').eq().eq().eq().limit(1).
        // Default: no active thread (resume surface stays hidden).
        const threadId = opts.activeOnboardingThreadId ?? null;
        const result = threadId ? [{ id: threadId }] : [];
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  limit: vi.fn().mockResolvedValue({ data: result, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'thread_turns') {
        // 2-S26: summary-event count probe on the active thread.
        // Default 0 → repository reports in-progress (no summary turn yet).
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                filter: () => ({
                  filter: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                    count: opts.inProgressSummaryTurnCount ?? 0,
                  }),
                }),
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
    _updateArgCaptor: updateArgCaptor,
    _deleteTranscriptsSpy: deleteTranscriptsSpy,
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
      notification_prefs: { weekly_plan_ready: boolean; grocery_list_ready: boolean };
      cultural_language: string;
      parental_notice_acknowledged_at: string | null;
      parental_notice_acknowledged_version: string | null;
    };
    expect(body.id).toBe(SAMPLE_USER_ID);
    expect(body.email).toBe('parent@example.com');
    expect(body.role).toBe('primary_parent');
    expect(body.auth_providers).toEqual(['email']);
    expect(body.notification_prefs).toEqual({
      weekly_plan_ready: true,
      grocery_list_ready: true,
      proactive_lumi_nudges: true,
    });
    expect(body.cultural_language).toBe('default');
    // AC7: both fields must be present in the profile response
    expect(body.parental_notice_acknowledged_at).toBeNull();
    expect(body.parental_notice_acknowledged_version).toBeNull();
  });

  it('returns non-null parental notice fields for acknowledged user (AC7)', async () => {
    const supabaseMock = buildMockSupabase({
      findUserResult: defaultUserRow({
        parental_notice_acknowledged_at: '2026-04-26T08:00:00.000Z',
        parental_notice_acknowledged_version: 'v1',
      }),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      parental_notice_acknowledged_at: string | null;
      parental_notice_acknowledged_version: string | null;
    };
    expect(body.parental_notice_acknowledged_at).toBe('2026-04-26T08:00:00.000Z');
    expect(body.parental_notice_acknowledged_version).toBe('v1');
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
    const body = JSON.parse(res.body) as {
      display_name: string;
      parental_notice_acknowledged_at: string | null;
      parental_notice_acknowledged_version: string | null;
    };
    expect(body.display_name).toBe('New Name');
    // PATCH responses include full profile — verify COPPA fields flow through
    expect(body.parental_notice_acknowledged_at).toBeNull();
    expect(body.parental_notice_acknowledged_version).toBeNull();
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

describe('PATCH /v1/users/me/notifications', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('updates weekly_plan_ready=false → 200 with updated notification_prefs', async () => {
    const supabaseMock = buildMockSupabase({
      updateUserResult: defaultUserRow({
        notification_prefs: { weekly_plan_ready: false, grocery_list_ready: true },
      }),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/notifications',
      headers: { authorization: `Bearer ${token}` },
      payload: { weekly_plan_ready: false },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      notification_prefs: { weekly_plan_ready: boolean; grocery_list_ready: boolean };
    };
    expect(body.notification_prefs.weekly_plan_ready).toBe(false);
    expect(body.notification_prefs.grocery_list_ready).toBe(true);
  });

  it('merges: existing grocery_list_ready=false, PATCH only weekly_plan_ready → grocery stays false', async () => {
    const supabaseMock = buildMockSupabase({
      findUserResult: defaultUserRow({
        notification_prefs: { weekly_plan_ready: true, grocery_list_ready: false },
      }),
      updateUserResult: defaultUserRow({
        notification_prefs: { weekly_plan_ready: true, grocery_list_ready: false },
      }),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/notifications',
      headers: { authorization: `Bearer ${token}` },
      payload: { weekly_plan_ready: true },
    });

    expect(res.statusCode).toBe(200);
    expect(supabaseMock._updateProfileSpy).toHaveBeenCalledTimes(1);
    expect(supabaseMock._updateArgCaptor).toHaveBeenCalledWith(
      expect.objectContaining({
        notification_prefs: {
          weekly_plan_ready: true,
          grocery_list_ready: false,
          proactive_lumi_nudges: true,
        },
      }),
    );
    // Verify the merge happened: the update payload sent both fields, preserving grocery_list_ready=false.
    const body = JSON.parse(res.body) as {
      notification_prefs: { weekly_plan_ready: boolean; grocery_list_ready: boolean };
    };
    expect(body.notification_prefs.weekly_plan_ready).toBe(true);
    expect(body.notification_prefs.grocery_list_ready).toBe(false);
  });

  it('empty body → 400 ValidationError', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/notifications',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
    expect(supabaseMock._updateProfileSpy).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/notifications',
      payload: { weekly_plan_ready: true },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /v1/users/me/preferences', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('sets cultural_language from default → south_asian → 200 with updated value', async () => {
    const supabaseMock = buildMockSupabase({
      updateUserResult: defaultUserRow({ cultural_language: 'south_asian' }),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { cultural_language: 'south_asian' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { cultural_language: string };
    expect(body.cultural_language).toBe('south_asian');
  });

  it('ratchet: south_asian → default returns 409 conflict (column unchanged)', async () => {
    const supabaseMock = buildMockSupabase({
      findUserResult: defaultUserRow({ cultural_language: 'south_asian' }),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { cultural_language: 'default' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/conflict');
    expect(supabaseMock._updateProfileSpy).not.toHaveBeenCalled();
  });

  it('ratchet allows sideways: south_asian → caribbean returns 200', async () => {
    const supabaseMock = buildMockSupabase({
      findUserResult: defaultUserRow({ cultural_language: 'south_asian' }),
      updateUserResult: defaultUserRow({ cultural_language: 'caribbean' }),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { cultural_language: 'caribbean' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { cultural_language: string };
    expect(body.cultural_language).toBe('caribbean');
  });

  it('unknown enum value → 400 ValidationError', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { cultural_language: 'klingon' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
    expect(supabaseMock._updateProfileSpy).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/preferences',
      payload: { cultural_language: 'south_asian' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /v1/users/me/accessibility', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('updates caption_only_mode=true → 200 with updated value', async () => {
    const supabaseMock = buildMockSupabase({
      updateUserResult: defaultUserRow({ caption_only_mode: true }),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/accessibility',
      headers: { authorization: `Bearer ${token}` },
      payload: { caption_only_mode: true },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { caption_only_mode: boolean };
    expect(body.caption_only_mode).toBe(true);
    expect(supabaseMock._updateArgCaptor).toHaveBeenCalledWith(
      expect.objectContaining({ caption_only_mode: true }),
    );
  });

  it('empty body (missing field) → 400 ValidationError', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/accessibility',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
    expect(supabaseMock._updateProfileSpy).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/accessibility',
      payload: { caption_only_mode: true },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/users/me/voice-transcripts', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 — returns transcripts and mode for authenticated user', async () => {
    const supabaseMock = buildMockSupabase({
      voiceTranscripts: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          transcript: 'What is for lunch today?',
          retention_until: '2026-11-01T00:00:00.000Z',
          created_at: '2026-10-23T10:00:00.000Z',
        },
      ],
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me/voice-transcripts',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      transcripts: Array<{ id: string; transcript: string }>;
      voice_retention_mode: string;
    };
    expect(body.transcripts).toHaveLength(1);
    expect(body.transcripts[0].transcript).toBe('What is for lunch today?');
    expect(body.voice_retention_mode).toBe('standard');
  });

  it('200 — returns empty array when no transcripts', async () => {
    const supabaseMock = buildMockSupabase({ voiceTranscripts: [] });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me/voice-transcripts',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { transcripts: unknown[] };
    expect(body.transcripts).toHaveLength(0);
  });

  it('unauthenticated → 401', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({ method: 'GET', url: '/v1/users/me/voice-transcripts' });

    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /v1/users/me/voice-retention', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 — switches to immediate_delete and deletes transcripts', async () => {
    const supabaseMock = buildMockSupabase({
      updateUserResult: defaultUserRow({ voice_retention_mode: 'immediate_delete' }),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/voice-retention',
      headers: { authorization: `Bearer ${token}` },
      payload: { voice_retention_mode: 'immediate_delete' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { voice_retention_mode: string };
    expect(body.voice_retention_mode).toBe('immediate_delete');
    expect(supabaseMock._deleteTranscriptsSpy).toHaveBeenCalledTimes(1);
  });

  it('200 — switches to standard without deleting transcripts', async () => {
    const supabaseMock = buildMockSupabase({
      updateUserResult: defaultUserRow({ voice_retention_mode: 'standard' }),
    });
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/voice-retention',
      headers: { authorization: `Bearer ${token}` },
      payload: { voice_retention_mode: 'standard' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { voice_retention_mode: string };
    expect(body.voice_retention_mode).toBe('standard');
    expect(supabaseMock._deleteTranscriptsSpy).not.toHaveBeenCalled();
  });

  it('invalid mode → 400 ValidationError', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);
    const token = signAccessToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/voice-retention',
      headers: { authorization: `Bearer ${token}` },
      payload: { voice_retention_mode: 'never' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
    expect(supabaseMock._deleteTranscriptsSpy).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401', async () => {
    const supabaseMock = buildMockSupabase({});
    app = await buildTestApp(supabaseMock);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/voice-retention',
      payload: { voice_retention_mode: 'immediate_delete' },
    });

    expect(res.statusCode).toBe(401);
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
