import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { householdsRoutes } from './households.routes.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const JWT_SECRET = 'a'.repeat(32);

interface AuditRow {
  event_type: string;
  user_id: string | null;
  household_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface MockState {
  audit: AuditRow[];
  // Maps householdId → row.
  households: Map<
    string,
    { id: string; created_at: string; tile_ghost_timestamp_enabled: boolean }
  >;
}

// Targeted in-memory Supabase mock — only models the audit_log + households
// surface that the tile-retry route touches. Counting query semantics mirror
// PostgREST's `.select('id', { count: 'exact', head: true })` chain: filters
// stack via `.eq()`/`.gte()`, no rows are returned, and the final resolution
// is `{ count, error, data: null }`.
function buildMockSupabase(state: MockState) {
  return {
    from(table: string) {
      if (table === 'audit_log') return auditTable(state);
      if (table === 'households') return householdsTable(state);
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function auditTable(state: MockState) {
  return {
    insert(row: Omit<AuditRow, 'created_at'> & { created_at?: string }) {
      const stored: AuditRow = {
        event_type: row.event_type,
        user_id: row.user_id ?? null,
        household_id: row.household_id ?? null,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        created_at: row.created_at ?? new Date().toISOString(),
      };
      state.audit.push(stored);
      return Promise.resolve({ data: null, error: null });
    },
    select(_columns: string, _opts?: { count?: string; head?: boolean }) {
      const filters: Record<string, unknown> = {};
      const gteFilters: Record<string, string> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        gte(column: string, value: string) {
          gteFilters[column] = value;
          return chain;
        },
        // The chain itself is thenable — calling code awaits it directly.
        then<T>(
          onFulfilled: (v: { count: number; data: null; error: null }) => T,
        ): Promise<T> {
          const matches = state.audit.filter((r) => {
            for (const [col, val] of Object.entries(filters)) {
              if (col === 'metadata->>edit_key') {
                if ((r.metadata.edit_key as string) !== val) return false;
              } else if ((r as unknown as Record<string, unknown>)[col] !== val) {
                return false;
              }
            }
            for (const [col, val] of Object.entries(gteFilters)) {
              if (col === 'created_at' && r.created_at < val) return false;
            }
            return true;
          });
          return Promise.resolve(
            onFulfilled({ count: matches.length, data: null, error: null }),
          );
        },
      };
      return chain;
    },
  };
}

function householdsTable(state: MockState) {
  return {
    select(_columns: string) {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => {
          const id = filters.id as string | undefined;
          if (!id) return { data: null, error: null };
          const row = state.households.get(id);
          if (!row) return { data: null, error: null };
          return { data: row, error: null };
        },
      };
      return chain;
    },
    update(patch: Record<string, unknown>) {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          const id = filters.id as string | undefined;
          if (id) {
            const row = state.households.get(id);
            if (row && typeof patch.tile_ghost_timestamp_enabled === 'boolean') {
              row.tile_ghost_timestamp_enabled = patch.tile_ghost_timestamp_enabled;
            }
          }
          // Return a chain that supports .select().maybeSingle() for setTileGhostFlag.
          return {
            select(_cols: string) {
              return {
                maybeSingle: async () => {
                  const rowId = filters.id as string | undefined;
                  if (!rowId) return { data: null, error: null };
                  const r = state.households.get(rowId);
                  return r ? { data: { id: r.id }, error: null } : { data: null, error: null };
                },
              };
            },
          };
        },
      };
      return chain;
    },
  };
}

interface BuildAppOpts {
  state: MockState;
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
      void reply.status(400).send({ type: '/errors/validation', status: 400 });
      return;
    }
    const obj = err as { validation?: unknown; cause?: unknown };
    if (obj.cause instanceof ZodError) {
      void reply.status(400).send({ type: '/errors/validation', status: 400 });
      return;
    }
    if (Array.isArray(obj.validation) && obj.validation.length > 0) {
      void reply.status(400).send({ type: '/errors/validation', status: 400 });
      return;
    }
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  await app.register(householdsRoutes);
  await app.ready();
  return app;
}

function freshState(opts: { householdAgeMs?: number; tileGhostEnabled?: boolean } = {}): MockState {
  const ageMs = opts.householdAgeMs ?? 1000 * 60 * 60; // 1h old by default
  return {
    audit: [],
    households: new Map([
      [
        SAMPLE_HOUSEHOLD_ID,
        {
          id: SAMPLE_HOUSEHOLD_ID,
          created_at: new Date(Date.now() - ageMs).toISOString(),
          tile_ghost_timestamp_enabled: opts.tileGhostEnabled ?? false,
        },
      ],
    ]),
  };
}

function signPrimary(app: FastifyInstance, householdId = SAMPLE_HOUSEHOLD_ID): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: householdId, role: 'primary_parent' });
}

function signSecondary(app: FastifyInstance): string {
  return app.jwt.sign({
    sub: SAMPLE_USER_ID,
    hh: SAMPLE_HOUSEHOLD_ID,
    role: 'secondary_caregiver',
  });
}

const VALID_BODY = {
  tile_id: 'tile-mon-0',
  edit_key: 'slot:mon:main',
  timestamp_ms: Date.now(),
};

describe('POST /v1/households/tile-retry', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 204 and writes a single tile.edit_retried audit row when count < 3', async () => {
    const state = freshState();
    app = await buildTestApp({ state });
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/households/tile-retry',
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(204);
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]?.event_type).toBe('tile.edit_retried');
    expect(state.audit[0]?.user_id).toBe(SAMPLE_USER_ID);
    expect(state.audit[0]?.metadata).toMatchObject({
      tile_id: VALID_BODY.tile_id,
      edit_key: VALID_BODY.edit_key,
      timestamp_ms: VALID_BODY.timestamp_ms,
    });
    // No threshold flag in the metadata of the first call.
    expect(state.audit[0]?.metadata.threshold_reached).toBeUndefined();
    expect(state.households.get(SAMPLE_HOUSEHOLD_ID)?.tile_ghost_timestamp_enabled).toBe(false);
  });

  it('does NOT set ghost flag if count ≥ 3 but household is older than 14 days', async () => {
    const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
    const state = freshState({ householdAgeMs: fifteenDaysMs });
    app = await buildTestApp({ state });
    const token = signPrimary(app);

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/households/tile-retry',
        headers: { authorization: `Bearer ${token}` },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(204);
    }

    expect(state.households.get(SAMPLE_HOUSEHOLD_ID)?.tile_ghost_timestamp_enabled).toBe(false);
    // Three retry rows, no threshold-reached row.
    expect(state.audit).toHaveLength(3);
    expect(
      state.audit.some((r) => r.metadata.threshold_reached === true),
    ).toBe(false);
  });

  it('sets ghost flag and writes threshold audit row on the third retry within 14 days', async () => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const state = freshState({ householdAgeMs: sevenDaysMs });
    app = await buildTestApp({ state });
    const token = signPrimary(app);

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/households/tile-retry',
        headers: { authorization: `Bearer ${token}` },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(204);
    }

    expect(state.households.get(SAMPLE_HOUSEHOLD_ID)?.tile_ghost_timestamp_enabled).toBe(true);
    // 3 base retry rows + 1 threshold-reached row = 4 audit rows.
    expect(state.audit).toHaveLength(4);
    const thresholdRow = state.audit.find((r) => r.metadata.threshold_reached === true);
    expect(thresholdRow).toBeDefined();
    expect(thresholdRow?.metadata).toMatchObject({
      tile_id: VALID_BODY.tile_id,
      edit_key: VALID_BODY.edit_key,
      threshold_reached: true,
      retry_count: 3,
    });
  });

  it('does not flip the flag when retries are spread across different edit_keys', async () => {
    const state = freshState({ householdAgeMs: 60_000 });
    app = await buildTestApp({ state });
    const token = signPrimary(app);

    for (const editKey of ['slot:mon:main', 'slot:tue:main', 'slot:wed:main']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/households/tile-retry',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...VALID_BODY, edit_key: editKey },
      });
      expect(res.statusCode).toBe(204);
    }

    expect(state.households.get(SAMPLE_HOUSEHOLD_ID)?.tile_ghost_timestamp_enabled).toBe(false);
    expect(state.audit).toHaveLength(3);
    expect(
      state.audit.some((r) => r.metadata.threshold_reached === true),
    ).toBe(false);
  });

  it('accepts secondary_caregiver tokens (both members may be editing tiles)', async () => {
    const state = freshState();
    app = await buildTestApp({ state });
    const token = signSecondary(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/households/tile-retry',
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(204);
    expect(state.audit).toHaveLength(1);
  });

  it('returns 401 without a token', async () => {
    const state = freshState();
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/households/tile-retry',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(401);
    expect(state.audit).toHaveLength(0);
  });

  it('does not write a second threshold audit row when the flag is already set (idempotency)', async () => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const state = freshState({ householdAgeMs: sevenDaysMs, tileGhostEnabled: true });
    // Pre-populate 3 recent retry rows to ensure count >= RETRY_THRESHOLD for this request.
    const recentTs = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      state.audit.push({
        event_type: 'tile.edit_retried',
        user_id: SAMPLE_USER_ID,
        household_id: SAMPLE_HOUSEHOLD_ID,
        metadata: { tile_id: VALID_BODY.tile_id, edit_key: VALID_BODY.edit_key, timestamp_ms: VALID_BODY.timestamp_ms },
        created_at: recentTs,
      });
    }
    app = await buildTestApp({ state });
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/households/tile-retry',
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(204);
    // One new base retry row added; no threshold-reached row written (flag already set).
    expect(state.audit).toHaveLength(4);
    expect(state.audit.some((r) => r.metadata.threshold_reached === true)).toBe(false);
    expect(state.households.get(SAMPLE_HOUSEHOLD_ID)?.tile_ghost_timestamp_enabled).toBe(true);
  });

  it('returns 400 when required fields are missing', async () => {
    const state = freshState();
    app = await buildTestApp({ state });
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/households/tile-retry',
      headers: { authorization: `Bearer ${token}` },
      payload: { tile_id: 'tile-mon-0' },
    });

    expect(res.statusCode).toBe(400);
    expect(state.audit).toHaveLength(0);
  });
});
