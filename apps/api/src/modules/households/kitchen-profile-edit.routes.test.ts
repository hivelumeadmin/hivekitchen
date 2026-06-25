import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { ChildAllergenMutationResponse } from '@hivekitchen/types';
import { encryptField, normalizedHash } from '../../lib/envelope-encryption.js';
import type { AuditWriteInput } from '../../audit/audit.types.js';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { kitchenProfileEditRoutes } from './kitchen-profile-edit.routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const PRIOR_ID = '44444444-4444-4444-8444-444444444444';
const JWT_SECRET = 'a'.repeat(32);

interface AllergenRow {
  id: string;
  household_id: string;
  child_id: string | null;
  allergen: string; // NOOP ciphertext (kek=null)
  allergen_hash: string;
  source: string;
}
interface PriorRow {
  id: string;
  household_id: string;
  key: string;
  label: string;
  tier: string;
  state: string;
  enforcement: string;
  presence: number;
  confidence: number;
  opted_in_at: string | null;
  opted_out_at: string | null;
  last_signal_at: string;
  created_at: string;
  updated_at: string;
}
interface RecipeRow {
  id: string;
  canonical_name: string;
  created_by_household_id: string;
  is_active: boolean;
}
interface UsageRow {
  household_id: string;
  recipe_id: string;
  is_household_favorite: boolean;
  is_household_banned: boolean;
  catalog_provenance: string;
  last_used_at: string | null;
}
interface MockState {
  children: Array<{ id: string; household_id: string }>;
  allergens: AllergenRow[];
  priors: PriorRow[];
  recipes: RecipeRow[];
  recipeUsage: UsageRow[];
}

function seedAllergen(child_id: string, plain: string, household_id = HOUSEHOLD_ID): AllergenRow {
  return {
    id: randomUUID(),
    household_id,
    child_id,
    allergen: encryptField(plain, null),
    allergen_hash: normalizedHash(plain),
    source: 'parent_edited',
  };
}

function makePrior(overrides: Partial<PriorRow> = {}): PriorRow {
  return {
    id: PRIOR_ID,
    household_id: HOUSEHOLD_ID,
    key: 'halal',
    label: 'Halal',
    tier: 'L1',
    state: 'opt_in_confirmed',
    enforcement: 'default',
    presence: 1,
    confidence: 90,
    opted_in_at: null,
    opted_out_at: null,
    last_signal_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Minimal in-memory Supabase covering only the chains the three routes call.
// kek=null → NOOP encryption, so no `households` DEK table is queried.
function buildMockSupabase(state: MockState) {
  function thenableChain(resolve: (filters: Record<string, unknown>) => unknown[]) {
    const filters: Record<string, unknown> = {};
    const c = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return c;
      },
      select() {
        return c;
      },
      maybeSingle: async () => ({ data: resolve(filters)[0] ?? null, error: null }),
      then(onF: (v: { data: unknown[]; error: null }) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve({ data: resolve(filters), error: null }).then(onF, onR);
      },
    };
    return c;
  }

  return {
    from(table: string) {
      if (table === 'children') {
        return {
          select() {
            return thenableChain((f) =>
              state.children.filter((c) => c.id === f.id && c.household_id === f.household_id),
            );
          },
        };
      }
      if (table === 'household_allergens') {
        return {
          upsert(row: Omit<AllergenRow, 'id'>) {
            return {
              select() {
                return {
                  maybeSingle: async () => {
                    const dup = state.allergens.find(
                      (a) =>
                        a.household_id === row.household_id &&
                        a.child_id === row.child_id &&
                        a.allergen_hash === row.allergen_hash,
                    );
                    if (dup) return { data: null, error: null };
                    const stored: AllergenRow = { id: randomUUID(), ...row };
                    state.allergens.push(stored);
                    return { data: { id: stored.id }, error: null };
                  },
                };
              },
            };
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const c = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return c;
              },
              select() {
                const matched = state.allergens.filter(
                  (a) =>
                    a.household_id === filters.household_id &&
                    a.child_id === filters.child_id &&
                    a.allergen_hash === filters.allergen_hash,
                );
                state.allergens = state.allergens.filter((a) => !matched.includes(a));
                return Promise.resolve({ data: matched.map((a) => ({ id: a.id })), error: null });
              },
            };
            return c;
          },
          select() {
            // findByHouseholdId selects by household_id only; the repo filters
            // child_id in JS. Return the full row shape it decrypts.
            return thenableChain((f) =>
              state.allergens.filter(
                (a) =>
                  a.household_id === f.household_id &&
                  (f.child_id === undefined || a.child_id === f.child_id),
              ),
            );
          },
        };
      }
      if (table === 'cultural_priors') {
        const matches = (p: PriorRow, f: Record<string, unknown>): boolean =>
          (f.household_id === undefined || p.household_id === f.household_id) &&
          (f.key === undefined || p.key === f.key) &&
          (f.id === undefined || p.id === f.id) &&
          (f.state === undefined || p.state === f.state);
        return {
          // findByKeyForHousehold / findByIdForHousehold
          select() {
            return thenableChain((f) => state.priors.filter((p) => matches(p, f)));
          },
          // updateEnforcementByKey (eq key) AND transition (eq id + eq state)
          update(patch: Partial<PriorRow>) {
            const filters: Record<string, unknown> = {};
            const c = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return c;
              },
              select() {
                return {
                  maybeSingle: async () => {
                    const idx = state.priors.findIndex((p) => matches(p, filters));
                    if (idx === -1) return { data: null, error: null };
                    state.priors[idx] = { ...state.priors[idx]!, ...patch };
                    return { data: state.priors[idx], error: null };
                  },
                };
              },
            };
            return c;
          },
        };
      }
      if (table === 'recipes') {
        return {
          insert(row: Record<string, unknown>) {
            const stored: RecipeRow = {
              id: randomUUID(),
              canonical_name: String(row.canonical_name),
              created_by_household_id: String(row.created_by_household_id),
              is_active: true,
            };
            state.recipes.push(stored);
            return {
              select() {
                return { single: async () => ({ data: { id: stored.id }, error: null }) };
              },
            };
          },
          select() {
            const filters: Record<string, unknown> = {};
            const c = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return c;
              },
              ilike(col: string, val: unknown) {
                filters[`ilike_${col}`] = val;
                return c;
              },
              maybeSingle: async () => ({ data: null, error: null }),
              then(onF: (v: { data: unknown[]; error: null }) => unknown, onR?: (e: unknown) => unknown) {
                const rows = state.recipes
                  .filter(
                    (r) =>
                      (filters.created_by_household_id === undefined ||
                        r.created_by_household_id === filters.created_by_household_id) &&
                      (filters.ilike_canonical_name === undefined ||
                        r.canonical_name.toLowerCase() ===
                          String(filters.ilike_canonical_name).toLowerCase()),
                  )
                  .map((r) => ({ id: r.id }));
                return Promise.resolve({ data: rows, error: null }).then(onF, onR);
              },
            };
            return c;
          },
        };
      }
      if (table === 'household_recipe_usage') {
        return {
          insert(row: Record<string, unknown>) {
            state.recipeUsage.push({
              household_id: String(row.household_id),
              recipe_id: String(row.recipe_id),
              is_household_favorite: row.is_household_favorite === true,
              is_household_banned: false,
              catalog_provenance: String(row.catalog_provenance ?? 'declared'),
              last_used_at: (row.last_used_at as string | undefined) ?? null,
            });
            return Promise.resolve({ data: null, error: null });
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const c = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return c;
              },
              in(_col: string, ids: string[]) {
                state.recipeUsage = state.recipeUsage.filter(
                  (u) => !(u.household_id === filters.household_id && ids.includes(u.recipe_id)),
                );
                return Promise.resolve({ data: null, error: null });
              },
            };
            return c;
          },
          select() {
            const filters: Record<string, unknown> = {};
            const c = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return c;
              },
              order() {
                return c;
              },
              then(onF: (v: { data: unknown[]; error: null }) => unknown, onR?: (e: unknown) => unknown) {
                const rows = state.recipeUsage
                  .filter(
                    (u) =>
                      (filters.household_id === undefined ||
                        u.household_id === filters.household_id) &&
                      (filters.is_household_banned === undefined ||
                        u.is_household_banned === filters.is_household_banned),
                  )
                  .map((u) => {
                    const recipe = state.recipes.find((r) => r.id === u.recipe_id);
                    return recipe
                      ? {
                          is_household_favorite: u.is_household_favorite,
                          catalog_provenance: u.catalog_provenance,
                          last_used_at: u.last_used_at,
                          recipes: {
                            canonical_name: recipe.canonical_name,
                            is_active: recipe.is_active,
                          },
                        }
                      : null;
                  })
                  .filter((r) => r !== null);
                return Promise.resolve({ data: rows, error: null }).then(onF, onR);
              },
            };
            return c;
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc() {
      return Promise.resolve({ data: [], error: null });
    },
  };
}

async function buildTestApp(
  state: MockState,
  capturedAudit?: { value: AuditWriteInput | undefined },
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET, ENVELOPE_ENCRYPTION_MASTER_KEY: '' };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate('supabase', buildMockSupabase(state) as unknown as FastifyInstance['supabase']);

  await app.register(jwt, { secret: JWT_SECRET, sign: { expiresIn: '15m' } });
  await app.register(authenticateHook);

  if (capturedAudit) {
    app.addHook('onResponse', async (request) => {
      capturedAudit.value = request.auditContext;
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
      void reply.status(400).send({ type: '/errors/validation', status: 400 });
      return;
    }
    const obj = err as { validation?: unknown; cause?: unknown };
    if (obj.cause instanceof ZodError || (Array.isArray(obj.validation) && obj.validation.length > 0)) {
      void reply.status(400).send({ type: '/errors/validation', status: 400 });
      return;
    }
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  await app.register(kitchenProfileEditRoutes);
  await app.ready();
  return app;
}

type Role = 'primary_parent' | 'secondary_caregiver' | 'guest_author';
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

function emptyState(overrides: Partial<MockState> = {}): MockState {
  return {
    children: [{ id: CHILD_ID, household_id: HOUSEHOLD_ID }],
    allergens: [],
    priors: [makePrior()],
    recipes: [],
    recipeUsage: [],
    ...overrides,
  };
}

function seedFavorite(canonical: string, household_id = HOUSEHOLD_ID): {
  recipe: RecipeRow;
  usage: UsageRow;
} {
  const recipe: RecipeRow = {
    id: randomUUID(),
    canonical_name: canonical,
    created_by_household_id: household_id,
    is_active: true,
  };
  const usage: UsageRow = {
    household_id,
    recipe_id: recipe.id,
    is_household_favorite: true,
    is_household_banned: false,
    catalog_provenance: 'declared',
    last_used_at: '2026-01-01T00:00:00.000Z',
  };
  return { recipe, usage };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /v1/children/:childId/allergens', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 adds a curated allergen and returns the child list', async () => {
    const state = emptyState();
    const audit = { value: undefined as AuditWriteInput | undefined };
    app = await buildTestApp(state, audit);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${CHILD_ID}/allergens`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { allergen: 'peanut' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as ChildAllergenMutationResponse;
    expect(body.child_id).toBe(CHILD_ID);
    expect(body.allergens).toEqual(['peanut']);
    expect(state.allergens).toHaveLength(1);
    expect(state.allergens[0]!.source).toBe('parent_edited');
    // PII-free audit — allergen string never in metadata.
    expect(audit.value?.event_type).toBe('household.profile_updated');
    expect(JSON.stringify(audit.value?.metadata)).not.toContain('peanut');
  });

  it('400 rejects a non-curated (free-text) allergen', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${CHILD_ID}/allergens`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { allergen: 'peanuts' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${CHILD_ID}/allergens`,
      payload: { allergen: 'peanut' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for a non-primary-parent role', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${CHILD_ID}/allergens`,
      headers: { authorization: `Bearer ${signToken(app, { role: 'secondary_caregiver' })}` },
      payload: { allergen: 'peanut' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 for a child in another household (no existence leak)', async () => {
    app = await buildTestApp(emptyState({ children: [] }));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${CHILD_ID}/allergens`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { allergen: 'peanut' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /v1/children/:childId/allergens/:allergen', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 removes exactly one allergen and leaves the others intact', async () => {
    const peanut = seedAllergen(CHILD_ID, 'peanut');
    const milk = seedAllergen(CHILD_ID, 'milk');
    app = await buildTestApp(emptyState({ allergens: [peanut, milk] }));
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/children/${CHILD_ID}/allergens/peanut`,
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as ChildAllergenMutationResponse;
    expect(body.allergens).toEqual(['milk']);
  });

  it('404 when the allergen value matches no row', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/children/${CHILD_ID}/allergens/peanut`,
      headers: { authorization: `Bearer ${signToken(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/children/${CHILD_ID}/allergens/peanut`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for a non-primary-parent role', async () => {
    const peanut = seedAllergen(CHILD_ID, 'peanut');
    app = await buildTestApp(emptyState({ allergens: [peanut] }));
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/children/${CHILD_ID}/allergens/peanut`,
      headers: { authorization: `Bearer ${signToken(app, { role: 'secondary_caregiver' })}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /v1/households/:id/cultural-priors/enforcement', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 updates the enforcement level by key', async () => {
    const state = emptyState();
    app = await buildTestApp(state);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${HOUSEHOLD_ID}/cultural-priors/enforcement`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { key: 'halal', enforcement: 'strong' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { key: string; enforcement: string };
    expect(body).toEqual({ key: 'halal', enforcement: 'strong' });
    expect(state.priors[0]!.enforcement).toBe('strong');
  });

  it('400 rejects a UI-tier value that is not an API enforcement rung', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${HOUSEHOLD_ID}/cultural-priors/enforcement`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { key: 'halal', enforcement: 'always' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 when the path household does not match the caller (no existence leak)', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${randomUUID()}/cultural-priors/enforcement`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { key: 'halal', enforcement: 'strong' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${HOUSEHOLD_ID}/cultural-priors/enforcement`,
      payload: { key: 'halal', enforcement: 'strong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('404 when the prior key is not in the caller household', async () => {
    app = await buildTestApp(emptyState({ priors: [] }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${HOUSEHOLD_ID}/cultural-priors/enforcement`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { key: 'halal', enforcement: 'strong' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// Story 7-S15 (Arc B)
describe('PATCH /v1/households/:id/cultural-priors/state', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 opt_in transitions the prior and returns the new state', async () => {
    const state = emptyState({ priors: [makePrior({ state: 'suggested' })] });
    const audit = { value: undefined as AuditWriteInput | undefined };
    app = await buildTestApp(state, audit);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${HOUSEHOLD_ID}/cultural-priors/state`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { key: 'halal', action: 'opt_in' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ key: 'halal', state: 'opt_in_confirmed' });
    expect(state.priors[0]!.state).toBe('opt_in_confirmed');
    expect(audit.value?.event_type).toBe('template.state_changed');
  });

  it('200 forget transitions an opted-in prior to forgotten', async () => {
    const state = emptyState({ priors: [makePrior({ state: 'opt_in_confirmed' })] });
    app = await buildTestApp(state);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${HOUSEHOLD_ID}/cultural-priors/state`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { key: 'halal', action: 'forget' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ key: 'halal', state: 'forgotten' });
  });

  it('404 when the key is not found for the household', async () => {
    app = await buildTestApp(emptyState({ priors: [] }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${HOUSEHOLD_ID}/cultural-priors/state`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { key: 'halal', action: 'opt_in' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404 when the path household does not match the caller (no existence leak)', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${randomUUID()}/cultural-priors/state`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { key: 'halal', action: 'opt_in' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${HOUSEHOLD_ID}/cultural-priors/state`,
      payload: { key: 'halal', action: 'opt_in' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for a non-primary-parent role', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/households/${HOUSEHOLD_ID}/cultural-priors/state`,
      headers: { authorization: `Bearer ${signToken(app, { role: 'secondary_caregiver' })}` },
      payload: { key: 'halal', action: 'opt_in' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// Story 7-S15 (Arc A)
describe('PUT /v1/households/:id/favorite-lunches', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 diffs the list: adds new items and removes dropped ones', async () => {
    const pasta = seedFavorite('Pasta');
    const state = emptyState({ recipes: [pasta.recipe], recipeUsage: [pasta.usage] });
    const audit = { value: undefined as AuditWriteInput | undefined };
    app = await buildTestApp(state, audit);
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/households/${HOUSEHOLD_ID}/favorite-lunches`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { items: ['Sushi'] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { items: string[] };
    expect(body.items).toEqual(['Sushi']);
    expect(audit.value?.event_type).toBe('household.profile_updated');
    expect(audit.value?.metadata).toMatchObject({
      subject: 'favorite_lunches',
      added: 1,
      removed: 1,
    });
  });

  it('200 empty list removes all existing favorites', async () => {
    const pasta = seedFavorite('Pasta');
    const state = emptyState({ recipes: [pasta.recipe], recipeUsage: [pasta.usage] });
    app = await buildTestApp(state);
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/households/${HOUSEHOLD_ID}/favorite-lunches`,
      headers: { authorization: `Bearer ${signToken(app)}` },
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ items: [] });
    expect(state.recipeUsage).toHaveLength(0);
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/households/${HOUSEHOLD_ID}/favorite-lunches`,
      payload: { items: ['Sushi'] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for a non-primary-parent role', async () => {
    app = await buildTestApp(emptyState());
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/households/${HOUSEHOLD_ID}/favorite-lunches`,
      headers: { authorization: `Bearer ${signToken(app, { role: 'secondary_caregiver' })}` },
      payload: { items: ['Sushi'] },
    });
    expect(res.statusCode).toBe(403);
  });
});
