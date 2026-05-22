import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { KitchenMap } from '@hivekitchen/types';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { householdScopeHook } from '../../middleware/household-scope.hook.js';
import { isDomainError } from '../../common/errors.js';
import { kitchenMapRoutes } from './kitchen-map.routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HOUSEHOLD_ID = '55555555-5555-4555-8555-555555555555';
const JWT_SECRET = 'a'.repeat(32);

function sampleKitchenMap(overrides: Partial<KitchenMap> = {}): KitchenMap {
  return {
    household: {
      id: HOUSEHOLD_ID,
      tier: 'standard',
      tier_variant: 'control',
      timezone: 'Europe/London',
      display_name: 'Test Family',
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    },
    caregivers: [],
    children: [],
    cultural: { active: [], suggested: [] },
    memory: { nodes: [] },
    household_extras: { library: [] },
    recipes: { favourites: [], banned: [] },
    allergens: [],
    dietary: [],
    food_preferences: [],
    favorite_lunches: [],
    rules: [],
    meta: {
      composed_at: '2026-05-22T00:00:00.000Z',
      map_version: 1,
      schema_version: '1.1.0',
      is_complete: false,
      required_set_complete: false,
    },
    ...overrides,
  };
}

async function buildTestApp(opts: {
  getResult?: KitchenMap;
  getError?: unknown;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET };
  app.decorate('env', env as unknown as FastifyInstance['env']);

  const getMock = vi.fn();
  if (opts.getError !== undefined) {
    getMock.mockRejectedValue(opts.getError);
  } else {
    getMock.mockResolvedValue(opts.getResult ?? sampleKitchenMap());
  }
  app.decorate('kitchenMapService', {
    get: getMock,
  } as unknown as FastifyInstance['kitchenMapService']);

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

  await app.register(kitchenMapRoutes);
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

describe('GET /v1/households/:householdId/kitchen-map', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 with kitchen map payload when caller household matches', async () => {
    app = await buildTestApp({ getResult: sampleKitchenMap() });
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${HOUSEHOLD_ID}/kitchen-map`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as KitchenMap;
    expect(body.household.id).toBe(HOUSEHOLD_ID);
    expect(body.meta.schema_version).toBe('1.1.0');
  });

  it('403 when householdId path param does not match caller household', async () => {
    app = await buildTestApp({ getResult: sampleKitchenMap() });
    const token = signToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/kitchen-map`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/forbidden');
  });

  it('401 without bearer token', async () => {
    app = await buildTestApp({ getResult: sampleKitchenMap() });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${HOUSEHOLD_ID}/kitchen-map`,
    });

    expect(res.statusCode).toBe(401);
  });
});
