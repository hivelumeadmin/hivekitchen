import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { householdsRoutes } from './households.routes.js';
import {
  ConsentHistoryResponseSchema,
  DataExportResponseSchema,
  DeleteHouseholdResponseSchema,
  ParentalDashboardResponseSchema,
} from '@hivekitchen/contracts';

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
  plansService?: Partial<FastifyInstance['plansService']>;
  memoryService?: Partial<FastifyInstance['memoryService']>;
  briefStateComposer?: Partial<FastifyInstance['briefStateComposer']>;
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

  if (opts.plansService) {
    app.decorate('plansService', opts.plansService as unknown as FastifyInstance['plansService']);
  }
  if (opts.memoryService) {
    app.decorate(
      'memoryService',
      opts.memoryService as unknown as FastifyInstance['memoryService'],
    );
  }
  if (opts.briefStateComposer) {
    app.decorate(
      'briefStateComposer',
      opts.briefStateComposer as unknown as FastifyInstance['briefStateComposer'],
    );
  }
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

describe('GET /v1/households/:householdId/brief', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function buildBriefApp(getBriefResult: unknown): Promise<FastifyInstance> {
    return buildTestApp({
      state: freshState(),
      plansService: { getBrief: async (_id: string) => getBriefResult },
    });
  }

  it('returns 200 with { brief: null } when no projection exists yet', async () => {
    app = await buildBriefApp(null);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ brief: null });
  });

  it('returns 403 when the JWT household_id does not match the URL param', async () => {
    app = await buildBriefApp(null);
    const OTHER_HOUSEHOLD = '99999999-9999-4999-8999-999999999999';
    const token = signPrimary(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${OTHER_HOUSEHOLD}/brief`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 401 without a token', async () => {
    app = await buildBriefApp(null);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`,
    });

    expect(res.statusCode).toBe(401);
  });
});

// ===========================================================================
// Story 7-S1 — GET /v1/households/:householdId/memory (Visible Memory read)
// ===========================================================================

describe('GET /v1/households/:householdId/memory', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  interface MemoryNodeRowShape {
    id: string;
    household_id: string;
    node_type: string;
    facet: string;
    subject_child_id: string | null;
    prose_text: string;
    soft_forget_at: string | null;
    hard_forgotten: boolean;
    created_at: string;
    updated_at: string;
  }

  function sampleNode(overrides: Partial<MemoryNodeRowShape> = {}): MemoryNodeRowShape {
    return {
      id: '00000000-0000-4000-8000-000000000001',
      household_id: SAMPLE_HOUSEHOLD_ID,
      node_type: 'preference',
      facet: 'avoids spicy',
      subject_child_id: null,
      prose_text: 'Child avoids spicy peppers.',
      soft_forget_at: null,
      hard_forgotten: false,
      created_at: '2026-04-30T00:00:00.000Z',
      updated_at: '2026-04-30T00:00:00.000Z',
      ...overrides,
    };
  }

  async function buildMemoryApp(findActive: (id: string) => Promise<MemoryNodeRowShape[]>) {
    return buildTestApp({
      state: freshState(),
      memoryService: { findActive: findActive as FastifyInstance['memoryService']['findActive'] },
    });
  }

  it('returns 200 with { nodes: [] } when there are no active nodes', async () => {
    app = await buildMemoryApp(async () => []);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/memory`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ nodes: [] });
  });

  it('returns 200 with the active nodes when they exist, passing the household id through', async () => {
    const nodes = [
      sampleNode({ id: '00000000-0000-4000-8000-00000000000a', prose_text: 'first' }),
      sampleNode({ id: '00000000-0000-4000-8000-00000000000b', prose_text: 'second' }),
    ];
    const findActive = vi.fn(async () => nodes);
    app = await buildMemoryApp(findActive);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/memory`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { nodes: MemoryNodeRowShape[] };
    expect(body.nodes.map((n) => n.prose_text)).toEqual(['first', 'second']);
    expect(findActive).toHaveBeenCalledWith(SAMPLE_HOUSEHOLD_ID);
  });

  it('accepts secondary_caregiver tokens', async () => {
    app = await buildMemoryApp(async () => []);
    const token = signSecondary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/memory`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when the JWT household_id does not match the URL param', async () => {
    const findActive = vi.fn(async () => []);
    app = await buildMemoryApp(findActive);
    const OTHER_HOUSEHOLD = '99999999-9999-4999-8999-999999999999';
    const token = signPrimary(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${OTHER_HOUSEHOLD}/memory`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(findActive).not.toHaveBeenCalled();
  });

  it('returns 401 without a token', async () => {
    app = await buildMemoryApp(async () => []);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/memory`,
    });

    expect(res.statusCode).toBe(401);
  });
});

// ===========================================================================
// Slice 2-s27 — PATCH /v1/households/:id (household food-identity profile)
// ===========================================================================

import { encryptField, normalizedHash } from '../../lib/envelope-encryption.js';
import { vi } from 'vitest';

const OTHER_HOUSEHOLD_ID = '33333333-3333-4333-8333-333333333333';

interface PatchMockOpts {
  /** Plain (decrypted) initial values seeded into the new structured tables. */
  initial?: {
    cultural_identifiers?: string[];
    dietary_preferences?: string[];
    declared_allergens?: string[];
  };
}

// Story 3-DM-B2 — household profile (cultural / dietary / allergens) now
// lives in three structured tables:
//   - household_cultural_identifiers (composite PK)
//   - dietary_preferences (child_id=NULL = household-scoped)
//   - household_allergens (child_id=NULL = household-wide)
// getProfile/patchProfile route through HouseholdAllergensRepository +
// HouseholdCulturalIdentifiersRepository + direct dietary_preferences IO.
function buildPatchMockSupabase(opts: PatchMockOpts = {}) {
  const initial = opts.initial ?? {};
  const state = {
    householdExists: true as boolean,
    culturalTags: [...(initial.cultural_identifiers ?? [])],
    dietaryTags: [...(initial.dietary_preferences ?? [])],
    // [{ allergen plaintext, ciphertext, hash }]
    householdAllergens: (initial.declared_allergens ?? []).map((plaintext) => ({
      allergen: encryptField(plaintext, null),
      allergen_hash: normalizedHash(plaintext),
      source: 'parent_edited',
      child_id: null as string | null,
    })),
  };

  return {
    from(table: string) {
      if (table === 'households') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: vi.fn().mockImplementation(() =>
                Promise.resolve({
                  data: state.householdExists ? { id: SAMPLE_HOUSEHOLD_ID } : null,
                  error: null,
                }),
              ),
            }),
          }),
          update: (_patch: Record<string, string>) => ({
            eq: vi.fn().mockImplementation(() => ({
              select: () => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: SAMPLE_HOUSEHOLD_ID }, error: null }),
              }),
            })),
          }),
        };
      }
      if (table === 'household_keys') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === 'household_allergens') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) =>
              Promise.resolve({
                data: state.householdAllergens.map((a) => ({
                  household_id: SAMPLE_HOUSEHOLD_ID,
                  child_id: null,
                  allergen: a.allergen,
                  source: a.source,
                })),
                error: null,
              }),
          }),
          upsert: (
            payload: {
              household_id: string;
              child_id: string | null;
              allergen: string;
              allergen_hash: string;
              source: string;
            },
            opts: { onConflict?: string; ignoreDuplicates?: boolean },
          ) => ({
            select: (_cols: string) => ({
              maybeSingle: async () => {
                const existing = state.householdAllergens.find(
                  (a) => a.allergen_hash === payload.allergen_hash,
                );
                if (existing !== undefined) {
                  if (opts.ignoreDuplicates === true) return { data: null, error: null };
                  return { data: { id: 'mock' }, error: null };
                }
                state.householdAllergens.push({
                  allergen: payload.allergen,
                  allergen_hash: payload.allergen_hash,
                  source: payload.source,
                  child_id: payload.child_id,
                });
                return { data: { id: randomUUID() }, error: null };
              },
            }),
          }),
          delete: () => {
            let childIdIsNull = false;
            let excludeHashes: string[] = [];
            const chain = {
              eq: (_col: string, _val: unknown) => chain,
              is: (col: string, val: null) => {
                if (col === 'child_id' && val === null) childIdIsNull = true;
                return chain;
              },
              not: (col: string, op: string, value: string) => {
                if (col === 'allergen_hash' && op === 'in') {
                  excludeHashes = value.slice(1, -1).split(',').filter(Boolean);
                }
                return chain;
              },
              then(resolve: (v: { error: null }) => void) {
                if (childIdIsNull) {
                  state.householdAllergens = state.householdAllergens.filter((a) =>
                    excludeHashes.length > 0
                      ? !(a.child_id === null && !excludeHashes.includes(a.allergen_hash))
                      : a.child_id !== null,
                  );
                }
                resolve({ error: null });
                return Promise.resolve({ error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === 'household_cultural_identifiers') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) =>
              Promise.resolve({
                data: state.culturalTags.map((cultural_tag) => ({
                  household_id: SAMPLE_HOUSEHOLD_ID,
                  cultural_tag,
                  enforcement: 'default',
                  source: 'parent_edited',
                })),
                error: null,
              }),
          }),
          upsert: (
            payload:
              | Array<{ household_id: string; cultural_tag: string }>
              | { household_id: string; cultural_tag: string },
            _opts: { onConflict?: string; ignoreDuplicates?: boolean },
          ) => {
            const rows = Array.isArray(payload) ? payload : [payload];
            for (const r of rows) {
              if (!state.culturalTags.includes(r.cultural_tag)) {
                state.culturalTags.push(r.cultural_tag);
              }
            }
            return Promise.resolve({ error: null });
          },
          delete: () => {
            const chain = {
              eq: (_col: string, _val: unknown) => {
                state.culturalTags = [];
                return Promise.resolve({ error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === 'dietary_preferences') {
        return {
          select: (_cols: string) => {
            const chain = {
              eq: (_col: string, _val: string) => chain,
              is: (_col: string, _val: null) =>
                Promise.resolve({
                  data: state.dietaryTags.map((tag) => ({ tag })),
                  error: null,
                }),
            };
            return chain;
          },
          upsert: (
            payload:
              | Array<{ household_id: string; child_id: string | null; tag: string }>
              | { household_id: string; child_id: string | null; tag: string },
            _opts: { onConflict?: string; ignoreDuplicates?: boolean },
          ) => {
            const rows = Array.isArray(payload) ? payload : [payload];
            for (const r of rows) {
              if (r.child_id === null && !state.dietaryTags.includes(r.tag)) {
                state.dietaryTags.push(r.tag);
              }
            }
            return Promise.resolve({ error: null });
          },
          delete: () => {
            const chain = {
              eq: (_col: string, _val: unknown) => chain,
              is: (_col: string, _val: null) => {
                state.dietaryTags = [];
                return Promise.resolve({ error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === 'audit_log') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const VOCAB_OK_PATCH = {
  validateCultural: vi.fn((keys: string[]) => [...keys]),
  validateDietary: vi.fn((keys: string[]) => [...keys]),
  validateAllergens: vi.fn((keys: string[]) => [...keys]),
};
const VOCAB_REJECTS_ALLERGEN_PATCH = {
  validateCultural: vi.fn((keys: string[]) => [...keys]),
  validateDietary: vi.fn((keys: string[]) => [...keys]),
  validateAllergens: vi.fn((_keys: string[]) => {
    throw new Error('Unknown or inactive allergen tag: kryptonite');
  }),
};

async function buildPatchApp(
  supabase: ReturnType<typeof buildPatchMockSupabase>,
  vocabulary: typeof VOCAB_OK_PATCH | typeof VOCAB_REJECTS_ALLERGEN_PATCH = VOCAB_OK_PATCH,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = {
    NODE_ENV: 'development' as const,
    JWT_SECRET,
    ENVELOPE_ENCRYPTION_MASTER_KEY: '',
  };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', supabase as unknown as FastifyInstance['supabase']);
  app.decorate(
    'vocabularyService',
    vocabulary as unknown as FastifyInstance['vocabularyService'],
  );
  if (!app.hasDecorator('plansService')) {
    app.decorate(
      'plansService',
      { getBrief: vi.fn() } as unknown as FastifyInstance['plansService'],
    );
  }

  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: '15m' } });
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
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        detail: err.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
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

  await app.register(householdsRoutes);
  await app.ready();
  return app;
}

function signPatchToken(
  app: FastifyInstance,
  overrides: Partial<{
    sub: string;
    hh: string;
    role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
  }> = {},
): string {
  return app.jwt.sign({
    sub: overrides.sub ?? SAMPLE_USER_ID,
    hh: overrides.hh ?? SAMPLE_HOUSEHOLD_ID,
    role: overrides.role ?? 'primary_parent',
  });
}

describe('PATCH /v1/households/:id', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 with the updated profile on a single-field patch', async () => {
    app = await buildPatchApp(buildPatchMockSupabase());
    const token = signPatchToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { dietary_preferences: ['halal'] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      id: string;
      cultural_identifiers: string[];
      dietary_preferences: string[];
      declared_allergens: string[];
    };
    expect(body.id).toBe(SAMPLE_HOUSEHOLD_ID);
    expect(body.dietary_preferences).toEqual(['halal']);
    expect(body.cultural_identifiers).toEqual([]);
    expect(body.declared_allergens).toEqual([]);
  });

  it('200 with all three arrays', async () => {
    app = await buildPatchApp(buildPatchMockSupabase());
    const token = signPatchToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cultural_identifiers: ['south_asian'],
        dietary_preferences: ['halal'],
        declared_allergens: ['pork'],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      cultural_identifiers: string[];
      dietary_preferences: string[];
      declared_allergens: string[];
    };
    expect(body.cultural_identifiers).toEqual(['south_asian']);
    expect(body.dietary_preferences).toEqual(['halal']);
    expect(body.declared_allergens).toEqual(['pork']);
  });

  it('200 with empty array clears the field', async () => {
    app = await buildPatchApp(
      buildPatchMockSupabase({ initial: { declared_allergens: ['pork'] } }),
    );
    const token = signPatchToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { declared_allergens: [] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { declared_allergens: string[] };
    expect(body.declared_allergens).toEqual([]);
  });

  it('400 on invalid body (tag too long)', async () => {
    app = await buildPatchApp(buildPatchMockSupabase());
    const token = signPatchToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { declared_allergens: ['a'.repeat(101)] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('400 on vocabulary rejection (unknown allergen)', async () => {
    app = await buildPatchApp(buildPatchMockSupabase(), VOCAB_REJECTS_ALLERGEN_PATCH);
    const token = signPatchToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { declared_allergens: ['kryptonite'] },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { detail?: string };
    expect(body.detail).toMatch(/Unknown or inactive/);
  });

  it('401 without bearer token', async () => {
    app = await buildPatchApp(buildPatchMockSupabase());

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}`,
      payload: { dietary_preferences: ['halal'] },
    });

    expect(res.statusCode).toBe(401);
  });

  it('403 for secondary_caregiver role', async () => {
    app = await buildPatchApp(buildPatchMockSupabase());
    const token = signPatchToken(app, { role: 'secondary_caregiver' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { dietary_preferences: ['halal'] },
    });

    expect(res.statusCode).toBe(403);
  });

  it("403 when URL id is not the caller's household", async () => {
    app = await buildPatchApp(buildPatchMockSupabase());
    const token = signPatchToken(app); // hh = SAMPLE_HOUSEHOLD_ID

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { dietary_preferences: ['halal'] },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/forbidden');
  });
});

// ===========================================================================
// Story 3.29 — PATCH /v1/households/:id/sovereignty-mode
// ===========================================================================

interface SovereigntyMockState {
  sovereigntyMode: 'unified' | 'alternating';
  sovereigntyModeUpdatedAt: string | null;
  audit: Array<{ event_type: string; metadata: Record<string, unknown> }>;
}

function buildSovereigntyMockSupabase(state: SovereigntyMockState) {
  return {
    from(table: string) {
      if (table === 'households') {
        return {
          select: (_cols: string) => ({
            eq: () => ({
              maybeSingle: vi
                .fn()
                .mockImplementation(() =>
                  Promise.resolve({
                    data: { sovereignty_mode: state.sovereigntyMode },
                    error: null,
                  }),
                ),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: vi.fn().mockImplementation(() => {
              if (typeof patch.sovereignty_mode === 'string') {
                state.sovereigntyMode = patch.sovereignty_mode as 'unified' | 'alternating';
              }
              if (typeof patch.sovereignty_mode_updated_at === 'string') {
                state.sovereigntyModeUpdatedAt = patch.sovereignty_mode_updated_at;
              }
              return {
                select: () => ({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: { id: SAMPLE_HOUSEHOLD_ID }, error: null }),
                }),
              };
            }),
          }),
        };
      }
      if (table === 'audit_log') {
        return {
          insert: (row: { event_type: string; metadata: Record<string, unknown> }) => {
            state.audit.push({
              event_type: row.event_type,
              metadata: row.metadata ?? {},
            });
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

async function buildSovereigntyApp(
  state: SovereigntyMockState,
  hooks: {
    clearDegradedPlanState?: ReturnType<typeof vi.fn>;
    triggerAdjustment?: ReturnType<typeof vi.fn>;
  } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = {
    NODE_ENV: 'development' as const,
    JWT_SECRET,
    ENVELOPE_ENCRYPTION_MASTER_KEY: '',
  };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate(
    'supabase',
    buildSovereigntyMockSupabase(state) as unknown as FastifyInstance['supabase'],
  );
  app.decorate(
    'vocabularyService',
    VOCAB_OK_PATCH as unknown as FastifyInstance['vocabularyService'],
  );
  app.decorate(
    'plansService',
    {
      getBrief: vi.fn(),
      clearDegradedPlanState:
        hooks.clearDegradedPlanState ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as FastifyInstance['plansService'],
  );
  app.decorate(
    'planAdjustmentService',
    {
      triggerAdjustment:
        hooks.triggerAdjustment ??
        vi.fn().mockResolvedValue({ plansQueued: 1, enqueuedPlanIds: [], failedPlanIds: [] }),
    } as unknown as FastifyInstance['planAdjustmentService'],
  );

  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: '15m' } });
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
    const validation = (err as { validation?: unknown }).validation;
    if (Array.isArray(validation) && validation.length > 0) {
      void reply.status(400).send({ type: '/errors/validation', status: 400 });
      return;
    }
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  await app.register(householdsRoutes);
  await app.ready();
  return app;
}

describe('PATCH /v1/households/:id/sovereignty-mode (Story 3.29)', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 — updates sovereignty_mode, clears degraded plan_state, audits, and triggers regen', async () => {
    const state: SovereigntyMockState = {
      sovereigntyMode: 'unified',
      sovereigntyModeUpdatedAt: null,
      audit: [],
    };
    const clearDegradedPlanState = vi.fn().mockResolvedValue(undefined);
    const triggerAdjustment = vi
      .fn()
      .mockResolvedValue({ plansQueued: 1, enqueuedPlanIds: [], failedPlanIds: [] });
    app = await buildSovereigntyApp(state, { clearDegradedPlanState, triggerAdjustment });
    const token = signPatchToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/sovereignty-mode`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sovereignty_mode: 'alternating' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ sovereignty_mode: 'alternating' });
    expect(state.sovereigntyMode).toBe('alternating');
    expect(state.sovereigntyModeUpdatedAt).not.toBeNull();
    expect(clearDegradedPlanState).toHaveBeenCalledWith(SAMPLE_HOUSEHOLD_ID);
    expect(triggerAdjustment).toHaveBeenCalledTimes(1);
    expect(triggerAdjustment.mock.calls[0]![0]).toMatchObject({
      type: 'cultural_sovereignty_mode_changed',
      householdId: SAMPLE_HOUSEHOLD_ID,
      slotScope: 'bag_wide',
      dayScope: null,
      metadata: { sovereignty_mode: 'alternating' },
    });
    expect(state.audit.some((r) => r.event_type === 'household.sovereignty_mode_changed')).toBe(true);
  });

  it('403 when URL id is not the caller\'s household', async () => {
    const state: SovereigntyMockState = {
      sovereigntyMode: 'unified',
      sovereigntyModeUpdatedAt: null,
      audit: [],
    };
    const clearDegradedPlanState = vi.fn().mockResolvedValue(undefined);
    const triggerAdjustment = vi.fn().mockResolvedValue({ plansQueued: 0, enqueuedPlanIds: [], failedPlanIds: [] });
    app = await buildSovereigntyApp(state, { clearDegradedPlanState, triggerAdjustment });
    const token = signPatchToken(app); // hh = SAMPLE_HOUSEHOLD_ID

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/sovereignty-mode`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sovereignty_mode: 'alternating' },
    });

    expect(res.statusCode).toBe(403);
    expect(state.sovereigntyMode).toBe('unified');
    expect(clearDegradedPlanState).not.toHaveBeenCalled();
    expect(triggerAdjustment).not.toHaveBeenCalled();
  });

  it('403 for secondary_caregiver — toggle is primary-parent only', async () => {
    const state: SovereigntyMockState = {
      sovereigntyMode: 'unified',
      sovereigntyModeUpdatedAt: null,
      audit: [],
    };
    app = await buildSovereigntyApp(state);
    const token = signPatchToken(app, { role: 'secondary_caregiver' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/sovereignty-mode`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sovereignty_mode: 'alternating' },
    });

    expect(res.statusCode).toBe(403);
    expect(state.sovereigntyMode).toBe('unified');
  });

  it('400 on invalid sovereignty_mode enum value', async () => {
    const state: SovereigntyMockState = {
      sovereigntyMode: 'unified',
      sovereigntyModeUpdatedAt: null,
      audit: [],
    };
    app = await buildSovereigntyApp(state);
    const token = signPatchToken(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/sovereignty-mode`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sovereignty_mode: 'monarchy' },
    });

    expect(res.statusCode).toBe(400);
    expect(state.sovereigntyMode).toBe('unified');
  });
});

// ===========================================================================
// Story 7-S8 — GET /v1/households/:householdId/dashboard
// ===========================================================================

interface DashboardChildRow {
  id: string;
  household_id: string;
  name: string;
  age_band: string;
  school_policy_notes: string | null;
  appetite_level: string;
  texture_needs: string;
  spice_tolerance: string;
  bag_composition_pattern: string;
  created_at: string;
}

interface DashboardSeed {
  children?: DashboardChildRow[];
  culturalPriors?: Array<Record<string, unknown>>;
  // memory_nodes rows with embedded provenance for the counts-by-source feed.
  memoryNodes?: Array<{
    subject_child_id: string | null;
    memory_provenance: Array<{ source_type: string }> | null;
  }>;
  vpcConsents?: Array<Record<string, unknown>>;
}

function makeDashboardChild(overrides: Partial<DashboardChildRow> = {}): DashboardChildRow {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    household_id: SAMPLE_HOUSEHOLD_ID,
    name: 'Layla',
    age_band: 'child',
    school_policy_notes: null,
    appetite_level: 'normal',
    texture_needs: 'normal',
    spice_tolerance: 'mild',
    bag_composition_pattern: 'main_only',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Thenable chain: eq/is/order/limit all return the chain, and awaiting the
// chain at any point resolves with the seeded rows. This models every read the
// dashboard performs (children, household_allergens, cultural identifiers,
// dietary_preferences, cultural_priors, memory_nodes embed, vpc_consents)
// without re-implementing each PostgREST verb's terminal position.
function tableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.eq = passthrough;
  chain.is = passthrough;
  chain.order = passthrough;
  chain.limit = passthrough;
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: rows, error: null });
  return chain;
}

function buildDashboardMockSupabase(seed: DashboardSeed) {
  return {
    from(table: string) {
      switch (table) {
        case 'children':
          return { select: () => tableChain(seed.children ?? []) };
        case 'household_allergens':
          return { select: () => tableChain([]) };
        case 'household_cultural_identifiers':
          return { select: () => tableChain([]) };
        case 'dietary_preferences':
          return { select: () => tableChain([]) };
        case 'cultural_priors':
          return { select: () => tableChain(seed.culturalPriors ?? []) };
        case 'memory_nodes':
          return { select: () => tableChain(seed.memoryNodes ?? []) };
        case 'vpc_consents':
          return { select: () => tableChain(seed.vpcConsents ?? []) };
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
  };
}

async function buildDashboardApp(seed: DashboardSeed): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = {
    NODE_ENV: 'development' as const,
    JWT_SECRET,
    ENVELOPE_ENCRYPTION_MASTER_KEY: '',
  };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate(
    'supabase',
    buildDashboardMockSupabase(seed) as unknown as FastifyInstance['supabase'],
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

describe('GET /v1/households/:householdId/dashboard (7-S8)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 — body matches the schema; seeded child + provenance land in the right buckets', async () => {
    const child = makeDashboardChild({ name: 'Layla' });
    app = await buildDashboardApp({
      children: [child],
      culturalPriors: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          household_id: SAMPLE_HOUSEHOLD_ID,
          key: 'bengali',
          label: 'Bengali',
          tier: 'L2',
          state: 'active',
          presence: 1,
          confidence: 0.9,
          opted_in_at: null,
          opted_out_at: null,
          last_signal_at: '2026-01-01T00:00:00.000Z',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      memoryNodes: [
        { subject_child_id: child.id, memory_provenance: [{ source_type: 'onboarding' }] },
        { subject_child_id: null, memory_provenance: [{ source_type: 'turn' }, { source_type: 'turn' }] },
      ],
      vpcConsents: [
        {
          id: '00000000-0000-4000-8000-0000000000v1',
          household_id: SAMPLE_HOUSEHOLD_ID,
          mechanism: 'signed_declaration',
          signed_at: '2026-06-01T00:00:00.000Z',
          signed_by_user_id: SAMPLE_USER_ID,
          document_version: 'v1',
          created_at: '2026-06-01T00:00:00.000Z',
        },
      ],
    });
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/dashboard`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const parsed = ParentalDashboardResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
    const body = res.json() as ReturnType<typeof ParentalDashboardResponseSchema.parse>;
    expect(body.children).toHaveLength(1);
    expect(body.children[0]?.name).toBe('Layla');
    expect(body.children[0]?.memory_node_counts.onboarding).toBe(1);
    expect(body.household.general_memory_node_counts.turn).toBe(2);
    expect(body.household.voice_retention_days).toBe(90);
    expect(body.household.cultural_priors).toHaveLength(1);
    expect(body.household.recent_vpc_events).toHaveLength(1);
  });

  it('200 with children: [] when the household has no children (AC#7)', async () => {
    app = await buildDashboardApp({});
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/dashboard`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as ReturnType<typeof ParentalDashboardResponseSchema.parse>;
    expect(body.children).toEqual([]);
    expect(body.household.cultural_priors).toEqual([]);
    expect(body.household.recent_vpc_events).toEqual([]);
  });

  it('accepts secondary_caregiver tokens', async () => {
    app = await buildDashboardApp({});
    const token = signSecondary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/dashboard`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('403 when :householdId is not the caller’s household', async () => {
    app = await buildDashboardApp({});
    const token = signPrimary(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/dashboard`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('401 without a token', async () => {
    app = await buildDashboardApp({});

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/dashboard`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('400 when :householdId is not a valid UUID', async () => {
    app = await buildDashboardApp({});
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/not-a-uuid/dashboard`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ===========================================================================
// Story 7-S9 — GET /v1/households/:householdId/consent-history
// ===========================================================================

interface ConsentEventRow {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Thenable chain for the audit_log read the consent-history repo performs:
// select(...).eq('household_id', ...).in('event_type', ...).order('created_at',
// { ascending: false }). The mock returns the seeded rows verbatim (the real
// .in()/.order() filtering is exercised in audit.repository.test.ts); rows are
// seeded pre-sorted so the route's pass-through ordering is asserted here.
function consentTableChain(rows: ConsentEventRow[]) {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.eq = passthrough;
  chain.in = passthrough;
  chain.order = () => Promise.resolve({ data: rows, error: null });
  return chain;
}

function buildConsentMockSupabase(rows: ConsentEventRow[]) {
  return {
    from(table: string) {
      if (table === 'audit_log') return { select: () => consentTableChain(rows) };
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

async function buildConsentApp(rows: ConsentEventRow[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = {
    NODE_ENV: 'development' as const,
    JWT_SECRET,
    ENVELOPE_ENCRYPTION_MASTER_KEY: '',
  };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate(
    'supabase',
    buildConsentMockSupabase(rows) as unknown as FastifyInstance['supabase'],
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

function consentEvent(overrides: Partial<ConsentEventRow> = {}): ConsentEventRow {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    event_type: 'vpc.consented',
    metadata: { mechanism: 'signed_declaration', document_version: 'v1.0' },
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('GET /v1/households/:householdId/consent-history (7-S9)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 — body parses against the schema; seeded events land newest-first', async () => {
    const newer = consentEvent({
      id: '44444444-4444-4444-8444-444444444444',
      event_type: 'vpc.consented',
      created_at: '2026-06-02T00:00:00.000Z',
    });
    const older = consentEvent({
      id: '55555555-5555-4555-8555-555555555555',
      event_type: 'account.created',
      metadata: {},
      created_at: '2026-06-01T00:00:00.000Z',
    });
    app = await buildConsentApp([newer, older]);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/consent-history`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const parsed = ConsentHistoryResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
    const body = res.json() as ReturnType<typeof ConsentHistoryResponseSchema.parse>;
    expect(body.events.map((e) => e.id)).toEqual([newer.id, older.id]);
  });

  it('200 with { events: [] } when the household has no matching audit rows (AC#7)', async () => {
    app = await buildConsentApp([]);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/consent-history`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [] });
  });

  it('accepts secondary_caregiver tokens', async () => {
    app = await buildConsentApp([]);
    const token = signSecondary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/consent-history`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('403 when :householdId is not the caller’s household', async () => {
    app = await buildConsentApp([consentEvent()]);
    const token = signPrimary(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/consent-history`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('401 without a token', async () => {
    app = await buildConsentApp([]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/consent-history`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('400 when :householdId is not a valid UUID', async () => {
    app = await buildConsentApp([]);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/not-a-uuid/consent-history`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ===========================================================================
// Story 7-S10 — POST /v1/households/:householdId/export (JSON data export)
// ===========================================================================

interface ExportQueueMock {
  add: ReturnType<typeof vi.fn>;
}

async function buildExportApp(queue: ExportQueueMock): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = {
    NODE_ENV: 'development' as const,
    JWT_SECRET,
    ENVELOPE_ENCRYPTION_MASTER_KEY: '',
  };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  // The export route never touches supabase directly (it only enqueues a job),
  // but the households plugin constructs repositories with fastify.supabase at
  // registration time — a bare object satisfies those constructors.
  app.decorate('supabase', {} as unknown as FastifyInstance['supabase']);
  app.decorate(
    'bullmq',
    { getQueue: vi.fn(() => queue), getWorker: vi.fn() } as unknown as FastifyInstance['bullmq'],
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

describe('POST /v1/households/:householdId/export (7-S10)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('202 — enqueues the job and returns a queued body matching the schema', async () => {
    const queue: ExportQueueMock = { add: vi.fn().mockResolvedValue({}) };
    app = await buildExportApp(queue);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/export`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
    const parsed = DataExportResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
    const body = res.json() as ReturnType<typeof DataExportResponseSchema.parse>;
    expect(body.status).toBe('queued');

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, jobData] = queue.add.mock.calls[0] as [string, Record<string, unknown>];
    expect(jobName).toBe('compose-export');
    expect(jobData).toMatchObject({
      household_id: SAMPLE_HOUSEHOLD_ID,
      user_id: SAMPLE_USER_ID,
    });
    expect(typeof jobData.request_id).toBe('string');
  });

  it('403 when :householdId is not the caller’s household', async () => {
    const queue: ExportQueueMock = { add: vi.fn().mockResolvedValue({}) };
    app = await buildExportApp(queue);
    const token = signPrimary(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/export`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('403 for secondary_caregiver — export is primary-parent only', async () => {
    const queue: ExportQueueMock = { add: vi.fn().mockResolvedValue({}) };
    app = await buildExportApp(queue);
    const token = signSecondary(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/export`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('403 for guest_author — export is primary-parent only', async () => {
    const queue: ExportQueueMock = { add: vi.fn().mockResolvedValue({}) };
    app = await buildExportApp(queue);
    const token = app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'guest_author' });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/export`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('401 without a token', async () => {
    const queue: ExportQueueMock = { add: vi.fn().mockResolvedValue({}) };
    app = await buildExportApp(queue);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/export`,
    });

    expect(res.statusCode).toBe(401);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('400 when :householdId is not a valid UUID', async () => {
    const queue: ExportQueueMock = { add: vi.fn().mockResolvedValue({}) };
    app = await buildExportApp(queue);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/not-a-uuid/export`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Story 7-S11 — POST /v1/households/:householdId/delete (account deletion)
// ===========================================================================

interface DeleteMockState {
  household: { display_name: string | null; deletion_requested_at: string | null } | null;
  deletionRequestedAt: string | null;
  audit: Array<{ event_type: string; metadata: Record<string, unknown> }>;
  updateUserByIdCalls: Array<[string, { ban_duration?: string }]>;
  signOutCalls: Array<[string, string]>;
}

function buildDeleteMockSupabase(state: DeleteMockState) {
  return {
    from(table: string) {
      if (table === 'households') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: async () => ({ data: state.household, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, _val: string) => {
              if (typeof patch.deletion_requested_at === 'string') {
                state.deletionRequestedAt = patch.deletion_requested_at;
              }
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'audit_log') {
        return {
          insert: (row: { event_type: string; metadata?: Record<string, unknown> }) => {
            state.audit.push({ event_type: row.event_type, metadata: row.metadata ?? {} });
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    auth: {
      admin: {
        updateUserById: vi.fn(async (id: string, attrs: { ban_duration?: string }) => {
          state.updateUserByIdCalls.push([id, attrs]);
          return { data: {}, error: null };
        }),
        signOut: vi.fn(async (id: string, scope: string) => {
          state.signOutCalls.push([id, scope]);
          return { data: {}, error: null };
        }),
      },
    },
  };
}

function freshDeleteState(
  overrides: Partial<{ display_name: string | null; deletion_requested_at: string | null }> = {},
): DeleteMockState {
  return {
    household: {
      display_name: overrides.display_name ?? 'The Menon Kitchen',
      deletion_requested_at: overrides.deletion_requested_at ?? null,
    },
    deletionRequestedAt: null,
    audit: [],
    updateUserByIdCalls: [],
    signOutCalls: [],
  };
}

async function buildDeleteApp(state: DeleteMockState): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = {
    NODE_ENV: 'development' as const,
    JWT_SECRET,
    ENVELOPE_ENCRYPTION_MASTER_KEY: '',
  };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate(
    'supabase',
    buildDeleteMockSupabase(state) as unknown as FastifyInstance['supabase'],
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

describe('POST /v1/households/:householdId/delete (7-S11)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 — soft-deletes, bans login, revokes sessions, audits, and returns a scheduled body', async () => {
    const state = freshDeleteState();
    app = await buildDeleteApp(state);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmation_name: 'The Menon Kitchen' },
    });

    expect(res.statusCode).toBe(200);
    const parsed = DeleteHouseholdResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
    const body = res.json() as ReturnType<typeof DeleteHouseholdResponseSchema.parse>;
    expect(body.status).toBe('scheduled');

    expect(state.deletionRequestedAt).not.toBeNull();
    expect(state.updateUserByIdCalls).toEqual([[SAMPLE_USER_ID, { ban_duration: '876600h' }]]);
    expect(state.signOutCalls).toEqual([[SAMPLE_USER_ID, 'global']]);
    expect(state.audit.some((r) => r.event_type === 'account.deletion_requested')).toBe(true);
  });

  it('200 — matches the household name case-insensitively after trimming', async () => {
    const state = freshDeleteState();
    app = await buildDeleteApp(state);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmation_name: '  the menon kitchen  ' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('200 already_scheduled — idempotent path does not re-revoke auth', async () => {
    const state = freshDeleteState({ deletion_requested_at: '2026-06-01T00:00:00.000Z' });
    app = await buildDeleteApp(state);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmation_name: 'The Menon Kitchen' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as ReturnType<typeof DeleteHouseholdResponseSchema.parse>;
    expect(body.status).toBe('already_scheduled');
    expect(state.updateUserByIdCalls).toHaveLength(0);
    expect(state.signOutCalls).toHaveLength(0);
  });

  it('400 when confirmation_name does not match the household name', async () => {
    const state = freshDeleteState();
    app = await buildDeleteApp(state);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmation_name: 'wrong name' },
    });

    expect(res.statusCode).toBe(400);
    expect(state.deletionRequestedAt).toBeNull();
    expect(state.updateUserByIdCalls).toHaveLength(0);
  });

  it('400 when :householdId is not a valid UUID', async () => {
    const state = freshDeleteState();
    app = await buildDeleteApp(state);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/not-a-uuid/delete`,
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmation_name: 'The Menon Kitchen' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('403 when :householdId is not the caller’s household', async () => {
    const state = freshDeleteState();
    app = await buildDeleteApp(state);
    const token = signPrimary(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmation_name: 'The Menon Kitchen' },
    });

    expect(res.statusCode).toBe(403);
    expect(state.updateUserByIdCalls).toHaveLength(0);
  });

  it('403 for secondary_caregiver — deletion is primary-parent only', async () => {
    const state = freshDeleteState();
    app = await buildDeleteApp(state);
    const token = signSecondary(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmation_name: 'The Menon Kitchen' },
    });

    expect(res.statusCode).toBe(403);
    expect(state.updateUserByIdCalls).toHaveLength(0);
  });

  it('403 for guest_author — deletion is primary-parent only', async () => {
    const state = freshDeleteState();
    app = await buildDeleteApp(state);
    const token = app.jwt.sign({
      sub: SAMPLE_USER_ID,
      hh: SAMPLE_HOUSEHOLD_ID,
      role: 'guest_author',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmation_name: 'The Menon Kitchen' },
    });

    expect(res.statusCode).toBe(403);
    expect(state.updateUserByIdCalls).toHaveLength(0);
  });

  it('401 without a token', async () => {
    const state = freshDeleteState();
    app = await buildDeleteApp(state);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/delete`,
      payload: { confirmation_name: 'The Menon Kitchen' },
    });

    expect(res.statusCode).toBe(401);
    expect(state.updateUserByIdCalls).toHaveLength(0);
  });
});

// ===========================================================================
// Slice 5-S2 — GET /v1/households/:id/members (household roster)
// ===========================================================================

interface MemberRow {
  id: string;
  display_name: string | null;
  role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
}

// Models the findByHousehold query: select → eq(current_household_id) →
// in('role', [...]) → order('role'). The .in() filter is applied so the mock
// reflects the guest_author exclusion the route relies on.
function buildMembersMockSupabase(rows: MemberRow[], householdDisplayName: string | null = null) {
  return {
    from(table: string) {
      if (table === 'users') {
        let allowedRoles: string[] | null = null;
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.in = (_col: string, vals: string[]) => {
          allowedRoles = vals;
          return chain;
        };
        chain.order = () => chain;
        chain.then = (resolve: (v: { data: MemberRow[]; error: null }) => unknown) => {
          const filtered = allowedRoles
            ? rows.filter((r) => allowedRoles!.includes(r.role))
            : rows;
          return resolve({ data: filtered, error: null });
        };
        return chain;
      }
      if (table === 'households') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { display_name: householdDisplayName }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

async function buildMembersApp(rows: MemberRow[], householdDisplayName: string | null = null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = {
    NODE_ENV: 'development' as const,
    JWT_SECRET,
    ENVELOPE_ENCRYPTION_MASTER_KEY: '',
  };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate(
    'supabase',
    buildMembersMockSupabase(rows, householdDisplayName) as unknown as FastifyInstance['supabase'],
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
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  await app.register(householdsRoutes);
  await app.ready();
  return app;
}

describe('GET /v1/households/:id/members (5-S2)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  const primary: MemberRow = {
    id: SAMPLE_USER_ID,
    display_name: 'Alex',
    role: 'primary_parent',
  };
  const secondary: MemberRow = {
    id: '55555555-5555-4555-8555-555555555555',
    display_name: 'Sam',
    role: 'secondary_caregiver',
  };
  const guest: MemberRow = {
    id: '66666666-6666-4666-8666-666666666666',
    display_name: 'Grandma',
    role: 'guest_author',
  };

  it('200 — returns the member list for a valid household', async () => {
    app = await buildMembersApp([primary, secondary]);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/members`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { members: Array<{ user_id: string; role: string }> };
    expect(body.members).toHaveLength(2);
    expect(body.members[0]).toMatchObject({ user_id: SAMPLE_USER_ID, role: 'primary_parent' });
  });

  it('200 — accepts a secondary_caregiver token', async () => {
    app = await buildMembersApp([primary, secondary]);
    const token = signSecondary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/members`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('filters out guest_author members', async () => {
    app = await buildMembersApp([primary, secondary, guest]);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/members`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { members: Array<{ role: string }> };
    expect(body.members.some((m) => m.role === 'guest_author')).toBe(false);
    expect(body.members).toHaveLength(2);
  });

  it('401 without a token', async () => {
    app = await buildMembersApp([primary]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/members`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('403 when accessing another household', async () => {
    app = await buildMembersApp([primary]);
    const token = signPrimary(app); // hh = SAMPLE_HOUSEHOLD_ID

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/members`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ===========================================================================
// Slice 5-S3 — GET /v1/households/:id/packers + PATCH .../days/:date/packer
// ===========================================================================

interface PackerUserRow {
  id: string;
  display_name: string | null;
  role: 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';
}

interface DayAssignmentMockRow {
  household_id: string;
  date: string;
  packer_user_id: string | null;
  assigned_by: string;
  assigned_at: string;
}

interface PackersState {
  dayAssignments: DayAssignmentMockRow[];
  users: PackerUserRow[];
  threads: Array<{ id: string; type: string; status: string }>;
  threadTurns: Array<{ server_seq: number; role: string; body: unknown }>;
  emitted: Array<{ householdId: string; event: string; data: string }>;
  simulateThreadInsertError?: boolean;
}

// Models day_assignments (upsert + select/eq/order), users (findByHousehold +
// findUserById), and the lazy coordination thread (threads + thread_turns).
function buildPackersMockSupabase(state: PackersState) {
  return {
    from(table: string) {
      if (table === 'day_assignments') {
        return {
          upsert(payload: {
            household_id: string;
            date: string;
            packer_user_id: string | null;
            assigned_by: string;
          }) {
            return {
              select: () => ({
                single: async () => {
                  const row: DayAssignmentMockRow = {
                    household_id: payload.household_id,
                    date: payload.date,
                    packer_user_id: payload.packer_user_id ?? null,
                    assigned_by: payload.assigned_by,
                    assigned_at: new Date().toISOString(),
                  };
                  const idx = state.dayAssignments.findIndex(
                    (r) => r.household_id === row.household_id && r.date === row.date,
                  );
                  if (idx >= 0) state.dayAssignments[idx] = row;
                  else state.dayAssignments.push(row);
                  return { data: row, error: null };
                },
              }),
            };
          },
          select() {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              order() {
                return chain;
              },
              then<T>(resolve: (v: { data: DayAssignmentMockRow[]; error: null }) => T): T {
                const rows = state.dayAssignments
                  .filter((r) => r.household_id === filters.household_id)
                  .slice()
                  .sort((a, b) => (a.date < b.date ? -1 : 1));
                return resolve({ data: rows, error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === 'users') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            let roleFilter: string[] | null = null;
            const chain = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              in(_col: string, vals: string[]) {
                roleFilter = vals;
                return chain;
              },
              order() {
                return chain;
              },
              maybeSingle: async () => {
                const u = state.users.find((x) => x.id === filters.id);
                return { data: u ?? null, error: null };
              },
              then<T>(resolve: (v: { data: PackerUserRow[]; error: null }) => T): T {
                const rows = roleFilter
                  ? state.users.filter((x) => roleFilter!.includes(x.role))
                  : state.users;
                return resolve({ data: rows, error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === 'threads') {
        return {
          select() {
            const chain = {
              eq: () => chain,
              order: () => chain,
              limit: () => chain,
              maybeSingle: async () => {
                const t = state.threads.find(
                  (x) => x.type === 'coordination' && x.status === 'active',
                );
                return { data: t ?? null, error: null };
              },
            };
            return chain;
          },
          insert(payload: { type: string; modality: string }) {
            return {
              select: () => ({
                single: async () => {
                  const t = {
                    id: randomUUID(),
                    household_id: SAMPLE_HOUSEHOLD_ID,
                    type: payload.type,
                    status: 'active',
                    modality: payload.modality,
                    created_at: new Date().toISOString(),
                  };
                  state.threads.push({ id: t.id, type: t.type, status: t.status });
                  return { data: t, error: null };
                },
              }),
            };
          },
        };
      }
      if (table === 'thread_turns') {
        return {
          select() {
            const chain = {
              eq: () => chain,
              order: () => chain,
              limit: () => chain,
              maybeSingle: async () => {
                if (state.threadTurns.length === 0) return { data: null, error: null };
                const max = Math.max(...state.threadTurns.map((t) => t.server_seq));
                return { data: { server_seq: max }, error: null };
              },
            };
            return chain;
          },
          insert(payload: {
            thread_id: string;
            server_seq: number;
            role: string;
            body: unknown;
            modality: string;
          }) {
            return {
              select: () => ({
                single: async () => {
                  if (state.simulateThreadInsertError) {
                    return { data: null, error: { message: 'simulated insert error', code: '23505' } };
                  }
                  const turn = {
                    id: randomUUID(),
                    thread_id: payload.thread_id,
                    server_seq: payload.server_seq,
                    role: payload.role,
                    body: payload.body,
                    modality: payload.modality,
                    created_at: new Date().toISOString(),
                  };
                  state.threadTurns.push({
                    server_seq: payload.server_seq,
                    role: payload.role,
                    body: payload.body,
                  });
                  return { data: turn, error: null };
                },
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function freshPackersState(users: PackerUserRow[] = []): PackersState {
  return { dayAssignments: [], users, threads: [], threadTurns: [], emitted: [] };
}

async function buildPackersApp(state: PackersState): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET, ENVELOPE_ENCRYPTION_MASTER_KEY: '' };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate(
    'supabase',
    buildPackersMockSupabase(state) as unknown as FastifyInstance['supabase'],
  );
  app.decorate('sseDispatcher', {
    register: vi.fn(),
    unregister: vi.fn(),
    emit: (householdId: string, event: string, data: string) => {
      state.emitted.push({ householdId, event, data });
    },
  } as unknown as FastifyInstance['sseDispatcher']);

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

function signGuest(app: FastifyInstance): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'guest_author' });
}

const PRIMARY_MEMBER: PackerUserRow = {
  id: SAMPLE_USER_ID,
  display_name: 'Alex',
  role: 'primary_parent',
};
const SECONDARY_MEMBER: PackerUserRow = {
  id: '55555555-5555-4555-8555-555555555555',
  display_name: 'Devon',
  role: 'secondary_caregiver',
};

describe('GET /v1/households/:id/packers (5-S3)', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 — empty array when no days are assigned', async () => {
    app = await buildPackersApp(freshPackersState([PRIMARY_MEMBER, SECONDARY_MEMBER]));
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/packers`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ assignments: [] });
  });

  it('200 — resolves packer_display_name from the roster', async () => {
    const state = freshPackersState([PRIMARY_MEMBER, SECONDARY_MEMBER]);
    state.dayAssignments.push({
      household_id: SAMPLE_HOUSEHOLD_ID,
      date: '2026-06-16',
      packer_user_id: SECONDARY_MEMBER.id,
      assigned_by: SAMPLE_USER_ID,
      assigned_at: new Date().toISOString(),
    });
    app = await buildPackersApp(state);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/packers`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      assignments: Array<{ date: string; packer_user_id: string | null; packer_display_name: string | null }>;
    };
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0]).toEqual({
      date: '2026-06-16',
      packer_user_id: SECONDARY_MEMBER.id,
      packer_display_name: 'Devon',
    });
  });

  it('403 — cross-household read', async () => {
    app = await buildPackersApp(freshPackersState([PRIMARY_MEMBER]));
    const token = signPrimary(app); // hh = SAMPLE_HOUSEHOLD_ID

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/packers`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /v1/households/:id/days/:date/packer (5-S3)', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 — upserts the row and emits packer.assigned SSE', async () => {
    const state = freshPackersState([PRIMARY_MEMBER, SECONDARY_MEMBER]);
    app = await buildPackersApp(state);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/days/2026-06-16/packer`,
      headers: { authorization: `Bearer ${token}` },
      payload: { packer_user_id: SECONDARY_MEMBER.id },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      date: '2026-06-16',
      packer_user_id: SECONDARY_MEMBER.id,
      packer_display_name: 'Devon',
    });
    expect(state.dayAssignments).toHaveLength(1);
    expect(state.dayAssignments[0]?.packer_user_id).toBe(SECONDARY_MEMBER.id);
    // Slice 5-S4 — two emissions on assign: packer.assigned (canvas refresh) and
    // thread.turn (sequence tracking for gap detection).
    expect(state.emitted).toHaveLength(2);
    const emittedPayload = JSON.parse(state.emitted[0]!.data) as { type: string; date: string; packer_id: string };
    expect(emittedPayload).toEqual({
      type: 'packer.assigned',
      date: '2026-06-16',
      packer_id: SECONDARY_MEMBER.id,
    });
    const threadTurnPayload = JSON.parse(state.emitted[1]!.data) as {
      type: string;
      thread_id: string;
      turn: { server_seq: string; role: string };
    };
    expect(threadTurnPayload.type).toBe('thread.turn');
    // server_seq is stringified for JSON safety (bigint → numeric string).
    expect(threadTurnPayload.turn.server_seq).toBe('1');
    expect(threadTurnPayload.turn.role).toBe('system');
  });

  it('200 — null clears the assignment: no packer.assigned, but thread.turn still emitted', async () => {
    // Slice 5-S4 — clearing an assignment is still a coordination event, so the
    // thread write (and its thread.turn emission) fires. packer.assigned is
    // suppressed because its contract packer_id is non-nullable.
    const state = freshPackersState([PRIMARY_MEMBER, SECONDARY_MEMBER]);
    app = await buildPackersApp(state);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/days/2026-06-16/packer`,
      headers: { authorization: `Bearer ${token}` },
      payload: { packer_user_id: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      date: '2026-06-16',
      packer_user_id: null,
      packer_display_name: null,
    });
    expect(state.dayAssignments[0]?.packer_user_id).toBeNull();
    expect(state.emitted).toHaveLength(1);
    const onlyPayload = JSON.parse(state.emitted[0]!.data) as {
      type: string;
      turn: { server_seq: string; role: string; modality: string };
    };
    expect(onlyPayload.type).toBe('thread.turn');
    expect(/^\d+$/.test(onlyPayload.turn.server_seq)).toBe(true);
    expect(onlyPayload.turn.role).toBe('system');
    expect(onlyPayload.turn.modality).toBeDefined();
  });

  it('400 — invalid date format', async () => {
    app = await buildPackersApp(freshPackersState([PRIMARY_MEMBER]));
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/days/not-a-date/packer`,
      headers: { authorization: `Bearer ${token}` },
      payload: { packer_user_id: null },
    });

    expect(res.statusCode).toBe(400);
  });

  it('403 — cross-household write', async () => {
    app = await buildPackersApp(freshPackersState([PRIMARY_MEMBER]));
    const token = signPrimary(app); // hh = SAMPLE_HOUSEHOLD_ID

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/days/2026-06-16/packer`,
      headers: { authorization: `Bearer ${token}` },
      payload: { packer_user_id: null },
    });

    expect(res.statusCode).toBe(403);
  });

  it('403 — guest_author cannot assign', async () => {
    app = await buildPackersApp(freshPackersState([PRIMARY_MEMBER]));
    const token = signGuest(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/days/2026-06-16/packer`,
      headers: { authorization: `Bearer ${token}` },
      payload: { packer_user_id: null },
    });

    expect(res.statusCode).toBe(403);
  });

  it('400 — packer_user_id does not belong to the household', async () => {
    app = await buildPackersApp(freshPackersState([PRIMARY_MEMBER, SECONDARY_MEMBER]));
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/days/2026-06-16/packer`,
      headers: { authorization: `Bearer ${token}` },
      payload: { packer_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('200 — appendTurnNext failure on assign: only packer.assigned emitted, no thread.turn', async () => {
    // Slice 5-S4 — the thread write is best-effort. When appendTurnNext throws,
    // the route still returns 200 and still emits packer.assigned (which fired
    // before the try-catch). thread.turn must NOT be emitted.
    const state = freshPackersState([PRIMARY_MEMBER, SECONDARY_MEMBER]);
    state.simulateThreadInsertError = true;
    app = await buildPackersApp(state);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/days/2026-06-16/packer`,
      headers: { authorization: `Bearer ${token}` },
      payload: { packer_user_id: SECONDARY_MEMBER.id },
    });

    expect(res.statusCode).toBe(200);
    expect(state.emitted).toHaveLength(1);
    const emittedPayload = JSON.parse(state.emitted[0]!.data) as { type: string };
    expect(emittedPayload.type).toBe('packer.assigned');
  });

  it('200 — appendTurnNext failure on clear: no events emitted', async () => {
    // Slice 5-S4 — clearing an assignment with a failing thread write emits
    // nothing: packer.assigned is suppressed (packer_id is null, non-nullable
    // in contract) and thread.turn never fires because appendTurnNext threw.
    const state = freshPackersState([PRIMARY_MEMBER]);
    state.simulateThreadInsertError = true;
    app = await buildPackersApp(state);
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/days/2026-06-16/packer`,
      headers: { authorization: `Bearer ${token}` },
      payload: { packer_user_id: null },
    });

    expect(res.statusCode).toBe(200);
    expect(state.emitted).toHaveLength(0);
  });
});

// Slice 5-S8 — POST /v1/households/:householdId/brief/learning-moment
describe('POST /v1/households/:householdId/brief/learning-moment', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 204 and calls respondToLearningMoment with the action', async () => {
    const respondToLearningMoment = vi.fn().mockResolvedValue(undefined);
    app = await buildTestApp({
      state: freshState(),
      briefStateComposer: { respondToLearningMoment },
    });
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief/learning-moment`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'confirm' },
    });

    expect(res.statusCode).toBe(204);
    expect(respondToLearningMoment).toHaveBeenCalledWith(
      SAMPLE_HOUSEHOLD_ID,
      'confirm',
      expect.any(String),
    );
  });

  it('returns 403 on a cross-household respond', async () => {
    const respondToLearningMoment = vi.fn().mockResolvedValue(undefined);
    app = await buildTestApp({
      state: freshState(),
      briefStateComposer: { respondToLearningMoment },
    });
    const token = signPrimary(app);
    const otherHousehold = '99999999-9999-4999-8999-999999999999';

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${otherHousehold}/brief/learning-moment`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'confirm' },
    });

    expect(res.statusCode).toBe(403);
    expect(respondToLearningMoment).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid action', async () => {
    const respondToLearningMoment = vi.fn().mockResolvedValue(undefined);
    app = await buildTestApp({
      state: freshState(),
      briefStateComposer: { respondToLearningMoment },
    });
    const token = signPrimary(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief/learning-moment`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'banana' },
    });

    expect(res.statusCode).toBe(400);
  });
});
