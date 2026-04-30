import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { AuditWriteInput } from '../../audit/audit.types.js';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { childrenRoutes } from './children.routes.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HOUSEHOLD_ID = '33333333-3333-4333-8333-333333333333';
const JWT_SECRET = 'a'.repeat(32);

interface ChildRowDb {
  id: string;
  household_id: string;
  name: string;
  age_band: 'toddler' | 'child' | 'preteen' | 'teen';
  school_policy_notes: string | null;
  declared_allergens: string | null;
  cultural_identifiers: string | null;
  dietary_preferences: string | null;
  allergen_rule_version: string;
  bag_composition: { main: true; snack: boolean; extra: boolean };
  created_at: string;
}

interface MockDbState {
  children: ChildRowDb[];
  ackedUserIds: Set<string>;
  insertSpy?: (row: ChildRowDb) => void;
}

// In-memory Supabase mock — children + users (for parental_notice gate).
// Lets the real ChildrenRepository + ChildrenService + ComplianceService run
// end-to-end with NOOP encryption. The point is to confirm route wiring,
// audit context, RBAC, and the encryption boundary in one harness.
function buildMockSupabase(state: MockDbState) {
  return {
    from(table: string) {
      if (table === 'children') return childrenTable(state);
      if (table === 'users') return usersTable(state);
      if (table === 'households') return householdsTable();
      if (table === 'vpc_consents') return vpcConsentsNoop();
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(_fnName: string) {
      return Promise.resolve({ data: [], error: null });
    },
  };
}

function childrenTable(state: MockDbState) {
  return {
    insert(row: Omit<ChildRowDb, 'id' | 'allergen_rule_version' | 'bag_composition' | 'created_at'>) {
      return {
        select() {
          return {
            single: vi.fn().mockImplementation(async () => {
              const stored: ChildRowDb = {
                id: randomUUID(),
                household_id: row.household_id,
                name: row.name,
                age_band: row.age_band,
                school_policy_notes: row.school_policy_notes,
                declared_allergens: row.declared_allergens,
                cultural_identifiers: row.cultural_identifiers,
                dietary_preferences: row.dietary_preferences,
                allergen_rule_version: 'v1',
                // DB default for bag_composition — main always true,
                // snack/extra default to true.
                bag_composition: { main: true, snack: true, extra: true },
                created_at: '2026-04-28T10:00:00.000Z',
              };
              state.children.push(stored);
              state.insertSpy?.(stored);
              return { data: stored, error: null };
            }),
          };
        },
      };
    },
    select() {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        maybeSingle: vi.fn().mockImplementation(async () => {
          const row = state.children.find(
            (c) => c.id === filters.id && c.household_id === filters.household_id,
          );
          return { data: row ?? null, error: null };
        }),
      };
      return chain;
    },
    update(patch: Partial<ChildRowDb>) {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        select() {
          return {
            maybeSingle: vi.fn().mockImplementation(async () => {
              const idx = state.children.findIndex(
                (c) => c.id === filters.id && c.household_id === filters.household_id,
              );
              if (idx === -1) return { data: null, error: null };
              state.children[idx] = { ...state.children[idx]!, ...patch };
              return { data: state.children[idx], error: null };
            }),
          };
        },
      };
      return chain;
    },
  };
}

function usersTable(state: MockDbState) {
  return {
    select() {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        maybeSingle: vi.fn().mockImplementation(async () => {
          const userId = filters.id as string | undefined;
          if (!userId) return { data: null, error: null };
          const acked = state.ackedUserIds.has(userId);
          return {
            data: {
              parental_notice_acknowledged_at: acked ? '2026-04-28T09:00:00.000Z' : null,
              parental_notice_acknowledged_version: acked ? 'v1' : null,
            },
            error: null,
          };
        }),
      };
      return chain;
    },
  };
}

function householdsTable() {
  // KEK is null in tests → repository never reads encrypted_dek and never
  // updates the row. A no-op shape suffices.
  return {
    select() {
      return {
        eq() {
          return {
            maybeSingle: async () => ({ data: { encrypted_dek: null }, error: null }),
          };
        },
      };
    },
    update() {
      return { eq: async () => ({ error: null }) };
    },
  };
}

function vpcConsentsNoop() {
  return {
    select() {
      return {
        eq: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        }),
      };
    },
  };
}

interface BuildAppOpts {
  state: MockDbState;
  capturedAudit?: { value: AuditWriteInput | undefined };
}

async function buildTestApp(opts: BuildAppOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate(
    'supabase',
    buildMockSupabase(opts.state) as unknown as FastifyInstance['supabase'],
  );

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

  await app.register(childrenRoutes);
  await app.ready();
  return app;
}

function emptyState(opts: { acked?: string[]; insertSpy?: (row: ChildRowDb) => void } = {}): MockDbState {
  return {
    children: [],
    ackedUserIds: new Set(opts.acked ?? []),
    insertSpy: opts.insertSpy,
  };
}

function signPrimaryParentToken(app: FastifyInstance, householdId = SAMPLE_HOUSEHOLD_ID): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: householdId, role: 'primary_parent' });
}

function signSecondaryCaregiverToken(app: FastifyInstance): string {
  return app.jwt.sign({
    sub: SAMPLE_USER_ID,
    hh: SAMPLE_HOUSEHOLD_ID,
    role: 'secondary_caregiver',
  });
}

const VALID_BODY = {
  name: 'Asha',
  age_band: 'child' as const,
  declared_allergens: ['peanut', 'shellfish'],
  cultural_identifiers: ['south_asian'],
  dietary_preferences: ['vegetarian'],
};

describe('POST /v1/households/:id/children', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path → 201 with plaintext arrays in response and PII-free audit context', async () => {
    const insertSpy = vi.fn();
    const state = emptyState({ acked: [SAMPLE_USER_ID], insertSpy });
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { child: { name: string; declared_allergens: string[]; cultural_identifiers: string[]; dietary_preferences: string[]; allergen_rule_version: string } };
    expect(body.child.name).toBe('Asha');
    expect(body.child.declared_allergens).toEqual(['peanut', 'shellfish']);
    expect(body.child.cultural_identifiers).toEqual(['south_asian']);
    expect(body.child.dietary_preferences).toEqual(['vegetarian']);
    expect(body.child.allergen_rule_version).toBe('v1');

    expect(captured.value).toBeDefined();
    expect(captured.value?.event_type).toBe('child.add');
    expect(captured.value?.household_id).toBe(SAMPLE_HOUSEHOLD_ID);
    const meta = captured.value?.metadata ?? {};
    expect(meta).toMatchObject({
      allergen_rule_version: 'v1',
      declared_allergen_count: 2,
      cultural_identifier_count: 1,
      dietary_preference_count: 1,
    });
    // PII never lands in audit metadata — neither plaintext values nor the name.
    const metaJson = JSON.stringify(meta);
    expect(metaJson).not.toContain('peanut');
    expect(metaJson).not.toContain('shellfish');
    expect(metaJson).not.toContain('south_asian');
    expect(metaJson).not.toContain('vegetarian');
    expect(metaJson).not.toContain('Asha');
  });

  it('encrypted storage → raw inserted row uses NOOP: prefix in encrypted columns (never plaintext)', async () => {
    let captured: ChildRowDb | undefined;
    const state = emptyState({
      acked: [SAMPLE_USER_ID],
      insertSpy: (row) => {
        captured = row;
      },
    });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(captured).toBeDefined();
    expect(captured!.declared_allergens).toMatch(/^NOOP:/);
    expect(captured!.cultural_identifiers).toMatch(/^NOOP:/);
    expect(captured!.dietary_preferences).toMatch(/^NOOP:/);
    // Stored ciphertext must not contain the raw plaintext anywhere.
    expect(captured!.declared_allergens).not.toContain('peanut');
    expect(captured!.cultural_identifiers).not.toContain('south_asian');
    expect(captured!.dietary_preferences).not.toContain('vegetarian');
  });

  it('parental notice not acknowledged → 403 /errors/parental-notice-required, no insert', async () => {
    const insertSpy = vi.fn();
    const state = emptyState({ acked: [], insertSpy });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/parental-notice-required');
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('secondary_caregiver JWT → 403', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signSecondaryCaregiverToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(403);
  });

  it('cross-household primary_parent → 403', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const state = emptyState();
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(401);
  });

  it('missing name → 400 validation error', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: { age_band: 'child' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/households/:id/children/:childId', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path → 200 with decrypted plaintext arrays', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const created = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(created.statusCode).toBe(201);
    const childId = (JSON.parse(created.body) as { child: { id: string } }).child.id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children/${childId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { child: { id: string; declared_allergens: string[] } };
    expect(body.child.id).toBe(childId);
    expect(body.child.declared_allergens).toEqual(['peanut', 'shellfish']);
  });

  it('non-existent child → 404 /errors/not-found', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/not-found');
  });

  it('cross-household GET → 403', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/children/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('GET response includes bag_composition with the DB default', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const created = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    const childId = (JSON.parse(created.body) as { child: { id: string } }).child.id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children/${childId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      child: { bag_composition: { main: boolean; snack: boolean; extra: boolean } };
    };
    expect(body.child.bag_composition).toEqual({ main: true, snack: true, extra: true });
  });
});

describe('PATCH /v1/children/:id/bag-composition', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function createChild(token: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { child: { id: string } }).child.id;
  }

  it('happy path → 200 returns updated child and writes child.bag_updated audit context', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { snack: false, extra: true },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      child: { id: string; bag_composition: { main: boolean; snack: boolean; extra: boolean } };
    };
    expect(body.child.id).toBe(childId);
    expect(body.child.bag_composition).toEqual({ main: true, snack: false, extra: true });

    expect(captured.value).toBeDefined();
    expect(captured.value?.event_type).toBe('child.bag_updated');
    expect(captured.value?.household_id).toBe(SAMPLE_HOUSEHOLD_ID);
    const meta = captured.value?.metadata ?? {};
    expect(meta).toMatchObject({
      child_id: childId,
      old: { main: true, snack: true, extra: true },
      new: { main: true, snack: false, extra: true },
    });
  });

  it('body containing main: false → 400 /errors/validation', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { main: false, snack: true, extra: true },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });

  it('body containing main: true → 400 /errors/validation (main is never user-settable)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { main: true, snack: true, extra: true },
    });

    expect(res.statusCode).toBe(400);
  });

  it('non-boolean snack → 400', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { snack: 'yes', extra: true },
    });

    expect(res.statusCode).toBe(400);
  });

  it('cross-household child id → 403', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const tokenA = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);
    const childId = await createChild(tokenA);

    const tokenB = signPrimaryParentToken(app, OTHER_HOUSEHOLD_ID);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { snack: false, extra: false },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/forbidden');
  });

  it('secondary_caregiver token → 403 (only primary_parent can change bag composition)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const primaryToken = signPrimaryParentToken(app);
    const childId = await createChild(primaryToken);

    const secondaryToken = signSecondaryCaregiverToken(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${secondaryToken}` },
      payload: { snack: false, extra: true },
    });

    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${randomUUID()}/bag-composition`,
      payload: { snack: true, extra: true },
    });

    expect(res.statusCode).toBe(401);
  });

  it('partial body — missing required field snack → 400', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { extra: true },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });

  it('subsequent GET reflects the patched bag_composition', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { snack: false, extra: false },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children/${childId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      child: { bag_composition: { main: boolean; snack: boolean; extra: boolean } };
    };
    expect(body.child.bag_composition).toEqual({ main: true, snack: false, extra: false });
  });
});
