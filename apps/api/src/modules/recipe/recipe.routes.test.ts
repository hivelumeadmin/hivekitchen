import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { recipeRoutes } from './recipe.routes.js';

// Story 14-s4 — GET /v1/recipes/:recipeId, the day-detail Wall Card's recipe
// read. Covers the auth rail, the visibility guard (404-not-403), the legacy
// ingredient shape, and validation.

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HOUSEHOLD_ID = '33333333-3333-4333-8333-333333333333';
const RECIPE_ID = '44444444-4444-4444-8444-444444444444';
const JWT_SECRET = 'a'.repeat(32);

function dayViewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RECIPE_ID,
    canonical_name: 'Dal + rice thermos',
    ingredients: ['1 cup yellow dal', '1.5 cups basmati rice'],
    prep_time_minutes: 20,
    finish_time_minutes: 6,
    source: 'agent_generated',
    visibility: 'private',
    created_by_household_id: SAMPLE_HOUSEHOLD_ID,
    ...overrides,
  };
}

const STEPS = [
  { id: 's1', recipe_id: RECIPE_ID, sequence: 1, mode: 'prep', text: 'Cook the dal.', created_at: '2026-05-04T00:00:00.000Z' },
  { id: 's2', recipe_id: RECIPE_ID, sequence: 2, mode: 'finish', text: 'Layer and seal.', created_at: '2026-05-04T00:00:00.000Z' },
];

async function buildTestApp(
  opts: {
    findForDayView?: ReturnType<typeof vi.fn>;
    findStepsByRecipeId?: ReturnType<typeof vi.fn>;
  } = {},
): Promise<FastifyInstance> {
  const findForDayView = opts.findForDayView ?? vi.fn().mockResolvedValue(dayViewRow());
  const findStepsByRecipeId = opts.findStepsByRecipeId ?? vi.fn().mockResolvedValue(STEPS);

  // The route constructs its own RecipesRepository from fastify.supabase, so
  // the seam is the repository prototype rather than a decorated service.
  const { RecipesRepository } = await import('./recipes.repository.js');
  vi.spyOn(RecipesRepository.prototype, 'findForDayView').mockImplementation(
    findForDayView as never,
  );
  vi.spyOn(RecipesRepository.prototype, 'findStepsByRecipeId').mockImplementation(
    findStepsByRecipeId as never,
  );

  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('env', { NODE_ENV: 'development', JWT_SECRET } as unknown as FastifyInstance['env']);
  app.decorate('supabase', {} as unknown as FastifyInstance['supabase']);

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
    if (obj.cause instanceof ZodError || (Array.isArray(obj.validation) && obj.validation.length > 0)) {
      void reply.status(400).send({ type: '/errors/validation', status: 400 });
      return;
    }
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  await app.register(recipeRoutes);
  await app.ready();
  return app;
}

function signMember(app: FastifyInstance): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: SAMPLE_HOUSEHOLD_ID, role: 'secondary_caregiver' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /v1/recipes/:recipeId', () => {
  it('returns the recipe content and ordered steps for an owned recipe', async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${signMember(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      recipe: { canonical_name: string; ingredients: string[]; prep_time_minutes: number };
      steps: Array<{ sequence: number; mode: string; text: string }>;
    };
    expect(body.recipe.canonical_name).toBe('Dal + rice thermos');
    expect(body.recipe.ingredients).toEqual(['1 cup yellow dal', '1.5 cups basmati rice']);
    expect(body.recipe.prep_time_minutes).toBe(20);
    // Both modes are returned — the Wall Card toggle filters client-side.
    expect(body.steps.map((s) => s.mode)).toEqual(['prep', 'finish']);
    await app.close();
  });

  it('requires authentication', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: `/v1/recipes/${RECIPE_ID}` });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('404s a private recipe owned by another household (never 403 — no existence leak)', async () => {
    const app = await buildTestApp({
      findForDayView: vi
        .fn()
        .mockResolvedValue(
          dayViewRow({ visibility: 'private', created_by_household_id: OTHER_HOUSEHOLD_ID }),
        ),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${signMember(app)}` },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('reads a curated / catalog-seeded row with a NULL owner', async () => {
    const app = await buildTestApp({
      findForDayView: vi.fn().mockResolvedValue(
        dayViewRow({
          visibility: 'private',
          created_by_household_id: null,
          source: 'catalog_seeded',
        }),
      ),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${signMember(app)}` },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("reads another household's SHARED recipe", async () => {
    const app = await buildTestApp({
      findForDayView: vi
        .fn()
        .mockResolvedValue(
          dayViewRow({ visibility: 'shared', created_by_household_id: OTHER_HOUSEHOLD_ID }),
        ),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${signMember(app)}` },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('404s an unknown recipe id', async () => {
    const app = await buildTestApp({ findForDayView: vi.fn().mockResolvedValue(null) });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${signMember(app)}` },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('400s a non-uuid recipe id', async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/v1/recipes/not-a-uuid',
      headers: { authorization: `Bearer ${signMember(app)}` },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('serializes an oversized legacy row — response schemas are descriptive, never a 500', async () => {
    // Legacy backfill emitted one recipe_steps row per instruction line, so
    // real rows exceed the write-side caps (40 ingredients / 40 steps / 256
    // chars). The read must return them, not fail serialization.
    const manyIngredients = Array.from(
      { length: 45 },
      (_, i) => `ingredient ${String(i)} — ${'x'.repeat(300)}`,
    );
    const manySteps = Array.from({ length: 45 }, (_, i) => ({
      id: `s${String(i)}`,
      recipe_id: RECIPE_ID,
      sequence: i + 1,
      mode: i % 2 === 0 ? 'prep' : 'finish',
      text: `step ${String(i)} — ${'y'.repeat(700)}`,
      created_at: '2026-05-04T00:00:00.000Z',
    }));
    const app = await buildTestApp({
      findForDayView: vi.fn().mockResolvedValue(dayViewRow({ ingredients: manyIngredients })),
      findStepsByRecipeId: vi.fn().mockResolvedValue(manySteps),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${signMember(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { recipe: { ingredients: string[] }; steps: unknown[] };
    expect(body.recipe.ingredients).toHaveLength(45);
    expect(body.steps).toHaveLength(45);
    await app.close();
  });

  it('does not query steps when the recipe is not readable', async () => {
    const findStepsByRecipeId = vi.fn().mockResolvedValue(STEPS);
    const app = await buildTestApp({
      findForDayView: vi.fn().mockResolvedValue(null),
      findStepsByRecipeId,
    });

    await app.inject({
      method: 'GET',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${signMember(app)}` },
    });

    expect(findStepsByRecipeId).not.toHaveBeenCalled();
    await app.close();
  });
});
