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
const OTHER_HOUSEHOLD_ID = '99999999-9999-4999-8999-999999999999';
const GLOBAL_SKU_ID = '33333333-3333-4333-8333-333333333333';
const HOUSEHOLD_SKU_ID = '44444444-4444-4444-8444-444444444444';
const JWT_SECRET = 'a'.repeat(32);

interface SkuRow {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  allergen_tags: string[];
  is_active: boolean;
  in_stock: boolean;
  archived_at: string | null;
  created_at: string;
  created_by_household_id: string | null;
  upc_code: string | null;
  package_type: string | null;
}

interface MockState {
  rows: SkuRow[];
}

function seededState(): MockState {
  return {
    rows: [
      {
        id: GLOBAL_SKU_ID,
        name: 'Apple',
        brand: null,
        category: 'fruit',
        allergen_tags: [],
        is_active: true,
        in_stock: true,
        archived_at: null,
        created_at: '2026-06-01T00:00:00.000Z',
        created_by_household_id: null,
        upc_code: null,
        package_type: null,
      },
      {
        id: HOUSEHOLD_SKU_ID,
        name: 'Pretzel Twists',
        brand: 'Snyder',
        category: 'grain',
        allergen_tags: ['wheat'],
        is_active: true,
        in_stock: true,
        archived_at: null,
        created_at: '2026-06-10T00:00:00.000Z',
        created_by_household_id: SAMPLE_HOUSEHOLD_ID,
        upc_code: null,
        package_type: null,
      },
    ],
  };
}

function snackSkusTable(state: MockState) {
  return {
    // findActiveForHousehold: .select(COLS).eq('is_active', true).or(...)
    select(_cols: string) {
      const filters: Record<string, unknown> = {};
      let orHouseholdId: string | null = null;
      const chain = {
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        or(expr: string) {
          const m = /created_by_household_id\.eq\.([0-9a-fA-F-]+)/.exec(expr);
          orHouseholdId = m ? m[1] : null;
          return chain;
        },
        then<T>(onFulfilled: (v: { data: SkuRow[]; error: null }) => T): Promise<T> {
          const rows = state.rows.filter(
            (r) =>
              r.is_active === true &&
              (r.created_by_household_id === null ||
                r.created_by_household_id === orHouseholdId),
          );
          return Promise.resolve(onFulfilled({ data: rows, error: null }));
        },
      };
      return chain;
    },
    // create: .insert(row).select(COLS).single()
    insert(row: Partial<SkuRow>) {
      const inserted: SkuRow = {
        id: randomUUID(),
        name: row.name as string,
        brand: (row.brand as string | null) ?? null,
        category: row.category as string,
        allergen_tags: (row.allergen_tags as string[] | undefined) ?? [],
        is_active: true,
        in_stock: true,
        archived_at: null,
        created_at: '2026-06-20T12:00:00.000Z',
        created_by_household_id: (row.created_by_household_id as string | null) ?? null,
        upc_code: (row.upc_code as string | null) ?? null,
        package_type: (row.package_type as string | null) ?? null,
      };
      state.rows.push(inserted);
      return {
        select(_cols: string) {
          return { single: async () => ({ data: inserted, error: null }) };
        },
      };
    },
    // archive: .update(patch).eq('id').eq('created_by_household_id').select('id').maybeSingle()
    update(patch: Partial<SkuRow>) {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        select(_cols: string) {
          return {
            maybeSingle: async () => {
              const match = state.rows.find(
                (r) =>
                  r.id === filters.id &&
                  r.created_by_household_id === filters.created_by_household_id,
              );
              if (!match) return { data: null, error: null };
              if (typeof patch.is_active === 'boolean') match.is_active = patch.is_active;
              if (typeof patch.archived_at === 'string') match.archived_at = patch.archived_at;
              if (typeof patch.in_stock === 'boolean') match.in_stock = patch.in_stock;
              return { data: match, error: null };
            },
          };
        },
      };
      return chain;
    },
  };
}

function buildMockSupabase(state: MockState) {
  return {
    from(table: string) {
      if (table === 'snack_skus') return snackSkusTable(state);
      // The audit flush hook is not registered in this harness; no other table
      // is touched by the snack routes.
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

async function buildApp(state: MockState): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', buildMockSupabase(state) as unknown as FastifyInstance['supabase']);

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

function signPrimary(app: FastifyInstance, householdId = SAMPLE_HOUSEHOLD_ID): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: householdId, role: 'primary_parent' });
}

function signSecondary(app: FastifyInstance, householdId = SAMPLE_HOUSEHOLD_ID): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: householdId, role: 'secondary_caregiver' });
}

describe('GET /v1/households/:id/snacks', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns global seeds + household rows for a caregiver', async () => {
    app = await buildApp(seededState());
    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks`,
      headers: { authorization: `Bearer ${signSecondary(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string; created_by_household_id: string | null }> };
    expect(body.items).toHaveLength(2);
    expect(body.items.some((i) => i.id === GLOBAL_SKU_ID && i.created_by_household_id === null)).toBe(true);
    expect(
      body.items.some((i) => i.id === HOUSEHOLD_SKU_ID && i.created_by_household_id === SAMPLE_HOUSEHOLD_ID),
    ).toBe(true);
  });

  it('includes allergen_tags on every returned item', async () => {
    app = await buildApp(seededState());
    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks`,
      headers: { authorization: `Bearer ${signSecondary(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string; allergen_tags: string[] }> };
    expect(body.items.every((i) => Array.isArray(i.allergen_tags))).toBe(true);
    expect(body.items.find((i) => i.id === HOUSEHOLD_SKU_ID)?.allergen_tags).toEqual(['wheat']);
    expect(body.items.find((i) => i.id === GLOBAL_SKU_ID)?.allergen_tags).toEqual([]);
  });

  it('returns 403 when the path household differs from the token household', async () => {
    app = await buildApp(seededState());
    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks`,
      headers: { authorization: `Bearer ${signPrimary(app, OTHER_HOUSEHOLD_ID)}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /v1/households/:id/snacks', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('creates a household snack and returns 201 with the persisted row', async () => {
    const state = seededState();
    app = await buildApp(state);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks`,
      headers: { authorization: `Bearer ${signPrimary(app)}` },
      payload: {
        name: 'Hummus Cup',
        brand: 'Sabra',
        category: 'protein',
        upc_code: '012345678905',
        package_type: 'cup',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      name: string;
      category: string;
      created_by_household_id: string | null;
      upc_code: string | null;
      package_type: string | null;
    };
    expect(body.name).toBe('Hummus Cup');
    expect(body.category).toBe('protein');
    expect(body.created_by_household_id).toBe(SAMPLE_HOUSEHOLD_ID);
    expect(body.upc_code).toBe('012345678905');
    expect(body.package_type).toBe('cup');
    expect(state.rows.some((r) => r.name === 'Hummus Cup')).toBe(true);
  });

  it('accepts allergen_tags and returns them on the 201 response', async () => {
    const state = seededState();
    app = await buildApp(state);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks`,
      headers: { authorization: `Bearer ${signPrimary(app)}` },
      payload: { name: 'Cheese Stick', category: 'dairy', allergen_tags: ['dairy'] },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { allergen_tags: string[] };
    expect(body.allergen_tags).toEqual(['dairy']);
    expect(state.rows.find((r) => r.name === 'Cheese Stick')?.allergen_tags).toEqual(['dairy']);
  });

  it('defaults allergen_tags to [] when omitted', async () => {
    const state = seededState();
    app = await buildApp(state);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks`,
      headers: { authorization: `Bearer ${signPrimary(app)}` },
      payload: { name: 'Plain Cracker', category: 'grain' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { allergen_tags: string[] };
    expect(body.allergen_tags).toEqual([]);
  });

  it('returns null upc_code and package_type when they are omitted', async () => {
    const state = seededState();
    app = await buildApp(state);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks`,
      headers: { authorization: `Bearer ${signPrimary(app)}` },
      payload: { name: 'Plain Cracker', category: 'grain' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { upc_code: string | null; package_type: string | null; in_stock: boolean };
    expect(body.upc_code).toBeNull();
    expect(body.package_type).toBeNull();
    expect(body.in_stock).toBe(true);
  });

  it('normalizes a whitespace-only upc_code to null', async () => {
    const state = seededState();
    app = await buildApp(state);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks`,
      headers: { authorization: `Bearer ${signPrimary(app)}` },
      payload: { name: 'Plain Cracker', category: 'grain', upc_code: '   ' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { upc_code: string | null };
    expect(body.upc_code).toBeNull();
  });

  it('returns 403 for a secondary_caregiver', async () => {
    app = await buildApp(seededState());
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks`,
      headers: { authorization: `Bearer ${signSecondary(app)}` },
      payload: { name: 'Hummus Cup', category: 'protein' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 on a cross-household path', async () => {
    app = await buildApp(seededState());
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks`,
      headers: { authorization: `Bearer ${signPrimary(app, OTHER_HOUSEHOLD_ID)}` },
      payload: { name: 'Hummus Cup', category: 'protein' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /v1/households/:id/snacks/:skuId', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('soft-deletes a household-owned snack and returns 204', async () => {
    const state = seededState();
    app = await buildApp(state);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks/${HOUSEHOLD_SKU_ID}`,
      headers: { authorization: `Bearer ${signPrimary(app)}` },
    });

    expect(res.statusCode).toBe(204);
    const row = state.rows.find((r) => r.id === HOUSEHOLD_SKU_ID);
    expect(row?.is_active).toBe(false);
    expect(typeof row?.archived_at).toBe('string');
  });

  it('returns 404 when archiving a global seed (not household-owned)', async () => {
    app = await buildApp(seededState());
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks/${GLOBAL_SKU_ID}`,
      headers: { authorization: `Bearer ${signPrimary(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a secondary_caregiver', async () => {
    app = await buildApp(seededState());
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks/${HOUSEHOLD_SKU_ID}`,
      headers: { authorization: `Bearer ${signSecondary(app)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 on a cross-household path', async () => {
    app = await buildApp(seededState());
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks/${HOUSEHOLD_SKU_ID}`,
      headers: { authorization: `Bearer ${signPrimary(app, OTHER_HOUSEHOLD_ID)}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /v1/households/:id/snacks/:skuId (in-stock toggle)', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('toggles in_stock on a household-owned snack and returns 200 with the updated row', async () => {
    const state = seededState();
    app = await buildApp(state);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks/${HOUSEHOLD_SKU_ID}`,
      headers: { authorization: `Bearer ${signPrimary(app)}` },
      payload: { in_stock: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; in_stock: boolean };
    expect(body.id).toBe(HOUSEHOLD_SKU_ID);
    expect(body.in_stock).toBe(false);
    expect(state.rows.find((r) => r.id === HOUSEHOLD_SKU_ID)?.in_stock).toBe(false);
  });

  it('returns 404 when toggling a global seed (not household-owned)', async () => {
    app = await buildApp(seededState());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks/${GLOBAL_SKU_ID}`,
      headers: { authorization: `Bearer ${signPrimary(app)}` },
      payload: { in_stock: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a secondary_caregiver', async () => {
    app = await buildApp(seededState());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks/${HOUSEHOLD_SKU_ID}`,
      headers: { authorization: `Bearer ${signSecondary(app)}` },
      payload: { in_stock: false },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 on a cross-household path', async () => {
    app = await buildApp(seededState());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/snacks/${HOUSEHOLD_SKU_ID}`,
      headers: { authorization: `Bearer ${signPrimary(app, OTHER_HOUSEHOLD_ID)}` },
      payload: { in_stock: false },
    });
    expect(res.statusCode).toBe(403);
  });
});
